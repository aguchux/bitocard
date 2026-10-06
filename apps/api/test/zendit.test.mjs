// Zendit: the catalogue (gift cards that need no customer details, airtime and data by country, one offer per face
// value gathered on one product), orders by our reference (one purchase per card), unclear outcomes checked again, and
// Zendit's webhooks (authenticated by the header set in its console, the body never trusted).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakeZendit } from './fakes.mjs';

let server;
let zendit;
let admin;
let prisma;
let wallets;

before(async () => {
  zendit = await fakeZendit();
  server = await startApp({ env: { ...zendit.env, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.patch('/v1/admin/suppliers/zendit', { enabled: true })).status, 200);
  for (const category of ['gift_cards', 'airtime', 'data']) {
    assert.equal((await admin.put(`/v1/admin/suppliers/zendit/markets/NG/${category}`, { enabled: true })).status, 200);
    await prisma.countryCategory.upsert({ where: { countryCode_category: { countryCode: 'NG', category } }, create: { countryCode: 'NG', category, enabled: true }, update: { enabled: true } });
  }
});

after(async () => {
  await server?.close();
  await zendit?.close();
});

async function reseller() {
  const created = await resellerClient(server);
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: 500_000_000, reason: 'Test funding' });
  return created;
}

const productId = async key => (await prisma.product.findUniqueOrThrow({ where: { key } })).id;
const amazon = 'gift_cards:US:amazon:usd';
const mtn = 'airtime:NG:mtn:any-amount';

async function buy(browser, body) {
  const quote = await browser.post('/v1/quotes', body);
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const order = await browser.post('/v1/orders', { quote_id: quote.json.id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  return { quote: quote.json, order: order.json };
}

describe('Zendit catalogue', () => {
  test('syncs gift cards that need no customer details and top-ups by country, gathering face values on one product', async () => {
    const sync = await admin.post('/v1/admin/suppliers/zendit/sync');
    assert.equal(sync.status, 200, JSON.stringify(sync.json));
    const giftCard = await prisma.product.findUniqueOrThrow({ where: { key: amazon }, include: { supplierProducts: true } });
    assert.deepEqual([giftCard.name, giftCard.brand, giftCard.fixedValues.map(Number)], ['Amazon', 'amazon', [2500, 5000]]);
    assert.deepEqual(giftCard.supplierProducts.map(offer => [offer.sku, offer.meta.face_value]).sort(), [['AMZ-US-25', '2500'], ['AMZ-US-50', '5000']]);
    assert.equal(await prisma.product.count({ where: { key: { startsWith: 'gift_cards:US:netflix' } } }), 0, 'needs the customer email');
    assert.equal(await prisma.product.count({ where: { key: { startsWith: 'gift_cards:US:power' } } }), 0, 'utility payments are not gift cards');
    assert.equal(await prisma.product.count({ where: { key: { startsWith: 'gift_cards:US:gone' } } }), 0, 'disabled offers');

    const topup = await prisma.product.findUniqueOrThrow({ where: { key: mtn } });
    assert.deepEqual([topup.denominationType, Number(topup.minValueMinor), Number(topup.maxValueMinor), topup.recipientType], ['range', 10000, 5000000, 'phone']);
    const data = await prisma.product.findUniqueOrThrow({ where: { key: 'data:NG:mtn:1gb-30-days' } });
    assert.deepEqual([data.name, data.fixedValues.map(Number)], ['MTN Nigeria 1GB 30 days', [100000]]);
  });

  test('each face value routes to its own offer, and the reseller never sees the supplier', async () => {
    const { browser } = await reseller();
    const product = (await browser.get(`/v1/catalogue/products/${await productId(amazon)}`)).json;
    assert.deepEqual(product.pricing.denominations.map(d => d.face_value), [2500, 5000]);
    assert.ok(!/zendit/i.test(JSON.stringify(product)));
    const quote = (await browser.post('/v1/quotes', { product_id: product.id, face_value: 5000 })).json;
    const stored = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { product: true } });
    const offer = await prisma.supplierProduct.findUniqueOrThrow({ where: { id: stored.supplierProductId } });
    assert.deepEqual([stored.supplierCode, offer.sku, Number(stored.supplierCostMinor)], ['zendit', 'AMZ-US-50', 4760], 'cost plus the fixed fee');
  });
});

