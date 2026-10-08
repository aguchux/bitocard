import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { adminApi, parseStockCodes, percentToPpb } from '../src/admin';
import { resellerCatalogueApi, resellerFeesApi, resellerNumbersApi, resellerOrdersApi, resellerPayoutsApi, resellerSessionApi, smsLimit } from '../src/reseller';
import { keepUnusedSeconds, makeStore, notificationsApi, pushApi, readTimeoutMs, revalidateAfterSeconds, setRequestContext, toApiError, uploadMedia } from '../src';

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

  test('reads time out; a timeout comes back as a network error with its own message', async () => {
    const store = makeStore();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (input: Request) => {
      signal = input.signal;
      return new Promise<Response>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason)));
    });
    vi.useFakeTimers();
    const pending = store.dispatch(adminApi.endpoints.overview.initiate({ days: 7, mode: 'live' }));
    await vi.advanceTimersByTimeAsync(readTimeoutMs);
    const result = await pending;
    vi.useRealTimers();
    expect(signal?.aborted).toBe(true);
    expect(result.error).toMatchObject({ code: 'timeout', type: 'network_error' });
    pending.unsubscribe();
  });

  test('a 401 outside sign-in checks the session again, so the app can send the person to sign in', async () => {
    const store = makeStore();
    reply = call => (call.url.endsWith('/auth/session') ? Response.json({ object: 'session', user: { id: 'u' }, memberships: [] }) : Response.json({ error: { type: 'authentication_error', code: 'unauthenticated', message: 'Sign in again.' } }, { status: 401 }));
    const session = store.dispatch(resellerSessionApi.endpoints.session.initiate());
    await session;
    await store.dispatch(resellerSessionApi.endpoints.account.initiate());
    await vi.waitFor(() => expect(calls.filter(call => call.url.endsWith('/v1/auth/session'))).toHaveLength(2));
    session.unsubscribe();
  });

  test('a 401 from the session check itself does not loop', async () => {
    const store = makeStore();
    reply = () => Response.json({ error: { type: 'authentication_error', code: 'unauthenticated', message: 'Sign in.' } }, { status: 401 });
    const session = store.dispatch(resellerSessionApi.endpoints.session.initiate());
    await session;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
    session.unsubscribe();
  });

  test('cached data is kept for 5 minutes and revalidated after 30 seconds, on focus and on reconnect', () => {
    expect([keepUnusedSeconds, revalidateAfterSeconds]).toEqual([300, 30]);
    const config = makeStore().getState().bitocardApi.config;
    expect(config).toMatchObject({ keepUnusedDataFor: 300, refetchOnMountOrArgChange: 30, refetchOnFocus: true, refetchOnReconnect: true });
  });

  test('orders, simulated outcomes and plan changes refresh the BitoCard fee lists', async () => {
    const store = makeStore();
    reply = call => Response.json(call.method === 'GET' ? { object: 'list', data: [] } : { object: 'order', id: 'o1' });
    const fees = store.dispatch(resellerFeesApi.endpoints.feeRates.initiate());
    await fees;
    await store.dispatch(resellerOrdersApi.endpoints.placeOrder.initiate({ quote_id: 'q1' }));
    await vi.waitFor(() => expect(calls.filter(call => call.url.endsWith('/v1/wallet/fee-rates'))).toHaveLength(2));
    await store.dispatch(resellerPayoutsApi.endpoints.changePlan.initiate({ plan: 'premium' }));
    await vi.waitFor(() => expect(calls.filter(call => call.url.endsWith('/v1/wallet/fee-rates'))).toHaveLength(3));
    fees.unsubscribe();
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

describe('notifications', () => {
  test('each app reads its own inbox; marking read refetches the count', async () => {
    const store = makeStore();
    reply = call => (call.url.includes('unread-count') ? Response.json({ object: 'unread_count', count: 1 }) : Response.json({ object: 'list', data: [], has_more: false, unread_count: 1 }));
    await store.dispatch(notificationsApi.endpoints.unreadNotifications.initiate('admin'));
    await store.dispatch(notificationsApi.endpoints.unreadNotifications.initiate('reseller'));
    await store.dispatch(notificationsApi.endpoints.notifications.initiate({ realm: 'reseller', unread: true, limit: 5 }));
    await store.dispatch(notificationsApi.endpoints.notifications.initiate({ realm: 'admin', unread: false }));
    expect(calls.map(call => call.url)).toEqual([
      'http://api.test/v1/admin/notifications/unread-count',
      'http://api.test/v1/notifications/unread-count',
      'http://api.test/v1/notifications?unread=true&limit=5',
      'http://api.test/v1/admin/notifications',
    ]);
    calls = [];
    await store.dispatch(notificationsApi.endpoints.markNotificationRead.initiate({ realm: 'admin', id: 'n1' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://api.test/v1/admin/notifications/n1/read' });
    expect(calls.some(call => call.url === 'http://api.test/v1/admin/notifications/unread-count')).toBe(true);
  });
});

describe('notifications read at once', () => {
  const page = (read: boolean) => ({
    object: 'list',
    has_more: false,
    unread_count: read ? 0 : 2,
    data: [
      { object: 'notification', id: 'n1', read, read_at: null, title: 'A' },
      { object: 'notification', id: 'n2', read, read_at: null, title: 'B' },
    ],
  });
  const inbox = (store: ReturnType<typeof makeStore>) => notificationsApi.endpoints.notifications.select({ realm: 'reseller' })(store.getState()).data;
  const count = (store: ReturnType<typeof makeStore>) => notificationsApi.endpoints.unreadNotifications.select('reseller')(store.getState()).data?.count;

  test('marking one read shows it read and lowers the count before the API answers', async () => {
    const store = makeStore();
    let answer!: () => void;
    reply = call => (call.url.endsWith('/unread-count') ? Response.json({ object: 'unread_count', count: 2 }) : Response.json(page(false)));
    const list = store.dispatch(notificationsApi.endpoints.notifications.initiate({ realm: 'reseller' }));
    const badge = store.dispatch(notificationsApi.endpoints.unreadNotifications.initiate('reseller'));
    await Promise.all([list, badge]);
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => (answer = () => resolve(Response.json({ object: 'notification', id: 'n1', read: true })))));
    const marking = store.dispatch(notificationsApi.endpoints.markNotificationRead.initiate({ realm: 'reseller', id: 'n1' }));
    expect(inbox(store)?.pages[0].data.map(item => item.read)).toEqual([true, false]);
    expect(inbox(store)?.pages[0].unread_count).toBe(1);
    expect(count(store)).toBe(1);
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    answer();
    await marking;
    list.unsubscribe();
    badge.unsubscribe();
  });

  test('a refused change is undone; marking all read empties the count', async () => {
    const store = makeStore();
    reply = call => (call.url.endsWith('/unread-count') ? Response.json({ object: 'unread_count', count: 2 }) : Response.json(page(false)));
    const list = store.dispatch(notificationsApi.endpoints.notifications.initiate({ realm: 'reseller' }));
    const badge = store.dispatch(notificationsApi.endpoints.unreadNotifications.initiate('reseller'));
    await Promise.all([list, badge]);
    reply = () => Response.json({ error: { type: 'api_error', code: 'unexpected', message: 'No.' } }, { status: 500 });
    await store.dispatch(notificationsApi.endpoints.markNotificationRead.initiate({ realm: 'reseller', id: 'n1' }));
    expect(inbox(store)?.pages[0].data.map(item => item.read)).toEqual([false, false]);
    expect(count(store)).toBe(2);

    let answer!: () => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => (answer = () => resolve(Response.json({ object: 'notifications_read', updated: 2 })))));
    const all = store.dispatch(notificationsApi.endpoints.markAllNotificationsRead.initiate('reseller'));
    expect(inbox(store)?.pages[0].data.every(item => item.read)).toBe(true);
    expect(count(store)).toBe(0);
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
    answer();
    await all;
    list.unsubscribe();
    badge.unsubscribe();
  });
});

describe('optimistic toggles', () => {
  /** A request the test answers when it chooses. */
  const holdNext = () => {
    let answer!: (response: Response) => void;
    vi.stubGlobal('fetch', async (input: Request) => {
      calls.push({ url: input.url, method: input.method, headers: input.headers, credentials: input.credentials, body: null });
      return new Promise<Response>(resolve => (answer = resolve));
    });
    return async (response: Response) => {
      await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
      answer(response);
    };
  };
  const product = (id: string, listed: boolean) => ({ object: 'admin_product', id, name: id, listed, active: true, image_url: null, offers: [{ id: `${id}-o`, available: true, discount_bps: 0, priority: 0 }] });

  test('listing a product shows at once with the listed count, then takes the saved values without refetching the list', async () => {
    const store = makeStore();
    reply = () => Response.json({ object: 'list', data: [product('p1', false), product('p2', true)], has_more: false, total: 2, listed: 1 });
    const list = store.dispatch(adminApi.endpoints.products.initiate({}));
    await list;
    const answer = holdNext();
    const saving = store.dispatch(adminApi.endpoints.updateProduct.initiate({ id: 'p1', listed: true }));
    const page = () => adminApi.endpoints.products.select({})(store.getState()).data!.pages[0];
    expect(page().data[0].listed).toBe(true);
    expect(page().listed).toBe(2);
    await answer(Response.json({ id: 'p1', active: true, listed: true, name: 'Renamed by the API', image_url: null }));
    await saving;
    expect(page().data[0].name).toBe('Renamed by the API');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls.filter(call => call.url.includes('/v1/admin/products?'))).toHaveLength(1);
    list.unsubscribe();
  });

  test('a refused change flips back and the list is fetched again', async () => {
    const store = makeStore();
    reply = () => Response.json({ object: 'list', data: [product('p1', false)], has_more: false, total: 1, listed: 0 });
    const list = store.dispatch(adminApi.endpoints.products.initiate({}));
    await list;
    const answer = holdNext();
    const saving = store.dispatch(adminApi.endpoints.updateOffer.initiate({ id: 'p1-o', available: false }));
    const offer = () => adminApi.endpoints.products.select({})(store.getState()).data!.pages[0].data[0].offers[0];
    expect(offer().available).toBe(false);
    await vi.waitFor(() => expect(calls.some(call => call.method === 'PATCH')).toBe(true));
    vi.stubGlobal('fetch', async (input: Request) => {
      calls.push({ url: input.url, method: input.method, headers: input.headers, credentials: input.credentials, body: null });
      return Response.json({ object: 'list', data: [product('p1', false)], has_more: false, total: 1, listed: 0 });
    });
    await answer(Response.json({ error: { type: 'invalid_request_error', code: 'not_allowed', message: 'No.' } }, { status: 409 }));
    await saving;
    expect(offer().available).toBe(true);
    await vi.waitFor(() => expect(calls.filter(call => call.url.includes('/v1/admin/products?'))).toHaveLength(2));
    list.unsubscribe();
  });

  test('a switch shows at once at its scope; reset removes it', async () => {
    const store = makeStore();
    reply = () => Response.json({ object: 'list', data: [{ object: 'switch', key: 'own_integrations', scope: 'country', country_code: 'NG', reseller_id: null, enabled: true }], definitions: {} });
    const switches = store.dispatch(adminApi.endpoints.switches.initiate());
    await switches;
    const rows = () => adminApi.endpoints.switches.select()(store.getState()).data!.data;
    let answer = holdNext();
    let saving = store.dispatch(adminApi.endpoints.setSwitch.initiate({ key: 'own_integrations', enabled: true }));
    expect(rows().map(row => [row.scope, row.country_code, row.enabled])).toEqual([
      ['country', 'NG', true],
      ['global', null, true],
    ]);
    await answer(Response.json({ object: 'switch' }));
    await saving;
    answer = holdNext();
    saving = store.dispatch(adminApi.endpoints.setSwitch.initiate({ key: 'own_integrations', country_code: 'NG', enabled: null }));
    expect(rows().some(row => row.country_code === 'NG')).toBe(false);
    await answer(Response.json({ object: 'switch' }));
    await saving;
    switches.unsubscribe();
  });

  test('a supplier market and a reseller listing show at once', async () => {
    const store = makeStore();
    reply = call =>
      call.url.includes('/v1/admin/suppliers/')
        ? Response.json({ object: 'supplier', code: 'zendit', enabled: true, funding: { resale_approved: false }, markets: [{ country: 'NG', category: 'airtime', enabled: false }] })
        : Response.json({ object: 'list', data: [{ object: 'product', id: 'c1', listed: false }], has_more: false, next_cursor: null });
    const supplier = store.dispatch(adminApi.endpoints.supplier.initiate('zendit'));
    const catalogue = store.dispatch(resellerCatalogueApi.endpoints.catalogueProducts.initiate({}));
    await Promise.all([supplier, catalogue]);
    let answer = holdNext();
    const market = store.dispatch(adminApi.endpoints.setSupplierMarket.initiate({ code: 'zendit', country: 'NG', category: 'airtime', enabled: true }));
    expect(adminApi.endpoints.supplier.select('zendit')(store.getState()).data!.markets![0].enabled).toBe(true);
    await answer(Response.json({ object: 'supplier', code: 'zendit', enabled: true, funding: { resale_approved: false }, markets: [{ country: 'NG', category: 'airtime', enabled: true }] }));
    await market;
    answer = holdNext();
    const listing = store.dispatch(resellerCatalogueApi.endpoints.setListing.initiate({ listed: true, product_ids: ['c1'] }));
    expect(resellerCatalogueApi.endpoints.catalogueProducts.select({})(store.getState()).data!.pages[0].data[0].listed).toBe(true);
    await answer(Response.json({ object: 'listing_update', listed: true, product_ids: ['c1'], updated: 1 }));
    await listing;
    supplier.unsubscribe();
    catalogue.unsubscribe();
  });

  test("a number's auto-renew shows at once on the number and its list, and a refusal flips it back", async () => {
    const store = makeStore();
    const number = { object: 'virtual_number', id: 'n1', number: '+447700900123', status: 'active', auto_renew: true, customer_sending: false };
    reply = call => (call.url.includes('/v1/numbers/n1') ? Response.json(number) : Response.json({ object: 'list', data: [number], has_more: false }));
    const one = store.dispatch(resellerNumbersApi.endpoints.resellerNumber.initiate('n1'));
    const list = store.dispatch(resellerNumbersApi.endpoints.resellerNumbers.initiate({}));
    await Promise.all([one, list]);
    const shown = () => [resellerNumbersApi.endpoints.resellerNumber.select('n1')(store.getState()).data!.auto_renew, resellerNumbersApi.endpoints.resellerNumbers.select({})(store.getState()).data!.pages[0].data[0].auto_renew];
    let answer = holdNext();
    let saving = store.dispatch(resellerNumbersApi.endpoints.updateNumber.initiate({ id: 'n1', auto_renew: false }));
    expect(shown()).toEqual([false, false]);
    await answer(Response.json({ ...number, auto_renew: false }));
    await saving;
    expect(shown()).toEqual([false, false]);
    answer = holdNext();
    saving = store.dispatch(resellerNumbersApi.endpoints.updateNumber.initiate({ id: 'n1', auto_renew: true }));
    expect(shown()).toEqual([true, true]);
    await answer(Response.json({ error: { type: 'permission_error', code: 'forbidden', message: 'No.' } }, { status: 403 }));
    await saving;
    expect(shown()).toEqual([false, false]);
    one.unsubscribe();
    list.unsubscribe();
  });
});

