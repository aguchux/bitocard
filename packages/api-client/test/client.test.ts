import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminApi, percentToPpb } from '../src/admin';
import { resellerSessionApi } from '../src/reseller';
import { makeStore, setRequestContext, toApiError } from '../src';

type Call = { url: string; method: string; headers: Headers; credentials: RequestCredentials | undefined; body: string | null };

let calls: Call[];
let reply: (call: Call) => Response;

beforeEach(() => {
  calls = [];
  reply = () => Response.json({});
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    const call = { url: input.url, method: input.method, headers: input.headers, credentials: input.credentials, body: input.method === 'GET' ? null : await input.text() };
    calls.push(call);
    return reply(call);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setRequestContext({ reseller: null, mode: 'live' });
});

describe('base query', () => {
  test('sends cookies, and an Idempotency-Key on every POST but not on GET', async () => {
    const store = makeStore();
    reply = call => (call.url.endsWith('/signin') ? Response.json({ object: 'mfa_challenge', challenge_token: 't', mfa_setup_required: false, expires_in: 300 }) : Response.json({ object: 'admin_session', admin: { id: 'a' } }));
    await store.dispatch(adminApi.endpoints.adminSession.initiate());
    await store.dispatch(adminApi.endpoints.adminSignIn.initiate({ email: 'a@bitocard.com', password: 'secret passphrase' }));
    await store.dispatch(adminApi.endpoints.adminSignIn.initiate({ email: 'a@bitocard.com', password: 'secret passphrase' }));
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['GET', 'http://api.test/v1/admin/auth/session'],
      ['POST', 'http://api.test/v1/admin/auth/signin'],
      ['POST', 'http://api.test/v1/admin/auth/signin'],
    ]);
    expect(calls.every(call => call.credentials === 'include')).toBe(true);
    expect(calls[0].headers.get('idempotency-key')).toBeNull();
    const keys = calls.slice(1).map(call => call.headers.get('idempotency-key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).not.toEqual(keys[1]);
    expect(JSON.parse(calls[1].body!)).toEqual({ email: 'a@bitocard.com', password: 'secret passphrase' });
  });

  test('SHQ requests name the reseller account and sandbox mode; nothing is sent until SHQ sets them', async () => {
    const store = makeStore();
    reply = () => Response.json({ object: 'account' });
    await store.dispatch(resellerSessionApi.endpoints.account.initiate());
    expect([calls[0].headers.get('bitocard-reseller'), calls[0].headers.get('bitocard-mode')]).toEqual([null, null]);

    setRequestContext({ reseller: 'res_1', mode: 'test' });
    await store.dispatch(resellerSessionApi.endpoints.signIn.initiate({ identifier: 'ada@example.com', password: 'secret passphrase' }));
    expect([calls[1].headers.get('bitocard-reseller'), calls[1].headers.get('bitocard-mode')]).toEqual(['res_1', 'test']);

    // Live mode sends no header: the dashboard is live unless it asks for the sandbox.
    setRequestContext({ mode: 'live' });
    await store.dispatch(resellerSessionApi.endpoints.signIn.initiate({ identifier: 'ada@example.com', password: 'secret passphrase' }));
    expect([calls[2].headers.get('bitocard-reseller'), calls[2].headers.get('bitocard-mode')]).toEqual(['res_1', null]);
  });

  test('errors come back in the BitoCard shape', async () => {
    const store = makeStore();
    reply = () => Response.json({ error: { type: 'conflict_error', code: 'verification_required', message: 'Not verified yet.', param: 'status', request_id: 'req_1' } }, { status: 409 });
    const result = await store.dispatch(adminApi.endpoints.updateReseller.initiate({ id: 'r1', status: 'active' }));
    expect('error' in result && result.error).toEqual({ status: 409, type: 'conflict_error', code: 'verification_required', message: 'Not verified yet.', param: 'status', requestId: 'req_1' });
    expect(toApiError('FETCH_ERROR', undefined).code).toBe('network_error');
    expect(toApiError(500, '<html>').message).toMatch(/went wrong/);
  });

  test('query parameters drop empty values', async () => {
    const store = makeStore();
    reply = () => Response.json({ object: 'list', data: [] });
    await store.dispatch(adminApi.endpoints.orders.initiate({ status: 'processing', needs_review: true, reseller_id: undefined }));
    expect(calls[0].url).toBe('http://api.test/v1/admin/orders?status=processing&needs_review=true&limit=50');
  });

  test('lists page by cursor until the API says there is no more', async () => {
    const store = makeStore();
    reply = call => Response.json(call.url.includes('starting_after') ? { object: 'list', data: [{ id: 'o3' }], has_more: false } : { object: 'list', data: [{ id: 'o1' }, { id: 'o2' }], has_more: true });
    const first = await store.dispatch(adminApi.endpoints.orders.initiate({}));
    expect(first.data?.pages).toHaveLength(1);
    const next = await store.dispatch(adminApi.endpoints.orders.initiate({}, { direction: 'forward' }));
    expect(next.data?.pages.flatMap(page => page.data.map(order => order.id))).toEqual(['o1', 'o2', 'o3']);
    expect(calls.at(-1)!.url).toBe('http://api.test/v1/admin/orders?limit=50&starting_after=o2');
    expect(next.hasNextPage).toBe(false);
  });

  test('a mutation refetches the lists it changes', async () => {
    const store = makeStore();
    reply = call => (call.method === 'POST' ? Response.json({ object: 'verification', id: 'v1', status: 'approved' }) : Response.json({ object: 'list', data: [] }));
    const subscription = store.dispatch(adminApi.endpoints.verifications.initiate({ status: 'in_review' }));
    await subscription;
    await store.dispatch(adminApi.endpoints.decideVerification.initiate({ id: 'v1', decision: 'approved', reason: 'Checked by hand' }));
    await vi.waitFor(() => expect(calls.filter(call => call.url.includes('/v1/admin/verifications?')).length).toBe(2));
    subscription.unsubscribe();
  });
});

