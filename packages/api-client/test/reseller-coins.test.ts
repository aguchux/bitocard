import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resellerCoinsApi, resellerExchangeApi } from '../src/reseller';
import { makeStore, setRequestContext } from '../src';

type Call = {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
};
let calls: Call[];

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({
      url: input.url,
      method: input.method,
      headers: input.headers,
      body: input.method === 'GET' ? null : await input.text(),
    });
    if (input.url.endsWith('/v1/crypto'))
      return Response.json({
        object: 'reseller_coins',
        mode: 'test',
        onchain: true,
        assets: [],
      });
    if (input.method !== 'GET')
      return Response.json({
        object: 'crypto_withdrawal',
        id: 'w1',
        status: 'queued',
      });
    return Response.json({ object: 'list', data: [], has_more: false });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setRequestContext({ reseller: null, mode: 'live' });
});

const gets = (url: string) => calls.filter(call => call.method === 'GET' && call.url === url).length;

describe('reseller coins', () => {
  test('balances and networks are read from /v1/crypto in the chosen mode', async () => {
    setRequestContext({ reseller: 'r1', mode: 'test' });
    const store = makeStore();
    await store.dispatch(resellerCoinsApi.endpoints.resellerCoins.initiate());
    await store.dispatch(resellerCoinsApi.endpoints.coinWithdrawalNetworks.initiate('USDT'));
    expect(calls.map(call => call.url)).toEqual(['http://api.test/v1/crypto', 'http://api.test/v1/crypto/withdrawal-networks?asset=USDT']);
    expect(calls.every(call => call.headers.get('bitocard-mode') === 'test' && call.headers.get('bitocard-reseller') === 'r1')).toBe(true);
  });

  test('confirming a withdrawal refetches the coin wallet, the withdrawals and the exchange pages', async () => {
    const store = makeStore();
    const coins = store.dispatch(resellerCoinsApi.endpoints.resellerCoins.initiate());
    const list = store.dispatch(resellerCoinsApi.endpoints.coinWithdrawals.initiate());
    const reserves = store.dispatch(resellerExchangeApi.endpoints.resellerExchangeReserves.initiate());
    await Promise.all([coins, list, reserves]);
    await store.dispatch(
      resellerCoinsApi.endpoints.confirmCoinWithdrawal.initiate({
        id: 'w1',
        code: '123456',
      }),
    );
    const post = calls.find(call => call.method === 'POST');
    expect(post?.url).toBe('http://api.test/v1/crypto/withdrawals/w1/confirm');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ code: '123456' });
    expect(post?.headers.get('idempotency-key')).toBeTruthy();
    await vi.waitFor(() => {
      expect(gets('http://api.test/v1/crypto')).toBe(2);
      expect(gets('http://api.test/v1/crypto/withdrawals')).toBe(2);
      expect(gets('http://api.test/v1/exchange/reserves')).toBe(2);
    });
    [coins, list, reserves].forEach(sub => sub.unsubscribe());
  });

  test('a preview sends preview: true and changes nothing cached', async () => {
    const store = makeStore();
    const coins = store.dispatch(resellerCoinsApi.endpoints.resellerCoins.initiate());
    await coins;
    await store.dispatch(
      resellerCoinsApi.endpoints.previewCoinWithdrawal.initiate({
        asset: 'USDT',
        chain: 'TRON',
        address_id: 'a1',
        amount: '10',
      }),
    );
    const post = calls.find(call => call.method === 'POST');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      asset: 'USDT',
      chain: 'TRON',
      address_id: 'a1',
      amount: '10',
      preview: true,
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(gets('http://api.test/v1/crypto')).toBe(1);
    coins.unsubscribe();
  });
});
