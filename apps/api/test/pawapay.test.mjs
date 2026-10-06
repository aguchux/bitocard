// pawaPay mobile money top-ups: the catalogue (every country and provider enabled for payouts, within its limits),
// payouts by a UUID made from our reference, whole amounts where a provider takes no decimals, refusals and unclear
// outcomes, and callbacks authenticated by the token in their address (the body never trusted).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakePawapay } from './fakes.mjs';

const { PawapayAdapter, payoutId } = await import('../dist/suppliers/pawapay.adapter.js');

let server;
let pawapay;
let admin;
let prisma;
let wallets;

before(async () => {
  pawapay = await fakePawapay();
  server = await startApp({ env: { ...pawapay.env, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  assert.equal((await admin.patch('/v1/admin/suppliers/pawapay', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/suppliers/pawapay/markets/GH/mobile_money', { enabled: true })).status, 200);
  await prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'GH', category: 'mobile_money' } }, data: { enabled: true } });
  const sync = await admin.post('/v1/admin/suppliers/pawapay/sync');
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
});

after(async () => {
  await server?.close();
  await pawapay?.close();
});

const mtnGhana = 'mobile_money:GH:mtn:ghs';

async function ghanaReseller() {
  const created = await resellerClient(server, { country: 'GH' });
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
  return created;
}

async function topUp(browser, faceValue, phone = '0241234567') {
  const product = await prisma.product.findUniqueOrThrow({ where: { key: mtnGhana } });
  const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: faceValue, recipient: { phone } });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const order = await browser.post('/v1/orders', { quote_id: quote.json.id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const reference = (await prisma.order.findUniqueOrThrow({ where: { id: order.json.id } })).supplierReference;
  return { quote: quote.json, order: order.json, reference, payout: pawapay.state.payouts[payoutId(reference)] };
}

describe('pawaPay catalogue', () => {
  test('every country and provider enabled for payouts becomes a mobile money product within its limits', async () => {
    const products = await prisma.product.findMany({ where: { category: 'mobile_money' }, include: { supplierProducts: true }, orderBy: { key: 'asc' } });
    assert.deepEqual(
      products.map(p => [p.key, p.name, p.country, p.faceCurrency, p.denominationType, Number(p.minValueMinor), Number(p.maxValueMinor), p.recipientType]),
      [
        ['mobile_money:GH:mtn:ghs', 'MTN mobile money', 'GH', 'GHS', 'range', 100, 500000, 'phone'],
        ['mobile_money:KE:m-pesa:kes', 'M-Pesa mobile money', 'KE', 'KES', 'range', 1000, 15000000, 'phone'],
        ['mobile_money:ZM:airtel:zmw', 'Airtel mobile money', 'ZM', 'ZMW', 'range', 100, 1000000, 'phone'],
      ],
      'a provider closed for payouts is left out',
    );
    const mtn = products[0].supplierProducts[0];
    assert.deepEqual([mtn.sku, mtn.costCurrency, mtn.costRatio.toString(), mtn.meta.provider, mtn.meta.whole_units], ['MTN_MOMO_GHA:GHS', 'GHS', '1.015', 'MTN_MOMO_GHA', true], 'cost is the amount plus the agreed fee');
    assert.equal(products[2].supplierProducts[0].meta.whole_units, false);
  });

  test('syncing refuses until the agreed payout fee is set, so nothing is ever priced below cost', async () => {
    const adapter = new PawapayAdapter({ apiToken: 'pawapay-token', baseUrl: pawapay.url });
    await assert.rejects(() => adapter.catalogue(), /payout fee/);
  });

  test('payout IDs are UUIDv4s made from our reference: the same reference always gives the same payout', () => {
    const id = payoutId('202610061200BCabc123');
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(payoutId('202610061200BCabc123'), id);
    assert.notEqual(payoutId('202610061200BCabc124'), id);
  });
});

describe('pawaPay top-ups', () => {
  test('a top-up sends the amount to the wallet, takes cost plus margin, and never names pawaPay', async () => {
    const { browser } = await ghanaReseller();
    const { quote, order, reference, payout } = await topUp(browser, 5000);
    assert.ok(quote.wholesale >= Math.ceil(5000 * 1.015), 'wholesale covers the amount and the fee');
    assert.deepEqual([order.status, order.deliveries[0].kind, order.deliveries[0].details.transaction_id.startsWith('PT-')], ['completed', 'confirmation', true]);
    assert.deepEqual(
      [payout.body.amount, payout.body.currency, payout.body.recipient, payout.body.clientReferenceId],
      ['50', 'GHS', { type: 'MMO', accountDetails: { phoneNumber: '233241234567', provider: 'MTN_MOMO_GHA' } }, reference],
    );
    assert.ok(!/pawapay/i.test(JSON.stringify(order)) && !/pawapay/i.test(JSON.stringify(quote)));
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });

  test('providers taking whole amounts refuse pennies at the quote; other markets need the international plan', async () => {
    const { browser } = await ghanaReseller();
    const product = await prisma.product.findUniqueOrThrow({ where: { key: mtnGhana } });
    const pennies = await browser.post('/v1/quotes', { product_id: product.id, face_value: 5050, recipient: { phone: '0241234567' } });
    assert.deepEqual([pennies.status, pennies.json.error.param], [400, 'face_value']);
    const kenya = await prisma.product.findUniqueOrThrow({ where: { key: 'mobile_money:KE:m-pesa:kes' } });
    assert.equal((await browser.post('/v1/quotes', { product_id: kenya.id, face_value: 100000, recipient: { phone: '0712345678' } })).json.error.code, 'international_selling_required');
  });

  test('a rejected payout fails the order and releases the money', async () => {
    const { browser } = await ghanaReseller();
    const before = (await browser.get('/v1/wallet')).json;
    pawapay.state.reply = 'REJECTED';
    try {
      const { order } = await topUp(browser, 2000);
      assert.equal(order.status, 'failed');
    } finally {
      pawapay.state.reply = 'COMPLETED';
    }
    const after = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([after.available, after.reserved], [before.available, 0]);
  });

  test('a payout still processing waits; a callback with the right token makes BitoCard check it again', async () => {
    const { browser } = await ghanaReseller();
    pawapay.state.reply = 'PROCESSING';
    let placed;
    try {
      placed = await topUp(browser, 3000);
    } finally {
      pawapay.state.reply = 'COMPLETED';
    }
    assert.equal(placed.order.status, 'processing');
    placed.payout.status = 'COMPLETED';
    const body = { payoutId: payoutId(placed.reference), status: 'COMPLETED', clientReferenceId: placed.reference };
    const hook = client(server.base);
    assert.equal((await hook.post('/v1/webhooks/pawapay', body)).status, 401);
    assert.equal((await hook.post('/v1/webhooks/pawapay?token=wrong', body)).status, 401);
    assert.equal((await hook.post('/v1/webhooks/pawapay?token=pawapay-callback', body)).status, 200);
    let status = 'processing';
    for (let tries = 0; tries < 50 && status === 'processing'; tries += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
      status = (await browser.get(`/v1/orders/${placed.order.id}`)).json.status;
    }
    assert.equal(status, 'completed');
  });
});
