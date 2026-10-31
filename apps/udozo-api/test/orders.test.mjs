// Orders: holds, supplier fulfilment, unclear outcomes and checks, the exception queue, fallback between suppliers,
// delivered codes kept secret, receipts, refunds and the ledger behind every step.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly, fakeVtpass } from './fakes.mjs';

let server;
let reloadly;
let vtpass;
let admin;
let prisma;
let wallets;

before(async () => {
  reloadly = await fakeReloadly();
  vtpass = await fakeVtpass();
  server = await startApp({ env: { ...reloadly.env, ...vtpass.env, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await admin.post('/v1/admin/suppliers/reloadly/sync');
  await admin.post('/v1/admin/suppliers/vtpass/sync');
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  await vtpass?.close();
});

const sandbox = { 'bitocard-mode': 'test' };
const productId = async key => (await prisma.product.findUniqueOrThrow({ where: { key } })).id;
const amazon = () => productId('gift_cards:US:amazon-us');
const mtn = () => productId('airtime:NG:mtn:topup');
const padi = () => productId('pay_tv:NG:dstv:dstv-padi');
const ikeja = () => productId('bills:NG:ikeja-electric:prepaid');

/** A verified reseller with money in the wallet (live and sandbox). */
async function funded(amount = 50_000_000, options) {
  const reseller = await resellerClient(server, options);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  for (const mode of ['live', 'test']) {
    if (amount) await wallets.adjust(null, { resellerId: reseller.resellerId, mode, balance: 'funding', amount, reason: 'Test funding' });
  }
  return reseller;
}

async function quote(browser, body, headers) {
  const res = await browser.post('/v1/quotes', body, headers);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

const wallet = async (browser, headers) => (await browser.get('/v1/wallet', headers)).json;
const runChecks = () => fetch(`${server.base}/v1/cron/orders`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
const makeDue = id => prisma.order.update({ where: { id }, data: { nextCheckAt: new Date(Date.now() - 1000) } });
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

describe('sandbox orders', () => {
  test('a gift card order completes with test codes, takes the wholesale cost once, and has a receipt', async () => {
    const { browser } = await funded();
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000, quantity: 2, customer_reference: 'cust-7' }, sandbox);
    const calls = reloadly.calls.length;
    const created = await browser.post('/v1/orders', { quote_id: q.id }, sandbox);
    assert.equal(created.status, 201);
    const order = created.json;
    assert.deepEqual([order.status, order.mode, order.quantity, order.charged, order.customer_reference], ['completed', 'test', 2, q.wholesale, 'cust-7']);
    assert.equal(order.deliveries.length, 2);
    assert.match(order.deliveries[0].code, /^SANDBOX-/);
    assert.match(order.receipt_number, /^BC-\d{6}$/);
    assert.equal(reloadly.calls.length, calls, 'the sandbox never calls suppliers');

    assert.deepEqual([(await wallet(browser, sandbox)).available, (await wallet(browser, sandbox)).reserved], [50_000_000 - q.wholesale, 0]);
    assert.equal((await browser.post('/v1/orders', { quote_id: q.id }, sandbox)).json.error.code, 'quote_used');

    const listed = (await browser.get('/v1/orders', sandbox)).json.data[0];
    assert.equal(listed.id, order.id);
    assert.equal(listed.deliveries, undefined, 'codes only on the single order');
    assert.equal((await browser.get(`/v1/orders/${order.id}`, sandbox)).json.deliveries[0].code, order.deliveries[0].code);
    assert.equal((await browser.get('/v1/orders?customer_reference=cust-7', sandbox)).json.data.length, 1);
  });

  test('simulated failures release the hold; simulated pending orders wait for the simulated outcome', async () => {
    const { browser } = await funded();
    const failed = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox)).id, simulate: 'failed' }, sandbox)).json;
    assert.equal(failed.status, 'failed');
    assert.match(failed.failure_reason, /returned to your wallet/);
    assert.equal((await wallet(browser, sandbox)).available, 50_000_000);

    const pending = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox)).id, simulate: 'pending' }, sandbox)).json;
    assert.equal(pending.status, 'processing');
    assert.ok((await wallet(browser, sandbox)).reserved > 0);
    const done = (await browser.post(`/v1/orders/${pending.id}/simulate`, { outcome: 'completed' }, sandbox)).json;
    assert.deepEqual([done.status, (await wallet(browser, sandbox)).reserved], ['completed', 0]);
    assert.equal((await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 })).id, simulate: 'failed' })).json.error.code, 'livemode_not_allowed');
  });

  test('without enough money no order is placed and the quote stays usable', async () => {
    const { browser, resellerId } = await funded(1000);
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox);
    const refused = await browser.post('/v1/orders', { quote_id: q.id }, sandbox);
    assert.deepEqual([refused.status, refused.json.error.code], [402, 'insufficient_funds']);
    assert.equal(await prisma.order.count({ where: { resellerId } }), 0);
    await wallets.adjust(null, { resellerId, mode: 'test', balance: 'funding', amount: 5_000_000, reason: 'Top-up' });
    assert.equal((await browser.post('/v1/orders', { quote_id: q.id }, sandbox)).json.status, 'completed');
  });

  test('expired quotes, other resellers and missing scopes are refused', async () => {
    const { browser } = await funded();
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox);
    await prisma.quote.update({ where: { id: q.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await browser.post('/v1/orders', { quote_id: q.id }, sandbox)).json.error.code, 'quote_expired');

    const stranger = await funded();
    const fresh = await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox);
    assert.equal((await stranger.browser.post('/v1/orders', { quote_id: fresh.id }, sandbox)).json.error.param, 'quote_id');

    const key = (await browser.post('/v1/api-keys', { name: 'Read', mode: 'test', scopes: ['orders:read'] })).json.secret;
    const res = await fetch(`${server.base}/v1/orders`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': 'o-1' },
      body: JSON.stringify({ quote_id: fresh.id }),
    });
    assert.equal(res.status, 403);
  });

  test('the same quote ordered twice at once becomes one order', async () => {
    const { browser, resellerId } = await funded();
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox);
    const results = await Promise.all([browser.post('/v1/orders', { quote_id: q.id }, sandbox), browser.post('/v1/orders', { quote_id: q.id }, sandbox)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(await prisma.order.count({ where: { resellerId } }), 1);
    assert.equal((await wallet(browser, sandbox)).available, 50_000_000 - q.wholesale, 'the losing request released its hold');
  });
});

