// The documented responses of the developer endpoints (API keys, webhook endpoints and deliveries, events) and the
// account endpoints (account, identity and BVN checks, countries, settings, customer checks, team), checked against
// real responses from a running app.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeDidit, fakeFlutterwave } from './fakes.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let check;
let didit;
let flutterwave;
let admin;
let delivery;
let receiver;

before(async () => {
  didit = await fakeDidit();
  flutterwave = await fakeFlutterwave();
  server = await startApp({ env: { ...didit.env, ...flutterwave.env, WEBHOOK_ALLOW_PRIVATE_URLS: 'on', EVENTS_SETTLE_SECONDS: '0' } });
  check = await responseChecker(server.app);
  admin = await adminClient(server);
  delivery = server.app.get((await import('../dist/webhooks/delivery.service.js')).WebhookDeliveryService);
  const http = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  receiver = { url: `http://127.0.0.1:${http.address().port}/hooks`, close: () => new Promise(resolve => http.close(resolve)) };
});

after(async () => {
  await server?.close();
  await didit?.close();
  await flutterwave?.close();
  await receiver?.close();
});

const sandbox = { 'bitocard-mode': 'test' };

/** Calls and checks one documented response. */
async function expect(key, status, promise) {
  const res = await promise;
  assert.equal(res.status, status, `${key}: ${JSON.stringify(res.json)}`);
  if (res.json !== null) check(key, status, res.json);
  return res.json;
}

const bearer = (token, path) => fetch(`${server.base}${path}`, { headers: { authorization: `Bearer ${token}` } }).then(async res => ({ status: res.status, json: await res.json() }));

