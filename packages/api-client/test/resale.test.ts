import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bpsPercent, resaleApi, resaleStateText } from '../src/reseller';
import { makeStore } from '../src';

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, body: input.method === 'GET' ? null : await input.text() });
    return Response.json(input.method === 'GET' ? { object: 'list', data: [], total: 0, offset: 0, limit: 24 } : { object: 'resale_listing', id: 'r1' });
  });
});

afterEach(() => vi.unstubAllGlobals());

const path = (call: Call) => call.url.replace('http://api.test', '');
const sent = () => calls.filter(call => call.method !== 'GET').map(call => [call.method, path(call), call.body ? JSON.parse(call.body) : null]);

describe('resale for resellers', () => {
  test('pricing, notes, rules, chat and deals send what the API takes', async () => {
    const store = makeStore();
    const run = (endpoint: keyof typeof resaleApi.endpoints, arg: unknown) => store.dispatch((resaleApi.endpoints[endpoint] as unknown as { initiate: (arg: unknown) => Parameters<typeof store.dispatch>[0] }).initiate(arg));
    await run('addResaleListing', { store_id: 's1', listing_id: 'l1', markup_bps: 1500, fixed_price: null });
    await run('updateResaleListing', { id: 'r1', status: 'paused' });
    await run('setResaleNote', { id: 'r1', note: 'Free bracket' });
    await run('clearResaleNote', 'r1');
    await run('removeResaleListing', 'r1');
    await run('createResaleRule', { store_id: 's1', category: 'tvs', markup_bps: 1000 });
    await run('sendResaleMessage', { id: 'p1', body: 'Hello' });
    await run('setResaleChatClosed', { id: 'p1', closed: true });
    await run('answerResaleDeal', { id: 'd1', supplierId: 'p1', answer: 'accept' });
    await run('startResaleSupplier', 'c1');
    expect(sent()).toEqual([
      ['POST', '/v1/resale/listings', { store_id: 's1', listing_id: 'l1', markup_bps: 1500, fixed_price: null }],
      ['PATCH', '/v1/resale/listings/r1', { status: 'paused' }],
      ['PUT', '/v1/resale/listings/r1/note', { note: 'Free bracket' }],
      ['DELETE', '/v1/resale/listings/r1/note', null],
      ['DELETE', '/v1/resale/listings/r1', null],
      ['POST', '/v1/resale/rules', { store_id: 's1', category: 'tvs', markup_bps: 1000 }],
      ['POST', '/v1/resale/suppliers/p1/messages', { body: 'Hello' }],
      ['POST', '/v1/resale/suppliers/p1/close', null],
      ['POST', '/v1/resale/deals/d1/accept', null],
      ['POST', '/v1/resale/suppliers', { supplier_id: 'c1' }],
    ]);
  });

  test('resale orders: the list filters, the thread asked for, cancelling with the reason and writing in a thread', async () => {
    const store = makeStore();
    const run = (endpoint: keyof typeof resaleApi.endpoints, arg: unknown) => store.dispatch((resaleApi.endpoints[endpoint] as unknown as { initiate: (arg: unknown) => Parameters<typeof store.dispatch>[0] }).initiate(arg));
    await run('resaleOrders', { status: 'locked', store_id: 's1' });
    await run('resaleOrderMessages', { id: 'o1', thread: 'trade' });
    await run('cancelResaleOrder', { id: 'o1', reason: 'The customer asked' });
    await run('sendResaleOrderMessage', { id: 'o1', thread: 'order', body: 'Thank you' });
    // The two reads, then each refetched by the changes (cancelling refreshes the order, its list and its threads).
    expect(calls.filter(call => call.method === 'GET').map(path).slice(0, 2)).toEqual(['/v1/resale/orders?status=locked&store_id=s1', '/v1/resale/orders/o1/messages?thread=trade']);
    expect(calls.filter(call => call.method === 'GET').map(path).slice(2)).toEqual(expect.arrayContaining(['/v1/resale/orders?status=locked&store_id=s1', '/v1/resale/orders/o1/messages?thread=trade']));
    expect(sent()).toEqual([
      ['POST', '/v1/resale/orders/o1/cancel', { reason: 'The customer asked' }],
      ['POST', '/v1/resale/orders/o1/messages', { thread: 'order', body: 'Thank you' }],
    ]);
  });

  test('the catalogue sends only the filters given; previews send one way of pricing', async () => {
    const store = makeStore();
    await store.dispatch(resaleApi.endpoints.resaleCatalogue.initiate({ q: 'tv', sort: 'price_asc', offset: 0, limit: 24, store_id: undefined }));
    await store.dispatch(resaleApi.endpoints.resalePricePreview.initiate({ listing_id: 'l1', markup_bps: -500 }));
    await store.dispatch(resaleApi.endpoints.resaleCategories.initiate('NG'));
    expect(calls.map(path)).toEqual(['/v1/resale/catalogue?q=tv&sort=price_asc&offset=0&limit=24', '/v1/resale/price-preview?listing_id=l1&markup_bps=-500', '/v1/classifieds/categories?country=NG']);
  });

  test('accepting a deal refreshes the store listings it can reprice', async () => {
    const store = makeStore();
    await store.dispatch(resaleApi.endpoints.resaleListings.initiate({ store_id: 's1' }));
    const before = calls.length;
    await store.dispatch(resaleApi.endpoints.answerResaleDeal.initiate({ id: 'd1', supplierId: 'p1', answer: 'end' }));
    await vi.waitFor(() => expect(calls.slice(before).filter(call => call.method === 'GET').map(path)).toContain('/v1/resale/listings?limit=100&store_id=s1'));
  });

  test('labels', () => {
    expect(bpsPercent(1500)).toBe('15%');
    expect(bpsPercent(250)).toBe('2.5%');
    expect(resaleStateText.price_out_of_range).toBe('Reprice to sell');
  });
});
