import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resellerUdozoApi, udozoApiKeyScopes, udozoWebhookEventTypes } from '../src/reseller';
import { makeStore, setApiProduct } from '../src';

type Call = { url: string; method: string; body: string | null };
let calls: Call[];

beforeEach(() => {
  calls = [];
  delete process.env.NEXT_PUBLIC_API_URL;
  setApiProduct('udozo');
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, body: input.method === 'GET' ? null : await input.text() });
    return Response.json({ object: 'ok' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setApiProduct('bitocard');
});

const run = (store: ReturnType<typeof makeStore>, endpoint: keyof typeof resellerUdozoApi.endpoints, arg: unknown) =>
  store.dispatch((resellerUdozoApi.endpoints[endpoint] as unknown as { initiate: (arg: unknown) => Parameters<typeof store.dispatch>[0] }).initiate(arg));

describe("Udozo's Seller HQ endpoints", () => {
  test('the setup fee, the free domain and the theme go to api.udozo.com with what the API takes', async () => {
    const store = makeStore();
    await run(store, 'setupFee', undefined);
    await run(store, 'paySetupFee', undefined);
    await run(store, 'freeDomain', 's1');
    await run(store, 'claimFreeDomain', { store: 's1', domain: 'adaresale.com', contact: { first_name: 'Ada', last_name: 'Obi', email: 'a@example.com', phone: '+2348031234567', address1: '1 Marina', city: 'Lagos', state: 'Lagos', zip: '100001', country: 'NG' } });
    await run(store, 'sellerHqTheme', undefined);
    expect(calls.every(call => call.url.startsWith('https://api.udozo.com/'))).toBe(true);
    const first = (method: string, path: string) => calls.find(call => call.method === method && call.url === `https://api.udozo.com${path}`);
    expect(first('GET', '/v1/billing/setup-fee')).toBeTruthy();
    expect(first('POST', '/v1/billing/setup-fee')?.body ?? '').toBe('');
    expect(first('GET', '/v1/stores/s1/free-domain')).toBeTruthy();
    expect(JSON.parse(first('POST', '/v1/stores/s1/free-domain')?.body ?? '{}')).toMatchObject({ domain: 'adaresale.com', contact: { country: 'NG' } });
    expect(first('GET', '/v1/theme')).toBeTruthy();
  });

  test("Udozo's webhook events and key scopes are its own: resale, never BitoCard's orders, numbers or eSIMs", () => {
    expect(udozoWebhookEventTypes).toContain('resale_order.created');
    expect(udozoWebhookEventTypes.every(type => /^(resale_order|top_up|payout|support_ticket)\./.test(type))).toBe(true);
    expect(udozoApiKeyScopes).toContain('resale:write');
    expect(udozoApiKeyScopes.some(scope => /^(catalogue|quotes|orders|customers|disputes):/.test(scope))).toBe(false);
  });
});
