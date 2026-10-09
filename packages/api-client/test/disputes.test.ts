import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminDisputesApi } from '../src/admin';
import { resellerDisputesApi } from '../src/reseller';
import { makeStore, setRequestContext } from '../src';

type Call = { url: string; method: string; headers: Headers; body: string | null };
let calls: Call[];

beforeEach(() => {
  calls = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, headers: input.headers, body: input.method === 'GET' ? null : await input.text() });
    return input.method === 'GET' ? Response.json({ object: 'list', data: [] }) : Response.json({ object: 'dispute', id: 'd1', messages: [] });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setRequestContext({ reseller: null, mode: 'live' });
});

describe('reseller disputes', () => {
  test('SHQ lists, opens, replies, escalates and resolves at /v1/disputes, for the account and mode chosen', async () => {
    setRequestContext({ reseller: 'r1', mode: 'test' });
    const store = makeStore();
    const list = store.dispatch(resellerDisputesApi.endpoints.disputes.initiate());
    await list;
    await store.dispatch(resellerDisputesApi.endpoints.openDispute.initiate({ kind: 'reseller', topic: 'funding', subject: 'Top-up missing', message: 'Paid, not credited' }));
    await store.dispatch(resellerDisputesApi.endpoints.replyDispute.initiate({ id: 'd1', body: 'Note', visibility: 'staff' }));
    await store.dispatch(resellerDisputesApi.endpoints.escalateDispute.initiate({ id: 'd1', recommendation: 'credit_reseller', amount: 500, report: 'Paid at the gateway.' }));
    await store.dispatch(resellerDisputesApi.endpoints.resolveDispute.initiate({ id: 'd1', note: 'Sorted' }));
    const posts = calls.filter(call => call.method === 'POST');
    expect(posts.map(call => call.url)).toEqual([
      'http://api.test/v1/disputes',
      'http://api.test/v1/disputes/d1/messages',
      'http://api.test/v1/disputes/d1/escalate',
      'http://api.test/v1/disputes/d1/resolve',
    ]);
    expect(JSON.parse(posts[2].body ?? '{}')).toEqual({ recommendation: 'credit_reseller', amount: 500, report: 'Paid at the gateway.' });
    expect(posts.every(call => call.headers.get('bitocard-reseller') === 'r1' && call.headers.get('bitocard-mode') === 'test')).toBe(true);
    // Every change refetches the list.
    await vi.waitFor(() => expect(calls.filter(call => call.url === 'http://api.test/v1/disputes?limit=100').length).toBeGreaterThan(1));
    list.unsubscribe();
  });
});

describe('admin disputes', () => {
  test('admins read the queue, reply, send back and execute at /v1/admin/disputes', async () => {
    const store = makeStore();
    await store.dispatch(adminDisputesApi.endpoints.adminDisputes.initiate({ status: 'escalated' }));
    await store.dispatch(adminDisputesApi.endpoints.replyAdminDispute.initiate({ id: 'd1', body: 'Looking', visibility: 'all' }));
    await store.dispatch(adminDisputesApi.endpoints.returnDispute.initiate({ id: 'd1', note: 'Need more' }));
    await store.dispatch(adminDisputesApi.endpoints.executeDispute.initiate({ id: 'd1', action: 'refund_customer', note: 'Refunded' }));
    expect(calls[0].url).toBe('http://api.test/v1/admin/disputes?limit=100&status=escalated');
    expect(calls.filter(call => call.method === 'POST').map(call => call.url)).toEqual([
      'http://api.test/v1/admin/disputes/d1/messages',
      'http://api.test/v1/admin/disputes/d1/return',
      'http://api.test/v1/admin/disputes/d1/execute',
    ]);
    expect(JSON.parse(calls.find(call => call.url.endsWith('/execute'))!.body ?? '{}')).toEqual({ action: 'refund_customer', note: 'Refunded' });
  });
});
