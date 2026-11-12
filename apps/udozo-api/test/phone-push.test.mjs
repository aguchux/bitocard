// Udozo's app on phones (docs/UDOZO_MOBILE_APP_PLAN.md, phase 0): the app registers its push tokens (FCM on Android,
// APNs and the VoIP token on iPhones), notices go to them through a fake FCM and a fake APNs speaking HTTP/2, VoIP tokens
// never get notices, and calls ring the callee's closed app: a callee with the app counts as reachable, their phones ring,
// and Android phones are told when the ringing should stop.
import assert from 'node:assert/strict';
import { createServer as createH2 } from 'node:http2';
import { after, before, describe, test } from 'node:test';
import { exportPKCS8, generateKeyPair } from 'jose';
import { adminClient, confirmMobile, fakeService, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let fcm;
let turn;
let apns;
const apnsCalls = [];
const fcmToken = 'fcm-token-android-0001:APA91bExample_with-dashes.and.dots';
const apnsToken = 'a'.repeat(64);
const voipToken = 'b'.repeat(64);
const goneToken = 'c'.repeat(64);

before(async () => {
  const google = await generateKeyPair('RS256', { extractable: true });
  const apple = await generateKeyPair('ES256', { extractable: true });
  fcm = await fakeService(call => {
    if (call.url === '/token') return { body: { access_token: 'google-access', expires_in: 3600 } };
    if (call.url === '/v1/projects/udozo-app/messages:send') {
      if (call.headers.authorization !== 'Bearer google-access') return { status: 401, body: {} };
      if (call.body.message.token === 'fcm-token-gone-0000000000000') return { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } };
      return { body: { name: 'projects/udozo-app/messages/1' } };
    }
    return { status: 404, body: {} };
  });
  turn = await fakeService(call =>
    call.method === 'POST' ? { status: 201, body: { iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }] } } : { status: 404, body: {} },
  );
  apns = createH2();
  apns.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => (body += chunk));
    stream.on('end', () => {
      apnsCalls.push({ headers, body: JSON.parse(body) });
      const gone = headers[':path'].endsWith(goneToken);
      stream.respond({ ':status': gone ? 410 : 200, 'content-type': 'application/json' });
      stream.end(gone ? JSON.stringify({ reason: 'Unregistered' }) : '');
    });
  });
  await new Promise(resolve => apns.listen(0, '127.0.0.1', resolve));
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      CLOUDFLARE_TURN_KEY_ID: 'k',
      CLOUDFLARE_TURN_API_TOKEN: 't',
      CLOUDFLARE_TURN_API_URL: turn.url,
      FCM_API_URL: fcm.url,
      FCM_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'udozo-app', client_email: 'push@udozo-app.iam.gserviceaccount.com', private_key: await exportPKCS8(google.privateKey), token_uri: `${fcm.url}/token` }),
      APNS_KEY_ID: 'KEY1234567',
      APNS_TEAM_ID: 'TEAM123456',
      APNS_PRIVATE_KEY: await exportPKCS8(apple.privateKey),
      APNS_TOPIC: 'com.udozo.app',
      APNS_API_URL: `http://127.0.0.1:${apns.address().port}`,
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(async () => {
  await server?.close();
  await fcm?.close();
  await turn?.close();
  await new Promise(resolve => apns?.close(resolve));
});

