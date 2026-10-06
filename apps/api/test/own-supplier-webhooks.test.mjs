// Supplier notifications to a reseller's own connection: each live connection has its own address, checked with that
// reseller's own secret (Reloadly's webhook secret, DIDWW's API key); they only ever name that connection's own orders,
// are stored and re-checked like BitoCard's, are listed for the reseller, and tell them (and admins) when given up on.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeDidww, fakeReloadly } from './fakes.mjs';

const callbackBase = 'https://api.test.example';
const bitocardSecret = 'bitocard-reloadly-webhook-secret';
let server;
let reloadly;
let didww;
let admin;
let prisma;
let wallets;

before(async () => {
  reloadly = await fakeReloadly();
  didww = await fakeDidww();
  didww.state.keys.push('reseller-didww-key');
  server = await startApp({ env: { ...reloadly.env, ...didww.env, DIDWW_CALLBACK_URL: callbackBase, RELOADLY_WEBHOOK_SECRET: bitocardSecret, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
  assert.equal((await admin.put('/v1/admin/countries/NG/categories/virtual_numbers', { enabled: true })).status, 200);
  for (const id of ['reloadly', 'didww']) {
    assert.equal((await admin.put(`/v1/admin/integrations/${id}/reseller-access`, { enabled: true })).status, 200);
    assert.equal((await admin.put(`/v1/admin/integrations/${id}/reseller-availability`, { global: true, countries: [], approval: 'automatic' })).status, 200);
  }
  assert.equal((await admin.put('/v1/admin/fee-rules', { kind: 'supplier_order', country_code: 'NG', rate_ppb: 10_000_000 })).status, 200);
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  await didww?.close();
});

const until = async (check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};
const runJob = () => fetch(`${server.base}/v1/cron/supplier-webhooks`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());

/** A live, verified Premium reseller connected to their own account with these credentials. */
async function connected(integration, values) {
  const reseller = await resellerClient(server);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', planCode: 'premium' } });
  await admin.put('/v1/admin/switches/own_integrations', { reseller_id: reseller.resellerId, enabled: true });
  await wallets.adjust(null, { resellerId: reseller.resellerId, mode: 'live', balance: 'funding', amount: 5_000_000, reason: 'Test funding' });
  const connection = await reseller.browser.put(`/v1/integrations/${integration}/connection`, { values });
  assert.equal(connection.status, 200, JSON.stringify(connection.json));
  const synced = await reseller.browser.post(`/v1/integrations/${integration}/connection/sync`, {});
  assert.equal(synced.status, 200, JSON.stringify(synced.json));
  return { ...reseller, integration: connection.json };
}

/** Posts a notification signed like Reloadly to an address. */
async function reloadlyNotify(path, payload, key) {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', key).update(`${body}:${timestamp}`).digest('hex');
  const res = await fetch(`${server.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-reloadly-signature': signature, 'x-reloadly-request-timestamp': timestamp },
    body,
  });
  return { status: res.status, json: await res.json() };
}

/** A pending own-supplier Reloadly order. */
async function pendingOwnOrder(reseller) {
  const product = (await prisma.product.findUniqueOrThrow({ where: { key: 'gift_cards:US:amazon-us' } })).id;
  const quote = (await reseller.browser.post('/v1/quotes', { product_id: product, face_value: 1000 })).json;
  assert.equal(quote.source, 'own');
  reloadly.state.orderReply = { status: 'PENDING' };
  const order = (await reseller.browser.post('/v1/orders', { quote_id: quote.id })).json;
  reloadly.state.orderReply = { status: 'SUCCESSFUL' };
  assert.equal(order.status, 'processing');
  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

const statusEvent = (order, status = 'SUCCESSFUL') => ({ type: 'giftcard_transaction.status', data: { transactionId: Number(order.supplierTransactionId), customIdentifier: order.supplierReference, status } });
const settleAtReloadly = order => {
  for (const tx of Object.values(reloadly.state.transactions)) if (tx.customIdentifier === order.supplierReference) tx.status = 'SUCCESSFUL';
};

describe('own Reloadly connection notifications', () => {
  test('the connection shows its own address, ready once the webhook secret is saved', async () => {
    const reseller = await connected('reloadly', { client_id: 'reloadly-id', client_secret: 'reloadly-secret' });
    const notifications = reseller.integration.connection.notifications;
    assert.deepEqual(notifications, { url: `${callbackBase}/v1/webhooks/reloadly/${reseller.integration.connection.id}`, setup: 'manual', ready: false });
    const updated = await reseller.browser.put('/v1/integrations/reloadly/connection', { values: { client_id: 'reloadly-id', webhook_secret: 'reseller-webhook-secret' } });
    assert.equal(updated.json.connection.notifications.ready, true);
    // The sandbox receives no notifications.
    const sandbox = await reseller.browser.put('/v1/integrations/reloadly/connection', { values: { client_id: 'x', client_secret: 'y' } }, { 'bitocard-mode': 'test' });
    assert.equal(sandbox.json.connection.notifications, null);
  });

  test('a notification signed with the reseller’s secret settles their own order, and they can see it', async () => {
    const reseller = await connected('reloadly', { client_id: 'reloadly-id', client_secret: 'reloadly-secret', webhook_secret: 'reseller-webhook-secret' });
    const connectionId = reseller.integration.connection.id;
    const order = await pendingOwnOrder(reseller);
    settleAtReloadly(order);

    // BitoCard's secret is not this connection's.
    assert.equal((await reloadlyNotify(`/v1/webhooks/reloadly/${connectionId}`, statusEvent(order), bitocardSecret)).status, 401);
    assert.equal((await reloadlyNotify('/v1/webhooks/reloadly/00000000-0000-4000-8000-000000000000', statusEvent(order), 'reseller-webhook-secret')).status, 401);
    assert.equal((await reloadlyNotify('/v1/webhooks/reloadly/not-a-uuid', statusEvent(order), 'reseller-webhook-secret')).status, 401);

    const res = await reloadlyNotify(`/v1/webhooks/reloadly/${connectionId}`, statusEvent(order), 'reseller-webhook-secret');
    assert.deepEqual([res.status, res.json], [200, { received: true }]);
    await until(async () => (await reseller.browser.get(`/v1/orders/${order.id}`)).json.status === 'completed', 'the order to complete');
    await until(async () => (await prisma.supplierWebhook.findFirst({ where: { connectionId } }))?.status === 'processed', 'the notification to be processed');
    const fee = await prisma.feeCharge.findUniqueOrThrow({ where: { reference: `fee:order:${order.id}` } });
    assert.equal(fee.status, 'charged');

    const listed = await reseller.browser.get('/v1/integrations/reloadly/connection/notifications');
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.equal(listed.json.data.length, 1);
    assert.deepEqual([listed.json.data[0].status, listed.json.data[0].order_id, listed.json.data[0].reference], ['processed', order.id, order.supplierReference]);
    assert.equal(listed.json.data[0].connection_id, undefined);
    assert.equal(listed.json.data[0].supplier, undefined);
    const adminView = await admin.get(`/v1/admin/supplier-webhooks?connection_id=${connectionId}`);
    assert.equal(adminView.json.data[0].connection_id, connectionId);
  });

  test('notifications only name orders through that connection', async () => {
    const owner = await connected('reloadly', { client_id: 'reloadly-id', client_secret: 'reloadly-secret', webhook_secret: 'owner-secret' });
    const other = await connected('reloadly', { client_id: 'reloadly-id', client_secret: 'reloadly-secret', webhook_secret: 'other-secret' });
    const order = await pendingOwnOrder(owner);

    // Another reseller's connection, and BitoCard's own address, cannot touch it.
    await reloadlyNotify(`/v1/webhooks/reloadly/${other.integration.connection.id}`, statusEvent(order), 'other-secret');
    await reloadlyNotify('/v1/webhooks/reloadly', statusEvent(order), bitocardSecret);
    await until(async () => (await prisma.supplierWebhook.count({ where: { reference: order.supplierReference, status: 'unmatched' } })) === 2, 'both to be unmatched');
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'processing');
    // The same body to a different connection is a different notification.
    assert.equal(await prisma.supplierWebhook.count({ where: { reference: order.supplierReference } }), 2);
    assert.equal((await other.browser.get('/v1/integrations/reloadly/connection/notifications')).json.data[0].status, 'unmatched');
  });

  test('a notification given up on tells the reseller and operations', async () => {
    const reseller = await connected('reloadly', { client_id: 'reloadly-id', client_secret: 'reloadly-secret', webhook_secret: 'giving-up-secret' });
    const operations = await adminClient(server, ['operations']);
    const finance = await adminClient(server, ['finance']);
    const res = await reloadlyNotify(`/v1/webhooks/reloadly/${reseller.integration.connection.id}`, { type: 'x', data: { customIdentifier: 'NO-SUCH-ORDER' } }, 'giving-up-secret');
    assert.equal(res.status, 200);
    const row = await prisma.supplierWebhook.findFirstOrThrow({ where: { reference: 'NO-SUCH-ORDER' } });
    await until(async () => (await prisma.supplierWebhook.findUniqueOrThrow({ where: { id: row.id } })).attempts >= 1, 'the first try');
    for (let i = 0; i < 10; i += 1) {
      await prisma.supplierWebhook.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await runJob();
    }
    assert.equal((await prisma.supplierWebhook.findUniqueOrThrow({ where: { id: row.id } })).status, 'unmatched');
    const mine = (await reseller.browser.get('/v1/notifications')).json.data.filter(item => item.type === 'supplier_notification.failed');
    assert.equal(mine.length, 1);
    assert.match(mine[0].body, /own Reloadly account matches none of your orders/);
    assert.equal(mine[0].link, '/integrations');
    assert.equal((await operations.get('/v1/admin/notifications')).json.data.filter(item => item.type === 'admin.supplier_notification.failed').length >= 1, true);
    assert.equal((await finance.get('/v1/admin/notifications')).json.data.some(item => item.type === 'admin.supplier_notification.failed'), false);
  });
});

describe('own DIDWW connection callbacks', () => {
  test('orders give DIDWW the connection’s own address; callbacks are checked with the reseller’s API key', async () => {
    const reseller = await connected('didww', { api_key: 'reseller-didww-key' });
    const connectionId = reseller.integration.connection.id;
    assert.deepEqual(reseller.integration.connection.notifications, { url: `${callbackBase}/v1/webhooks/didww/${connectionId}`, setup: 'automatic', ready: true });

    const product = await prisma.product.findUniqueOrThrow({ where: { key: 'virtual_numbers:GB:local:london-voice-sms-0ch' } });
    const quote = (await reseller.browser.post('/v1/quotes', { product_id: product.id, face_value: Number(product.fixedValues[0]) })).json;
    assert.equal(quote.source, 'own', JSON.stringify(quote));
    didww.state.orderReply = 'Pending';
    const created = (await reseller.browser.post('/v1/orders', { quote_id: quote.id })).json;
    didww.state.orderReply = 'Completed';
    assert.equal(created.status, 'processing', JSON.stringify(created));
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    const placed = didww.state.orders[order.supplierTransactionId];
    const path = `/v1/webhooks/didww/${connectionId}?reference=${encodeURIComponent(order.supplierReference)}`;
    assert.equal(placed.callback_url, `${callbackBase}${path}`);

    const fields = { id: placed.id, type: 'orders', status: 'completed' };
    const send = key =>
      fetch(`${server.base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-didww-signature': createHmac('sha1', key)
            .update(`https://api.test.example:443${path}${Object.keys(fields).sort().map(name => `${name}${fields[name]}`).join('')}`)
            .digest('hex'),
        },
        body: new URLSearchParams(fields).toString(),
      });
    // BitoCard's own DIDWW key does not sign the reseller's callbacks.
    assert.equal((await send('didww-key')).status, 401);
    didww.complete(placed.id);
    assert.equal((await send('reseller-didww-key')).status, 200);
    await until(async () => (await reseller.browser.get(`/v1/orders/${created.id}`)).json.status === 'completed', 'the order to complete');
    // The order settles a moment before the notification records that it was processed.
    await until(async () => (await prisma.supplierWebhook.findFirst({ where: { connectionId } }))?.status === 'processed', 'the callback to be processed');
    const stored = await prisma.supplierWebhook.findFirstOrThrow({ where: { connectionId } });
    assert.deepEqual([stored.status, stored.orderId], ['processed', created.id]);
  });
});