describe('live orders', () => {
  test('live orders need a verified business', async () => {
    const { browser, resellerId } = await funded();
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000 });
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'pending' } });
    assert.equal((await browser.post('/v1/orders', { quote_id: q.id })).json.error.code, 'reseller_not_verified');
  });

  test('a Reloadly gift card: codes delivered and encrypted, wholesale taken, supplier cost recorded, nothing about the supplier shown', async () => {
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    const { browser } = await funded();
    const q = await quote(browser, { product_id: await amazon(), face_value: 2500, quantity: 2 });
    const order = (await browser.post('/v1/orders', { quote_id: q.id })).json;
    assert.equal(order.status, 'completed');
    assert.deepEqual(order.deliveries.map(d => d.kind), ['gift_card', 'gift_card']);
    assert.match(order.deliveries[0].code, /^AMZ-\d+-0$/);
    assert.equal(order.deliveries[0].pin, '4000');
    assert.ok(!JSON.stringify(order).toLowerCase().includes('reloadly'));

    const sent = reloadly.calls.findLast(c => c.url === '/giftcards/orders').body;
    assert.deepEqual([sent.productId, sent.quantity, sent.unitPrice], [1, 2, 25]);
    const stored = await prisma.orderDelivery.findMany({ where: { orderId: order.id } });
    assert.ok(!JSON.stringify(stored).includes('AMZ-'), 'codes are encrypted at rest');

    assert.deepEqual([(await wallet(browser)).available, (await wallet(browser)).reserved], [50_000_000 - q.wholesale, 0]);
    const cost = await prisma.journalEntry.findUnique({ where: { reference: `order_cost:${order.id}` }, include: { postings: { include: { account: true } } } });
    assert.deepEqual(cost.postings.map(p => [p.account.kind, p.account.currency, p.amountMinor]).sort(), [
      ['cost_of_sales', 'USD', 5148n],
      ['supplier_float', 'USD', -5148n],
    ]);
    await ledgerOk();

    const trace = (await admin.get(`/v1/admin/orders/${order.id}`)).json;
    assert.deepEqual([trace.supplier.code, trace.attempts.length, trace.attempts[0].outcome], ['reloadly', 1, 'completed']);
    assert.deepEqual(trace.ledger.map(e => e.type), ['hold', 'hold_capture', 'order_cost']);
    assert.equal(trace.deliveries, undefined, 'admins trace orders without seeing codes');
  });

  test('a pending top-up holds the money until a later check confirms it', async () => {
    reloadly.state.orderReply = { status: 'PENDING' };
    const { browser } = await funded();
    const q = await quote(browser, { product_id: await mtn(), face_value: 100_000, recipient: { phone: '08031234567' } });
    const order = (await browser.post('/v1/orders', { quote_id: q.id })).json;
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    assert.equal(order.status, 'processing');
    assert.equal((await wallet(browser)).reserved, 100_000);
    const sent = reloadly.calls.findLast(c => c.url === '/topups/topups').body;
    assert.deepEqual([sent.operatorId, sent.amount, sent.useLocalAmount, sent.recipientPhone], [341, 1000, true, { countryCode: 'NG', number: '+2348031234567' }]);

    await makeDue(order.id);
    await runChecks();
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'processing', 'still pending at the supplier');

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    reloadly.state.transactions[row.supplierTransactionId].status = 'SUCCESSFUL';
    await makeDue(order.id);
    const run = await runChecks();
    assert.ok(run.result.completed >= 1);
    const done = (await browser.get(`/v1/orders/${order.id}`)).json;
    assert.deepEqual([done.status, done.deliveries[0].kind], ['completed', 'confirmation']);
    assert.equal((await wallet(browser)).reserved, 0);
  });

  test('reconciliation: what the supplier says it charged is recorded, and a difference is flagged for finance', async () => {
    const { browser } = await funded();
    const order = async () => {
      const q = await quote(browser, { product_id: await mtn(), face_value: 100_000, recipient: { phone: '08031234567' } });
      return prisma.order.findUniqueOrThrow({ where: { id: (await browser.post('/v1/orders', { quote_id: q.id })).json.id } });
    };
    try {
      reloadly.state.balanceCost = 970;
      const matched = await order();
      assert.deepEqual([matched.supplierCostMinor, matched.supplierReportedCostMinor, matched.costMismatch], [97_000n, 97_000n, false], 'Reloadly took the 97% it promised');

      reloadly.state.balanceCost = 990;
      const differs = await order();
      assert.deepEqual([differs.supplierReportedCostMinor, differs.costMismatch], [99_000n, true], 'Reloadly cut its discount');
      assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.order.cost_mismatch' } }), 'finance is told');
      const view = (await admin.get(`/v1/admin/orders/${differs.id}`)).json;
      assert.deepEqual([view.supplier.reported_cost, view.supplier.cost_mismatch], [99_000, true]);
    } finally {
      reloadly.state.balanceCost = undefined;
    }

    // VTpass reports what it charged after its commission.
    vtpass.state.totalAmount = 3600;
    try {
      const q = await quote(browser, { product_id: await padi(), face_value: 360_000, recipient: { account_number: '1212121212' } });
      const placed = await prisma.order.findUniqueOrThrow({ where: { id: (await browser.post('/v1/orders', { quote_id: q.id })).json.id } });
      assert.deepEqual([placed.supplierCode, placed.supplierCostMinor, placed.supplierReportedCostMinor, placed.costMismatch], ['vtpass', 360_000n, 360_000n, false], 'no commission agreed here: full face value, as charged');
    } finally {
      vtpass.state.totalAmount = undefined;
    }
  });

  test('an unclear reply is never retried elsewhere: the same supplier is asked, and it had completed the order', async () => {
    reloadly.state.orderReply = { http: 500, recorded: 'SUCCESSFUL' };
    const { browser } = await funded();
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000 });
    const order = (await browser.post('/v1/orders', { quote_id: q.id })).json;
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    assert.equal(order.status, 'processing');
    await makeDue(order.id);
    await runChecks();
    const done = (await browser.get(`/v1/orders/${order.id}`)).json;
    assert.equal(done.status, 'completed');
    assert.equal(done.deliveries.length, 1);
    const attempts = await prisma.orderAttempt.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(attempts.map(a => [a.supplierCode, a.action, a.outcome]), [
      ['reloadly', 'place', 'pending'],
      ['reloadly', 'check', 'completed'],
    ]);
  });

  test('an order that stays unclear joins the exception queue; an admin resolves it', async () => {
    reloadly.state.orderReply = { http: 500 };
    const { browser } = await funded();
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000 });
    const order = (await browser.post('/v1/orders', { quote_id: q.id })).json;
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    for (let i = 0; i < 10; i += 1) {
      await makeDue(order.id);
      await runChecks();
    }
    const queue = (await admin.get('/v1/admin/orders?needs_review=true')).json.data;
    assert.ok(queue.some(o => o.id === order.id));
    // The reseller's owner and support staff, and BitoCard operations and support, are told once.
    assert.equal((await browser.get('/v1/notifications')).json.data.filter(item => item.type === 'order.needs_review' && item.link === `/orders/${order.id}`).length, 1);
    assert.equal((await admin.get('/v1/admin/notifications?limit=100')).json.data.filter(item => item.type === 'admin.order.needs_review' && item.link === `/orders/${order.id}`).length, 1);
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'processing', 'resellers see processing, not internal review');

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/orders/${order.id}/resolve`, { outcome: 'failed', reason: 'Supplier confirmed by email' })).status, 403);
    const resolved = await admin.post(`/v1/admin/orders/${order.id}/resolve`, { outcome: 'failed', reason: 'Supplier confirmed by email it never received the order' });
    assert.equal(resolved.json.status, 'failed');
    assert.equal((await wallet(browser)).available, 50_000_000);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'order.resolved_failed', targetId: order.id } }));
    assert.equal((await admin.post(`/v1/admin/orders/${order.id}/resolve`, { outcome: 'completed', reason: 'Changed my mind' })).json.error.code, 'order_not_processing');
  });

  test('an admin can complete a stuck order with the delivered codes', async () => {
    reloadly.state.orderReply = { http: 500 };
    const { browser } = await funded();
    const order = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 })).id })).json;
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    await admin.post(`/v1/admin/orders/${order.id}/resolve`, { outcome: 'completed', reason: 'Codes sent by the supplier', deliveries: [{ kind: 'gift_card', code: 'MANUAL-CODE-1', pin: '9999' }] });
    const done = (await browser.get(`/v1/orders/${order.id}`)).json;
    assert.deepEqual([done.status, done.deliveries[0].code, done.deliveries[0].pin], ['completed', 'MANUAL-CODE-1', '9999']);
    await ledgerOk();
  });

  test('VTpass pay-TV and electricity: change of package, tokens delivered', async () => {
    vtpass.state.payReply = { code: '000', status: 'delivered' };
    vtpass.state.accounts['45012345678'] = { Customer_Name: 'ADA OBI', Address: '1 Allen Avenue, Ikeja' };
    const { browser } = await funded();
    const tv = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await padi(), face_value: 360_000, recipient: { account_number: '1212121212' } })).id })).json;
    assert.equal(tv.status, 'completed');
    const paid = vtpass.calls.findLast(c => c.url === '/pay').body;
    assert.deepEqual([paid.serviceID, paid.billersCode, paid.variation_code, paid.amount, paid.subscription_type], ['dstv', '1212121212', 'dstv-padi', '3600.00', 'change']);
    assert.match(paid.request_id, /^\d{12}BC[0-9a-f]{16}$/, 'request IDs start with the Lagos date and time');

    const light = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await ikeja(), face_value: 500_000, recipient: { account_number: '45012345678' } })).id })).json;
    assert.deepEqual(light.deliveries[0], { kind: 'token', code: '1234-5678-9012-3456-7890', pin: null, serial: null, details: { units: '79.9' } });
  });

  test('VTpass processing (099) is requeried until delivered', async () => {
    vtpass.state.payReply = { code: '099', status: 'pending' };
    const { browser } = await funded();
    const order = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await padi(), face_value: 360_000, recipient: { account_number: '1212121212' } })).id })).json;
    vtpass.state.payReply = { code: '000', status: 'delivered' };
    assert.equal(order.status, 'processing');
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    vtpass.state.requests[row.supplierReference] = { ...vtpass.state.requests[row.supplierReference], code: '000', content: { transactions: { status: 'delivered', transactionId: 'VT1' } } };
    await makeDue(order.id);
    await runChecks();
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'completed');
  });

  test('a confirmed failure moves to another supplier that can honour the quote, or fails and releases the money', async () => {
    // Reloadly as a second source for DStv Padi.
    const product = await padi();
    await prisma.supplierMarket.create({ data: { supplierCode: 'reloadly', countryCode: 'NG', category: 'pay_tv', enabled: true } });
    // VTpass is cheapest (2% agreed commission), Reloadly second at 99% of face value: still within the quoted wholesale.
    const vtpassOffer = await prisma.supplierProduct.findFirstOrThrow({ where: { supplierCode: 'vtpass', productId: product } });
    await prisma.supplierProduct.update({ where: { id: vtpassOffer.id }, data: { discountBps: 200 } });
    const offer = await prisma.supplierProduct.create({ data: { supplierCode: 'reloadly', productId: product, sku: 'op:999', costCurrency: 'NGN', costRatio: 0.99, meta: { operatorId: 999 }, syncedAt: new Date() } });
    vtpass.state.payReply = { code: '016', status: 'failed' };
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    try {
      const { browser } = await funded();
      const q = await quote(browser, { product_id: product, face_value: 360_000, recipient: { account_number: '1212121212' } });
      const order = (await browser.post('/v1/orders', { quote_id: q.id })).json;
      assert.equal(order.status, 'completed');
      const attempts = await prisma.orderAttempt.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(attempts.map(a => [a.supplierCode, a.outcome]), [['vtpass', 'failed'], ['reloadly', 'completed']]);
      assert.equal(order.wholesale, q.wholesale, 'the quote is honoured');

      // When the other source costs more than the quoted wholesale price, the order fails instead.
      await prisma.supplierProduct.update({ where: { id: offer.id }, data: { costRatio: 1.05 } });
      const second = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: product, face_value: 360_000, recipient: { account_number: '1212121212' } })).id })).json;
      assert.equal(second.status, 'failed');
      assert.equal((await wallet(browser)).reserved, 0);
      await ledgerOk();
    } finally {
      vtpass.state.payReply = { code: '000', status: 'delivered' };
      await prisma.supplierProduct.update({ where: { id: vtpassOffer.id }, data: { discountBps: 0 } });
      await prisma.supplierProduct.delete({ where: { id: offer.id } });
      await prisma.supplierMarket.deleteMany({ where: { supplierCode: 'reloadly', category: 'pay_tv' } });
    }
  });
});

describe('concurrent checks', () => {
  /** A live top-up left pending at Reloadly, and a copy of it as a check loaded it before anything else changed. */
  async function pendingOrder() {
    reloadly.state.orderReply = { status: 'PENDING' };
    const { browser } = await funded();
    const q = await quote(browser, { product_id: await mtn(), face_value: 100_000, recipient: { phone: '08031234567' } });
    const order = (await browser.post('/v1/orders', { quote_id: q.id })).json;
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    assert.equal(order.status, 'processing');
    const stale = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { product: true } });
    return { browser, order, stale };
  }

  test('a check holding an old copy cannot fail, complete or reschedule an order another check moved to a new supplier', async () => {
    const orders = server.app.get((await import('../dist/orders/orders.service.js')).OrdersService);
    const { browser, order, stale } = await pendingOrder();
    // Another check has meanwhile moved the order to a new supplier attempt.
    await prisma.order.update({ where: { id: order.id }, data: { supplierReference: `${stale.supplierReference}X`, supplierTransactionId: 'new-attempt', nextCheckAt: null } });

    await orders.failOrFallBack(stale, 'stale failure');
    await orders.complete(stale, { deliveries: [] });
    await orders.wait(stale, { status: 'pending', supplierTransactionId: 'old-attempt' });

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(row.status, 'processing', 'the new attempt is still in progress');
    assert.deepEqual([row.supplierTransactionId, row.nextCheckAt], ['new-attempt', null], 'nothing of the old attempt is written over it');
    assert.equal((await wallet(browser)).reserved, 100_000, 'the money stays held for the new attempt');
    await prisma.order.update({ where: { id: order.id }, data: { supplierReference: stale.supplierReference, supplierTransactionId: stale.supplierTransactionId } });
  });

  test('an order moved to another supplier is scheduled for checks even if the run stops before the new supplier answers', async () => {
    const orders = server.app.get((await import('../dist/orders/orders.service.js')).OrdersService);
    const { order, stale } = await pendingOrder();
    const attempt = orders.attempt;
    orders.attempt = async () => {
      throw new Error('function stopped');
    };
    try {
      await assert.rejects(orders.failOrFallBack(stale, 'failed at the supplier'));
    } finally {
      orders.attempt = attempt;
    }
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(row.status, 'processing');
    assert.notEqual(row.supplierReference, stale.supplierReference, 'moved to a new attempt');
    assert.ok(row.nextCheckAt, 'still checked by the orders job');
  });
});

describe('tax, receipts and refunds', () => {
  test('tax is charged to the wallet with the wholesale cost and kept for BitoCard to pay', async () => {
    await admin.put('/v1/admin/countries/NG/categories/gift_cards', { taxable: true });
    try {
      const { browser } = await funded();
      // Amazon costs BitoCard more than face value (no supplier discount): a markup product, so the markup covers VAT.
      await browser.put('/v1/pricing/markups', { category: 'gift_cards', markup_bps: 1000 });
      const q = await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox);
      const order = (await browser.post('/v1/orders', { quote_id: q.id }, sandbox)).json;
      const vat = Math.round((q.price * 7.5) / 107.5);
      assert.deepEqual([order.wholesale, order.tax, order.charged, order.price], [q.wholesale, vat, q.wholesale + vat, q.price]);
      assert.equal(q.price, Math.ceil(q.wholesale * 1.1));
      assert.equal((await wallet(browser, sandbox)).available, 50_000_000 - (q.wholesale + vat));
      const receipt = (await browser.get(`/v1/orders/${order.id}/receipt`, sandbox)).json;
      assert.deepEqual([receipt.subtotal, receipt.tax, receipt.total], [q.price - vat, { name: 'VAT', rate_percent: 7.5, amount: vat }, q.price]);
    } finally {
      await admin.put('/v1/admin/countries/NG/categories/gift_cards', { taxable: false });
    }
  });

  test('the receipt names the regional Golojan entity as seller and the reseller store', async () => {
    const { browser } = await funded();
    await browser.post('/v1/stores', { name: 'Ada Cards', subdomain: `adacards${Date.now().toString(36)}` });
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000, quantity: 2, customer_reference: 'c-9' }, sandbox);
    const order = (await browser.post('/v1/orders', { quote_id: q.id }, sandbox)).json;
    const receipt = (await browser.get(`/v1/orders/${order.id}/receipt`, sandbox)).json;
    assert.equal(receipt.number, order.receipt_number);
    assert.deepEqual(receipt.seller, {
      name: 'De-Golojan Technologies Ltd',
      rc_number: 'RC 1606658',
      registered_address: '3 Agu Street, Upper Housing Estate Extension, Abakpa Nike, Enugu',
    });
    assert.deepEqual([receipt.sold_through, receipt.items[0].quantity, receipt.total, receipt.tax, receipt.customer_reference], ['Ada Cards', 2, q.price, null, 'c-9']);

    const failed = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox)).id, simulate: 'failed' }, sandbox)).json;
    assert.equal((await browser.get(`/v1/orders/${failed.id}/receipt`, sandbox)).json.error.code, 'receipt_unavailable');
  });

  test('receipt numbers rise in sequence', async () => {
    const { browser } = await funded();
    const numbers = [];
    for (let i = 0; i < 3; i += 1) {
      const order = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox)).id }, sandbox)).json;
      numbers.push(Number(order.receipt_number.slice(3)));
    }
    assert.ok(numbers[0] < numbers[1] && numbers[1] < numbers[2]);
  });

  test('the seller entities match the legal pages', () => {
    const legal = readFileSync(new URL('../../../packages/ui/src/legal.ts', import.meta.url), 'utf8');
    for (const text of ['Golojan Technologies LLC', '10762897', '1207 Delaware Ave #3036, Wilmington, DE 19806', 'Golojan Ltd', '17481904', '12 Devon Road, Canterbury CT1 1RP', 'De-Golojan Technologies Ltd', 'RC 1606658', '3 Agu Street, Upper Housing Estate Extension, Abakpa Nike, Enugu']) {
      assert.ok(legal.includes(text), text);
    }
  });

  test('finance admins refund a completed order to the wallet once, reversing the supplier cost when refunded', async () => {
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    const { browser } = await funded();
    const order = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 })).id })).json;
    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Card did not work', supplier_refunded: true })).status, 403);

    const refunded = await admin.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Card did not work', supplier_refunded: true });
    assert.equal(refunded.json.status, 'refunded');
    assert.equal((await wallet(browser)).available, 50_000_000);
    assert.equal((await admin.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Again', supplier_refunded: false })).json.error.code, 'order_not_refundable');
    const [txn] = (await browser.get('/v1/wallet/transactions')).json.data;
    assert.deepEqual([txn.type, txn.amount], ['order_refund', order.charged]);
    await ledgerOk();
  });
});
