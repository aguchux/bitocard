import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resellerExchangeApi } from '../src/reseller';
import { makeStore, setRequestContext } from '../src';

type Call = { url: string; method: string; headers: Headers; body: string | null };
let calls: Call[];

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, headers: input.headers, body: input.method === 'GET' ? null : await input.text() });
    if (input.url.includes('/desk/trades') && !input.url.includes('starting_after')) {
      return Response.json({ object: 'list', data: [{ object: 'desk_trade', id: 't1' }], has_more: true });
    }
    return input.method === 'GET' ? Response.json({ object: 'list', data: [], has_more: false }) : Response.json({ object: 'exchange_reserves', coins: [], wallets: [] });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setRequestContext({ reseller: null, mode: 'live' });
});

describe('reseller exchange', () => {
  test('desk trades page by cursor at /v1/exchange/desk/trades', async () => {
    setRequestContext({ reseller: 'r1', mode: 'test' });
    const store = makeStore();
    const pages = store.dispatch(resellerExchangeApi.endpoints.resellerDeskTrades.initiate(undefined));
    await pages;
    await store.dispatch(resellerExchangeApi.endpoints.resellerDeskTrades.initiate(undefined, { direction: 'forward' }));
    expect(calls.map(call => call.url)).toEqual(['http://api.test/v1/exchange/desk/trades?limit=25', 'http://api.test/v1/exchange/desk/trades?limit=25&starting_after=t1']);
    expect(calls.every(call => call.headers.get('bitocard-mode') === 'test')).toBe(true);
    pages.unsubscribe();
  });

  test('moving reserve money refetches the reserves (and the wallet it came from)', async () => {
    const store = makeStore();
    const reserves = store.dispatch(resellerExchangeApi.endpoints.resellerExchangeReserves.initiate());
    await reserves;
    await store.dispatch(resellerExchangeApi.endpoints.transferExchangeReserve.initiate({ currency: 'NGN', amount: 5000, direction: 'withdraw' }));
    const post = calls.find(call => call.method === 'POST');
    expect(post?.url).toBe('http://api.test/v1/exchange/reserves/transfers');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ currency: 'NGN', amount: 5000, direction: 'withdraw' });
    await vi.waitFor(() => expect(calls.filter(call => call.url === 'http://api.test/v1/exchange/reserves').length).toBe(2));
    reserves.unsubscribe();
  });
});
