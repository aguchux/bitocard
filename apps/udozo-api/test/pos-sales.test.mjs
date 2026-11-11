// Udozo POS milestone 3 (docs/UDOZO_POS_PLAN.md): ringing up sales. A sale at one of the owner's tills takes its units off
// the listings' own stock (never what online buyers hold), records how it was paid (cash with change, transfer, card,
// other, split) with VAT at the shop's rate, numbers it per shop, and is one sale however often the till sends it. A
// refund puts the units back; restocks, counts and damage change stock too, each kept as a movement.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adjustedStock, checkPayments, saleNumber } from '../dist/pos/sale-rules.js';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server);
  for (const key of ['classifieds', 'pos']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'free' }, data: { limits: { products: 10, shops: 1, tills: 2, staff: 3 } } });
});

after(() => server?.close());

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `sales-${randomUUID()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function owner(vatBps = 750) {
  const person = storeServer();
  const email = `sales${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name: 'Ada Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, person);
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  const pos = await person.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: "Ada's Gadget Hub", vat_bps: vatBps } });
  assert.equal(pos.status, 201, JSON.stringify(pos.json));
  person.id = signup.json.customer.id;
  const me = await person.get('/v1/pos/owner');
  person.shop = me.json.account.shops[0];
  person.till = person.shop.tills[0];
  return person;
}

