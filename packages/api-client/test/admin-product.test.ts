import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminApi } from '../src/admin';
import { adminPath, apiFetch, makeStore, setAdminProduct } from '../src';

let urls: string[];

beforeEach(() => {
  urls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test';
  vi.stubGlobal('fetch', async (input: Request | string) => {
    urls.push(typeof input === 'string' ? input : input.url);
    return Response.json({ object: 'admin_session', admin: { id: 'a1', name: 'Ada', email: 'ada@afrippa.com', roles: ['super_admin'] } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAdminProduct('bitocard');
});

describe("the admin product (BitoCard's admin app or Afrippa's)", () => {
  test("BitoCard's admin app calls BitoCard's admin routes, untouched", async () => {
    await makeStore().dispatch(adminApi.endpoints.adminSession.initiate());
    expect(urls).toEqual(['http://api.test/v1/admin/auth/session']);
    expect(adminPath('/v1/afrippa/admin/p2p/orders')).toBe('/v1/afrippa/admin/p2p/orders');
  });

  test("Afrippa's admin app: the same hooks and raw requests call Afrippa's admin realm; other paths are left alone", async () => {
    setAdminProduct('afrippa');
    await makeStore().dispatch(adminApi.endpoints.adminSession.initiate());
    await apiFetch('/v1/admin/support/chats/x/files/y');
    expect(urls).toEqual(['http://api.test/v1/afrippa/admin/auth/session', 'http://api.test/v1/afrippa/admin/support/chats/x/files/y']);
    expect(adminPath('/v1/afrippa/admin/p2p/orders')).toBe('/v1/afrippa/admin/p2p/orders');
    expect(adminPath('/v1/countries')).toBe('/v1/countries');
    expect(adminPath('/v1/administrators')).toBe('/v1/administrators');
  });

  test("a failed connection names the admin's own product", async () => {
    const { toApiError } = await import('../src');
    expect(toApiError('FETCH_ERROR', undefined).message).toBe('Could not reach BitoCard. Check your connection and try again.');
    setAdminProduct('afrippa');
    expect(toApiError('FETCH_ERROR', undefined).message).toBe('Could not reach Afrippa. Check your connection and try again.');
    expect(toApiError('TIMEOUT_ERROR', undefined).message).toBe('Afrippa took too long to answer. Try again.');
  });

  test("Afrippa's admin calls api.afrippa.com unless NEXT_PUBLIC_API_URL says otherwise; BitoCard's api.bitocard.com", async () => {
    const { apiBaseUrl } = await import('../src');
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(apiBaseUrl()).toBe('https://api.bitocard.com');
    setAdminProduct('afrippa');
    expect(apiBaseUrl()).toBe('https://api.afrippa.com');
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/';
    expect(apiBaseUrl()).toBe('http://localhost:3001');
  });
});
