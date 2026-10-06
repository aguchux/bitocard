// Orders through a reseller's own supplier account (own integrations, phase 3): their catalogue synced with their own
// credentials, routing preference, quotes with BitoCard's fee locked, orders that hold and charge only that fee, no
// fallback, the sandbox, and isolation from other resellers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';

let server;
let reloadly;
let admin;
let prisma;
let wallets;

const sandbox = { 'bitocard-mode': 'test' };
const credentials = { client_id: 'reloadly-id', client_secret: 'reloadly-secret' };

before(async () => {
  reloadly = await fakeReloadly();
  server = await startApp({ env: { ...reloadly.env, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
  assert.equal((await admin.put('/v1/admin/integrations/reloadly/reseller-access', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/integrations/reloadly/reseller-availability', { global: true, countries: [], approval: 'automatic' })).status, 200);
  // 1% on own-supplier orders in Nigeria.
  assert.equal((await admin.put('/v1/admin/fee-rules', { kind: 'supplier_order', country_code: 'NG', rate_ppb: 10_000_000 })).status, 200);
});

after(async () => {
  await server?.close();
  await reloadly?.close();
});

const productId = async key => (await prisma.product.findUniqueOrThrow({ where: { key } })).id;
const amazon = () => productId('gift_cards:US:amazon-us');
const mtn = () => productId('airtime:NG:mtn:topup');
const available = async (browser, headers) => (await browser.get('/v1/wallet', headers)).json.available;
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const runChecks = () => fetch(`${server.base}/v1/cron/orders`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());

/** A verified Premium reseller with own integrations on and money in both wallets; connected to Reloadly unless told not to. */
async function ownReseller({ connect = true } = {}) {
  const reseller = await resellerClient(server);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', planCode: 'premium' } });
  await admin.put('/v1/admin/switches/own_integrations', { reseller_id: reseller.resellerId, enabled: true });
  for (const mode of ['live', 'test']) await wallets.adjust(null, { resellerId: reseller.resellerId, mode, balance: 'funding', amount: 5_000_000, reason: 'Test funding' });
  if (connect) {
    for (const headers of [{}, sandbox]) {
      const connected = await reseller.browser.put('/v1/integrations/reloadly/connection', { values: credentials }, headers);
      assert.equal(connected.status, 200, JSON.stringify(connected.json));
      const synced = await reseller.browser.post('/v1/integrations/reloadly/connection/sync', {}, headers);
      assert.equal(synced.status, 200, JSON.stringify(synced.json));
      assert.ok(synced.json.offers > 0);
    }
  }
  return reseller;
}

async function quote(browser, body, headers) {
  const res = await browser.post('/v1/quotes', body, headers);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

describe('own-supplier orders', () => {
  test('the catalogue syncs with the reseller’s credentials onto the shared products, and orders charge only BitoCard’s fee', async () => {
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    const { browser, resellerId } = await ownReseller();
    const offers = await prisma.resellerOffer.findMany({ where: { resellerId, mode: 'live' } });
    const amazonId = await amazon();
    assert.ok(offers.some(offer => offer.productId === amazonId && offer.supplierCode === 'reloadly'), 'the same Amazon product BitoCard sells');
    assert.ok(offers.every(offer => offer.resellerId === resellerId));

    const q = await quote(browser, { product_id: await amazon(), face_value: 1000 });
    assert.deepEqual([q.source, q.integration?.name, q.bitocard_fee?.rate_percent, q.tax], ['own', 'Reloadly', '1', null]);
    assert.ok(q.bitocard_fee.max > 0);

    const before = await available(browser);
    const created = await browser.post('/v1/orders', { quote_id: q.id });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const order = created.json;
    assert.deepEqual([order.status, order.source, order.integration.id, order.receipt_number], ['completed', 'own', 'reloadly', null]);
    assert.match(order.deliveries[0].code, /^AMZ-/);
    const fee = await prisma.feeCharge.findUniqueOrThrow({ where: { reference: `fee:order:${order.id}` } });
    assert.equal(fee.status, 'charged');
    assert.equal(order.charged, Number(fee.chargedMinor), 'the order shows what BitoCard charged: its fee');
    assert.equal(await available(browser), before - Number(fee.chargedMinor), 'only the fee leaves the wallet');
    assert.equal(await prisma.journalEntry.count({ where: { reference: `order_cost:${order.id}` } }), 0, 'BitoCard paid no supplier');
    assert.equal((await browser.get(`/v1/orders/${order.id}/receipt`)).json.error.code, 'receipt_unavailable', 'the reseller is the seller');
    await ledgerOk();
  });

  test('face-value products charge the fee on the face value', async () => {
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    const { browser } = await ownReseller();
    const q = await quote(browser, { product_id: await mtn(), face_value: 100_000, recipient: { phone: '+2348031234567' } });
    assert.equal(q.source, 'own');
    // 1% of NGN 1,000.00 is exactly NGN 10.00.
    assert.equal(q.bitocard_fee.max, 1_000);
    const order = (await browser.post('/v1/orders', { quote_id: q.id })).json;
    assert.deepEqual([order.status, order.charged], ['completed', 1_000]);
  });

  test('routing: preferred uses the reseller’s supplier, fallback and off use BitoCard’s', async () => {
    const { browser } = await ownReseller();
    const source = async () => (await quote(browser, { product_id: await amazon(), face_value: 1000 })).source;
    assert.equal(await source(), 'own');
    assert.equal((await browser.put('/v1/integrations/reloadly/connection/routing', { routing: 'fallback' })).status, 204);
    assert.equal(await source(), 'bitocard', 'BitoCard has an offer, so fallback is not needed');
    await browser.put('/v1/integrations/reloadly/connection/routing', { routing: 'off' });
    assert.equal(await source(), 'bitocard');
    assert.equal((await browser.put('/v1/integrations/reloadly/connection/routing', { routing: 'sometimes' })).status, 400);
  });

  test('a supplier failure fails the order, returns the fee hold and never falls back to BitoCard', async () => {
    reloadly.state.orderReply = { status: 'FAILED' };
    const { browser } = await ownReseller();
    const before = await available(browser);
    const order = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 })).id })).json;
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    assert.deepEqual([order.status, order.charged], ['failed', 0]);
    assert.equal(await available(browser), before);
    const attempts = await prisma.orderAttempt.findMany({ where: { orderId: order.id } });
    assert.equal(attempts.length, 1, 'no second supplier was tried');
    assert.equal((await prisma.feeCharge.findUniqueOrThrow({ where: { reference: `fee:order:${order.id}` } })).status, 'released');
    await ledgerOk();
  });

  test('an unclear answer stays processing with the fee held, and the scheduled check settles it', async () => {
    reloadly.state.orderReply = { status: 'PENDING' };
    const { browser } = await ownReseller();
    const order = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 })).id })).json;
    assert.equal(order.status, 'processing');
    const fee = await prisma.feeCharge.findUniqueOrThrow({ where: { reference: `fee:order:${order.id}` } });
    assert.deepEqual([fee.status, order.charged], ['held', Number(fee.heldMinor)]);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    for (const tx of Object.values(reloadly.state.transactions)) if (tx.customIdentifier === row.supplierReference) tx.status = 'SUCCESSFUL';
    await prisma.order.update({ where: { id: order.id }, data: { nextCheckAt: new Date(Date.now() - 1000) } });
    await runChecks();
    const after = (await browser.get(`/v1/orders/${order.id}`)).json;
    assert.equal(after.status, 'completed');
    assert.equal((await prisma.feeCharge.findUniqueOrThrow({ where: { id: fee.id } })).status, 'charged');
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    await ledgerOk();
  });

  test('the sandbox simulates the reseller’s catalogue and orders without calling the supplier', async () => {
    const { browser, resellerId } = await ownReseller();
    assert.ok((await prisma.resellerOffer.count({ where: { resellerId, mode: 'test' } })) > 0);
    const calls = reloadly.calls.length;
    const q = await quote(browser, { product_id: await amazon(), face_value: 1000 }, sandbox);
    assert.equal(q.source, 'own');
    const order = (await browser.post('/v1/orders', { quote_id: q.id }, sandbox)).json;
    assert.equal(order.status, 'completed');
    assert.match(order.deliveries[0].code, /^SANDBOX-/);
    assert.equal(reloadly.calls.length, calls, 'the sandbox never calls suppliers');
    assert.equal((await prisma.feeCharge.findUniqueOrThrow({ where: { reference: `fee:order:${order.id}` } })).mode, 'test');
  });

  test('another reseller never gets these offers; a suspended connection stops orders on open quotes', async () => {
    const owner = await ownReseller();
    const other = await ownReseller({ connect: false });
    assert.equal((await quote(other.browser, { product_id: await amazon(), face_value: 1000 })).source, 'bitocard');

    const open = await quote(owner.browser, { product_id: await amazon(), face_value: 1000 });
    const connection = await prisma.resellerConnection.findFirstOrThrow({ where: { resellerId: owner.resellerId, mode: 'live' } });
    await admin.post(`/v1/admin/connections/${connection.id}/decide`, { decision: 'suspend', reason: 'Checking the account' });
    const refused = await owner.browser.post('/v1/orders', { quote_id: open.id });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'integration_unavailable']);
    assert.equal((await quote(owner.browser, { product_id: await amazon(), face_value: 1000 })).source, 'bitocard', 'new quotes use BitoCard again');
  });

  test('refunding an own-supplier order gives back BitoCard’s fee only', async () => {
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    const { browser } = await ownReseller();
    const order = (await browser.post('/v1/orders', { quote_id: (await quote(browser, { product_id: await amazon(), face_value: 1000 })).id })).json;
    const before = await available(browser);
    const refund = await admin.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Customer never received it', supplier_refunded: false });
    assert.equal(refund.status, 200, JSON.stringify(refund.json));
    assert.equal(refund.json.status, 'refunded');
    assert.equal(await available(browser), before + order.charged);
    await ledgerOk();
  });
});
