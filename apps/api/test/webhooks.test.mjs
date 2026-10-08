// Webhooks: the outbox, signed delivery, retries and giving up, auto-disable, secret rotation, test events, resends,
// per-endpoint isolation, safe destinations, the events API, the OpenAPI event reference and the published docs.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly, fakeVercelQueue, fakeVtpass } from './fakes.mjs';

const { verifySignature, sign, signatureTestVector } = await import('../dist/webhooks/signing.js');
const { isBlockedAddress, checkDestination } = await import('../dist/webhooks/destinations.js');
const { eventTypes } = await import('../dist/webhooks/events.js');
const { eventObjectSchemas } = await import('../dist/webhooks/openapi.js');

let server;
let reloadly;
let vtpass;
let admin;
let prisma;
let wallets;
let delivery;
let email;
const receivers = [];

before(async () => {
  reloadly = await fakeReloadly();
  vtpass = await fakeVtpass();
  server = await startApp({ env: { ...reloadly.env, ...vtpass.env, CRON_SECRET: 'cron-secret', WEBHOOK_ALLOW_PRIVATE_URLS: 'on', EVENTS_SETTLE_SECONDS: '0' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  delivery = server.app.get((await import('../dist/webhooks/delivery.service.js')).WebhookDeliveryService);
  email = server.app.get((await import('../dist/notifications/email.service.js')).EmailService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await admin.post('/v1/admin/suppliers/reloadly/sync');
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  await vtpass?.close();
  for (const receiver of receivers) await receiver.close();
});

const sandbox = { 'bitocard-mode': 'test' };
const cron = job => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
const settle = async () => {
  await delivery.idle();
  await cron('webhooks');
  await delivery.idle();
};
const makeDue = endpointId => prisma.webhookDelivery.updateMany({ where: { endpointId, status: 'pending' }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });

/** A local endpoint that keeps raw bodies (for signatures) and can be told how to answer and how slowly. */
async function receiver({ status = 200, delayMs = 0 } = {}) {
  const state = { status, delayMs, calls: [], inFlight: 0, maxInFlight: 0 };
  const httpServer = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    const call = { headers: req.headers, body, json: JSON.parse(body), at: Date.now() };
    state.calls.push(call);
    if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
    state.inFlight -= 1;
    if (state.status === 302) res.writeHead(302, { location: 'https://example.com/elsewhere' });
    else res.writeHead(state.status, { 'content-type': 'text/plain' });
    res.end(state.status >= 400 ? 'Something broke on our side' : 'ok');
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}/hooks`;
  const handle = { ...state, state, url, close: () => new Promise(resolve => httpServer.close(resolve)) };
  receivers.push(handle);
  return handle;
}

async function endpoint(browser, url, body = {}, headers = sandbox) {
  const created = await browser.post('/v1/webhook-endpoints', { url, ...body }, headers);
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json;
}

/** A sandbox top-up settled with the given outcome: produces top_up.succeeded or top_up.failed. */
async function topUp(browser, outcome = 'succeeded', amount = 500_000) {
  const created = (await browser.post('/v1/wallet/top-ups', { amount }, sandbox)).json;
  await browser.post(`/v1/wallet/top-ups/${created.id}/simulate`, { outcome }, sandbox);
  return created.id;
}

async function funded() {
  const reseller = await resellerClient(server);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: reseller.resellerId, mode: 'test', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
  return reseller;
}

const amazon = async () => (await prisma.product.findUniqueOrThrow({ where: { key: 'gift_cards:US:amazon-us' } })).id;

async function sandboxOrder(browser, simulate) {
  const quote = (await browser.post('/v1/quotes', { product_id: await amazon(), face_value: 1000 }, sandbox)).json;
  const order = await browser.post('/v1/orders', { quote_id: quote.id, ...(simulate ? { simulate } : {}) }, sandbox);
  assert.equal(order.status, 201, JSON.stringify(order.json));
  return order.json;
}

describe('endpoints', () => {
  test('the secret is shown on creation only; endpoints belong to one mode', async () => {
    const { browser } = await resellerClient(server);
    const hook = await receiver();
    const created = await endpoint(browser, hook.url, { description: 'Shop backend' });
    assert.match(created.secret, /^whsec_/);
    assert.deepEqual([created.mode, created.status, created.events], ['test', 'enabled', ['*']]);
    const listed = (await browser.get('/v1/webhook-endpoints', sandbox)).json.data;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].secret, undefined);
    assert.equal((await browser.get(`/v1/webhook-endpoints/${created.id}`, sandbox)).json.secret, undefined);
    assert.equal((await browser.get('/v1/webhook-endpoints')).json.data.length, 0, 'live endpoints are separate');
    const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(!stored.secretEncrypted.includes(created.secret.slice(6)), 'the secret is encrypted at rest');
  });

  test('validation: event types, duplicates, HTTPS in production settings', async () => {
    const { browser } = await resellerClient(server);
    const hook = await receiver();
    assert.equal((await browser.post('/v1/webhook-endpoints', { url: hook.url, events: ['order.exploded'] }, sandbox)).json.error.param, 'events');
    await endpoint(browser, hook.url, { events: ['order.completed', 'order.failed'] });
    assert.equal((await browser.post('/v1/webhook-endpoints', { url: hook.url }, sandbox)).json.error.code, 'endpoint_exists');
    assert.equal((await browser.post('/v1/webhook-endpoints', { url: 'not a url' }, sandbox)).json.error.param, 'url');
  });

  test('API keys need the webhooks:manage and events:read scopes', async () => {
    const { browser } = await resellerClient(server);
    const key = (await browser.post('/v1/api-keys', { name: 'Orders only', mode: 'test', scopes: ['orders:read'] })).json.secret;
    const call = path => fetch(`${server.base}${path}`, { headers: { authorization: `Bearer ${key}` } }).then(res => res.json());
    assert.match((await call('/v1/webhook-endpoints')).error.message, /webhooks:manage/);
    assert.match((await call('/v1/events')).error.message, /events:read/);
    const full = (await browser.post('/v1/api-keys', { name: 'Full', mode: 'test' })).json.secret;
    const listed = await fetch(`${server.base}/v1/events`, { headers: { authorization: `Bearer ${full}` } });
    assert.equal(listed.status, 200);
  });
});

describe('delivery', () => {
  test('a sandbox order delivers a signed order.completed event without the codes', async () => {
    const { browser } = await funded();
    const hook = await receiver();
    const { secret } = await endpoint(browser, hook.url);
    const order = await sandboxOrder(browser);
    await settle();
    assert.equal(hook.state.calls.length, 1);
    const [call] = hook.state.calls;
    assert.ok(verifySignature(call.headers['bitocard-signature'], call.body, secret), 'signature verifies with the endpoint secret');
    assert.ok(!verifySignature(call.headers['bitocard-signature'], `${call.body} `, secret), 'a changed body does not verify');
    assert.deepEqual([call.headers['bitocard-event-type'], call.headers['bitocard-event-id'], call.headers['bitocard-delivery-attempt']], ['order.completed', call.json.id, '1']);
    assert.equal(call.headers['content-type'], 'application/json');
    assert.deepEqual([call.json.object, call.json.type, call.json.mode, call.json.api_version], ['event', 'order.completed', 'test', '2026-10-01']);
    assert.equal(call.json.data.object.id, order.id);
    assert.equal(call.json.data.object.status, 'completed');
    assert.equal(call.json.data.object.deliveries, undefined);
    assert.ok(!call.body.includes('SANDBOX-'), 'codes never travel in webhooks');
    const { deliveries, access, ...withoutSecrets } = order;
    assert.ok(deliveries.length && access.url);
    assert.ok(!call.body.includes(access.url) && !('access' in call.json.data.object), 'the order’s page link never travels in webhooks');
    assert.deepEqual(call.json.data.object, { ...withoutSecrets, updated_at: call.json.data.object.updated_at });
  });

  test('failed orders, refunds, top-ups and payouts each send their event; filters apply', async () => {
    const { browser, resellerId } = await funded();
    const all = await receiver();
    const failuresOnly = await receiver();
    await endpoint(browser, all.url);
    await endpoint(browser, failuresOnly.url, { events: ['order.failed', 'top_up.failed'] });

    await sandboxOrder(browser, 'failed');
    const completed = await sandboxOrder(browser);
    await admin.post(`/v1/admin/orders/${completed.id}/refund`, { reason: 'Customer complaint upheld', supplier_refunded: false });
    await topUp(browser, 'succeeded');
    await topUp(browser, 'failed');
    await wallets.adjust(null, { resellerId, mode: 'test', balance: 'earnings', amount: 5_000_000, reason: 'Matured test earnings' });
    const account = (await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '1234567890' }, sandbox)).json;
    const paid = (await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id }, sandbox)).json;
    await browser.post(`/v1/payouts/${paid.id}/simulate`, { outcome: 'paid' }, sandbox);
    await browser.post(`/v1/payouts/${paid.id}/simulate`, { outcome: 'failed' }, sandbox);
    const failed = (await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id }, sandbox)).json;
    assert.equal(failed.object, 'payout', JSON.stringify(failed));
    await browser.post(`/v1/payouts/${failed.id}/simulate`, { outcome: 'failed' }, sandbox);
    await settle();

    const types = all.state.calls.map(call => call.json.type).sort();
    assert.deepEqual(types, ['order.completed', 'order.failed', 'order.refunded', 'payout.failed', 'payout.paid', 'top_up.failed', 'top_up.succeeded']);
    assert.deepEqual(failuresOnly.state.calls.map(call => call.json.type).sort(), ['order.failed', 'top_up.failed']);
    const refunded = all.state.calls.find(call => call.json.type === 'order.refunded').json.data.object;
    assert.equal(refunded.status, 'refunded');
    const topUpEvent = all.state.calls.find(call => call.json.type === 'top_up.succeeded').json.data.object;
    assert.deepEqual([topUpEvent.object, topUpEvent.source, topUpEvent.amount], ['top_up', 'checkout', 500_000]);
  });

  test('every event matches its documented schema', async () => {
    const { browser } = await funded();
    const hook = await receiver();
    await endpoint(browser, hook.url);
    await sandboxOrder(browser);
    await topUp(browser);
    await settle();
    const schemaFor = { order: 'Order', top_up: 'TopUp', payout: 'Payout' };
    for (const call of hook.state.calls) {
      const object = call.json.data.object;
      const schema = eventObjectSchemas[schemaFor[object.object]];
      assert.deepEqual(Object.keys(object).sort(), Object.keys(schema.properties).sort(), `${call.json.type} fields match the docs`);
      assert.deepEqual(Object.keys(call.json).sort(), ['api_version', 'created_at', 'data', 'id', 'mode', 'object', 'type']);
    }
    const doc = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
    assert.equal(doc.openapi, '3.1.0');
    assert.deepEqual(Object.keys(doc.webhooks).sort(), [...eventTypes].sort(), 'every event type is documented');
    for (const type of eventTypes) {
      const post = doc.webhooks[type].post;
      assert.ok(post.description.includes('Does not fire'), `${type} says when it does not fire`);
      const example = post.requestBody.content['application/json'].example;
      assert.equal(example.type, type);
      const envelope = doc.components.schemas[post.requestBody.content['application/json'].schema.$ref.split('/').pop()];
      const schema = doc.components.schemas[envelope.properties.data.properties.object.$ref.split('/').pop()];
      assert.deepEqual(Object.keys(example.data.object).sort(), Object.keys(schema.properties).sort(), `${type} example is complete`);
    }
  });

  test('failures are retried on the schedule with the same event, then succeed and clear the failure run', async () => {
    const { browser } = await resellerClient(server);
    const hook = await receiver({ status: 500 });
    const created = await endpoint(browser, hook.url);
    await topUp(browser);
    await settle();
    let [record] = await prisma.webhookDelivery.findMany({ where: { endpointId: created.id } });
    assert.deepEqual([record.status, record.attempts, record.lastResponseStatus, record.lastError], ['pending', 1, 500, 'http_500']);
    const firstWait = record.nextAttemptAt.getTime() - record.lastAttemptAt.getTime();
    assert.ok(firstWait >= 54_000 && firstWait <= 66_000, `first retry after about a minute (${firstWait} ms)`);
    assert.ok((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } })).failingSince);

    await settle();
    assert.equal(hook.state.calls.length, 1, 'not retried before it is due');
    await makeDue(created.id);
    await settle();
    [record] = await prisma.webhookDelivery.findMany({ where: { endpointId: created.id } });
    const secondWait = record.nextAttemptAt.getTime() - record.lastAttemptAt.getTime();
    assert.ok(secondWait >= 270_000 && secondWait <= 330_000, `then after about 5 minutes (${secondWait} ms)`);
    assert.equal(hook.state.calls[1].headers['bitocard-delivery-attempt'], '2');
    assert.equal(hook.state.calls[1].body, hook.state.calls[0].body, 'retries carry the identical body');

    hook.state.status = 200;
    await makeDue(created.id);
    await settle();
    [record] = await prisma.webhookDelivery.findMany({ where: { endpointId: created.id } });
    assert.deepEqual([record.status, record.attempts, record.nextAttemptAt], ['succeeded', 3, null]);
    assert.equal((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } })).failingSince, null);

    const log = (await browser.get(`/v1/webhook-endpoints/${created.id}/deliveries/${record.id}`, sandbox)).json;
    assert.deepEqual(log.log.map(attempt => [attempt.success, attempt.response_status]), [[true, 200], [false, 500], [false, 500]]);
    assert.equal(log.log[1].response_body, 'Something broke on our side');
    assert.equal(log.event.type, 'top_up.succeeded');
  });

  test('redirects are failures, and deliveries stop 3 days after the event', async () => {
    const { browser } = await resellerClient(server);
    const hook = await receiver({ status: 302 });
    const created = await endpoint(browser, hook.url);
    await topUp(browser);
    await settle();
    let [record] = await prisma.webhookDelivery.findMany({ where: { endpointId: created.id } });
    assert.deepEqual([record.status, record.lastError], ['pending', 'http_302']);
    await prisma.event.update({ where: { id: record.eventId }, data: { createdAt: new Date(Date.now() - 3 * 24 * 3600_000 + 30_000) } });
    await makeDue(created.id);
    await settle();
    [record] = await prisma.webhookDelivery.findMany({ where: { endpointId: created.id } });
    assert.deepEqual([record.status, record.nextAttemptAt], ['failed', null]);
  });

  test('an endpoint failing for 3 days is disabled, its owner is told, and it can be enabled again', async () => {
    const { browser, email: owner } = await resellerClient(server);
    const hook = await receiver({ status: 503 });
    const created = await endpoint(browser, hook.url);
    await topUp(browser);
    await topUp(browser);
    await settle();
    await prisma.webhookEndpoint.update({ where: { id: created.id }, data: { failingSince: new Date(Date.now() - 3 * 24 * 3600_000 - 1000) } });
    await makeDue(created.id);
    await settle();
    const disabled = (await browser.get(`/v1/webhook-endpoints/${created.id}`, sandbox)).json;
    assert.deepEqual([disabled.status, disabled.disabled_reason], ['disabled', 'failing']);
    const pending = await prisma.webhookDelivery.count({ where: { endpointId: created.id, status: 'pending' } });
    assert.equal(pending, 0, 'its pending deliveries stop');
    const message = email.outbox.filter(item => item.to === owner).at(-1);
    assert.match(message.subject, /We stopped sending webhooks/);
    const [note] = (await browser.get('/v1/notifications')).json.data.filter(item => item.type === 'webhook_endpoint.disabled');
    assert.deepEqual([note.severity, note.link], ['critical', `/developers/webhooks/${created.id}`]);
    assert.ok(message.text.includes(hook.url));

    const calls = hook.state.calls.length;
    await topUp(browser);
    await settle();
    assert.equal(hook.state.calls.length, calls, 'a disabled endpoint receives nothing');

    hook.state.status = 200;
    const enabled = await browser.patch(`/v1/webhook-endpoints/${created.id}`, { status: 'enabled' }, sandbox);
    assert.deepEqual([enabled.json.status, enabled.json.disabled_reason], ['enabled', null]);
    await topUp(browser);
    await settle();
    assert.equal(hook.state.calls.at(-1).json.type, 'top_up.succeeded');
    assert.equal((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } })).failingSince, null);
  });

  test('pausing an endpoint holds its deliveries until it is enabled again', async () => {
    const { browser } = await resellerClient(server);
    const hook = await receiver();
    const created = await endpoint(browser, hook.url);
    assert.equal((await browser.patch(`/v1/webhook-endpoints/${created.id}`, { status: 'disabled' }, sandbox)).json.disabled_reason, 'by_reseller');
    await topUp(browser);
    await settle();
    assert.equal(hook.state.calls.length, 0);
    await browser.patch(`/v1/webhook-endpoints/${created.id}`, { status: 'enabled' }, sandbox);
    await settle();
    assert.equal(hook.state.calls.length, 0, 'events while disabled were not queued for it');
    await topUp(browser);
    await settle();
    assert.equal(hook.state.calls.length, 1);
  });

  test('rotating the secret signs with both secrets during the overlap, then only the new one', async () => {
    const { browser } = await resellerClient(server);
    const hook = await receiver();
    const created = await endpoint(browser, hook.url);
    const rotated = (await browser.post(`/v1/webhook-endpoints/${created.id}/rotate-secret`, { expire_previous_in_hours: 2 }, sandbox)).json;
    assert.notEqual(rotated.secret, created.secret);
    assert.ok(new Date(rotated.previous_secret_expires_at) > new Date(Date.now() + 3600_000));
    await topUp(browser);
    await settle();
    const header = hook.state.calls[0].headers['bitocard-signature'];
    assert.equal(header.split(',').filter(part => part.startsWith('v1=')).length, 2);
    assert.ok(verifySignature(header, hook.state.calls[0].body, rotated.secret));
    assert.ok(verifySignature(header, hook.state.calls[0].body, created.secret));

    const immediate = (await browser.post(`/v1/webhook-endpoints/${created.id}/rotate-secret`, { expire_previous_in_hours: 0 }, sandbox)).json;
    assert.equal(immediate.previous_secret_expires_at, null);
    await topUp(browser);
    await settle();
    const latest = hook.state.calls.at(-1);
    assert.ok(verifySignature(latest.headers['bitocard-signature'], latest.body, immediate.secret));
    assert.ok(!verifySignature(latest.headers['bitocard-signature'], latest.body, rotated.secret));
  });

  test('test events go to one endpoint, are not listed or retried; any delivery can be resent', async () => {
    const { browser } = await resellerClient(server);
    const hook = await receiver();
    const other = await receiver();
    const created = await endpoint(browser, hook.url);
    await endpoint(browser, other.url);
    const ping = (await browser.post(`/v1/webhook-endpoints/${created.id}/test`, {}, sandbox)).json;
    assert.deepEqual([ping.event.type, ping.status, ping.log.length, ping.log[0].manual], ['ping', 'succeeded', 1, true]);
    assert.equal(hook.state.calls[0].json.data.object.object, 'ping');
    await settle();
    assert.equal(other.state.calls.length, 0, 'only the endpoint tested');
    assert.equal((await browser.get('/v1/events', sandbox)).json.data.length, 0, 'test events are not listed');

    hook.state.status = 500;
    const failedPing = (await browser.post(`/v1/webhook-endpoints/${created.id}/test`, {}, sandbox)).json;
    assert.equal(failedPing.status, 'failed', 'a failed test is not retried');
    assert.equal((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.id } })).failingSince, null, 'manual attempts never count towards disabling');

    hook.state.status = 200;
    const resent = (await browser.post(`/v1/webhook-endpoints/${created.id}/deliveries/${failedPing.id}/resend`, {}, sandbox)).json;
    assert.deepEqual([resent.status, resent.log.length], ['succeeded', 2]);
    assert.equal(hook.state.calls.at(-1).json.id, hook.state.calls.at(-2).json.id, 'a resend carries the same event ID');

    const list = (await browser.get(`/v1/webhook-endpoints/${created.id}/deliveries`, sandbox)).json;
    assert.equal(list.data.length, 2);
    assert.equal((await browser.get(`/v1/webhook-endpoints/${created.id}/deliveries?status=failed`, sandbox)).json.data.length, 0);
    assert.equal((await browser.delete(`/v1/webhook-endpoints/${created.id}`, sandbox)).json.deleted, true);
    assert.equal(await prisma.webhookDelivery.count({ where: { endpointId: created.id } }), 0);
  });

  test('a slow endpoint gets at most 5 requests at once and never holds up another reseller', async () => {
    const slowReseller = await resellerClient(server);
    const fastReseller = await resellerClient(server);
    const slow = await receiver({ delayMs: 1500 });
    const fast = await receiver();
    const slowEndpoint = await endpoint(slowReseller.browser, slow.url);
    const fastEndpoint = await endpoint(fastReseller.browser, fast.url);
    // Queue the work up front, then release it all at once to several concurrent runs.
    const hold = { nextAttemptAt: new Date(Date.now() + 3600_000) };
    await slowReseller.browser.patch(`/v1/webhook-endpoints/${slowEndpoint.id}`, { status: 'disabled' }, sandbox);
    await fastReseller.browser.patch(`/v1/webhook-endpoints/${fastEndpoint.id}`, { status: 'disabled' }, sandbox);
    for (let i = 0; i < 12; i += 1) await topUp(slowReseller.browser);
    await topUp(fastReseller.browser);
    await delivery.idle();
    await slowReseller.browser.patch(`/v1/webhook-endpoints/${slowEndpoint.id}`, { status: 'enabled' }, sandbox);
    await fastReseller.browser.patch(`/v1/webhook-endpoints/${fastEndpoint.id}`, { status: 'enabled' }, sandbox);
    await delivery.idle();
    for (const [reseller, target] of [[slowReseller, slowEndpoint], [fastReseller, fastEndpoint]]) {
      const events = await prisma.event.findMany({ where: { resellerId: reseller.resellerId } });
      await prisma.webhookDelivery.createMany({ data: events.map(event => ({ eventId: event.id, endpointId: target.id, ...hold })) });
    }
    const started = Date.now();
    await prisma.webhookDelivery.updateMany({ where: { endpointId: { in: [slowEndpoint.id, fastEndpoint.id] } }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await Promise.all([cron('webhooks'), cron('webhooks'), cron('webhooks')]);
    await delivery.idle();
    assert.equal(slow.state.calls.length, 12);
    assert.ok(slow.state.maxInFlight <= 5, `at most 5 at once (saw ${slow.state.maxInFlight})`);
    assert.ok(slow.state.maxInFlight >= 2, 'several at once');
    assert.equal(new Set(slow.state.calls.map(call => call.json.id)).size, 12, 'concurrent runs never send one delivery twice');
    assert.equal(fast.state.calls.length, 1, 'the fast endpoint was served');
    assert.ok(fast.state.calls[0].at - started < 1500, 'without waiting for the slow one');
  });

  test('events are written only when the change commits', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const id = await topUp(browser, 'succeeded');
    // Simulating again changes nothing, so no second event.
    await Promise.all([browser.post(`/v1/wallet/top-ups/${id}/simulate`, { outcome: 'succeeded' }, sandbox), browser.post(`/v1/wallet/top-ups/${id}/simulate`, { outcome: 'failed' }, sandbox)]);
    assert.equal(await prisma.event.count({ where: { resellerId } }), 1);
    await delivery.idle();
    assert.ok((await prisma.event.findFirstOrThrow({ where: { resellerId } })).dispatchedAt, 'dispatched with no endpoints to receive it');
  });
});

describe('Vercel Queues transport', () => {
  let queued;
  let queue;
  let queuePrisma;
  let queueDelivery;
  let consumer;
  before(async () => {
    queue = await fakeVercelQueue();
    queued = await startApp({ env: { ...queue.env, WEBHOOK_ALLOW_PRIVATE_URLS: 'on', EVENTS_SETTLE_SECONDS: '0' }, database: 'pglite' });
    queuePrisma = queued.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    queueDelivery = queued.app.get((await import('../dist/webhooks/delivery.service.js')).WebhookDeliveryService);
    const { WebhookQueue } = await import('../dist/webhooks/queue.js');
    // Stands in for the Vercel function (api/webhook-queue.mjs): Node request with a parsed JSON body.
    const handle = queued.app.get(WebhookQueue).nodeHandler(message => queueDelivery.handleQueueMessage(message));
    const { default: express } = await import('express');
    const fn = express();
    fn.post('/api/webhook-queue', express.json(), (req, res) => handle(req, res));
    consumer = await new Promise(resolve => {
      const listening = fn.listen(0, '127.0.0.1', () => resolve(listening));
    });
  });
  after(async () => {
    await new Promise(resolve => consumer?.close(resolve));
    await queued?.close();
    await queue?.close();
  });

  const push = message => fetch(`http://127.0.0.1:${consumer.address().port}/api/webhook-queue`, queue.callback(message));
  const lastFor = endpointId => queue.state.sent.filter(message => message.payload.endpointId === endpointId).at(-1);

  test('a change queues its endpoint, and the pushed message delivers it', async () => {
    const { browser } = await resellerClient(queued);
    const hook = await receiver();
    const { id, secret } = await endpoint(browser, hook.url);
    await topUp(browser);
    await queueDelivery.idle();
    const message = lastFor(id);
    assert.deepEqual([message.topic, message.delaySeconds], ['webhook-deliveries', 0]);
    assert.equal(hook.state.calls.length, 0, 'nothing is sent until the queue pushes');

    const res = await push(message);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'success');
    assert.equal(hook.state.calls.length, 1);
    assert.ok(verifySignature(hook.state.calls[0].headers['bitocard-signature'], hook.state.calls[0].body, secret));
    assert.ok(queue.state.acknowledged.includes(`rh-${message.messageId}`), 'the message is acknowledged');
  });

  test('a failed delivery queues its retry for when it is due', async () => {
    const { browser } = await resellerClient(queued);
    const hook = await receiver({ status: 500 });
    const { id } = await endpoint(browser, hook.url);
    await topUp(browser);
    await queueDelivery.idle();
    await push(lastFor(id));
    const retry = lastFor(id);
    assert.ok(retry.delaySeconds >= 54 && retry.delaySeconds <= 67, `retry queued about a minute later (${retry.delaySeconds}s)`);
    assert.ok(retry.idempotencyKey.startsWith(`${id}:`) && /^[0-9]+$/.test(retry.idempotencyKey.split(':')[1]), retry.idempotencyKey);

    const early = await push(retry);
    assert.equal(early.status, 200);
    assert.equal(hook.state.calls.length, 1, 'an early or repeated message sends nothing that is not due');

    hook.state.status = 200;
    await queuePrisma.webhookDelivery.updateMany({ where: { endpointId: id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await push(retry);
    assert.equal(hook.state.calls.length, 2);
    assert.equal((await queuePrisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: id } })).status, 'succeeded');
  });

  test('a busy endpoint sends the message back for a short wait', async () => {
    const { browser } = await resellerClient(queued);
    const hook = await receiver();
    const { id } = await endpoint(browser, hook.url);
    await topUp(browser);
    await queueDelivery.idle();
    await queuePrisma.webhookEndpoint.update({ where: { id }, data: { leaseUntil: new Date(Date.now() + 60_000) } });
    const message = lastFor(id);
    await push(message);
    assert.equal(hook.state.calls.length, 0);
    assert.deepEqual(queue.state.visibility.at(-1), { receiptHandle: `rh-${message.messageId}`, visibilityTimeoutSeconds: 10 });
  });

  test('enabling an endpoint again queues its pending work; malformed messages are dropped', async () => {
    const { browser } = await resellerClient(queued);
    const hook = await receiver();
    const { id } = await endpoint(browser, hook.url);
    await topUp(browser);
    await queueDelivery.idle();
    await browser.patch(`/v1/webhook-endpoints/${id}`, { status: 'disabled' }, sandbox);
    const before = queue.state.sent.length;
    await browser.patch(`/v1/webhook-endpoints/${id}`, { status: 'enabled' }, sandbox);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(queue.state.sent.length, before + 1);
    assert.equal(lastFor(id).payload.endpointId, id);

    const forged = await push({ messageId: 'msg-forged', topic: 'webhook-deliveries', payload: { endpointId: 'not-an-id' } });
    assert.equal(forged.status, 200);
    assert.equal(hook.state.calls.length, 0);
  });

  test('the Vercel function exports the consumer; the database transport has none and queues nothing', async () => {
    const fn = await import('../api/webhook-queue.mjs');
    assert.equal(typeof fn.default, 'function');
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    assert.deepEqual(vercel.functions['api/webhook-queue.mjs'].experimentalTriggers[0], { type: 'queue/v2beta', topic: 'webhook-deliveries', retryAfterSeconds: 30 });
    const { WebhookQueue } = await import('../dist/webhooks/queue.js');
    const databaseQueue = server.app.get(WebhookQueue);
    assert.equal(databaseQueue.enabled, false);
    assert.throws(() => databaseQueue.nodeHandler(async () => {}), /not enabled/);
    const sent = queue.state.sent.length;
    await databaseQueue.schedule('00000000-0000-4000-8000-000000000000');
    assert.equal(queue.state.sent.length, sent);
  });
});

describe('safe destinations', () => {
  test('internal addresses are recognised, including IPv4 inside IPv6', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1']) {
      assert.equal(isBlockedAddress(address), true, address);
    }
    for (const address of ['8.8.8.8', '102.89.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(isBlockedAddress(address), false, address);
  });

  test('saving refuses http, internal hosts and names that resolve inside', async () => {
    assert.match(await checkDestination('http://example.com/hook', false), /https/);
    assert.match(await checkDestination('https://user:pass@example.com/hook', false), /username/);
    for (const url of ['https://127.0.0.1/hook', 'https://[::1]/hook', 'https://169.254.169.254/latest', 'https://10.0.0.5/x']) {
      assert.match(await checkDestination(url, false), /public internet/, url);
    }
    assert.match(await checkDestination('https://shop.example/hook', false, async () => ['192.168.0.10']), /public internet/);
    assert.match(await checkDestination('https://shop.example/hook', false, async () => ['8.8.8.8', '10.0.0.1']), /public internet/, 'any internal answer is refused');
    assert.equal(await checkDestination('https://shop.example/hook', false, async () => ['8.8.8.8']), null);
    assert.match(await checkDestination('https://missing.example/hook', false, async () => { throw new Error('ENOTFOUND'); }), /could not be found/);
  });

  test('without the development switch, the API refuses internal endpoints and delivery refuses them again', async () => {
    const strict = await startApp({ env: { EVENTS_SETTLE_SECONDS: '0' }, database: 'pglite' });
    try {
      const { browser, resellerId } = await resellerClient(strict);
      for (const url of ['http://example.com/hook', 'https://127.0.0.1/hook', 'https://localhost/hook', 'https://[::1]:8443/hook']) {
        const res = await browser.post('/v1/webhook-endpoints', { url }, sandbox);
        assert.deepEqual([res.status, res.json.error.code], [400, 'url_invalid'], url);
      }
      // Saved before an address change (DNS rebinding): delivery checks again when connecting.
      const strictPrisma = strict.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
      const strictDelivery = strict.app.get((await import('../dist/webhooks/delivery.service.js')).WebhookDeliveryService);
      const { Encryption } = await import('../dist/common/encryption.js');
      const encryption = new Encryption(strict.app.get((await import('../dist/config/config.js')).APP_CONFIG).ENCRYPTION_KEY);
      for (const url of ['https://127.0.0.1:9/hook', 'https://localhost:9/hook']) {
        await strictPrisma.webhookEndpoint.create({ data: { resellerId, mode: 'test', url, secretEncrypted: encryption.encrypt('whsec_x') } });
      }
      await topUp(browser);
      await strictDelivery.idle();
      await strictDelivery.run();
      const records = await strictPrisma.webhookDelivery.findMany();
      assert.equal(records.length, 2);
      assert.deepEqual(records.map(record => record.lastError), ['blocked_destination', 'blocked_destination']);
    } finally {
      await strict.close();
    }
  });
});

describe('events API', () => {
  test('lists events oldest first, catches up from an event or a time, and filters by type', async () => {
    const { browser } = await resellerClient(server);
    const other = await resellerClient(server);
    await topUp(other.browser);
    for (const outcome of ['succeeded', 'failed', 'succeeded']) await topUp(browser, outcome);
    const all = (await browser.get('/v1/events', sandbox)).json;
    assert.deepEqual(all.data.map(event => event.type), ['top_up.succeeded', 'top_up.failed', 'top_up.succeeded'], 'only this reseller, oldest first');
    assert.equal((await browser.get('/v1/events')).json.data.length, 0, 'live events are separate');

    const page = (await browser.get('/v1/events?limit=2', sandbox)).json;
    assert.deepEqual([page.data.length, page.has_more], [2, true]);
    const rest = (await browser.get(`/v1/events?since=${page.data[1].id}`, sandbox)).json;
    assert.deepEqual([rest.data.map(event => event.id), rest.has_more], [[all.data[2].id], false]);

    const since = encodeURIComponent(new Date(new Date(all.data[0].created_at).getTime()).toISOString());
    assert.equal((await browser.get(`/v1/events?since=${since}`, sandbox)).json.data.length, 2);
    assert.equal((await browser.get('/v1/events?type=top_up.failed', sandbox)).json.data.length, 1);
    assert.deepEqual((await browser.get(`/v1/events/${all.data[1].id}`, sandbox)).json, all.data[1]);
    assert.equal((await other.browser.get(`/v1/events/${all.data[1].id}`, sandbox)).status, 404);
    assert.equal((await browser.get('/v1/events?since=yesterday', sandbox)).json.error.param, 'since');
    assert.equal((await browser.get('/v1/events?since=00000000-0000-4000-8000-000000000000', sandbox)).json.error.param, 'since');
  });

  test('events too recent to be settled are held back', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await topUp(browser);
    await prisma.event.updateMany({ where: { resellerId }, data: { createdAt: new Date(Date.now() + 60_000) } });
    assert.equal((await browser.get('/v1/events', sandbox)).json.data.length, 0);
  });

  test('events and delivery logs older than 30 days are deleted', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const hook = await receiver();
    await endpoint(browser, hook.url);
    await topUp(browser);
    await topUp(browser);
    await settle();
    const [old] = await prisma.event.findMany({ where: { resellerId }, orderBy: { seq: 'asc' } });
    await prisma.event.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 31 * 24 * 3600_000) } });
    const result = await cron('webhooks-cleanup');
    assert.ok(result.result.events >= 1);
    assert.equal(await prisma.event.count({ where: { resellerId } }), 1);
    assert.equal(await prisma.webhookDelivery.count({ where: { eventId: old.id } }), 0);
  });
});