describe('developer endpoints', () => {
  test('API keys, webhook endpoints, deliveries and events match their documented responses', async () => {
    const { browser } = await resellerClient(server);

    const key = await expect('POST /v1/api-keys', 201, browser.post('/v1/api-keys', { name: 'Website backend', mode: 'test' }));
    const other = await expect('POST /v1/api-keys', 201, browser.post('/v1/api-keys', { name: 'Reports', mode: 'test', scopes: ['orders:read', 'events:read'] }));
    const rolled = await expect('POST /v1/api-keys/{id}/roll', 201, browser.post(`/v1/api-keys/${other.id}/roll`, { overlap_hours: 2 }));
    await expect('DELETE /v1/api-keys/{id}', 200, browser.delete(`/v1/api-keys/${rolled.id}`));
    const keys = await expect('GET /v1/api-keys', 200, browser.get('/v1/api-keys'));
    assert.equal(keys.data.length, 3);
    assert.ok(keys.data.some(item => item.expires_at) && keys.data.some(item => item.revoked_at), 'expired and revoked keys are covered');

    // The three ways a request can be authenticated.
    const viaKey = (await expect('GET /v1/account', 200, bearer(key.secret, '/v1/account'))).authenticated_as;
    assert.equal(viaKey.type, 'api_key');
    const docs = await browser.post('/v1/auth/docs-token', { mode: 'test' });
    assert.equal(docs.status, 200, JSON.stringify(docs.json));
    assert.equal((await expect('GET /v1/account', 200, bearer(docs.json.token, '/v1/account'))).authenticated_as.type, 'docs_token');
    assert.equal((await expect('GET /v1/account', 200, browser.get('/v1/account'))).authenticated_as.type, 'session');

    // Endpoints.
    const endpoint = await expect('POST /v1/webhook-endpoints', 201, browser.post('/v1/webhook-endpoints', { url: receiver.url, description: 'Shop backend' }, sandbox));
    const filtered = await expect('POST /v1/webhook-endpoints', 201, browser.post('/v1/webhook-endpoints', { url: `${receiver.url}/verifications`, events: ['customer_verification.approved'] }, sandbox));
    await expect('GET /v1/webhook-endpoints/{id}', 200, browser.get(`/v1/webhook-endpoints/${endpoint.id}`, sandbox));
    const paused = await expect('PATCH /v1/webhook-endpoints/{id}', 200, browser.patch(`/v1/webhook-endpoints/${filtered.id}`, { status: 'disabled' }, sandbox));
    assert.equal(paused.disabled_reason, 'by_reseller');
    await expect('PATCH /v1/webhook-endpoints/{id}', 200, browser.patch(`/v1/webhook-endpoints/${filtered.id}`, { status: 'enabled', description: 'Verifications' }, sandbox));
    const rotated = await expect('POST /v1/webhook-endpoints/{id}/rotate-secret', 200, browser.post(`/v1/webhook-endpoints/${endpoint.id}/rotate-secret`, { expire_previous_in_hours: 12 }, sandbox));
    assert.ok(rotated.previous_secret_expires_at);
    const ping = await expect('POST /v1/webhook-endpoints/{id}/test', 200, browser.post(`/v1/webhook-endpoints/${endpoint.id}/test`, {}, sandbox));
    assert.equal(ping.event.type, 'ping');
    assert.equal((await expect('GET /v1/webhook-endpoints', 200, browser.get('/v1/webhook-endpoints', sandbox))).data.length, 2);

    // Customer checks in the sandbox make real events, delivered to both endpoints.
    const customer = { country: 'GH', first_name: 'Kofi', last_name: 'Mensah', redirect_url: 'https://shop.example/verified', consent: true };
    await expect('POST /v1/customers/{reference}/verification', 201, browser.post('/v1/customers/cust-1/verification', customer, sandbox));
    await expect('GET /v1/customers/{reference}/verification', 200, browser.get('/v1/customers/cust-1/verification', sandbox));
    await expect('POST /v1/customers/{reference}/verification/simulate', 200, browser.post('/v1/customers/cust-1/verification/simulate', { outcome: 'approved' }, sandbox));
    await browser.post('/v1/customers/cust-2/verification', { ...customer, first_name: 'Ama' }, sandbox);
    const declined = await expect('POST /v1/customers/{reference}/verification/simulate', 200, browser.post('/v1/customers/cust-2/verification/simulate', { outcome: 'declined' }, sandbox));
    assert.equal(declined.reason, 'not_verified');
    await expect('GET /v1/customers/{reference}/verification', 200, browser.get('/v1/customers/cust-2/verification', sandbox));
    await delivery.idle();

    const deliveries = await expect('GET /v1/webhook-endpoints/{id}/deliveries', 200, browser.get(`/v1/webhook-endpoints/${endpoint.id}/deliveries`, sandbox));
    assert.ok(deliveries.data.length >= 3, 'the ping and both events');
    const delivered = deliveries.data.find(item => item.event.type !== 'ping');
    const detail = await expect('GET /v1/webhook-endpoints/{id}/deliveries/{deliveryId}', 200, browser.get(`/v1/webhook-endpoints/${endpoint.id}/deliveries/${delivered.id}`, sandbox));
    assert.ok(detail.log.length >= 1);
    const resent = await expect('POST /v1/webhook-endpoints/{id}/deliveries/{deliveryId}/resend', 200, browser.post(`/v1/webhook-endpoints/${endpoint.id}/deliveries/${delivered.id}/resend`, {}, sandbox));
    assert.equal(resent.log[0].manual, true);
    await expect('GET /v1/webhook-endpoints/{id}/deliveries', 200, browser.get(`/v1/webhook-endpoints/${endpoint.id}/deliveries?limit=1`, sandbox));

    const events = await expect('GET /v1/events', 200, browser.get('/v1/events', sandbox));
    assert.deepEqual(events.data.map(event => event.type), ['customer_verification.approved', 'customer_verification.declined']);
    await expect('GET /v1/events', 200, bearer(key.secret, `/v1/events?since=${events.data[0].id}`));
    await expect('GET /v1/events/{id}', 200, browser.get(`/v1/events/${events.data[1].id}`, sandbox));

    await expect('DELETE /v1/webhook-endpoints/{id}', 200, browser.delete(`/v1/webhook-endpoints/${filtered.id}`, sandbox));
  });
});