/** A listing ticked Sell at POS: live on udozo.com, or shop only. */
async function product(person, title, { price = 1_000_000, stock = 5, shopOnly = false } = {}) {
  const [category, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const made = await person.post('/v1/classifieds/listings', { title, price, condition: 'new', category_id: category.id, area_id: area.id, stock, pos_enabled: true, ...(shopOnly ? { on_shop: false } : {}) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  if (!shopOnly) await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/${made.json.id}-${position}.jpg` })) });
  const submitted = await person.post(`/v1/classifieds/listings/${made.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const sale = (person, lines, payments, extra = {}) =>
  person.post('/v1/pos/owner/sales', { till_id: person.till.id, client_sale_id: randomUUID(), lines, payments, ...extra });

const stockOf = async id => (await prisma.classifiedListing.findUniqueOrThrow({ where: { id }, select: { stock: true } })).stock;

describe('sale rules', () => {
  test('payments add up to the total exactly; only cash gives change', () => {
    const split = checkPayments([{ method: 'cash', amount: 600n, tendered: 1000n }, { method: 'transfer', amount: 475n, reference: ' TRF-1 ' }], 1075n);
    assert.equal(split.change, 400n);
    assert.deepEqual(split.payments.map(p => [p.method, p.tendered, p.change, p.reference]), [['cash', 1000n, 400n, null], ['transfer', null, 0n, 'TRF-1']]);
    assert.throws(() => checkPayments([{ method: 'cash', amount: 1000n }], 1075n), error => error.code === 'payments_mismatch');
    assert.throws(() => checkPayments([{ method: 'cash', amount: 1075n, tendered: 1000n }], 1075n), error => error.code === 'cash_short');
    assert.throws(() => checkPayments([{ method: 'card', amount: 1075n, tendered: 2000n }], 1075n), error => error.param === 'payments[0].tendered');
    assert.throws(() => checkPayments([], 1075n), error => error.param === 'payments');
    assert.deepEqual(checkPayments([], 0n), { payments: [], change: 0n });
    assert.equal(saleNumber(42), 'POS-000042');
  });

  test('stock adjustments never go below what online buyers hold', () => {
    assert.equal(adjustedStock(5, 'restock', 3, 0, 100), 8);
    assert.equal(adjustedStock(5, 'damage', 2, 1, 100), 3);
    assert.equal(adjustedStock(5, 'count', 9, 0, 100), 9);
    assert.throws(() => adjustedStock(5, 'damage', 5, 2, 100), error => error.code === 'stock_below_held');
    assert.throws(() => adjustedStock(5, 'restock', 96, 0, 100), error => error.code === 'parameter_invalid');
  });
});

describe('ringing up a sale', () => {
  test('takes the units off stock, adds VAT, records cash and its change, and numbers it per shop', async () => {
    const person = await owner(750);
    const tv = await product(person, 'Samsung 43 inch smart TV', { price: 10_000_00, stock: 5 });
    const fan = await product(person, 'Binatone standing fan', { price: 2_500_00, stock: 3, shopOnly: true });
    // 2 TVs (10,000 off one line) and a fan, 1,000 off the sale: 22,500 - 1,000 - 1,000 = 20,500 + 7.5% VAT = 22,037.50.
    const lines = [{ listing_id: tv.id, quantity: 2, discount: 1_000_00 }, { listing_id: fan.id, quantity: 1 }];
    const total = 22_037_50;
    const made = await sale(person, lines, [{ method: 'cash', amount: total, tendered: 25_000_00 }], { discount: 1_000_00, expected_total: total, note: 'Walk-in' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.number, 'POS-000001');
    assert.deepEqual([made.json.subtotal, made.json.discount, made.json.vat_bps, made.json.vat, made.json.total, made.json.change, made.json.items], [22_500_00, 2_000_00, 750, 1_537_50, total, 2_962_50, 3]);
    assert.deepEqual(made.json.lines.map(line => [line.title, line.quantity, line.unit_price, line.discount, line.total]), [['Samsung 43 inch smart TV', 2, 10_000_00, 1_000_00, 19_000_00], ['Binatone standing fan', 1, 2_500_00, 0, 2_500_00]]);
    assert.deepEqual(made.json.payments, [{ method: 'cash', amount: total, tendered: 25_000_00, change: 2_962_50, reference: null }]);
    assert.deepEqual([made.json.till.name, made.json.sold_by, made.json.shop.name], ['Till 1', 'Ada Okafor', "Ada's Gadget Hub"]);
    assert.deepEqual([await stockOf(tv.id), await stockOf(fan.id)], [3, 2]);

    // A shop-only listing that runs out keeps no udozo.com clock; a public one does.
    const fanSold = await sale(person, [{ listing_id: fan.id, quantity: 2 }], [{ method: 'card', amount: 5_375_00, reference: 'POS slip 88' }], { expected_total: 5_375_00 });
    assert.equal(fanSold.json.number, 'POS-000002');
    const fanRow = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: fan.id } });
    assert.deepEqual([fanRow.stock, fanRow.outOfStockAt, fanRow.expiresAt, fanRow.status], [0, null, null, 'active']);
    const tvAll = await sale(person, [{ listing_id: tv.id, quantity: 3 }], [{ method: 'transfer', amount: 32_250_00 }], { expected_total: 32_250_00 });
    assert.equal(tvAll.status, 201, JSON.stringify(tvAll.json));
    const tvRow = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: tv.id } });
    assert.equal(tvRow.stock, 0);
    assert.ok(tvRow.outOfStockAt, 'udozo.com counts it out of stock');

    // The movements say why stock moved.
    const movements = await person.get(`/v1/pos/owner/stock/${tv.id}/movements`);
    assert.deepEqual(movements.json.data.map(m => [m.reason, m.delta, m.stock_after, m.sale.number]), [['sale', -3, 0, 'POS-000003'], ['sale', -2, 3, 'POS-000001']]);
  });

  test('a sale sent twice (a lost reply) is one sale', async () => {
    const person = await owner(0);
    const tv = await product(person, 'Hisense 32 inch TV', { price: 500_000, stock: 4 });
    const body = { till_id: person.till.id, client_sale_id: randomUUID(), lines: [{ listing_id: tv.id, quantity: 1 }], payments: [{ method: 'cash', amount: 500_000 }], expected_total: 500_000 };
    const [first, second] = await Promise.all([person.post('/v1/pos/owner/sales', body), person.post('/v1/pos/owner/sales', body)]);
    assert.equal(first.json.id, second.json.id);
    assert.equal(await stockOf(tv.id), 3);
    assert.equal(await prisma.posSale.count({ where: { clientSaleId: body.client_sale_id } }), 1);
  });

  test('never sells what online buyers hold, a changed price, short payment, or another owner’s product', async () => {
    const person = await owner(0);
    const tv = await product(person, 'LG 50 inch TV', { price: 400_000, stock: 3 });
    const buyer = await owner(0);
    await prisma.classifiedBuyOrder.create({ data: { listingId: tv.id, buyerId: buyer.id, sellerId: person.id, country: 'NG', currency: 'NGN', priceMinor: 400_000n, quantity: 2, status: 'accepted' } });

    const short = await sale(person, [{ listing_id: tv.id, quantity: 2 }], [{ method: 'cash', amount: 800_000 }], { expected_total: 800_000 });
    assert.equal(short.status, 409);
    assert.deepEqual([short.json.error.code, short.json.error.param], ['stock_short', 'lines[0]']);
    assert.match(short.json.error.message, /Only 1 of/);

    const moved = await sale(person, [{ listing_id: tv.id, quantity: 1 }], [{ method: 'cash', amount: 400_000 }], { expected_total: 350_000 });
    assert.equal(moved.json.error.code, 'price_changed');
    const underpaid = await sale(person, [{ listing_id: tv.id, quantity: 1 }], [{ method: 'cash', amount: 300_000 }], { expected_total: 400_000 });
    assert.equal(underpaid.json.error.code, 'payments_mismatch');
    const theirs = await sale(buyer, [{ listing_id: tv.id, quantity: 1 }], [{ method: 'cash', amount: 400_000 }], { expected_total: 400_000 });
    assert.equal(theirs.json.error.code, 'product_unavailable');
    const otherTill = await person.post('/v1/pos/owner/sales', { till_id: buyer.till.id, client_sale_id: randomUUID(), lines: [{ listing_id: tv.id, quantity: 1 }], payments: [{ method: 'cash', amount: 400_000 }], expected_total: 400_000 });
    assert.equal(otherTill.status, 404);
    // Nothing was taken by the refusals; the one free unit still sells.
    assert.equal(await stockOf(tv.id), 3);
    assert.equal((await sale(person, [{ listing_id: tv.id, quantity: 1 }], [{ method: 'other', amount: 400_000 }], { expected_total: 400_000 })).status, 201);
    assert.equal(await stockOf(tv.id), 2);
  });
});

