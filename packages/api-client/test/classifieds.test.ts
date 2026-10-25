import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminClassifiedsApi, disputeOutcome, safePayFee } from '../src/admin';
import { makeStore } from '../src';

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, body: input.method === 'GET' ? null : await input.text() });
    if (input.method === 'DELETE') return new Response(null, { status: 204 });
    return input.method === 'GET' ? Response.json({ object: 'list', data: [], total: 0 }) : Response.json({ object: 'classified_listing', id: 'l1' });
  });
});

afterEach(() => vi.unstubAllGlobals());

const sent = () => calls.filter(call => call.method !== 'GET').map(call => [call.method, call.url, call.body ? JSON.parse(call.body) : null]);

describe('admin classifieds', () => {
  test('moderation: approve sends the note, reject and remove send it as the reason; reports are resolved', async () => {
    const store = makeStore();
    const queue = store.dispatch(adminClassifiedsApi.endpoints.classifiedQueue.initiate({ country: 'NG' }));
    await queue;
    await store.dispatch(adminClassifiedsApi.endpoints.moderateClassifiedListing.initiate({ id: 'l1', action: 'approve', note: '' }));
    await store.dispatch(adminClassifiedsApi.endpoints.moderateClassifiedListing.initiate({ id: 'l1', action: 'reject', note: 'Blurry photos.' }));
    await store.dispatch(adminClassifiedsApi.endpoints.moderateClassifiedListing.initiate({ id: 'l1', action: 'remove', note: 'Scam.' }));
    await store.dispatch(adminClassifiedsApi.endpoints.resolveClassifiedReport.initiate({ id: 'r1', action: 'remove_listing', note: 'Confirmed.' }));
    expect(sent()).toEqual([
      ['POST', 'http://api.test/v1/admin/classifieds/listings/l1/approve', {}],
      ['POST', 'http://api.test/v1/admin/classifieds/listings/l1/reject', { reason: 'Blurry photos.' }],
      ['POST', 'http://api.test/v1/admin/classifieds/listings/l1/remove', { reason: 'Scam.' }],
      ['POST', 'http://api.test/v1/admin/classifieds/reports/r1/resolve', { action: 'remove_listing', note: 'Confirmed.' }],
    ]);
    // A decision refreshes the queue.
    await vi.waitFor(() => expect(calls.filter(call => call.url === 'http://api.test/v1/admin/classifieds/queue?country=NG').length).toBeGreaterThan(1));
    queue.unsubscribe();
  });

  test('sellers, categories and market rules', async () => {
    const store = makeStore();
    await store.dispatch(adminClassifiedsApi.endpoints.classifiedSellers.initiate({ status: 'suspended', q: '' }));
    await store.dispatch(adminClassifiedsApi.endpoints.setClassifiedSellerSuspended.initiate({ id: 'c1', suspended: true, reason: 'Scams.' }));
    await store.dispatch(adminClassifiedsApi.endpoints.setClassifiedSellerSuspended.initiate({ id: 'c1', suspended: false, reason: 'Appeal.' }));
    await store.dispatch(adminClassifiedsApi.endpoints.clearClassifiedStrikes.initiate({ id: 'c1', reason: 'Fair.' }));
    await store.dispatch(adminClassifiedsApi.endpoints.setClassifiedCategoryCountry.initiate({ id: 'cat', country: 'NG', open: false }));
    await store.dispatch(adminClassifiedsApi.endpoints.setClassifiedCategory.initiate({ id: 'cat', enabled: true }));
    await store.dispatch(adminClassifiedsApi.endpoints.removeClassifiedWord.initiate('w1'));
    await store.dispatch(adminClassifiedsApi.endpoints.updateClassifiedMarketSettings.initiate({ country: 'NG', listing_days: 45 }));
    expect(calls[0].url).toBe('http://api.test/v1/admin/classifieds/sellers?limit=50&status=suspended');
    expect(sent()).toEqual([
      ['POST', 'http://api.test/v1/admin/classifieds/sellers/c1/suspend', { reason: 'Scams.' }],
      ['POST', 'http://api.test/v1/admin/classifieds/sellers/c1/unsuspend', { reason: 'Appeal.' }],
      ['POST', 'http://api.test/v1/admin/classifieds/sellers/c1/safe-pay/clear', { reason: 'Fair.' }],
      ['PUT', 'http://api.test/v1/admin/classifieds/categories/cat/countries/NG', { open: false }],
      ['PATCH', 'http://api.test/v1/admin/classifieds/categories/cat', { enabled: true }],
      ['DELETE', 'http://api.test/v1/admin/classifieds/prohibited-words/w1', null],
      ['PUT', 'http://api.test/v1/admin/classifieds/market-settings/NG', { listing_days: 45 }],
    ]);
  });

  test('Safe pay: dispute messages and decisions, payout reviews and settings', async () => {
    const store = makeStore();
    await store.dispatch(adminClassifiedsApi.endpoints.classifiedOrders.initiate({ payout_review: 'pending' }));
    await store.dispatch(adminClassifiedsApi.endpoints.writeClassifiedDispute.initiate({ id: 'o1', body: 'Send photos.' }));
    await store.dispatch(adminClassifiedsApi.endpoints.decideClassifiedDispute.initiate({ id: 'o1', decision: 'partial', refund: 5000, note: 'Scratched.' }));
    await store.dispatch(adminClassifiedsApi.endpoints.decideClassifiedPayoutReview.initiate({ id: 'o1', decision: 'approve', note: 'Settled.' }));
    await store.dispatch(adminClassifiedsApi.endpoints.updateClassifiedSafePaySettings.initiate({ country: 'NG', buyer_fee_bps: 150, strike_limit: 4 }));
    expect(calls[0].url).toBe('http://api.test/v1/admin/classifieds/orders?limit=50&payout_review=pending');
    expect(sent()).toEqual([
      ['POST', 'http://api.test/v1/admin/classifieds/orders/o1/dispute/messages', { body: 'Send photos.' }],
      ['POST', 'http://api.test/v1/admin/classifieds/orders/o1/dispute/decide', { decision: 'partial', refund: 5000, note: 'Scratched.' }],
      ['POST', 'http://api.test/v1/admin/classifieds/orders/o1/payout-review', { decision: 'approve', note: 'Settled.' }],
      ['PUT', 'http://api.test/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150, strike_limit: 4 }],
    ]);
  });

  test("the queue view, the feature registry, sellers' suggestions and areas", async () => {
    const store = makeStore();
    await store.dispatch(adminClassifiedsApi.endpoints.classifiedQueue.initiate({ country: 'NG', view: 'reported' }));
    await store.dispatch(adminClassifiedsApi.endpoints.classifiedQueue.initiate({ view: 'all' }));
    await store.dispatch(adminClassifiedsApi.endpoints.createClassifiedFeature.initiate({ key: 'refresh_rate', name: 'Refresh rate', icon: 'monitor', data_type: 'number', unit: 'Hz', suggestion: 'refresh rate' }));
    await store.dispatch(adminClassifiedsApi.endpoints.updateClassifiedFeature.initiate({ key: 'refresh_rate', enabled: false }));
    await store.dispatch(adminClassifiedsApi.endpoints.dismissClassifiedFeatureSuggestion.initiate('plot shape'));
    await store.dispatch(adminClassifiedsApi.endpoints.createClassifiedArea.initiate({ country: 'NG', state_id: 's1', name: 'Ojodu', latitude: 6.6, longitude: 3.4 }));
    await store.dispatch(adminClassifiedsApi.endpoints.updateClassifiedArea.initiate({ id: 'a1', country: 'NG', enabled: false }));
    expect(calls.filter(call => call.method === 'GET').map(call => call.url)).toEqual(['http://api.test/v1/admin/classifieds/queue?country=NG&view=reported', 'http://api.test/v1/admin/classifieds/queue?']);
    expect(sent()).toEqual([
      ['POST', 'http://api.test/v1/admin/classifieds/features', { key: 'refresh_rate', name: 'Refresh rate', icon: 'monitor', data_type: 'number', unit: 'Hz', suggestion: 'refresh rate' }],
      ['PATCH', 'http://api.test/v1/admin/classifieds/features/refresh_rate', { enabled: false }],
      ['POST', 'http://api.test/v1/admin/classifieds/feature-suggestions/dismiss', { name_key: 'plot shape' }],
      ['POST', 'http://api.test/v1/admin/classifieds/areas', { country: 'NG', state_id: 's1', name: 'Ojodu', latitude: 6.6, longitude: 3.4 }],
      ['PATCH', 'http://api.test/v1/admin/classifieds/areas/a1', { enabled: false }],
    ]);
  });

  test('fees and dispute outcomes are worked out as the API settles them', () => {
    expect(safePayFee(5_000_000, 200, 2_000_000)).toBe(100_000);
    expect(safePayFee(120_000_000, 200, 2_000_000)).toBe(2_000_000);
    expect(safePayFee(333, 150, 1_000)).toBe(4);
    const order = { price: 48_000_000, buyer_fee: 960_000, rates: { buyer_fee_bps: 200, buyer_fee_cap: 2_000_000, seller_fee_bps: 300, seller_fee_cap: 3_000_000 } };
    expect(disputeOutcome(order, 'refund')).toEqual({ buyer_gets: 48_960_000, seller_gets: 0, seller_fee: 0, buyer_fee_kept: 0 });
    expect(disputeOutcome(order, 'partial', 12_000_000)).toEqual({ buyer_gets: 12_000_000, seller_gets: 34_920_000, seller_fee: 1_080_000, buyer_fee_kept: 960_000 });
    expect(disputeOutcome(order, 'release')).toEqual({ buyer_gets: 0, seller_gets: 46_560_000, seller_fee: 1_440_000, buyer_fee_kept: 960_000 });
  });
});