describe('integrations', () => {
  test('saving sends a PUT with the values and code, then refetches the list', async () => {
    const store = makeStore();
    reply = call => Response.json(call.method === 'PUT' ? { object: 'integration', id: 'email' } : { object: 'list', data: [] });
    const list = store.dispatch(adminApi.endpoints.integrations.initiate());
    await list;
    await store.dispatch(adminApi.endpoints.updateIntegration.initiate({ id: 'email', values: { RESEND_API_KEY: 're_key', EMAIL_FROM: null }, code: '123456' }));
    await vi.waitFor(() => expect(calls.filter(call => call.url.endsWith('/v1/admin/integrations'))).toHaveLength(2));
    const put = calls.find(call => call.method === 'PUT')!;
    expect(put.url).toBe('http://api.test/v1/admin/integrations/email');
    expect(put.headers.get('idempotency-key')).toBeNull();
    expect(JSON.parse(put.body!)).toEqual({ values: { RESEND_API_KEY: 're_key', EMAIL_FROM: null }, code: '123456' });
    list.unsubscribe();
  });
});

describe('percentToPpb', () => {
  test('turns a percentage into parts per billion exactly', () => {
    expect(percentToPpb('0.01')).toBe(100_000);
    expect(percentToPpb('0.0000001')).toBe(1);
    expect(percentToPpb('10')).toBe(100_000_000);
    expect(percentToPpb('2.55')).toBe(25_500_000);
    expect(percentToPpb('0')).toBe(0);
  });

  test('refuses anything outside 0% to 10% or finer than 0.0000001%', () => {
    for (const text of ['10.0000001', '11', '0.00000001', '-1', 'abc', '', '1e-3']) expect(percentToPpb(text)).toBeNull();
  });
});