describe('sales history, refunds and stock', () => {
  test('lists sales with the takings, refunds a sale once and puts its units back', async () => {
    const person = await owner(0);
    const tv = await product(person, 'TCL 55 inch TV', { price: 300_000, stock: 5 });
    const first = (await sale(person, [{ listing_id: tv.id, quantity: 2 }], [{ method: 'cash', amount: 600_000 }], { expected_total: 600_000 })).json;
    await sale(person, [{ listing_id: tv.id, quantity: 1 }], [{ method: 'transfer', amount: 300_000 }], { expected_total: 300_000 });

    const list = await person.get('/v1/pos/owner/sales');
    assert.deepEqual([list.json.total, list.json.summary.sales, list.json.summary.takings], [2, 2, 900_000]);
    assert.deepEqual(list.json.data.map(s => s.number), ['POS-000002', 'POS-000001']);
    assert.equal((await person.get('/v1/pos/owner/sales?q=000001')).json.total, 1);

    assert.equal((await person.post(`/v1/pos/owner/sales/${first.id}/refund`, { reason: '' })).json.error.code, 'parameter_missing');
    const refunded = await person.post(`/v1/pos/owner/sales/${first.id}/refund`, { reason: 'Customer changed their mind' });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.deepEqual([refunded.json.status, refunded.json.refund_reason, refunded.json.restocked], ['refunded', 'Customer changed their mind', true]);
    assert.equal(await stockOf(tv.id), 4);
    assert.equal((await person.post(`/v1/pos/owner/sales/${first.id}/refund`, { reason: 'Again' })).json.error.code, 'sale_refunded');
    assert.equal(await stockOf(tv.id), 4);

    const after = await person.get('/v1/pos/owner/sales');
    assert.deepEqual([after.json.summary.sales, after.json.summary.takings, after.json.summary.refunds, after.json.summary.refunded], [1, 300_000, 1, 600_000]);
    assert.equal((await storeServer().get(`/v1/pos/owner/sales/${first.id}`)).status, 401);
    const stranger = await owner(0);
    assert.equal((await stranger.get(`/v1/pos/owner/sales/${first.id}`)).status, 404);
  });

  test('restocks, counts and writes off damage, each kept as a movement', async () => {
    const person = await owner(0);
    const tv = await product(person, 'Sony 65 inch TV', { price: 900_000, stock: 2, shopOnly: true });
    const restocked = await person.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'restock', quantity: 10, note: 'Delivery from Alaba' });
    assert.equal(restocked.status, 200, JSON.stringify(restocked.json));
    assert.deepEqual([restocked.json.stock, restocked.json.available], [12, 12]);
    assert.equal((await person.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'damage', quantity: 1, note: 'Cracked screen' })).json.stock, 11);
    assert.equal((await person.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'count', quantity: 9 })).json.stock, 9);
    assert.equal((await person.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'damage', quantity: 10 })).json.error.code, 'stock_below_held');
    assert.equal((await person.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'restock', quantity: 0 })).json.error.code, 'parameter_invalid');
    const movements = await person.get(`/v1/pos/owner/stock/${tv.id}/movements`);
    assert.deepEqual(movements.json.data.map(m => [m.reason, m.delta, m.stock_after, m.note]), [['count', -2, 9, null], ['damage', -1, 11, 'Cracked screen'], ['restock', 10, 12, 'Delivery from Alaba']]);
    const stranger = await owner(0);
    assert.equal((await stranger.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'restock', quantity: 1 })).status, 404);
  });
});
