// VTpass airtime and data in Nigeria: synced only for services with a commission agreed (BitoCard's cost is face value
// less it), airtime as the any-amount product other suppliers share within VTpass's own limits, fixed-price data plans,
// live orders sending the number in Nigeria's national format, sold at face value with BitoCard's discount.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeVtpass } from './fakes.mjs';

const { VtpassAdapter, parseVtpassCommissions } = await import('../dist/suppliers/vtpass.adapter.js');

const commissions = 'mtn 3; glo 4\nmtn-data 3, glo-data=4';
let server;
let vtpass;
let admin;
let prisma;
let wallets;

before(async () => {
  vtpass = await fakeVtpass();
  server = await startApp({ env: { ...vtpass.env, VTPASS_COMMISSIONS: commissions } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  for (const category of ['airtime', 'data']) {
    assert.equal((await admin.put(`/v1/admin/suppliers/vtpass/markets/NG/${category}`, { enabled: true })).status, 200);
  }
  // Only VTpass sells airtime and data here.
  await prisma.supplierMarket.updateMany({ where: { supplierCode: { not: 'vtpass' }, countryCode: 'NG', category: { in: ['airtime', 'data'] } }, data: { enabled: false } });
  const sync = await admin.post('/v1/admin/suppliers/vtpass/sync');
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
});

after(async () => {
  await server?.close();
  await vtpass?.close();
});

const offer = (sku, supplierCode = 'vtpass') => prisma.supplierProduct.findUnique({ where: { supplierCode_sku: { supplierCode, sku } }, include: { product: true } });

async function nigerianReseller() {
  const created = await resellerClient(server);
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: 5_000_000, reason: 'Test funding' });
  return created;
}

describe('commissions', () => {
  test('are read per service in any of the documented forms; anything else is reported, never guessed', () => {
    const { commissions: parsed, problems } = parseVtpassCommissions('mtn 3; airtel: 3.4\nglo-sme-data=4%, etisalat 25, nonsense');
    assert.deepEqual([...parsed].map(([id, percent]) => [id, percent.toString()]), [['mtn', '3'], ['airtel', '3.4'], ['glo-sme-data', '4']]);
    assert.deepEqual(problems, ['etisalat 25', 'nonsense']);
  });

  test('without any, airtime and data are not synced at all', async () => {
    const adapter = new VtpassAdapter({ apiKey: 'vt-api', publicKey: 'vt-public', secretKey: 'vt-secret' }, vtpass.url);
    for (const category of ['airtime', 'data']) {
      await assert.rejects(adapter.catalogue({ country: 'NG', category }), error => error.definite === true && /commissions agreed with VTpass/.test(error.message));
    }
  });
});

describe('the catalogue', () => {
  test('airtime is the shared any-amount product per network, at face value less the commission, within VTpass’s limits', async () => {
    const mtn = await offer('airtime:mtn');
    assert.deepEqual([mtn.product.key, mtn.product.recipientType, mtn.costCurrency, mtn.costRatio.toString()], ['airtime:NG:mtn:topup', 'phone', 'NGN', '0.97']);
    assert.deepEqual([mtn.meta.min_value, mtn.meta.max_value], ['5000', '5000000']);
    assert.equal((await offer('airtime:glo')).costRatio.toString(), '0.96');
    assert.equal(await offer('airtime:airtel'), null, 'no commission agreed: not synced');
  });

  test('data plans are fixed-price products at VTpass’s listed price; plans without a fixed price are left out', async () => {
    const plan = await offer('mtn-data:mtn-20gb-7500');
    assert.deepEqual(
      [plan.product.key, plan.product.name, plan.product.fixedValues, plan.costRatio.toString(), plan.meta.variationCode],
      ['data:NG:mtn:mtn-20gb-7500', 'MTN N7,500 20GB - 30 days', [750_000n], '0.97', 'mtn-20gb-7500'],
    );
    assert.equal((await offer('glo-data:glo1000')).costRatio.toString(), '0.96', 'the misspelt `varations` list is read too');
    assert.equal(await offer('mtn-data:mtn-flexi'), null);
  });
});

describe('live orders', () => {
  test('airtime: sold at face value, BitoCard’s cost the amount less 3%, the number sent as 080…', async () => {
    const { browser } = await nigerianReseller();
    const product = await prisma.product.findUniqueOrThrow({ where: { key: 'airtime:NG:mtn:topup' } });
    vtpass.state.totalAmount = body => Number(body.amount) * 0.97;
    const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: 100_000, recipient: { phone: '+2348031234567' } });
    assert.equal(quote.status, 201, JSON.stringify(quote.json));
    assert.equal(quote.json.price, 100_000, 'never above face value');
    const row = await prisma.quote.findUniqueOrThrow({ where: { id: quote.json.id } });
    assert.deepEqual([row.supplierCode, row.supplierCostMinor], ['vtpass', 97_000n]);

    const order = await browser.post('/v1/orders', { quote_id: quote.json.id });
    assert.equal(order.status, 201, JSON.stringify(order.json));
    assert.equal(order.json.status, 'completed');
    const sent = Object.values(vtpass.state.requests).at(-1).request;
    assert.deepEqual([sent.serviceID, sent.amount, sent.phone, 'variation_code' in sent], ['mtn', '1000.00', '08031234567', false]);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.json.id } });
    assert.deepEqual([stored.supplierReportedCostMinor, stored.costMismatch], [97_000n, false]);
  });

  test('airtime above VTpass’s ₦50,000 is not routed to it', async () => {
    const { browser } = await nigerianReseller();
    const product = await prisma.product.findUniqueOrThrow({ where: { key: 'airtime:NG:mtn:topup' } });
    await prisma.product.update({ where: { id: product.id }, data: { maxValueMinor: 20_000_000n } });
    try {
      const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: 6_000_000, recipient: { phone: '08031234567' } });
      assert.equal(quote.json.error?.code, 'product_unavailable', JSON.stringify(quote.json));
    } finally {
      await prisma.product.update({ where: { id: product.id }, data: { maxValueMinor: 5_000_000n } });
    }
  });

  test('data: the plan’s variation code with the number as billersCode', async () => {
    const { browser } = await nigerianReseller();
    const product = await prisma.product.findUniqueOrThrow({ where: { key: 'data:NG:mtn:mtn-20gb-7500' } });
    vtpass.state.totalAmount = body => Number(body.amount) * 0.97;
    const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: 750_000, recipient: { phone: '08031234567' } });
    assert.equal(quote.status, 201, JSON.stringify(quote.json));
    const order = await browser.post('/v1/orders', { quote_id: quote.json.id });
    assert.equal(order.json.status, 'completed', JSON.stringify(order.json));
    const sent = Object.values(vtpass.state.requests).at(-1).request;
    assert.deepEqual([sent.serviceID, sent.variation_code, sent.billersCode, sent.phone], ['mtn-data', 'mtn-20gb-7500', '08031234567', '08031234567']);
  });
});
