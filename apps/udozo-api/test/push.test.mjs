// Device push: each browser registers with its own ID, receives every notification meant for its person once (as the
// person's preferences allow), encrypted so only that browser can read it and signed with BitoCard's VAPID key; it is
// dropped when its session ends or the push service says it is gone; failures are retried briefly.
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, randomUUID, verify } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import webpush from 'web-push';
import { adminClient, fakeService, resellerClient, startApp } from './helpers.mjs';

const vapid = webpush.generateVAPIDKeys();
let server;
let pushService;
let prisma;
let inbox;
/** What the fake push service answers next, per path (default 201). */
const replies = new Map();

before(async () => {
  pushService = await fakeService(call => ({ status: replies.get(call.url.split('?')[0]) ?? 201, body: '' }));
  server = await startApp({
    env: { CRON_SECRET: 'cron-secret', WEBHOOK_ALLOW_PRIVATE_URLS: 'on', WEB_PUSH_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_PRIVATE_KEY: vapid.privateKey, WEB_PUSH_SUBJECT: 'mailto:ops@bitocard.com' },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  inbox = server.app.get((await import('../dist/notifications/inbox.service.js')).InboxService);
});

after(async () => {
  await server?.close();
  await pushService?.close();
});

let browserCount = 0;

/** A browser's push subscription: its own P-256 key pair and auth secret, at its own address on the fake service. */
function browserSubscription() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const path = `/push/${(browserCount += 1)}-${Date.now()}`;
  return {
    path,
    json: { endpoint: `${pushService.url}${path}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
    /** Decrypts a push as the browser would (RFC 8291, aes128gcm). */
    decrypt(body) {
      const salt = body.subarray(0, 16);
      const idLength = body[20];
      const senderKey = body.subarray(21, 21 + idLength);
      const ciphertext = body.subarray(21 + idLength);
      const secret = ecdh.computeSecret(senderKey);
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), senderKey]);
      const ikm = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
      const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const decipher = createDecipheriv('aes-128-gcm', key, nonce);
      decipher.setAuthTag(ciphertext.subarray(-16));
      const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
      return JSON.parse(padded.subarray(0, padded.lastIndexOf(2)).toString('utf8'));
    },
  };
}

/** The raw bodies the fake push service received at a browser's address, read from the recorded calls. */
const received = sub => pushService.calls.filter(call => call.url === sub.path);

/** Each push a browser received, decrypted. */
async function pushes(sub) {
  return received(sub).map(call => ({ headers: call.headers, payload: sub.decrypt(call.raw) }));
}

const until = async (check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};
const content = (subject, extra = {}) => ({ subject, title: `Title ${subject}`, body: `Body ${subject}`, ...extra });
const chrome = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };

async function registered(browser, headers = {}, path = '/v1/devices') {
  const sub = browserSubscription();
  const res = await browser.post(path, sub.json, { ...chrome, ...headers });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return { sub, device: res.json };
}

describe('registering devices', () => {
  test('a browser registers with its own ID and is recognisable', async () => {
    const owner = await resellerClient(server);
    assert.deepEqual((await owner.browser.get('/v1/devices/push-settings')).json, { object: 'push_settings', enabled: true, public_key: vapid.publicKey });
    const { device } = await registered(owner.browser);
    assert.deepEqual([device.object, device.channel, device.label, device.current], ['device', 'web_push', 'Chrome on Windows', true]);
    assert.match(device.id, /^[0-9a-f-]{36}$/);
    const listed = (await owner.browser.get('/v1/devices')).json.data;
    assert.deepEqual(listed.map(item => item.id), [device.id]);
    const stored = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    assert.ok(!stored.keysEncrypted.includes('auth'), 'keys are encrypted at rest');
  });

  test('bad keys, unknown push services and API keys are refused', async () => {
    const owner = await resellerClient(server);
    const sub = browserSubscription();
    const bad = await owner.browser.post('/v1/devices', { ...sub.json, keys: { ...sub.json.keys, p256dh: sub.json.keys.p256dh.slice(0, 80) } });
    assert.equal(bad.json.error.code, 'push_keys_invalid');
    const { pushEndpointAllowed } = await import('../dist/notifications/push.service.js');
    assert.equal(pushEndpointAllowed('https://fcm.googleapis.com/fcm/send/abc', false), true);
    assert.equal(pushEndpointAllowed('https://updates.push.services.mozilla.com/wpush/v2/abc', false), true);
    assert.equal(pushEndpointAllowed('https://web.push.apple.com/abc', false), true);
    assert.equal(pushEndpointAllowed('https://wns2-par02p.notify.windows.com/w/?token=abc', false), true);
    assert.equal(pushEndpointAllowed('https://evil.example.com/fcm.googleapis.com', false), false);
    assert.equal(pushEndpointAllowed('https://fcm.googleapis.com.evil.example/abc', false), false);
    assert.equal(pushEndpointAllowed('http://fcm.googleapis.com/abc', false), false);
    assert.equal(pushEndpointAllowed('https://fcm.googleapis.com:8443/abc', false), false);
    const key = (await owner.browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' })).json.secret;
    const viaKey = await fetch(`${server.base}/v1/devices`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal(viaKey.status, 403);
  });

  test('a removed device gets nothing; another person cannot remove or test it', async () => {
    const owner = await resellerClient(server);
    const stranger = await resellerClient(server);
    const { sub, device } = await registered(owner.browser);
    assert.equal((await stranger.browser.delete(`/v1/devices/${device.id}`)).status, 404);
    assert.equal((await stranger.browser.post(`/v1/devices/${device.id}/test`)).status, 404);
    assert.equal((await owner.browser.delete(`/v1/devices/${device.id}`)).status, 204);
    await inbox.reseller(owner.resellerId, 'payout.failed', content('after-removal'));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(received(sub).length, 0);
  });
});

describe('pushing', () => {
  test('each notification reaches each of its recipients’ devices once, encrypted and signed', async () => {
    const owner = await resellerClient(server);
    const finance = await resellerClient(server, { name: 'Fin Staff' });
    await prisma.resellerMember.create({ data: { resellerId: owner.resellerId, userId: finance.userId, role: 'finance' } });
    const support = await resellerClient(server, { name: 'Sup Staff' });
    await prisma.resellerMember.create({ data: { resellerId: owner.resellerId, userId: support.userId, role: 'support' } });
    const ownerDevice = await registered(owner.browser);
    const ownerPhone = await registered(owner.browser, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1' });
    const financeDevice = await registered(finance.browser);
    const supportDevice = await registered(support.browser);
    assert.equal(ownerPhone.device.label, 'Safari on iOS');

    await inbox.reseller(owner.resellerId, 'payout.failed', content('payout-9', { link: '/wallet/payouts', mode: 'test' }));
    await inbox.reseller(owner.resellerId, 'payout.failed', content('payout-9', { link: '/wallet/payouts', mode: 'test' }));
    for (const { sub } of [ownerDevice, ownerPhone, financeDevice]) await until(async () => received(sub).length === 1, 'the push');
    await new Promise(resolve => setTimeout(resolve, 200));
    for (const { sub } of [ownerDevice, ownerPhone, financeDevice]) assert.equal(received(sub).length, 1, 'once per device');
    assert.equal(received(supportDevice.sub).length, 0, 'support does not get withdrawals');

    const [push] = await pushes(financeDevice.sub);
    assert.deepEqual(
      { ...push.payload, id: undefined },
      { id: undefined, type: 'payout.failed', title: 'Title payout-9', body: 'Body payout-9', severity: 'critical', link: '/wallet/payouts', mode: 'test', account: owner.resellerId, icon: '/icon-192.png' },
    );
    assert.equal(push.headers['content-encoding'], 'aes128gcm');
    assert.equal(push.headers.urgency, 'high');
    assert.equal(push.headers.ttl, '86400');

    // VAPID: a JWT for the push service's origin, signed with BitoCard's private key.
    const [, jwt, key] = /^vapid t=([^,]+), k=(.+)$/.exec(push.headers.authorization);
    assert.equal(key, vapid.publicKey);
    const [header, claims, signature] = jwt.split('.');
    const raw = Buffer.from(vapid.publicKey, 'base64url');
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.equal(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
    const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString());
    assert.deepEqual([decoded.aud, decoded.sub], [pushService.url, 'mailto:ops@bitocard.com']);
    // The push arrives a moment before its delivery is recorded as sent.
    await until(async () => (await prisma.pushDelivery.count({ where: { deviceId: financeDevice.device.id, status: 'sent' } })) === 1, 'the delivery to be recorded');
  });

  test('preferences: quieter notifications are off until chosen; urgent and security ones cannot be turned off', async () => {
    const owner = await resellerClient(server);
    const { sub } = await registered(owner.browser);
    const preferences = (await owner.browser.get('/v1/notification-preferences')).json.data;
    const find = type => preferences.find(item => item.type === type);
    assert.deepEqual([find('top_up.credited').push, find('top_up.credited').locked], [false, false]);
    assert.deepEqual([find('order.needs_review').push, find('order.needs_review').locked], [true, false]);
    assert.deepEqual([find('payout.failed').push, find('payout.failed').locked], [true, true]);
    assert.deepEqual([find('security.password_changed').push, find('security.password_changed').locked], [true, true]);
    assert.equal(find('admin.order.needs_review'), undefined, 'only what this person can get');

    await inbox.reseller(owner.resellerId, 'top_up.credited', content('quiet-1'));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(received(sub).length, 0, 'success notices are not pushed by default');

    const on = await owner.browser.put('/v1/notification-preferences/top_up.credited', { push: true });
    assert.deepEqual([on.status, on.json.push], [200, true]);
    await inbox.reseller(owner.resellerId, 'top_up.credited', content('quiet-2'));
    await until(async () => received(sub).length === 1, 'the chosen push');

    assert.equal((await owner.browser.put('/v1/notification-preferences/payout.failed', { push: false })).json.error.code, 'preference_locked');
    assert.equal((await owner.browser.put('/v1/notification-preferences/admin.fx.paused', { push: true })).status, 404);
    await owner.browser.put('/v1/notification-preferences/order.needs_review', { push: false });
    await inbox.reseller(owner.resellerId, 'order.needs_review', content('muted'));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(received(sub).length, 1, 'turned off');
  });

  test('signing out drops the device; the same browser signed in by someone else moves to them', async () => {
    const first = await resellerClient(server);
    const { sub, device } = await registered(first.browser);
    assert.equal((await first.browser.post('/v1/auth/signout')).status < 300, true);
    await inbox.reseller(first.resellerId, 'payout.failed', content('signed-out'));
    await until(async () => (await prisma.device.count({ where: { id: device.id } })) === 0, 'the device to be dropped');
    assert.equal(received(sub).length, 0);

    const second = await resellerClient(server);
    const shared = await registered(second.browser);
    const third = await resellerClient(server);
    const moved = await third.browser.post('/v1/devices', shared.sub.json, chrome);
    assert.equal(moved.json.id, shared.device.id, 'one browser, one device');
    await inbox.reseller(second.resellerId, 'payout.failed', content('old-owner'));
    await inbox.reseller(third.resellerId, 'payout.failed', content('new-owner'));
    await until(async () => received(shared.sub).length === 1, 'the push');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual((await pushes(shared.sub)).map(item => item.payload.title), ['Title new-owner']);
  });

  test('a gone subscription is dropped; a busy push service is retried, then given up', async () => {
    const owner = await resellerClient(server);
    const gone = await registered(owner.browser);
    const busy = await registered(owner.browser);
    replies.set(gone.sub.path, 410);
    replies.set(busy.sub.path, 503);
    await inbox.reseller(owner.resellerId, 'payout.failed', content('retry-1'));
    await until(async () => (await prisma.device.count({ where: { id: gone.device.id } })) === 0, 'the gone device to be dropped');
    const delivery = () => prisma.pushDelivery.findFirstOrThrow({ where: { deviceId: busy.device.id } });
    // The attempt is counted when it is claimed, before the push service answers: wait for the recorded answer.
    await until(async () => (await delivery()).lastError === 'HTTP 503', 'the first try');
    assert.deepEqual([(await delivery()).status, (await delivery()).attempts], ['pending', 1]);

    const runJob = () => fetch(`${server.base}/v1/cron/push`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    const makeDue = async () => prisma.pushDelivery.updateMany({ where: { deviceId: busy.device.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    replies.delete(busy.sub.path);
    await makeDue();
    assert.equal((await runJob()).result.sent >= 1, true);
    assert.equal((await delivery()).status, 'sent');

    replies.set(busy.sub.path, 500);
    await inbox.reseller(owner.resellerId, 'payout.failed', content('retry-2'));
    const second = async () => prisma.pushDelivery.findFirstOrThrow({ where: { deviceId: busy.device.id, notification: { title: 'Title retry-2' } } });
    await until(async () => (await second()).lastError === 'HTTP 500', 'the first try');
    for (let i = 0; i < 5; i += 1) {
      await makeDue();
      await runJob();
    }
    assert.deepEqual([(await second()).status, (await second()).attempts], ['failed', 4]);
    assert.equal(await prisma.device.count({ where: { id: busy.device.id } }), 1, 'a busy service does not drop the device');
    replies.delete(busy.sub.path);
  });

  test('a test push says whether it was accepted', async () => {
    const owner = await resellerClient(server);
    const { sub, device } = await registered(owner.browser);
    const res = await owner.browser.post(`/v1/devices/${device.id}/test`);
    assert.deepEqual(res.json, { object: 'push_test', sent: true, error: null });
    assert.equal((await pushes(sub))[0].payload.title, 'Push notifications are on');
    replies.set(sub.path, 400);
    assert.deepEqual((await owner.browser.post(`/v1/devices/${device.id}/test`)).json, { object: 'push_test', sent: false, error: 'HTTP 400' });
    replies.delete(sub.path);
  });
});

describe('admins', () => {
  test('admins register in the admin app and get pushes for their roles; realms are kept apart', async () => {
    const finance = await adminClient(server, ['finance']);
    const support = await adminClient(server, ['support']);
    const financeDevice = await registered(finance, {}, '/v1/admin/devices');
    const supportDevice = await registered(support, {}, '/v1/admin/devices');
    const types = (await finance.get('/v1/admin/notification-preferences')).json.data.map(item => item.type);
    assert.ok(types.includes('admin.payout.failed') && !types.includes('admin.order.needs_review') && !types.includes('payout.failed'));

    await inbox.admins('admin.payout.failed', content(`admin-${Date.now()}`, { link: '/resellers/x' }));
    await until(async () => received(financeDevice.sub).length === 1, 'the admin push');
    assert.equal(received(supportDevice.sub).length, 0);
    assert.equal((await pushes(financeDevice.sub))[0].payload.account, null);

    const owner = await resellerClient(server);
    assert.equal((await owner.browser.get('/v1/admin/devices')).status, 401);
    assert.equal((await finance.get('/v1/devices')).status, 401);
  });
});

describe('storefront customers (baseline)', () => {
  /** A store and a customer of it. */
  async function storeCustomer(logoUrl = null) {
    const owner = await resellerClient(server);
    const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Ada Gifts', subdomain: `ada${Date.now()}${(browserCount += 1)}`, logoUrl } });
    const customer = await prisma.customer.create({ data: { storeId: store.id, email: `chi${Date.now()}${browserCount}@example.com`, name: 'Chi', passwordHash: 'x' } });
    return { owner, store, customerId: customer.id };
  }

  test('customer devices and preferences are their own; until customer sign-in exists nothing is pushed to them', async () => {
    const { PushService } = await import('../dist/notifications/push.service.js');
    const push = server.app.get(PushService);
    const { owner, store, customerId } = await storeCustomer('https://cdn.example/ada.png');
    const caller = { owner: { customerId }, audience: 'customer', sessionId: randomUUID(), storeId: store.id };
    const sub = browserSubscription();
    const device = await push.register(caller, sub.json, chrome['user-agent']);
    assert.deepEqual([device.label, device.current], ['Chrome on Windows', true]);
    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    assert.deepEqual([row.audience, row.userId, row.customerId, row.storeId], ['customer', null, customerId, store.id]);
    assert.equal((await owner.browser.get('/v1/devices')).json.data.length, 0, 'staff never see customer devices');

    const preferences = (await push.preferences(caller)).data;
    assert.ok(preferences.every(item => item.type.startsWith('customer.')), 'customers only see customer notifications');
    const find = type => preferences.find(item => item.type === type);
    assert.deepEqual([find('customer.order.completed').push, find('customer.order.completed').locked], [true, false]);
    assert.deepEqual([find('customer.security.password_changed').push, find('customer.security.password_changed').locked], [true, true]);
    await assert.rejects(push.setPreference(caller, 'customer.security.email_changed', false), /always pushed/);
    assert.equal((await push.setPreference(caller, 'customer.order.refunded', false)).push, false);

    // Queued like any other, but dropped instead of pushed: no customer session can be checked yet.
    await inbox.customer({ customerId, storeId: store.id }, 'customer.order.completed', content('order-c1', { link: '/account/orders/o1' }));
    await until(async () => (await prisma.device.count({ where: { id: device.id } })) === 0, 'the unverifiable device to be dropped');
    assert.equal(received(sub).length, 0);
  });

  test('a customer device only matches its own store', async () => {
    const { PushService } = await import('../dist/notifications/push.service.js');
    const push = server.app.get(PushService);
    const { store, customerId } = await storeCustomer();
    const other = await storeCustomer();
    const caller = { owner: { customerId }, audience: 'customer', sessionId: randomUUID(), storeId: store.id };
    const device = await push.register(caller, browserSubscription().json, chrome['user-agent']);
    // The same customer ID at another store (accounts are per store) is a different inbox and device set.
    await inbox.customer({ customerId, storeId: other.store.id }, 'customer.order.failed', content('elsewhere'));
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await prisma.pushDelivery.count({ where: { deviceId: device.id } }), 0);
    await assert.rejects(push.register({ ...caller, storeId: undefined }, browserSubscription().json), /register on their store/);
  });
});

describe('switched off', () => {
  test('without VAPID keys, browsers cannot register and nothing is pushed', async () => {
    const off = await startApp();
    try {
      const owner = await resellerClient(off);
      assert.deepEqual((await owner.browser.get('/v1/devices/push-settings')).json, { object: 'push_settings', enabled: false, public_key: null });
      assert.equal((await owner.browser.post('/v1/devices', browserSubscription().json)).json.error.code, 'push_not_configured');
    } finally {
      await off.close();
    }
  });
});
