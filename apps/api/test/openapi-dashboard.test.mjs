// The SHQ dashboard endpoints (sign-in and the person's own account, notifications and push, the reseller's own
// integrations) return exactly what the OpenAPI document says: each real response is checked against its schema.
import assert from 'node:assert/strict';
import { createECDH, createHmac, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import webpush from 'web-push';
import { adminClient, client, fakeService, lastEmailCode, lastSmsCode, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';
import { responseChecker } from './openapi-docs.mjs';

const vapid = webpush.generateVAPIDKeys();
const password = 'correct horse battery';
let server;
let check;
let prisma;
let reloadly;
let pushService;

before(async () => {
  reloadly = await fakeReloadly();
  pushService = await fakeService(() => ({ status: 201, body: '' }));
  server = await startApp({
    env: {
      ...reloadly.env,
      DIDWW_CALLBACK_URL: 'https://api.test.example',
      WEBHOOK_ALLOW_PRIVATE_URLS: 'on',
      WEB_PUSH_PUBLIC_KEY: vapid.publicKey,
      WEB_PUSH_PRIVATE_KEY: vapid.privateKey,
      WEB_PUSH_SUBJECT: 'mailto:ops@bitocard.com',
      GOOGLE_CLIENT_ID: 'google-client.apps.example',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    },
  });
  check = await responseChecker(server.app);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  await pushService?.close();
});

let counter = 0;
const unique = () => `dash${(counter += 1)}-${Date.now()}@example.com`;
/** Lets another code be sent at once (one a minute otherwise). */
const allowResend = userId => prisma.verificationCode.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - 2 * 60_000) } });

/** Asserts the status, then checks the body against the documented schema. */
function expect(key, status, response) {
  assert.equal(response.status, status, `${key}: ${JSON.stringify(response.json)}`);
  check(key, status, response.json);
  return response.json;
}

describe('authentication', () => {
  test('step-by-step sign-up, sessions, docs tokens and opening a reseller account', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    expect('POST /v1/auth/signup/email', 202, await browser.post('/v1/auth/signup/email', { email }));
    const verification = expect('POST /v1/auth/signup/email/verify', 200, await browser.post('/v1/auth/signup/email/verify', { email, code: await lastEmailCode(server.app, email) }));
    const session = expect(
      'POST /v1/auth/signup',
      201,
      await browser.post('/v1/auth/signup', { name: 'Ada Obi', email, password, country: 'NG', business_name: 'Ada Digital', signup_token: verification.signup_token }),
    );
    expect('GET /v1/auth/session', 200, await browser.get('/v1/auth/session'));
    const token = expect('POST /v1/auth/docs-token', 200, await browser.post('/v1/auth/docs-token', { mode: 'test' }));
    assert.match(token.token, /^bc_docs_/);
    expect('POST /v1/auth/docs-token', 200, await browser.post('/v1/auth/docs-token', { mode: 'test', read_only: true }));

    // A person who no longer owns a reseller account opens one.
    await prisma.resellerMember.deleteMany({ where: { userId: session.user.id } });
    const opened = expect('POST /v1/auth/reseller-account', 201, await browser.post('/v1/auth/reseller-account', { business_name: 'Ada Two', country: 'NG' }));
    assert.equal(opened.memberships.length, 1);
  });

  test('the person’s own account: email, profile, phone, password and addresses', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    const created = expect('POST /v1/auth/signup', 201, await browser.post('/v1/auth/signup', { name: 'Kofi Mensah', email, password, country: 'NG' }));
    const userId = created.user.id;
    await allowResend(userId);
    expect('POST /v1/auth/email/resend', 202, await browser.post('/v1/auth/email/resend', {}));
    expect('POST /v1/auth/email/verify', 200, await browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, email) }));
    expect('PATCH /v1/auth/profile', 200, await browser.patch('/v1/auth/profile', { name: 'Kofi A. Mensah' }));

    const phone = expect('POST /v1/auth/phone', 202, await browser.post('/v1/auth/phone', { phone: '+2348031234567' }));
    const verified = expect('POST /v1/auth/phone/verify', 200, await browser.post('/v1/auth/phone/verify', { code: await lastSmsCode(server.app, phone.phone) }));
    assert.equal(verified.user.phone_verified, true);
    expect('POST /v1/auth/signin', 200, await client(server.base).post('/v1/auth/signin', { identifier: phone.phone, password }));

    const newPassword = 'another horse battery staple';
    expect('POST /v1/auth/password/change', 200, await browser.post('/v1/auth/password/change', { current_password: password, new_password: newPassword }));

    const other = unique();
    expect('POST /v1/auth/emails', 202, await browser.post('/v1/auth/emails', { email: other }));
    expect('POST /v1/auth/emails/verify', 200, await browser.post('/v1/auth/emails/verify', { code: await lastEmailCode(server.app, other) }));
    expect('GET /v1/auth/emails', 200, await browser.get('/v1/auth/emails'));
    const swapped = expect('POST /v1/auth/emails/primary', 200, await browser.post('/v1/auth/emails/primary', { email: other, password: newPassword }));
    assert.equal(swapped.data.find(item => item.primary).email, other);
    const removed = expect('DELETE /v1/auth/emails/{email}', 200, await browser.delete(`/v1/auth/emails/${encodeURIComponent(email)}`));
    assert.equal(removed.data.length, 1);

    expect('POST /v1/auth/password/forgot', 202, await browser.post('/v1/auth/password/forgot', { email: other }));
    expect('POST /v1/auth/password/reset', 200, await browser.post('/v1/auth/password/reset', { email: other, code: await lastEmailCode(server.app, other), password }));
    expect('POST /v1/auth/signin', 200, await browser.post('/v1/auth/signin', { identifier: other, password }));
    assert.equal((await browser.post('/v1/auth/signout', {})).status, 204);
  });

  test('Google sign-in redirects to Google, and back to the app (here with an error, as no state was kept)', async () => {
    const start = await fetch(`${server.base}/v1/auth/google/start?intent=signup`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const callback = await fetch(`${server.base}/v1/auth/google/callback?state=unknown&code=x`, { redirect: 'manual' });
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get('location'), /auth_error=google_state_invalid/);
  });
});

