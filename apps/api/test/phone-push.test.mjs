// BitoCard's app on phones (docs/BITOCARD_MOBILE_APP_PLAN.md, phase 4): a store customer's app registers its push token
// (FCM on Android, APNs on iPhones), kept encrypted and found again by its hash; a notice reaches both through a fake FCM
// and a fake APNs speaking HTTP/2; an unregistered token is dropped; a phone stops getting pushes once signed out; and
// only customers register phones.
import assert from 'node:assert/strict';
import { createServer as createH2 } from 'node:http2';
import { after, before, describe, test } from 'node:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;
let fcm;
let apns;
const apnsCalls = [];
const fcmToken = 'fcm-token-android-0001:APA91bExample_with-dashes.and.dots';
const apnsToken = 'a'.repeat(64);

before(async () => {
  const google = await generateKeyPair('RS256', { extractable: true });
  const apple = await generateKeyPair('ES256', { extractable: true });
  fcm = await fakeFcm();
  apns = createH2();
  apns.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => (body += chunk));
    stream.on('end', () => {
      apnsCalls.push({ headers, body: JSON.parse(body) });
      stream.respond({ ':status': 200, 'content-type': 'application/json' });
      stream.end('');
    });
  });
  await new Promise(resolve => apns.listen(0, '127.0.0.1', resolve));
  server = await startApp({
    env: {
      FCM_API_URL: fcm.url,
      FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'bitocard-app', client_email: 'push@bitocard-app.iam.gserviceaccount.com', private_key: await exportPKCS8(google.privateKey), token_uri: `${fcm.url}/token` }),
      APNS_KEY_ID: 'KEY1234567',
      APNS_TEAM_ID: 'TEAM123456',
      APNS_PRIVATE_KEY: await exportPKCS8(apple.privateKey),
      APNS_TOPIC: 'com.bitocard.app',
      APNS_API_URL: `http://127.0.0.1:${apns.address().port}`,
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
  await fcm?.close();
  await new Promise(resolve => apns?.close(resolve));
});

async function fakeFcm() {
  const { fakeService } = await import('./helpers.mjs');
  return fakeService(call => {
    if (call.url === '/token') return { body: { access_token: 'google-access', expires_in: 3600 } };
    if (call.url === '/v1/projects/bitocard-app/messages:send') {
      if (call.headers.authorization !== 'Bearer google-access') return { status: 401, body: {} };
      if (call.body.message.token === 'fcm-token-gone-0000000000000') return { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } };
      return { body: { name: 'projects/bitocard-app/messages/1' } };
    }
    return { status: 404, body: {} };
  });
}

/** BitoCard's app, with the customer's session. */
function phone() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `pp-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

let counter = 0;
async function customer() {
  const app = phone();
  const email = `phone${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await app.post('/v1/store/account/signup', { name: 'Ada Eze', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await app.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  app.id = signup.json.customer.id;
  app.email = email;
  return app;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 300));

async function notify(customerId, subject) {
  const { InboxService } = await import('../dist/notifications/inbox.service.js');
  const row = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  await server.app.get(InboxService).customer({ customerId, storeId: row.storeId }, 'customer.order.completed', { subject, title: 'Your order is delivered', body: 'Your codes are ready.', link: '/account/orders/x' });
  await settle();
}

describe('Registering a phone', () => {
  test('the settings say which phones can be pushed; tokens are kept encrypted and found again', async () => {
    const app = await customer();
    const settings = await app.get('/v1/store/account/devices/push-settings');
    assert.deepEqual(settings.json.phones, { android: true, ios: true });
    const first = await app.post('/v1/store/account/devices/phone', { kind: 'fcm', token: fcmToken, app_version: '0.4.0' });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.deepEqual([first.json.channel, first.json.label, first.json.app_version, first.json.current], ['fcm', 'BitoCard app on Android', '0.4.0', true]);
    const again = await app.post('/v1/store/account/devices/phone', { kind: 'fcm', token: fcmToken, app_version: '0.4.1' });
    assert.equal(again.json.id, first.json.id, 'the same phone, updated');
    const row = await prisma.device.findUnique({ where: { id: first.json.id } });
    assert.ok(!row.keysEncrypted.includes(fcmToken) && !row.endpoint.includes(fcmToken), 'never kept in the clear');
    assert.equal((await app.post('/v1/store/account/devices/phone', { kind: 'apns', token: 'not-hex-at-all-000000000000' })).json.error.code, 'push_token_invalid');
    assert.equal((await app.post('/v1/store/account/devices/phone', { kind: 'apns_voip', token: apnsToken })).status, 400, 'no VoIP: the app takes no calls');
  });

  test('only a signed-in customer registers phones', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.post('/v1/store/account/devices/phone', { kind: 'fcm', token: fcmToken })).status, 401);
    assert.equal((await phone().post('/v1/store/account/devices/phone', { kind: 'fcm', token: fcmToken })).status, 401);
  });
});

describe('Pushing notices to phones', () => {
  test('a notice reaches Android and the iPhone; an unregistered token is dropped', async () => {
    const app = await customer();
    await app.post('/v1/store/account/devices/phone', { kind: 'fcm', token: 'fcm-token-gone-0000000000000' });
    await app.post('/v1/store/account/devices/phone', { kind: 'fcm', token: `${fcmToken}-ada` });
    await app.post('/v1/store/account/devices/phone', { kind: 'apns', token: apnsToken });
    const fcmBefore = fcm.calls.length;
    const apnsBefore = apnsCalls.length;
    await notify(app.id, 'n1');
    const sent = fcm.calls.slice(fcmBefore).filter(call => call.url.endsWith(':send'));
    assert.equal(sent.length, 2);
    const android = sent.find(call => call.body.message.token === `${fcmToken}-ada`).body.message;
    assert.deepEqual([android.notification.title, android.data.link, android.data.type], ['Your order is delivered', '/account/orders/x', 'customer.order.completed']);
    const pushed = apnsCalls.slice(apnsBefore);
    assert.equal(pushed.length, 1);
    assert.deepEqual([pushed[0].headers['apns-push-type'], pushed[0].headers['apns-topic']], ['alert', 'com.bitocard.app']);
    assert.match(pushed[0].headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(pushed[0].body.aps.alert.title, 'Your order is delivered');
    assert.equal(await prisma.device.count({ where: { customerId: app.id, channel: 'fcm' } }), 1, 'the unregistered token is dropped');
  });

  test('a phone signed out gets nothing more', async () => {
    const app = await customer();
    await app.post('/v1/store/account/devices/phone', { kind: 'apns', token: 'd'.repeat(64) });
    assert.equal((await app.post('/v1/store/account/signout')).status, 200);
    const before = apnsCalls.length;
    await notify(app.id, 'n2');
    assert.equal(apnsCalls.length, before);
    assert.equal(await prisma.device.count({ where: { customerId: app.id } }), 0, 'dropped with its session');
  });
});