describe('published docs', () => {
  // Windows checkouts may use CRLF; the guide's code is read with LF line endings.
  const guide = readFileSync(new URL('../../docs/content/webhooks.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = language => {
    const match = new RegExp('```' + language + '\\n([\\s\\S]*?)```').exec(guide);
    assert.ok(match, `the guide has ${language} code`);
    return match[1];
  };
  const expected = sign(signatureTestVector.secret, signatureTestVector.timestamp, signatureTestVector.body);

  test('the signature test vector in the guide is correct', () => {
    assert.ok(guide.includes(signatureTestVector.secret));
    assert.ok(guide.includes(String(signatureTestVector.timestamp)));
    assert.ok(guide.includes(signatureTestVector.body));
    assert.ok(guide.includes(expected), 'the expected signature is published');
  });

  test('the Node.js receiver code verifies real deliveries and the test vector', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bc-webhook-'));
    const file = join(dir, 'verify.mjs');
    writeFileSync(file, block('js'));
    const { verifyBitoCardSignature } = await import(pathToFileURL(file).href);
    const header = `t=${signatureTestVector.timestamp},v1=${expected}`;
    assert.equal(verifyBitoCardSignature(signatureTestVector.body, header, signatureTestVector.secret, signatureTestVector.timestamp), true);
    assert.equal(verifyBitoCardSignature(signatureTestVector.body, header, signatureTestVector.secret, signatureTestVector.timestamp + 301), false, 'too old');
    assert.equal(verifyBitoCardSignature(`${signatureTestVector.body} `, header, signatureTestVector.secret, signatureTestVector.timestamp), false);
  });

  for (const [language, binary, args] of [
    ['python', 'python3', file => [file]],
    ['php', 'php', file => [file]],
  ]) {
    const available = spawnSync(binary, ['--version']).status === 0;
    test(`the ${language} receiver code verifies the test vector`, { skip: available ? false : `${binary} is not installed` }, () => {
      const dir = mkdtempSync(join(tmpdir(), 'bc-webhook-'));
      const header = `t=${signatureTestVector.timestamp},v1=${expected}`;
      const harness =
        language === 'python'
          ? `${block('python')}\nimport sys\nprint(verify_bitocard_signature(sys.argv[1].encode(), sys.argv[2], sys.argv[3], int(sys.argv[4])))\n`
          : `${block('php')}\necho verifyBitoCardSignature($argv[1], $argv[2], $argv[3], (int) $argv[4]) ? 'True' : 'False';\n`;
      const file = join(dir, language === 'python' ? 'verify.py' : 'verify.php');
      writeFileSync(file, language === 'php' && !harness.startsWith('<?php') ? `<?php\n${harness}` : harness);
      const run = now => execFileSync(binary, [...args(file), signatureTestVector.body, header, signatureTestVector.secret, String(now)], { encoding: 'utf8' }).trim();
      assert.equal(run(signatureTestVector.timestamp), 'True');
      assert.equal(run(signatureTestVector.timestamp + 301), 'False');
    });
  }
});