describe('notifications and push', () => {
  test('the inbox, devices and preferences', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const inbox = server.app.get((await import('../dist/notifications/inbox.service.js')).InboxService);
    await inbox.reseller(resellerId, 'top_up.credited', { subject: 'top-up-1', title: 'Wallet topped up', body: '₦250,000.00 was added to your live wallet.', link: '/wallet', mode: 'live' });
    await inbox.reseller(resellerId, 'order.needs_review', { subject: 'order-1', title: 'Order outcome unclear', body: 'We are checking an order with the supplier.', link: '/orders' });
    await browser.post('/v1/auth/password/change', { current_password: password, new_password: 'another horse battery staple' });

    const listed = expect('GET /v1/notifications', 200, await browser.get('/v1/notifications?limit=2'));
    assert.equal(listed.data.length, 2);
    assert.equal(listed.has_more, true);
    expect('GET /v1/notifications/unread-count', 200, await browser.get('/v1/notifications/unread-count'));
    const read = expect('POST /v1/notifications/{id}/read', 200, await browser.post(`/v1/notifications/${listed.data[0].id}/read`, {}));
    assert.equal(read.read, true);
    expect('POST /v1/notifications/read-all', 200, await browser.post('/v1/notifications/read-all', {}));
    expect('GET /v1/notifications', 200, await browser.get('/v1/notifications'));

    expect('GET /v1/devices/push-settings', 200, await browser.get('/v1/devices/push-settings'));
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const subscription = { endpoint: `${pushService.url}/push/dashboard`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    const device = expect('POST /v1/devices', 201, await browser.post('/v1/devices', subscription, { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36' }));
    expect('GET /v1/devices', 200, await browser.get('/v1/devices'));
    const sent = expect('POST /v1/devices/{id}/test', 200, await browser.post(`/v1/devices/${device.id}/test`, {}));
    assert.equal(sent.sent, true);
    expect('GET /v1/notification-preferences', 200, await browser.get('/v1/notification-preferences'));
    expect('PUT /v1/notification-preferences/{type}', 200, await browser.put('/v1/notification-preferences/order.needs_review', { push: false }));
    assert.equal((await browser.delete(`/v1/devices/${device.id}`)).status, 204);
  });
});

describe('your own integrations', () => {
  test('connecting, checking, syncing, routing, notifications and disconnecting', async () => {
    const admin = await adminClient(server);
    assert.equal((await admin.put('/v1/admin/integrations/reloadly/reseller-availability', { global: true, countries: [], approval: 'automatic' })).status, 200);
    assert.equal((await admin.put('/v1/admin/integrations/monnify/reseller-availability', { global: true, countries: [], approval: 'review' })).status, 200);
    const { browser, resellerId } = await resellerClient(server);
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'active', planCode: 'premium' } });
    assert.equal((await admin.put('/v1/admin/switches/own_integrations', { reseller_id: resellerId, enabled: true })).status, 200);

    const before = expect('GET /v1/integrations', 200, await browser.get('/v1/integrations'));
    assert.equal(before.access.allowed, true);
    const values = { client_id: 'reloadly-id', client_secret: 'reloadly-secret', webhook_secret: 'reseller-webhook-secret' };
    const connected = expect('PUT /v1/integrations/{id}/connection', 200, await browser.put('/v1/integrations/reloadly/connection', { values }));
    assert.equal(connected.connection.status, 'active');
    assert.ok(!JSON.stringify(connected).includes('reloadly-secret'), 'secrets are never returned');
    expect('PUT /v1/integrations/{id}/connection', 200, await browser.put('/v1/integrations/reloadly/connection', { values: { client_id: 'sandbox-id', client_secret: 'sandbox-secret' } }, { 'bitocard-mode': 'test' }));
    expect('POST /v1/integrations/{id}/connection/check', 200, await browser.post('/v1/integrations/reloadly/connection/check', {}));
    const synced = expect('POST /v1/integrations/{id}/connection/sync', 200, await browser.post('/v1/integrations/reloadly/connection/sync', {}));
    assert.ok(synced.offers > 0);
    assert.equal((await browser.put('/v1/integrations/reloadly/connection/routing', { routing: 'fallback' })).status, 204);
    const listed = expect('GET /v1/integrations', 200, await browser.get('/v1/integrations'));
    assert.ok(listed.data.some(item => item.connection?.catalogue.synced_at));

    // An order update from the reseller's own Reloadly account, to its own address.
    const body = JSON.stringify({ type: 'giftcard_transaction.status', data: { transactionId: 48213, customIdentifier: 'NO-SUCH-ORDER', status: 'SUCCESSFUL' } });
    const timestamp = String(Date.now());
    const signature = createHmac('sha256', values.webhook_secret).update(`${body}:${timestamp}`).digest('hex');
    const notified = await fetch(`${server.base}/v1/webhooks/reloadly/${connected.connection.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-reloadly-signature': signature, 'x-reloadly-request-timestamp': timestamp },
      body,
    });
    assert.equal(notified.status, 200);
    const notifications = expect('GET /v1/integrations/{id}/connection/notifications', 200, await browser.get('/v1/integrations/reloadly/connection/notifications'));
    assert.equal(notifications.data.length, 1);

    assert.equal((await browser.delete('/v1/integrations/reloadly/connection')).status, 204);
  });
});
