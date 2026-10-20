// API keys and webhook endpoints belong to a store: a key sees only its store's orders, events and webhooks (and the
// account's own events), orders record their store, a store's events go only to its endpoints, docs tokens act for one
// store, and a reseller with no store gets an unpublished one for their keys.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';

let server;
let reloadly;
let prisma;
let wallets;
let delivery;
const receivers = [];
const sandbox = { 'bitocard-mode': 'test' };

before(async () => {
  reloadly = await fakeReloadly();
  server = await startApp({ env: { ...reloadly.env, CRON_SECRET: 'cron-secret', WEBHOOK_ALLOW_PRIVATE_URLS: 'on', EVENTS_SETTLE_SECONDS: '0' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  delivery = server.app.get((await import('../dist/webhooks/delivery.service.js')).WebhookDeliveryService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await (await adminClient(server)).post('/v1/admin/suppliers/reloadly/sync');
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  for (const receiver of receivers) await new Promise(resolve => receiver.close(resolve));
});

async function receiver() {
  const calls = [];
  const httpServer = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    res.writeHead(200).end('ok');
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  receivers.push(httpServer);
  return { calls, url: `http://127.0.0.1:${httpServer.address().port}/hooks` };
}

/** A verified, funded reseller with two stores and a sandbox key for each. */
async function reseller() {
  const owner = await resellerClient(server);
  // A second store needs a plan with several stores.
  await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', planCode: 'premium' } });
  await wallets.adjust(null, { resellerId: owner.resellerId, mode: 'test', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
  const store = async name => {
    const created = await owner.browser.post('/v1/stores', { name, subdomain: `${name.toLowerCase()}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    return created.json;
  };
  const first = await store('First');
  const second = await store('Second');
  const key = async storeId => {
    const created = await owner.browser.post('/v1/api-keys', { name: 'Backend', mode: 'test', store_id: storeId });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.store_id, storeId);
    return created.json.secret;
  };
  return { ...owner, first, second, keyA: await key(first.id), keyB: await key(second.id) };
}

const call = (key, method, path, body) =>
  fetch(`${server.base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async res => ({ status: res.status, json: await res.json() }));

const amazon = async () => (await prisma.product.findUniqueOrThrow({ where: { key: 'gift_cards:US:amazon-us' } })).id;
async function order(key) {
  const quote = await call(key, 'POST', '/v1/quotes', { product_id: await amazon(), face_value: 1000 });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const placed = await call(key, 'POST', '/v1/orders', { quote_id: quote.json.id });
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  return placed.json;
}

describe('store API keys', () => {
  test('a key’s orders belong to its store; the other store’s key cannot see them; the dashboard sees both', async () => {
    const { browser, first, keyA, keyB } = await reseller();
    const placed = await order(keyA);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: placed.id } })).storeId, first.id);
    assert.equal((await call(keyA, 'GET', `/v1/orders/${placed.id}`)).status, 200);
    const other = await call(keyB, 'GET', `/v1/orders/${placed.id}`);
    assert.deepEqual([other.status, other.json.error.code], [404, 'resource_missing']);
    assert.equal((await call(keyB, 'GET', '/v1/orders')).json.data.length, 0);
    assert.equal((await call(keyA, 'GET', '/v1/orders')).json.data.length, 1);
    assert.equal((await browser.get('/v1/orders', sandbox)).json.data.length, 1, 'the dashboard sees every store');
  });

  test('a store’s events go only to its endpoints and its keys; the account’s own events go to every store', async () => {
    const { browser, first, second, keyA, keyB } = await reseller();
    const [hookA, hookB] = [await receiver(), await receiver()];
    assert.equal((await call(keyA, 'POST', '/v1/webhook-endpoints', { url: hookA.url, store_id: second.id })).status, 404, 'a key cannot add an endpoint to another store');
    const a = await call(keyA, 'POST', '/v1/webhook-endpoints', { url: hookA.url });
    assert.deepEqual([a.status, a.json.store_id], [201, first.id]);
    const b = await browser.post('/v1/webhook-endpoints', { url: hookB.url, store_id: second.id }, sandbox);
    assert.deepEqual([b.status, b.json.store_id], [201, second.id]);
    assert.deepEqual((await call(keyB, 'GET', '/v1/webhook-endpoints')).json.data.map(item => item.id), [b.json.id]);
    assert.equal((await call(keyB, 'GET', `/v1/webhook-endpoints/${a.json.id}`)).status, 404);

    await order(keyA);
    const topUp = (await browser.post('/v1/wallet/top-ups', { amount: 500_000 }, sandbox)).json;
    await browser.post(`/v1/wallet/top-ups/${topUp.id}/simulate`, { outcome: 'succeeded' }, sandbox);
    await delivery.idle();
    await delivery.run();
    await delivery.idle();
    const types = items => items.map(item => item.type).sort();
    assert.deepEqual(types(hookA.calls), ['order.completed', 'top_up.succeeded']);
    assert.deepEqual(types(hookB.calls), ['top_up.succeeded'], 'another store’s order is never sent');
    assert.deepEqual(types((await call(keyB, 'GET', '/v1/events')).json.data), ['top_up.succeeded']);
    assert.deepEqual(types((await call(keyA, 'GET', '/v1/events')).json.data), ['order.completed', 'top_up.succeeded']);
  });

  test('keys are listed per store; a docs token acts for the store asked for', async () => {
    const { browser, first, second } = await reseller();
    assert.equal((await browser.get(`/v1/api-keys?store_id=${second.id}`)).json.data.length, 1);
    const token = await browser.post('/v1/auth/docs-token', { mode: 'test', store_id: second.id });
    assert.equal(token.status, 200, JSON.stringify(token.json));
    assert.equal(token.json.store.id, second.id);
    assert.equal((await browser.post('/v1/auth/docs-token', { mode: 'test' })).json.store.id, first.id, 'the oldest store by default');
    assert.equal((await browser.post('/v1/auth/docs-token', { mode: 'test', store_id: crypto.randomUUID() })).status, 404);
  });

  test('a reseller with no store gets an unpublished one for their keys', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const created = await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const stores = await prisma.store.findMany({ where: { resellerId } });
    assert.deepEqual([stores.length, stores[0].status, stores[0].id], [1, 'draft', created.json.store_id]);
    assert.equal((await browser.post('/v1/api-keys', { name: 'Second', mode: 'test' })).json.store_id, created.json.store_id, 'the same store again');
  });
});