describe('smsLimit', () => {
  test('160 characters in the GSM alphabet, 70 with anything else', () => {
    expect(smsLimit('Hello, £5 off {today}')).toBe(160);
    expect(smsLimit('Привет')).toBe(70);
    expect(smsLimit('Thanks 👍')).toBe(70);
  });
});

describe('push', () => {
  test('devices and preferences go to each app’s own endpoints', async () => {
    const store = makeStore();
    reply = () => Response.json({ object: 'list', data: [] });
    await store.dispatch(pushApi.endpoints.pushDevices.initiate('admin'));
    await store.dispatch(pushApi.endpoints.registerPushDevice.initiate({ realm: 'reseller', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } } }));
    await store.dispatch(pushApi.endpoints.setNotificationPreference.initiate({ realm: 'reseller', type: 'top_up.credited', push: true }));
    // Registering refetches the device list in between, so only these calls are checked.
    expect(calls.filter(call => !(call.method === 'GET' && call !== calls[0])).map(call => [call.method, call.url, call.body])).toEqual([
      ['GET', 'http://api.test/v1/admin/devices', null],
      ['POST', 'http://api.test/v1/devices', '{"endpoint":"https://fcm.googleapis.com/fcm/send/x","keys":{"p256dh":"p","auth":"a"}}'],
      ['PUT', 'http://api.test/v1/notification-preferences/top_up.credited', '{"push":true}'],
    ]);
    expect(calls.find(call => call.method === 'POST')!.headers.get('idempotency-key')).toBeTruthy();
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

describe('parseStockCodes', () => {
  test('one code per line, with an optional PIN after a bar, tab or comma; blanks and repeats skipped', () => {
    expect(parseStockCodes('AAAA-1111\n\n  BBBB-2222 | 1234 \r\nCCCC-3333\t99\nDDDD,5\nAAAA-1111')).toEqual([
      { code: 'AAAA-1111' },
      { code: 'BBBB-2222', pin: '1234' },
      { code: 'CCCC-3333', pin: '99' },
      { code: 'DDDD', pin: '5' },
    ]);
    expect(parseStockCodes('   \n')).toEqual([]);
  });
});

describe('media uploads', () => {
  const created = {
    object: 'media_upload',
    id: 'm1',
    purpose: 'brand_logo',
    folder: 'bitocard/platform/brands/amazon/logos',
    url: 'https://media.example/bitocard/platform/brands/amazon/logos/m1.png',
    upload: { method: 'PUT', url: 'https://nyc3.storage.test/bucket/key?X-Amz-Signature=abc', headers: { 'Content-Type': 'image/png', 'x-amz-acl': 'public-read' } },
    expires_at: '2026-10-04T12:00:00Z',
  };
  type Sent = { url: string; method: string; credentials?: RequestCredentials; headers: Headers; idempotent: boolean };
  let sent: Sent[];
  let storageStatus: number;

  beforeEach(() => {
    sent = [];
    storageStatus = 200;
    // The API goes through the base query (a Request); storage gets a plain fetch(url, init).
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      if (typeof input === 'string') {
        sent.push({ url: input, method: init?.method ?? 'GET', credentials: init?.credentials, headers: new Headers(init?.headers), idempotent: false });
        return new Response(null, { status: storageStatus });
      }
      sent.push({ url: input.url, method: input.method, credentials: input.credentials, headers: input.headers, idempotent: input.headers.has('idempotency-key') });
      return input.url.endsWith('/uploads') ? Response.json(created, { status: 201 }) : Response.json({ object: 'media_asset', id: 'm1', url: created.url, status: 'ready' });
    });
  });

  test('asks for a link, sends the file straight to storage without cookies, then asks for the check', async () => {
    const store = makeStore();
    const file = new File([new Uint8Array(16)], 'logo.png', { type: 'image/png' });
    const asset = await uploadMedia(store.dispatch, 'admin', { purpose: 'brand_logo', target_id: 'amazon' }, file);
    expect(asset.url).toBe(created.url);
    expect(sent.map(call => [call.method, call.url])).toEqual([
      ['POST', 'http://api.test/v1/admin/media/uploads'],
      ['PUT', created.upload.url],
      ['POST', 'http://api.test/v1/admin/media/m1/complete'],
    ]);
    expect(sent[1].credentials).toBe('omit');
    expect(sent[1].headers.get('x-amz-acl')).toBe('public-read');
    expect([sent[0].idempotent, sent[2].idempotent]).toEqual([true, true]);
  });

  test('SHQ uses its own address, and a refused upload is reported without checking', async () => {
    storageStatus = 403;
    const store = makeStore();
    const file = new File([new Uint8Array(4)], 'store.png', { type: 'image/png' });
    await expect(uploadMedia(store.dispatch, 'reseller', { purpose: 'store_logo' }, file)).rejects.toMatchObject({ code: 'upload_failed' });
    expect(sent.map(call => call.url)).toEqual(['http://api.test/v1/media/uploads', created.upload.url]);
  });
});