describe('Zendit orders', () => {
  test('a gift card order buys one voucher per card under our reference and delivers the codes', async () => {
    const { browser } = await reseller();
    const { order } = await buy(browser, { product_id: await productId(amazon), face_value: 2500, quantity: 2 });
    assert.equal(order.status, 'completed', JSON.stringify(order));
    assert.deepEqual(order.deliveries.map(d => [d.kind, d.code.startsWith('ZEN-'), d.details.expires_at]), [['gift_card', true, '2027-10-01T00:00:00Z'], ['gift_card', true, '2027-10-01T00:00:00Z']]);
    const reference = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).supplierReference;
    assert.deepEqual(
      Object.entries(zendit.state.purchases).filter(([id]) => id.startsWith(reference)).map(([id, p]) => [id, p.body.offerId, p.body.value]),
      [[`${reference}N1`, 'AMZ-US-25', undefined], [`${reference}N2`, 'AMZ-US-25', undefined]],
    );
    assert.ok(!/zendit/i.test(JSON.stringify(order)));
  });

  test('a top-up sends the amount in Zendit units to the phone number', async () => {
    const { browser } = await reseller();
    const { order } = await buy(browser, { product_id: await productId(mtn), face_value: 150000, recipient: { phone: '08031234567' } });
    assert.deepEqual([order.status, order.deliveries[0].kind], ['completed', 'confirmation']);
    const reference = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).supplierReference;
    const purchase = zendit.state.purchases[reference];
    assert.deepEqual([purchase.kind, purchase.body.offerId, purchase.body.recipientPhoneNumber, purchase.body.value], ['topups', 'MTN-NG-ANY', '+2348031234567', { type: 'ZEND', value: 150000 }]);
  });

  test('a failed purchase fails the order and releases the money', async () => {
    const { browser } = await reseller();
    const before = (await browser.get('/v1/wallet')).json;
    zendit.state.reply = 'FAILED';
    try {
      const { order } = await buy(browser, { product_id: await productId(amazon), face_value: 2500 });
      assert.equal(order.status, 'failed');
    } finally {
      zendit.state.reply = 'DONE';
    }
    const after = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([after.available, after.reserved], [before.available, 0]);
  });

  test('an unfinished purchase waits; Zendit’s webhook (with the right header) makes BitoCard check it again', async () => {
    const { browser } = await reseller();
    zendit.state.reply = 'IN_PROGRESS';
    let order;
    try {
      ({ order } = await buy(browser, { product_id: await productId(amazon), face_value: 2500 }));
    } finally {
      zendit.state.reply = 'DONE';
    }
    assert.equal(order.status, 'processing');
    const reference = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).supplierReference;
    zendit.state.purchases[reference].status = 'DONE';

    const hook = client(server.base);
    // The body is not trusted: a notice saying DONE without the header is refused.
    assert.equal((await hook.post('/v1/webhooks/zendit', { transactionId: reference, status: 'DONE' })).status, 401);
    assert.equal((await hook.post('/v1/webhooks/zendit', { transactionId: reference, status: 'DONE' }, { 'x-webhook-token': 'wrong' })).status, 401);
    const received = await hook.post('/v1/webhooks/zendit', { transactionId: reference, status: 'DONE', productType: 'VOUCHER' }, { 'x-webhook-token': 'zendit-hook' });
    assert.deepEqual([received.status, received.json.received], [200, true]);

    let status = 'processing';
    for (let tries = 0; tries < 50 && status === 'processing'; tries += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
      status = (await browser.get(`/v1/orders/${order.id}`)).json.status;
    }
    assert.equal(status, 'completed');
  });

  test('a clear refusal fails the order at once', async () => {
    const { browser } = await reseller();
    zendit.state.reply = { http: 400 };
    try {
      const { order } = await buy(browser, { product_id: await productId(amazon), face_value: 2500 });
      assert.equal(order.status, 'failed');
    } finally {
      zendit.state.reply = 'DONE';
    }
  });
});
