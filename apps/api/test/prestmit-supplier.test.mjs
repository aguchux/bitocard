// Prestmit as a gift card supplier (the buy side of its partner API): its buyable cards synced (fixed cards gathered
// on one product, any-amount cards with their limits, pre-order and region-less cards left out), priced from what it
// charges BitoCard's Naira wallet, bought under our reference with the codes delivered, pending trades checked in its
// buy history and never bought twice, clear refusals failing the order, and its buy notifications stored as supplier
// notifications. The supplier is never named to resellers.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, fakeService, resellerClient, startApp } from './helpers.mjs';

const cards = [
  { sku: 101, title: 'Amazon Gift Card', minPrice: 25, maxPrice: 25, currency: { code: 'USD' }, preOrder: false, categories: [{ name: 'Amazon' }], regions: [{ name: 'United States', code: 'US' }], imageUrl: 'https://cdn.example/amazon.png' },
  { sku: 102, title: 'Amazon Gift Card', minPrice: 50, maxPrice: 50, currency: { code: 'USD' }, preOrder: false, categories: [{ name: 'Amazon' }], regions: [{ name: 'United States', code: 'US' }], imageUrl: null },
  { sku: 201, title: 'Steam Wallet', minPrice: 5, maxPrice: 100, currency: { code: 'USD' }, preOrder: false, categories: [{ name: 'Steam' }], regions: [{ name: 'USA', code: 'US' }], imageUrl: null },
  { sku: 301, title: 'Coming Soon Card', minPrice: 10, maxPrice: 10, currency: { code: 'USD' }, preOrder: true, categories: [{ name: 'Mystery' }], regions: [{ code: 'US' }] },
  { sku: 401, title: 'Nowhere Card', minPrice: 10, maxPrice: 10, currency: { code: 'USD' }, preOrder: false, categories: [{ name: 'Nowhere' }], regions: [] },
  { sku: 501, title: 'Out of Stock Card', minPrice: 10, maxPrice: 10, currency: { code: 'USD' }, preOrder: false, categories: [{ name: 'Out of Stock' }], regions: [{ code: 'US' }] },
];

/** ₦1,470 a dollar: what Prestmit charges BitoCard's Naira wallet. */
const nairaPerDollar = 1470;
const field = (raw, name) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(raw.toString('latin1'))?.[1];

let fake;
const state = { reply: 'completed', trades: new Map() };
let server;
let admin;
let prisma;
let wallets;
let orders;

