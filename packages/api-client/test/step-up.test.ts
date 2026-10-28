import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminApi } from '../src/admin';
import { makeStore, setStepUpHandler } from '../src';

type Call = { url: string; method: string; key: string | null };
let calls: Call[];
let windowOpen: boolean;

beforeEach(() => {
  calls = [];
  windowOpen = false;
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('fetch', async (input: Request) => {
    calls.push({ url: input.url, method: input.method, key: input.headers.get('idempotency-key') });
    if (input.url.endsWith('/v1/admin/auth/step-up')) {
      windowOpen = true;
      return Response.json({ object: 'admin_step_up', step_up_until: '2026-10-18T10:05:00.000Z' });
    }
    if (input.method !== 'GET' && !windowOpen) {
      return Response.json({ error: { type: 'permission_error', code: 'step_up_required', message: 'Enter the code from your authenticator app to continue.' } }, { status: 403 });
    }
    return Response.json({ object: 'feature_switch', key: 'custom_domains', enabled: true });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setStepUpHandler(null);
});

const flip = (store: ReturnType<typeof makeStore>, key: string) => store.dispatch(adminApi.endpoints.setSwitch.initiate({ key, enabled: true } as never));

describe('admin step-up window', () => {
  test('an action outside the window asks once for the code, then is sent again with a new key', async () => {
    const asked = vi.fn(async () => {
      const store = makeStore();
      await store.dispatch(adminApi.endpoints.adminStepUp.initiate({ code: '123456' })).unwrap();
      return true;
    });
    setStepUpHandler(asked);
    const store = makeStore();
    const result = await flip(store, 'custom_domains');
    expect('error' in result && result.error).toBeFalsy();
    expect(asked).toHaveBeenCalledTimes(1);
    const sends = calls.filter(call => call.url.endsWith('/v1/admin/switches/custom_domains'));
    expect(sends).toHaveLength(2);
  });

  test('parallel refusals share one prompt', async () => {
    let release: (opened: boolean) => void = () => undefined;
    const asked = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          release = opened => {
            windowOpen = opened;
            resolve(opened);
          };
        }),
    );
    setStepUpHandler(asked);
    const store = makeStore();
    const both = Promise.all([flip(store, 'custom_domains'), flip(store, 'reseller_exchange')]);
    await vi.waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    release(true);
    const results = await both;
    expect(results.every(result => !('error' in result && result.error))).toBe(true);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  test('cancelling the prompt leaves the action refused, and nothing is retried', async () => {
    setStepUpHandler(async () => false);
    const store = makeStore();
    const result = await flip(store, 'custom_domains');
    expect('error' in result ? (result.error as { code: string }).code : null).toBe('step_up_required');
    expect(calls.filter(call => call.url.endsWith('/v1/admin/switches/custom_domains'))).toHaveLength(1);
  });

  test('without a handler (SHQ, the storefront) the refusal comes back as it is', async () => {
    const store = makeStore();
    const result = await flip(store, 'custom_domains');
    expect('error' in result ? (result.error as { code: string }).code : null).toBe('step_up_required');
  });
});
