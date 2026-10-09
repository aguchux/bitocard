import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminApi } from '../src/admin';
import { resellerCatalogueApi } from '../src/reseller';
import { makeStore } from '../src';

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, body: input.method === 'GET' ? null : await input.text() });
    return Response.json({ object: 'pricing', markups: [] });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('reseller pricing', () => {
  test('previews a trial setting without saving it, and saves partial settings where null clears a field', async () => {
    const store = makeStore();
    await store.dispatch(resellerCatalogueApi.endpoints.pricePreview.initiate({ id: 'p1', face_value: 1000, customer_discount_bps: 50 }));
    await store.dispatch(resellerCatalogueApi.endpoints.setMarkup.initiate({ product_id: 'p1', markup_bps: 1000, fixed_price: null }));
    await store.dispatch(resellerCatalogueApi.endpoints.setMarkup.initiate({ category: null, customer_discount_bps: 25, markup_bps: null }));
    await store.dispatch(resellerCatalogueApi.endpoints.removeMarkup.initiate({}));
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://api.test/v1/catalogue/products/p1/price-preview?face_value=1000&customer_discount_bps=50' });
    expect(calls.filter(call => call.method === 'PUT').map(call => JSON.parse(call.body ?? '{}'))).toEqual([
      { product_id: 'p1', markup_bps: 1000, fixed_price: null },
      { category: null, customer_discount_bps: 25, markup_bps: null },
    ]);
    expect(calls.find(call => call.method === 'DELETE')?.url).toMatch(/^http:\/\/api\.test\/v1\/pricing\/markups\??$/);
  });
});

describe('admin pricing', () => {
  test('previews a product under a trial rule and saves rules by scope', async () => {
    const store = makeStore();
    await store.dispatch(adminApi.endpoints.adminPricePreview.initiate({ product_id: 'p1', country: 'NG', kind: 'discount', reseller_discount_bps: 150 }));
    await store.dispatch(adminApi.endpoints.setPricingRule.initiate({ supplier_code: 'didww', kind: 'fixed', fixed_price: 500, fixed_currency: 'USD' }));
    expect(calls[0].url).toBe('http://api.test/v1/admin/pricing-rules/preview?product_id=p1&country=NG&kind=discount&reseller_discount_bps=150');
    expect(calls[1]).toMatchObject({ method: 'PUT', url: 'http://api.test/v1/admin/pricing-rules' });
    expect(JSON.parse(calls[1].body ?? '{}')).toEqual({ supplier_code: 'didww', kind: 'fixed', fixed_price: 500, fixed_currency: 'USD' });
  });
});
