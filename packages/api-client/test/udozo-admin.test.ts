import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminUdozoApi } from '../src/admin';
import { makeStore, setApiProduct } from '../src';

let calls: Array<{ method: string; url: string; body: unknown }>;

beforeEach(() => {
  calls = [];
  delete process.env.NEXT_PUBLIC_API_URL;
  setApiProduct('udozo');
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ method: input.method, url: input.url, body: input.method === 'GET' ? null : await input.json().catch(() => null) });
    return Response.json({ object: 'ok' });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setApiProduct('bitocard');
});

describe("Udozo's admin hooks (theme, setup fees, the books, credit limits)", () => {
  // Queries without a subscription, so a change's invalidation refetches nothing and only the calls asked for are seen.
  test("call Udozo's own API instance with BitoCard's admin paths", async () => {
    const store = makeStore();
    await store.dispatch(adminUdozoApi.endpoints.themeSettings.initiate(undefined, { subscribe: false }));
    await store.dispatch(adminUdozoApi.endpoints.saveThemeDraft.initiate({ colors: { primary: '#14532d', accent: '#b45309', ink: '#111827', page: '#ffffff' } }));
    await store.dispatch(adminUdozoApi.endpoints.saveThemeDraft.initiate({ preset: 'forest' }));
    await store.dispatch(adminUdozoApi.endpoints.themePreview.initiate());
    await store.dispatch(adminUdozoApi.endpoints.publishTheme.initiate());
    await store.dispatch(adminUdozoApi.endpoints.setupFees.initiate(undefined, { subscribe: false }));
    await store.dispatch(adminUdozoApi.endpoints.setSetupFee.initiate({ country: 'NG', enabled: true, amount: 500000 }));
    await store.dispatch(adminUdozoApi.endpoints.ledgerCheck.initiate(undefined, { subscribe: false }));
    await store.dispatch(adminUdozoApi.endpoints.resellerCredit.initiate('r1', { subscribe: false }));
    await store.dispatch(adminUdozoApi.endpoints.setResellerCreditLimit.initiate({ id: 'r1', cents: 2500, reason: 'Trusted seller' }));
    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
      'GET https://api.udozo.com/v1/admin/theme',
      'PUT https://api.udozo.com/v1/admin/theme/draft',
      'PUT https://api.udozo.com/v1/admin/theme/draft',
      'POST https://api.udozo.com/v1/admin/theme/preview',
      'POST https://api.udozo.com/v1/admin/theme/publish',
      'GET https://api.udozo.com/v1/admin/setup-fees',
      'PUT https://api.udozo.com/v1/admin/setup-fees/NG',
      'GET https://api.udozo.com/v1/admin/ledger/check',
      'GET https://api.udozo.com/v1/admin/resellers/r1/credit',
      'PUT https://api.udozo.com/v1/admin/resellers/r1/credit-limit',
    ]);
    expect(calls[1].body).toEqual({ colors: { primary: '#14532d', accent: '#b45309', ink: '#111827', page: '#ffffff' } });
    expect(calls[2].body).toEqual({ preset: 'forest' });
    expect(calls[6].body).toEqual({ enabled: true, amount: 500000 });
    expect(calls[9].body).toEqual({ cents: 2500, reason: 'Trusted seller' });
  });
});