before(async () => {
  fake = await fakeService(call => {
    const url = new URL(call.url, 'http://x');
    const path = url.pathname;
    if (path.endsWith('/giftcard-trade/buy/fetch-buyable-giftcards')) return { body: { data: cards, meta: { current_page: 1, last_page: 1 } } };
    if (path.endsWith('/giftcard-trade/buy/calculate-payment')) {
      const price = Number(field(call.raw, 'price'));
      const quantity = Number(field(call.raw, 'quantity'));
      return { body: { USD: price * quantity * 1.01, NAIRA: price * quantity * nairaPerDollar, CEDIS: 1, isAvailable: field(call.raw, 'giftCardSKU') !== '501' } };
    }
    if (path.endsWith('/giftcard-trade/buy/create')) {
      if (state.reply === 'refuse') return { status: 422, body: { message: 'The given data was invalid.', errors: { price: ['Out of stock'] } } };
      const uniqueIdentifier = field(call.raw, 'uniqueIdentifier');
      const price = Number(field(call.raw, 'price'));
      const quantity = Number(field(call.raw, 'quantity'));
      const reference = `pm-${state.trades.size + 1}`;
      const codes = Array.from({ length: quantity }, (_, n) => ({ cardNumber: `CODE-${reference}-${n + 1}`, pinCode: `PIN${n + 1}`, claimUrl: 'https://cards.example/claim', expireDate: '' }));
      const trade = { reference, uniqueIdentifier, price, quantity, totalPaymentAmount: price * quantity * nairaPerDollar, paymentMethod: 'NAIRA', status: state.reply === 'pending' ? 'PENDING' : 'COMPLETED', codes };
      state.trades.set(reference, trade);
      if (state.reply === 'lost') return { status: 504, body: { message: 'Gateway timeout' } };
      return { status: 201, body: { data: { ...trade, codes: undefined, cards: trade.status === 'COMPLETED' ? codes : [] } } };
    }
    if (path.endsWith('/giftcard-trade/buy/history')) {
      return { body: { data: [...state.trades.values()].reverse().map(trade => ({ ...trade, codes: undefined, cards: trade.status === 'COMPLETED' ? trade.codes : [] })), meta: { last_page: 1 } } };
    }
    const codes = /\/giftcard-trade\/buy\/fetch-codes\/(.+)$/.exec(path);
    if (codes) {
      const trade = state.trades.get(decodeURIComponent(codes[1]));
      return { body: trade?.status === 'COMPLETED' ? trade.codes : [] };
    }
    return { status: 404, body: { message: 'unknown' } };
  });
  server = await startApp({ env: { PRESTMIT_API_KEY: 'pk_live', PRESTMIT_API_SECRET: 'sk_live', PRESTMIT_API_URL: fake.url, PRESTMIT_ACCOUNT_PIN: '4321', PRESTMIT_WEBHOOK_SECRET: 'whsec_live', CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  orders = server.app.get((await import('../dist/orders/orders.service.js')).OrdersService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.patch('/v1/admin/suppliers/prestmit', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/suppliers/prestmit/markets/NG/gift_cards', { enabled: true })).status, 200);
  await prisma.countryCategory.upsert({ where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } }, create: { countryCode: 'NG', category: 'gift_cards', enabled: true, taxable: false }, update: { enabled: true, taxable: false } });
  const sync = await admin.post('/v1/admin/suppliers/prestmit/sync');
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
});

after(async () => {
  await server?.close();
  await fake?.close();
});

async function reseller() {
  const created = await resellerClient(server, { country: 'NG' });
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: 500_000_000, reason: 'Test funding' });
  return created;
}

const amazon = 'gift_cards:US:amazon:usd-card';
const steam = 'gift_cards:US:steam:usd-amount';

async function buy(browser, key, faceValue, quantity = 1) {
  const product = await prisma.product.findUniqueOrThrow({ where: { key } });
  const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: faceValue, quantity });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const order = await browser.post('/v1/orders', { quote_id: quote.json.id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  return { quote: quote.json, order: order.json, row: await prisma.order.findUniqueOrThrow({ where: { id: order.json.id } }) };
}

describe('Prestmit as a gift card supplier', () => {
  test('syncs its buyable cards: fixed cards on one product, any-amount ones with their limits, priced in naira', async () => {
    const fixed = await prisma.product.findUniqueOrThrow({ where: { key: amazon }, include: { supplierProducts: true } });
    assert.deepEqual([fixed.brand, fixed.denominationType, fixed.fixedValues.map(Number), fixed.faceCurrency], ['amazon', 'fixed', [2500, 5000], 'USD']);
    assert.deepEqual(
      fixed.supplierProducts.map(offer => [offer.sku, offer.costCurrency, offer.costRatio.toString(), offer.meta.face_value]).sort(),
      [
        ['101', 'NGN', '1470', '2500'],
        ['102', 'NGN', '1470', '5000'],
      ],
    );
    const range = await prisma.product.findUniqueOrThrow({ where: { key: steam }, include: { supplierProducts: true } });
    assert.deepEqual([range.denominationType, Number(range.minValueMinor), Number(range.maxValueMinor)], ['range', 500, 10_000]);
    assert.deepEqual([range.supplierProducts[0].meta.min_value, range.supplierProducts[0].meta.max_value], ['500', '10000']);
    assert.equal(await prisma.product.count({ where: { key: { contains: 'mystery' } } }), 0, 'pre-order cards are left out');
    assert.equal(await prisma.product.count({ where: { key: { contains: 'out-of-stock' } } }), 0, 'out-of-stock cards are left out');
    assert.equal(await prisma.product.count({ where: { key: { contains: 'nowhere' } } }), 0, 'cards without a region are left out');
    // Every call is signed with the key and API-Hash.
    assert.ok(fake.calls.every(call => call.headers['api-key'] === 'pk_live' && /^[0-9a-f]{64}$/.test(call.headers['api-hash'])));
  });

  test('a completed purchase delivers its codes from the reply; the reseller never sees the supplier', async () => {
    const { browser } = await reseller();
    const { order, row } = await buy(browser, amazon, 5000);
    assert.equal(order.status, 'completed', JSON.stringify(order));
    assert.deepEqual(order.deliveries.map(delivery => [delivery.kind, delivery.code, delivery.pin]), [['gift_card', 'CODE-pm-1-1', 'PIN1']]);
    assert.ok(!/prestmit/i.test(JSON.stringify(order)), 'the supplier is never named');
    const create = fake.calls.find(call => call.url.endsWith('/giftcard-trade/buy/create'));
    assert.deepEqual(['giftCardSKU', 'price', 'quantity', 'paymentMethod', 'uniqueIdentifier', 'currentAccountPIN'].map(name => field(create.raw, name)), ['102', '50', '1', 'NAIRA', row.supplierReference, '4321']);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.deepEqual([stored.supplierCode, stored.supplierTransactionId, Number(stored.supplierReportedCostMinor)], ['prestmit', 'pm-1', 50 * nairaPerDollar * 100]);
    assert.equal(stored.costMismatch, false);
  });

  test('any amount within the card’s limits, in whole units; several cards in one purchase', async () => {
    const { browser } = await reseller();
    const { order } = await buy(browser, steam, 2000, 2);
    assert.equal(order.status, 'completed', JSON.stringify(order));
    assert.equal(order.deliveries.length, 2);
    const product = await prisma.product.findUniqueOrThrow({ where: { key: steam } });
    const pennies = await browser.post('/v1/quotes', { product_id: product.id, face_value: 2050 });
    assert.notEqual(pennies.status, 201, 'Prestmit sells whole amounts only');
  });

  test('a pending purchase waits, and completes from the buy history and its codes', async () => {
    const { browser } = await reseller();
    state.reply = 'pending';
    try {
      const { order } = await buy(browser, amazon, 2500);
      assert.equal(order.status, 'processing');
      const reference = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).supplierTransactionId;
      await orders.attempt(order.id, 'check', { scheduled: false });
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'processing', 'still pending at Prestmit');
      state.trades.get(reference).status = 'COMPLETED';
      await orders.attempt(order.id, 'check', { scheduled: false });
      const done = (await browser.get(`/v1/orders/${order.id}`)).json;
      assert.deepEqual([done.status, done.deliveries[0].code], ['completed', `CODE-${reference}-1`]);
    } finally {
      state.reply = 'completed';
    }
  });

  test('a lost reply is never bought again: the history finds the trade by our reference', async () => {
    const { browser } = await reseller();
    state.reply = 'lost';
    try {
      const before = state.trades.size;
      const { order } = await buy(browser, amazon, 2500);
      assert.equal(order.status, 'processing', 'unclear is not failed');
      await orders.attempt(order.id, 'check', { scheduled: false });
      assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'completed');
      assert.equal(state.trades.size, before + 1, 'bought once');
    } finally {
      state.reply = 'completed';
    }
  });

  test('a clear refusal fails the order and releases the money', async () => {
    const { browser } = await reseller();
    const before = (await browser.get('/v1/wallet')).json.available;
    state.reply = 'refuse';
    try {
      const { order } = await buy(browser, amazon, 2500);
      assert.equal(order.status, 'failed');
      assert.equal((await browser.get('/v1/wallet')).json.available, before);
      assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
    } finally {
      state.reply = 'completed';
    }
  });

  test('its buy notifications are signed like the sell side’s and stored as supplier notifications', async () => {
    const body = JSON.stringify({ event: 'giftcard-trade.buy.approved', data: { reference: 'pm-1', uniqueIdentifier: 'nobody' } });
    const post = signature => fetch(`${server.base}/v1/webhooks/prestmit`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-prestmit-signature': signature }, body });
    assert.equal((await post('wrong')).status, 401);
    const signed = await post(createHmac('sha256', 'whsec_live').update(body).digest('base64'));
    assert.equal(signed.status, 200);
    const row = await prisma.supplierWebhook.findFirst({ where: { supplierCode: 'prestmit' }, orderBy: { receivedAt: 'desc' } });
    assert.deepEqual([row.eventType, row.supplierTransactionId, row.reference], ['giftcard-trade.buy.approved', 'pm-1', 'nobody']);
  });
});