/** Udozo's app, with the customer's session. */
function phone(platform = 'android') {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'udozo-app': `${platform}/0.1.0`,
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
async function customer(name, platform) {
  const app = phone(platform);
  const email = `phone${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await app.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, app);
  assert.equal((await app.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await app.post('/v1/classifieds/terms/accept', { version: (await app.get('/v1/classifieds/terms')).json.version });
  app.id = signup.json.customer.id;
  return app;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 300));

describe('Registering a phone', () => {
  test('the settings say which phones can be pushed; tokens are kept encrypted and found again', async () => {
    const app = await customer('Ada Eze', 'android');
    const settings = await app.get('/v1/store/account/devices/push-settings');
    assert.deepEqual(settings.json.phones, { android: true, ios: true });
    const first = await app.post('/v1/store/account/devices/phone', { kind: 'fcm', token: fcmToken, app_version: '0.1.0' });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.deepEqual([first.json.channel, first.json.label, first.json.app_version, first.json.current], ['fcm', 'Udozo app on Android', '0.1.0', true]);
    const again = await app.post('/v1/store/account/devices/phone', { kind: 'fcm', token: fcmToken, app_version: '0.1.1' });
    assert.equal(again.json.id, first.json.id, 'the same phone, updated');
    const row = await prisma.device.findUnique({ where: { id: first.json.id } });
    assert.ok(!row.keysEncrypted.includes(fcmToken) && !row.endpoint.includes(fcmToken), 'never kept in the clear');
    assert.equal((await app.post('/v1/store/account/devices/phone', { kind: 'apns', token: 'not-hex-at-all-000000000000' })).json.error.code, 'push_token_invalid');
  });

  test('a notice reaches Android and the iPhone, never the VoIP token; a gone token is dropped', async () => {
    const android = await customer('Bola Ade', 'android');
    const iphone = phone('ios');
    // The same person on their iPhone: signed in there too.
    const email = (await prisma.customer.findUniqueOrThrow({ where: { id: android.id } })).email;
    await iphone.post('/v1/store/account/signin', { email, password: 'correct horse battery' });
    await android.post('/v1/store/account/devices/phone', { kind: 'fcm', token: 'fcm-token-gone-0000000000000' });
    await android.post('/v1/store/account/devices/phone', { kind: 'fcm', token: `${fcmToken}-bola` });
    await iphone.post('/v1/store/account/devices/phone', { kind: 'apns', token: apnsToken });
    await iphone.post('/v1/store/account/devices/phone', { kind: 'apns_voip', token: voipToken });
    const fcmBefore = fcm.calls.length;
    const apnsBefore = apnsCalls.length;
    const { InboxService } = await import('../dist/notifications/inbox.service.js');
    const customerRow = await prisma.customer.findUniqueOrThrow({ where: { id: android.id } });
    await server.app.get(InboxService).customer({ customerId: android.id, storeId: customerRow.storeId }, 'customer.classifieds.listing_expired', { subject: 'x1', title: 'Your ad expired', body: 'Renew it to sell again.', link: '/account/listings' });
    await settle();
    const sent = fcm.calls.slice(fcmBefore).filter(call => call.url.endsWith(':send'));
    assert.equal(sent.length, 2);
    assert.equal(sent.find(call => call.body.message.token === `${fcmToken}-bola`).body.message.data.link, '/account/listings');
    const pushed = apnsCalls.slice(apnsBefore);
    assert.equal(pushed.length, 1, 'the VoIP token gets no notices');
    assert.equal(pushed[0].headers['apns-push-type'], 'alert');
    assert.equal(pushed[0].headers['apns-topic'], 'com.udozo.app');
    assert.match(pushed[0].headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(pushed[0].body.aps.alert.title, 'Your ad expired');
    assert.equal(await prisma.device.count({ where: { customerId: android.id, channel: 'fcm' } }), 1, 'the unregistered token is dropped');
  });
});

describe('Calls to a closed app', () => {
  test('a seller with the app counts as reachable and their phones ring; Android stops when the caller cancels', async () => {
    const seller = await customer('Chidi Obi', 'ios');
    const buyer = await customer('Dayo Ojo', 'android');
    const cat = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
    const area = await prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } });
    const draft = (await seller.post('/v1/classifieds/listings', { title: 'LG 43 inch smart TV', price: 18000000, condition: 'used', category_id: cat.id, area_id: area.id, contact: 'both' })).json;
    await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
    assert.equal((await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json.status, 'active');

    // Not on udozo.com and no app: offline.
    assert.equal((await buyer.post(`/v1/classifieds/listings/${draft.id}/calls`)).json.error.code, 'seller_offline');
    // An app too old to answer calls registers push but never makes them reachable.
    await seller.post('/v1/store/account/devices/phone', { kind: 'apns_voip', token: voipToken.replace(/b/g, 'e'), app_version: '0.1.0' });
    assert.equal((await buyer.get(`/v1/classifieds/listings/${draft.id}/viewer`)).json.seller_online, false);
    await seller.post('/v1/store/account/devices/phone', { kind: 'apns_voip', token: voipToken.replace(/b/g, 'd'), app_version: '0.4.0' });
    // A second phone of theirs, on Android.
    const sellerAndroid = phone('android');
    await sellerAndroid.post('/v1/store/account/signin', { email: (await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } })).email, password: 'correct horse battery' });
    await sellerAndroid.post('/v1/store/account/devices/phone', { kind: 'fcm', token: `${fcmToken}-chidi`, app_version: '0.4.0' });
    assert.equal((await buyer.get(`/v1/classifieds/listings/${draft.id}/viewer`)).json.seller_online, true);

    const apnsBefore = apnsCalls.length;
    const fcmBefore = fcm.calls.length;
    const started = await buyer.post(`/v1/classifieds/listings/${draft.id}/calls`);
    assert.equal(started.status, 201, JSON.stringify(started.json));
    await settle();
    const voip = apnsCalls.slice(apnsBefore).find(call => call.headers['apns-push-type'] === 'voip');
    assert.ok(voip, 'the iPhone rang through PushKit');
    assert.equal(voip.headers['apns-topic'], 'com.udozo.app.voip');
    assert.deepEqual([voip.body.kind, voip.body.call_id, voip.body.caller], ['call', started.json.id, 'Dayo O.']);
    assert.deepEqual(Object.keys(voip.body).sort(), ['about', 'call_id', 'caller', 'kind'], 'the call and a public name, never a number');
    const ring = fcm.calls.slice(fcmBefore).find(call => call.body?.message?.data?.kind === 'call');
    assert.equal(ring.body.message.android.priority, 'high');
    assert.equal(ring.body.message.data.call_id, started.json.id);

    const fcmBeforeEnd = fcm.calls.length;
    assert.equal((await buyer.post(`/v1/classifieds/calls/${started.json.id}/end`)).json.status, 'cancelled');
    await settle();
    const ended = fcm.calls.slice(fcmBeforeEnd).find(call => call.body?.message?.data?.kind === 'call_ended');
    assert.deepEqual([ended.body.message.data.call_id, ended.body.message.data.reason], [started.json.id, 'ended']);
  });
});
