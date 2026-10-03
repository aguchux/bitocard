// Supplier notifications (Reloadly): verified and stored before they are acknowledged, so none is lost; stored once
// per delivery; never trusted (the order is re-checked with Reloadly); retried on schedule; unmatched ones kept.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';

const secret = 'reloadly-webhook-signing-secret';
let server;
let reloadly;
let admin;
let prisma;
let wallets;

before(async () => {
  reloadly = await fakeReloadly();
  server = await startApp({ env: { ...reloadly.env, CRON_SECRET: 'cron-secret', RELOADLY_WEBHOOK_SECRET: secret } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await admin.post('/v1/admin/suppliers/reloadly/sync');
});

after(async () => {
  await server?.close();
  await reloadly?.close();
});

/** Posts a notification signed like Reloadly: hex HMAC-SHA256 of "<body>:<timestamp>". */
async function notify(payload, { key = secret, timestamp = String(Date.now()), raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  const signature = createHmac('sha256', key).update(`${body}:${timestamp}`).digest('hex');
  const res = await fetch(`${server.base}/v1/webhooks/reloadly`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-reloadly-signature': signature, 'x-reloadly-request-timestamp': timestamp },
    body,
  });
  return { status: res.status, json: await res.json() };
}

const runJob = () => fetch(`${server.base}/v1/cron/supplier-webhooks`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
const until = async (check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};
const notification = reference => prisma.supplierWebhook.findFirst({ where: { reference }, orderBy: { receivedAt: 'desc' } });
const makeDue = reference => prisma.supplierWebhook.updateMany({ where: { reference }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });

/** A live airtime order left pending at Reloadly. */
async function pendingOrder() {
  const reseller = await resellerClient(server);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: reseller.resellerId, mode: 'live', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
  const product = (await prisma.product.findUniqueOrThrow({ where: { key: 'airtime:NG:mtn:topup' } })).id;
  const quote = (await reseller.browser.post('/v1/quotes', { product_id: product, face_value: 100_000, recipient: { phone: '08031234567' } })).json;
  reloadly.state.orderReply = { status: 'PENDING' };
  const order = (await reseller.browser.post('/v1/orders', { quote_id: quote.id })).json;
  reloadly.state.orderReply = { status: 'SUCCESSFUL' };
  assert.equal(order.status, 'processing');
  const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  return { ...reseller, order: row, transaction: reloadly.state.transactions[row.supplierTransactionId] };
}

const statusEvent = (order, status = 'SUCCESSFUL') => ({
  type: 'airtime_transaction.status',
  data: { transactionId: Number(order.supplierTransactionId), customIdentifier: order.supplierReference, status, recipientEmail: 'only-in-the-notification@example.com' },
});

describe('Reloadly notifications', () => {
  test('unsigned or wrongly signed notifications are refused and not stored', async () => {
    const before = await prisma.supplierWebhook.count();
    assert.equal((await notify({ type: 'x' }, { key: 'wrong-secret' })).status, 401);
    const unsigned = await fetch(`${server.base}/v1/webhooks/reloadly`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(unsigned.status, 401);
    assert.equal((await unsigned.json()).error.code, 'signature_invalid');
    assert.equal(await prisma.supplierWebhook.count(), before);
  });

  test('a notification is stored encrypted, acknowledged, and completes the order once Reloadly confirms it', async () => {
    const { browser, order, transaction } = await pendingOrder();
    transaction.status = 'SUCCESSFUL';
    const res = await notify(statusEvent(order));
    assert.deepEqual([res.status, res.json], [200, { received: true }]);

    await until(async () => (await browser.get(`/v1/orders/${order.id}`)).json.status === 'completed', 'the order to complete');
    // The order completes inside the check; the notification is marked processed just after.
    await until(async () => (await notification(order.supplierReference))?.status === 'processed', 'the notification to be processed');
    const row = await notification(order.supplierReference);
    assert.deepEqual([row.status, row.orderId, row.eventType, row.supplierTransactionId], ['processed', order.id, 'airtime_transaction.status', order.supplierTransactionId]);
    assert.ok(!row.bodyEncrypted.includes('only-in-the-notification'), 'the body is encrypted at rest');
    const traced = (await admin.get(`/v1/admin/orders/${order.id}`)).json;
    assert.equal(traced.notifications[0].status, 'processed');
    assert.equal(JSON.stringify(traced).includes('only-in-the-notification'), false, 'admins never see the body');
  });

  test('the body is never trusted: a notification saying "successful" only makes BitoCard ask Reloadly', async () => {
    const { browser, order } = await pendingOrder();
    const checksBefore = order.checks;
    // Reloadly's own record still says PENDING.
    assert.equal((await notify(statusEvent(order, 'SUCCESSFUL'))).status, 200);
    await until(async () => (await notification(order.supplierReference))?.lastError === 'Order still pending at the supplier', 'the first try');
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'processing');
    const row = await notification(order.supplierReference);
    assert.equal(row.lastError, 'Order still pending at the supplier');
    assert.ok(row.nextAttemptAt > new Date(), 'tried again later');
    const checks = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).checks;
    assert.equal(checks, checksBefore, 'notifications do not count towards the exception queue');

    // Later Reloadly settles it; the retry finds out.
    reloadly.state.transactions[order.supplierTransactionId].status = 'SUCCESSFUL';
    await makeDue(order.supplierReference);
    const run = await runJob();
    assert.ok(run.result.processed >= 1, JSON.stringify(run));
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'completed');
  });

  test('a repeated delivery is stored and processed once', async () => {
    const { order } = await pendingOrder();
    reloadly.state.transactions[order.supplierTransactionId].status = 'SUCCESSFUL';
    const body = JSON.stringify(statusEvent(order));
    const first = await notify(null, { raw: body, timestamp: '1700000000000' });
    const again = await notify(null, { raw: body, timestamp: '1700000000000' });
    assert.deepEqual([first.json, again.json], [{ received: true }, { received: true, duplicate: true }]);
    assert.equal(await prisma.supplierWebhook.count({ where: { reference: order.supplierReference } }), 1);
  });

  test('a notification for no known order is kept, retried, listed for admins and can be retried by hand', async () => {
    const reference = `unknown-${Date.now()}`;
    assert.equal((await notify({ type: 'giftcard_transaction.status', transaction: { id: 999, customIdentifier: reference, status: 'SUCCESSFUL' } })).status, 200);
    await until(async () => (await notification(reference))?.status === 'unmatched', 'the notification to be marked unmatched');
    const row = await notification(reference);
    assert.equal(row.supplierTransactionId, '999');
    await makeDue(reference);
    await runJob();
    assert.equal((await notification(reference)).attempts, 2, 'retried on schedule');

    const listed = (await admin.get('/v1/admin/supplier-webhooks?status=unmatched')).json;
    const item = listed.data.find(entry => entry.reference === reference);
    assert.equal(item.supplier, 'reloadly');
    assert.equal(item.body, undefined, 'never the body');
    const retried = await admin.post(`/v1/admin/supplier-webhooks/${item.id}/retry`);
    assert.equal(retried.status, 201, JSON.stringify(retried.json));
    assert.equal(retried.json.attempts, 1);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/supplier-webhooks/${item.id}/retry`)).status, 403);
    assert.equal((await prisma.auditLog.count({ where: { targetType: 'supplier_webhook', targetId: item.id } })), 1);
  });

  test('when Reloadly cannot be reached, the notification waits and is retried; nothing is lost', async () => {
    const { browser, order } = await pendingOrder();
    reloadly.state.transactions[order.supplierTransactionId].status = 'SUCCESSFUL';
    reloadly.state.fail = '/topups';
    await notify(statusEvent(order));
    // Wait for the first try to finish (its error recorded), not just to start.
    await until(async () => (await notification(order.supplierReference))?.lastError !== null && (await notification(order.supplierReference))?.lastError !== undefined, 'the failed try');
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'processing');
    delete reloadly.state.fail;
    await makeDue(order.supplierReference);
    await runJob();
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'completed');
  });

  test('signature rules: no secret means refused; the exact body and timestamp are signed', async () => {
    const { reloadlySignatureValid, reloadlyNotice } = await import('../dist/suppliers/reloadly.webhooks.js');
    const body = Buffer.from('{"a":1}');
    const sign = (key, ts) => createHmac('sha256', key).update(`{"a":1}:${ts}`).digest('hex');
    assert.equal(reloadlySignatureValid(secret, body, '123', sign(secret, '123')), true);
    assert.equal(reloadlySignatureValid(undefined, body, '123', sign(secret, '123')), false, 'no secret configured');
    assert.equal(reloadlySignatureValid(secret, body, '124', sign(secret, '123')), false, 'timestamp is signed');
    assert.equal(reloadlySignatureValid(secret, Buffer.from('{"a":2}'), '123', sign(secret, '123')), false, 'body is signed');
    assert.equal(reloadlySignatureValid(secret, body, '123', 'short'), false);
    // Every payload shape Reloadly uses gives the same reference; a top-level id is not a transaction ID.
    for (const payload of [
      { type: 't', data: { customIdentifier: 'ref-1', transactionId: 5 } },
      { event: 't', transaction: { customIdentifier: 'ref-1', id: 5 } },
      { eventType: 't', id: 'evt_9', customIdentifier: 'ref-1', transactionId: '5' },
    ]) assert.deepEqual(reloadlyNotice(payload), { eventType: 't', reference: 'ref-1', supplierTransactionId: '5' });
    assert.deepEqual(reloadlyNotice({ id: 'evt_9' }), { eventType: null, reference: null, supplierTransactionId: null });
  });
});
