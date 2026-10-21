import { afterEach, expect, test, vi } from 'vitest';
import '../src/admin';
import { makeStore, prefetchQuery } from '../src';

afterEach(() => vi.unstubAllGlobals());

test('prefetching fetches an injected endpoint once (fresh data is not asked for again) and ignores unknown ones', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ object: 'order', id: 'o1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const store = makeStore();
  expect(prefetchQuery(store.dispatch, 'noSuchEndpoint', 'x')).toBe(false);
  expect(prefetchQuery(store.dispatch, 'order', 'o1')).toBe(true);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const url = String((fetch.mock.calls[0] as unknown as [Request])[0].url ?? fetch.mock.calls[0][0]);
  expect(url).toContain('/v1/admin/orders/o1');
  await new Promise(resolve => setTimeout(resolve, 20));
  prefetchQuery(store.dispatch, 'order', 'o1');
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(fetch).toHaveBeenCalledTimes(1);
});