describe('account endpoints', () => {
  test('business details, identity and BVN checks match their documented responses', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await expect('PATCH /v1/reseller', 200, browser.patch('/v1/reseller', { name: 'Ada Digital Ltd' }));

    await expect('GET /v1/account/verification', 200, browser.get('/v1/account/verification'));
    const started = await expect('POST /v1/account/verification', 201, browser.post('/v1/account/verification', { consent: true }));
    const session = started.url.split('/').pop();
    Object.assign(didit.state.sessions[session], { status: 'Approved', first_name: 'Ada', last_name: 'Obi' });
    const raw = JSON.stringify({ webhook_type: 'status.updated', session_id: session, status: 'Approved' });
    const signed = await fetch(`${server.base}/v1/webhooks/didit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-timestamp': String(Math.floor(Date.now() / 1000)), 'x-signature': createHmac('sha256', didit.secret).update(raw).digest('hex') },
      body: raw,
    });
    assert.equal(signed.status, 200);
    const verified = await expect('GET /v1/account/verification', 200, browser.get('/v1/account/verification'));
    assert.deepEqual([verified.status, verified.verified, verified.reseller_status], ['approved', true, 'active']);

    await expect('GET /v1/account/bvn', 200, browser.get('/v1/account/bvn'));
    flutterwave.state.bvns['22222222222'] = 'ADA OBI';
    const bvn = await expect('POST /v1/account/bvn', 201, browser.post('/v1/account/bvn', { bvn: '22222222222', consent: true }));
    assert.equal(bvn.status, 'in_progress');
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    const record = await prisma.identityVerification.findFirstOrThrow({ where: { resellerId, method: 'bvn' }, orderBy: { createdAt: 'desc' } });
    flutterwave.state.bvnChecks[record.providerReference].status = 'COMPLETED';
    assert.equal((await expect('GET /v1/account/bvn', 200, browser.get('/v1/account/bvn'))).verified, true);

    const account = await expect('GET /v1/account', 200, browser.get('/v1/account'));
    assert.equal(account.reseller.status, 'active');
  });

  test('countries and settings match their documented responses', async () => {
    const countries = await expect('GET /v1/countries', 200, client().get('/v1/countries'));
    assert.ok(countries.data.length >= 3);
    await expect('GET /v1/countries/{code}', 200, client().get('/v1/countries/NG'));

    const allowed = await admin.put('/v1/admin/countries/KE/options/gift_card_payout', { allowed: ['wallet', 'bank'], default: 'wallet' });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
    const { browser } = await resellerClient(server, { country: 'KE' });
    await expect('GET /v1/settings', 200, browser.get('/v1/settings'));
    const chosen = await expect('PUT /v1/settings/options/{key}', 200, browser.put('/v1/settings/options/gift_card_payout', { value: 'bank' }));
    assert.equal(chosen.options.gift_card_payout.source, 'reseller');
  });

  test('team management matches its documented responses', async () => {
    const owner = await resellerClient(server);
    const joiner = await resellerClient(server, { name: 'Chidi Eze', business: 'Chidi Store' });
    const cancelled = await expect('POST /v1/team/invitations', 201, owner.browser.post('/v1/team/invitations', { email: 'someone@example.com', role: 'support' }));
    const status = (await owner.browser.delete(`/v1/team/invitations/${cancelled.id}`)).status;
    assert.equal(status, 204);
    await expect('POST /v1/team/invitations', 201, owner.browser.post('/v1/team/invitations', { email: joiner.email, role: 'developer' }));
    await expect('POST /v1/team/invitations', 201, owner.browser.post('/v1/team/invitations', { email: 'pending@example.com', role: 'finance' }));

    const { EmailService } = await import('../dist/notifications/email.service.js');
    const message = server.app.get(EmailService).outbox.filter(item => item.to === joiner.email).at(-1);
    const token = new URL(/https?:\/\/\S+/.exec(message.text)[0]).searchParams.get('token');
    await expect('POST /v1/team/invitations/accept', 200, joiner.browser.post('/v1/team/invitations/accept', { token }));

    const team = await expect('GET /v1/team', 200, owner.browser.get('/v1/team'));
    assert.deepEqual([team.members.length, team.invitations.length], [2, 1]);
    await expect('PATCH /v1/team/members/{userId}', 200, owner.browser.patch(`/v1/team/members/${joiner.userId}`, { role: 'admin' }));
    assert.equal((await owner.browser.delete(`/v1/team/members/${joiner.userId}`)).status, 204);
  });
});

function client() {
  return { get: path => fetch(`${server.base}${path}`).then(async res => ({ status: res.status, json: await res.json() })) };
}
