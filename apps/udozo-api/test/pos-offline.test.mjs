// Udozo POS milestone 9 (docs/UDOZO_POS_PLAN.md): selling with no internet (a linked till's copy and its uploads in
// order, never undoing a sale, flagging what to look at, holding an unlinked device's sales for the owner), and with it
// prices per shop, stock in transit between shops and closing a shop.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let ledger;
let admin;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'pos']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'multi_shop' }, data: { prices: { NGN: 3_000_000 }, trialDays: 0, shown: true, limits: { products: null, shops: 10, tills: null, staff: null } } });
});

after(() => server?.close());

function client(kind = 'customer') {
  let token = null;
  let device = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { [kind === 'staff' ? 'udozo-pos-session' : 'bitocard-customer-session']: token } : {}),
        ...(device ? { 'udozo-pos-device': device } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'idempotency-key': `offline-${randomUUID()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    set device(value) {
      device = value;
    },
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body = {}) => request('PUT', path, body),
  };
}

let counter = 0;
async function owner() {
  const who = client();
  const email = `offline${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await who.post('/v1/store/account/signup', { name: 'Ada Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, who);
  assert.equal((await who.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await who.post('/v1/classifieds/terms/accept', { version: (await who.get('/v1/classifieds/terms')).json.version });
  who.customerId = signup.json.customer.id;
  await prisma.customer.update({ where: { id: who.customerId }, data: { phoneVerifiedAt: new Date() } });
  await ledger.post({ mode: 'live', type: 'adjustment', reference: `test-fund:${randomUUID()}`, description: 'Test top-up', lines: [{ account: { kind: 'adjustments', currency: 'NGN' }, debit: 100_000_000n }, { account: { kind: 'customer_wallet', currency: 'NGN', customerId: who.customerId }, credit: 100_000_000n }] });
  const made = await who.post('/v1/pos/owner/signup', { plan: 'multi_shop', shop: { name: 'Ikeja shop', vat_bps: 0 } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  who.account = (await who.get('/v1/pos/owner')).json.account;
  return who;
}

/** More shops, opened once the products exist (their stock then all in the first shop). */
async function addShops(who, count) {
  for (let n = 0; n < count; n += 1) assert.equal((await who.post('/v1/pos/owner/shops', { name: `Shop ${who.account.shops.length + n + 1}` })).status, 201);
  who.account = (await who.get('/v1/pos/owner')).json.account;
  return who.account.shops;
}

async function product(who, title, { stock = 10, price = 100_000 } = {}) {
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
  const made = await who.post('/v1/classifieds/listings', { title, price, category_id: category.id, stock, pos_enabled: true, on_shop: false });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return (await who.post(`/v1/classifieds/listings/${made.json.id}/submit`)).json;
}

async function hire(by, role, pin, tillIds) {
  const invited = await by.post('/v1/pos/owner/staff', { first_name: role, last_name: 'Test', phone: testMobile('NG'), role, till_ids: tillIds, send_via: 'link' });
  assert.equal(invited.status, 201, JSON.stringify(invited.json));
  const who = client('staff');
  assert.equal((await who.post('/v1/pos/invites/accept', { token: new URL(invited.json.invite.url).hash.slice(3), pin })).status, 201);
  who.id = invited.json.id;
  return who;
}

async function linkDevice(by, tillId) {
  const code = await by.post(`/v1/pos/owner/tills/${tillId}/devices/link-code`);
  const device = client('staff');
  const linked = await device.post('/v1/pos/devices/link', { code: code.json.code, name: 'Front counter', platform: 'web' });
  assert.equal(linked.status, 201, JSON.stringify(linked.json));
  device.device = linked.json.token;
  device.id = linked.json.device.id;
  return device;
}

const sell = (who, till, listing, { quantity = 1, price = 100_000 } = {}) =>
  who.post('/v1/pos/owner/sales', { till_id: till, client_sale_id: randomUUID(), lines: [{ listing_id: listing.id, quantity }], payments: [{ method: 'cash', amount: price * quantity }], expected_total: price * quantity });
const offlineSale = (staffId, listing, { quantity = 1, unit = 100_000, at = new Date(Date.now() - 3_600_000), payments, number = 'T1-0001', id = randomUUID() } = {}) => ({
  kind: 'sale',
  client_sale_id: id,
  client_number: number,
  client_created_at: at.toISOString(),
  staff_id: staffId,
  lines: [{ listing_id: listing.id, quantity, unit_price: unit }],
  vat_bps: 0,
  payments: payments ?? [{ method: 'cash', amount: unit * quantity, tendered: unit * quantity }],
  total: unit * quantity,
});
const stockOf = async listing => (await prisma.classifiedListing.findUniqueOrThrow({ where: { id: listing.id } })).stock;
const level = async (listing, shopId) => prisma.posStockLevel.findUnique({ where: { listingId_shopId: { listingId: listing.id, shopId } } });

describe('prices per shop', () => {
  test('a shop sells at its own price; the listing price stands elsewhere; staff need prices', async () => {
    const ada = await owner();
    const tv = await product(ada, 'Hisense 32 inch TV');
    const [ikeja, lekki] = await addShops(ada, 1);
    const set = await ada.put(`/v1/pos/owner/products/${tv.id}/prices`, { shop_id: lekki.id, price: 120_000 });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.udozo_price, 100_000);
    assert.deepEqual(set.json.shops.map(row => [row.name, row.own, row.price]), [['Ikeja shop', false, 100_000], ['Shop 2', true, 120_000]]);

    const atLekki = (await ada.get(`/v1/pos/owner/catalogue?shop=${lekki.id}`)).json.data.find(row => row.id === tv.id);
    assert.deepEqual([atLekki.price.amount, atLekki.price.udozo_amount, atLekki.price.shop_price], [120_000, 100_000, true]);
    assert.equal((await ada.get(`/v1/pos/owner/catalogue?shop=${ikeja.id}`)).json.data.find(row => row.id === tv.id).price.amount, 100_000);

    // Lekki's till charges its own price; the till's old total is refused.
    await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: ikeja.id, to_shop_id: lekki.id, lines: [{ listing_id: tv.id, quantity: 3 }] });
    assert.equal((await sell(ada, lekki.tills[0].id, tv)).json.error.code, 'price_changed');
    const sold = await sell(ada, lekki.tills[0].id, tv, { price: 120_000 });
    assert.equal(sold.status, 201, JSON.stringify(sold.json));
    assert.equal(sold.json.lines[0].unit_price, 120_000);
    assert.equal((await sell(ada, ikeja.tills[0].id, tv)).status, 201, 'Ikeja still at the listing price');

    const cashier = await hire(ada, 'cashier', '7391', [ikeja.tills[0].id]);
    assert.equal((await cashier.put(`/v1/pos/staff/products/${tv.id}/prices`, { shop_id: lekki.id, price: 90_000 })).status, 403);
    const manager = await hire(ada, 'manager', '4826', [ikeja.tills[0].id]);
    assert.equal((await manager.put(`/v1/pos/staff/products/${tv.id}/prices`, { shop_id: lekki.id, price: null })).json.shops[1].own, false, 'back to the listing price');
  });
});

describe('stock in transit', () => {
  test('sent stock waits as the receiving shop’s incoming, sold nowhere, until checked in; what did not arrive is written off', async () => {
    const ada = await owner();
    const tv = await product(ada, 'Samsung 43 inch TV', { stock: 10 });
    const [ikeja, lekki] = await addShops(ada, 1);
    const sent = await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: ikeja.id, to_shop_id: lekki.id, lines: [{ listing_id: tv.id, quantity: 4 }], in_transit: true });
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    assert.equal(sent.json.status, 'in_transit');
    assert.deepEqual([(await level(tv, ikeja.id)).quantity, (await level(tv, lekki.id)).quantity, (await level(tv, lekki.id)).incoming], [6, 0, 4]);
    assert.equal((await sell(ada, lekki.tills[0].id, tv)).json.error.code, 'stock_short', 'not on its shelf yet');
    const product1 = (await ada.get(`/v1/pos/owner/catalogue?shop=${lekki.id}`)).json.data.find(row => row.id === tv.id);
    assert.deepEqual([product1.available, product1.levels.online], [0, 0], 'neither at Lekki nor online');
    assert.equal((await ada.get('/v1/pos/owner/stock-transfers?status=in_transit')).json.total, 1);
    const online = await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: ikeja.id, lines: [{ listing_id: tv.id, quantity: 1 }], in_transit: true });
    assert.equal(online.json.error.param, 'in_transit', 'only between shops');

    const received = await ada.post(`/v1/pos/owner/stock-transfers/${sent.json.id}/receive`, { lines: [{ listing_id: tv.id, quantity: 3 }], note: 'One cracked' });
    assert.equal(received.status, 200, JSON.stringify(received.json));
    assert.equal(received.json.status, 'received');
    assert.deepEqual(received.json.received_lines, [{ listing_id: tv.id, sent: 4, received: 3, lost: 1 }]);
    assert.deepEqual([(await level(tv, lekki.id)).quantity, (await level(tv, lekki.id)).incoming, await stockOf(tv)], [3, 0, 9]);
    const lost = await prisma.posStockMovement.findFirst({ where: { listingId: tv.id, reason: 'transfer_lost' } });
    assert.deepEqual([lost.delta, lost.stockAfter], [-1, 9]);
    assert.equal((await ada.post(`/v1/pos/owner/stock-transfers/${sent.json.id}/receive`, {})).json.error.code, 'transfer_not_in_transit', 'once');
    assert.equal((await sell(ada, lekki.tills[0].id, tv)).status, 201);
  });

  test('the sender takes a transfer back; stock lowered on udozo.com meanwhile comes off the shelves before what is on its way', async () => {
    const ada = await owner();
    const tv = await product(ada, 'LG 55 inch TV', { stock: 5 });
    const [ikeja, lekki] = await addShops(ada, 1);
    const sent = await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: ikeja.id, to_shop_id: lekki.id, lines: [{ listing_id: tv.id, quantity: 2 }], in_transit: true });
    const cancelled = await ada.post(`/v1/pos/owner/stock-transfers/${sent.json.id}/cancel`);
    assert.equal(cancelled.json.status, 'cancelled');
    assert.deepEqual([(await level(tv, ikeja.id)).quantity, (await level(tv, lekki.id)).incoming], [5, 0]);

    await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: ikeja.id, to_shop_id: lekki.id, lines: [{ listing_id: tv.id, quantity: 2 }], in_transit: true });
    await prisma.classifiedListing.update({ where: { id: tv.id }, data: { stock: 2 } });
    assert.deepEqual([(await level(tv, ikeja.id)).quantity, (await level(tv, lekki.id)).incoming], [0, 2], 'the shelves first');
    await prisma.classifiedListing.update({ where: { id: tv.id }, data: { stock: 1 } });
    assert.equal((await level(tv, lekki.id)).incoming, 1, 'then what is on its way');
  });
});

describe('closing a shop', () => {
  test('its stock moves on, its tills stop and its devices unlink; never the last shop or with stock on its way', async () => {
    const ada = await owner();
    const tv = await product(ada, 'TCL 50 inch TV', { stock: 10 });
    const [ikeja, lekki, third] = await addShops(ada, 2);
    await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: ikeja.id, to_shop_id: lekki.id, lines: [{ listing_id: tv.id, quantity: 4 }] });
    const moving = await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: ikeja.id, to_shop_id: lekki.id, lines: [{ listing_id: tv.id, quantity: 1 }], in_transit: true });
    assert.equal((await ada.post(`/v1/pos/owner/shops/${lekki.id}/close`, { move_to_shop_id: ikeja.id })).json.error.code, 'transfers_in_transit');
    await ada.post(`/v1/pos/owner/stock-transfers/${moving.json.id}/receive`, {});
    const device = await linkDevice(ada, lekki.tills[0].id);

    const closed = await ada.post(`/v1/pos/owner/shops/${lekki.id}/close`, { move_to_shop_id: third.id });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.deepEqual(closed.json.shops.map(shop => shop.name), ['Ikeja shop', 'Shop 3']);
    assert.equal((await level(tv, third.id)).quantity, 5);
    assert.equal(await level(tv, lekki.id), null);
    assert.equal((await sell(ada, lekki.tills[0].id, tv)).json.error.code, 'shop_closed');
    assert.equal((await device.get('/v1/pos/device')).json.error.code, 'device_not_linked');
    const history = (await ada.get('/v1/pos/owner/stock-transfers')).json.data[0];
    assert.deepEqual([history.from.name, history.to.name, history.units, history.note], ['Shop 2', 'Shop 3', 5, 'Shop 2 closed']);

    // Down to one shop: the split ends, its stock the listing's.
    assert.equal((await ada.post(`/v1/pos/owner/shops/${third.id}/close`, {})).status, 200);
    assert.equal(await prisma.posStockLevel.count({ where: { listingId: tv.id } }), 0);
    assert.equal((await ada.post(`/v1/pos/owner/shops/${ikeja.id}/close`, {})).json.error.code, 'last_shop');
    assert.equal((await sell(ada, ikeja.tills[0].id, tv)).status, 201);
  });
});

describe('selling with no internet', () => {
  test('a linked till’s copy: its shop, products at its price with what is free, who may sign in, and the limits', async () => {
    const ada = await owner();
    const till = ada.account.shops[0].tills[0];
    const tv = await product(ada, 'Sony 65 inch TV', { stock: 4 });
    await ada.put(`/v1/pos/owner/products/${tv.id}/prices`, { shop_id: ada.account.shops[0].id, price: 95_000 });
    const cashier = await hire(ada, 'cashier', '7391', [till.id]);
    const device = await linkDevice(ada, till.id);
    const copy = await device.get('/v1/pos/device/sync');
    assert.equal(copy.status, 200, JSON.stringify(copy.json));
    assert.deepEqual(copy.json.limits, { hours: 72, sales: 500, warn_hours: 48 });
    assert.equal(copy.json.shift, null);
    assert.equal(copy.json.products.find(item => item.id === tv.id).on_hand, 4);
    assert.deepEqual([copy.json.till.id, copy.json.shop.name, copy.json.shop.paused, copy.json.shop.closed], [till.id, 'Ikeja shop', false, false]);
    const row = copy.json.products.find(item => item.id === tv.id);
    assert.deepEqual([row.price, row.available, row.blocked], [95_000, 4, null]);
    const staff = copy.json.staff.find(item => item.id === cashier.id);
    assert.deepEqual([staff.role.name, staff.permissions.sell, staff.permissions.refund], ['Cashier', 'yes', 'approval']);
    assert.equal(JSON.stringify(copy.json).includes('pin'), false, 'never a PIN or its hash');
    assert.ok((await prisma.posDevice.findUnique({ where: { id: device.id } })).lastSyncedAt);
    assert.equal((await client('staff').get('/v1/pos/device/sync')).status, 401);
  });

  test('uploads apply each sale once, as it was made; a short sale stands and is flagged; refunds follow', async () => {
    const ada = await owner();
    const till = ada.account.shops[0].tills[0];
    const tv = await product(ada, 'Hisense 50 inch TV', { stock: 2 });
    const radio = await product(ada, 'Sony radio', { stock: 5, price: 20_000 });
    const cashier = await hire(ada, 'cashier', '7391', [till.id]);
    const manager = await hire(ada, 'manager', '5820', [till.id]);
    const device = await linkDevice(ada, till.id);
    await device.get('/v1/pos/device/sync');

    const at = new Date(Date.now() - 2 * 3_600_000);
    const first = offlineSale(cashier.id, radio, { unit: 20_000, at, number: 'T1-0001' });
    const oversold = offlineSale(cashier.id, tv, { quantity: 3, number: 'T1-0002' });
    const oldPrice = offlineSale(cashier.id, radio, { unit: 18_000, number: 'T1-0003' });
    const credit = offlineSale(cashier.id, radio, { unit: 20_000, payments: [{ method: 'credit', amount: 20_000 }] });
    const wrong = { ...offlineSale(cashier.id, radio, { unit: 20_000 }), total: 25_000 };
    const refund = { kind: 'refund', client_id: randomUUID(), sale_client_id: first.client_sale_id, reason: 'Wrong colour', restock: true, staff_id: cashier.id, approved_by_staff_id: manager.id };
    const upload = await device.post('/v1/pos/device/upload', { entries: [first, oversold, oldPrice, credit, wrong, refund] });
    assert.equal(upload.status, 200, JSON.stringify(upload.json));
    const results = upload.json.results;
    assert.deepEqual(results.map(row => row.status), ['applied', 'applied', 'applied', 'rejected', 'rejected', 'applied']);
    assert.deepEqual([results[3].error.code, results[4].error.code], ['payment_method_offline', 'totals_mismatch']);
    assert.match(results[0].sale.number, /^POS-\d{6}$/);
    assert.equal(results[0].sale.client_number, 'T1-0001');
    assert.deepEqual(results[1].sale.flags, [{ code: 'oversold', listing_id: tv.id, title: 'Hisense 50 inch TV', short: 1 }]);
    assert.deepEqual(results[2].sale.flags, [{ code: 'price_changed', listing_id: radio.id, title: 'Sony radio', sold_at: 18_000, price: 20_000 }]);
    assert.equal(await stockOf(tv), 0, 'never below nothing');
    assert.equal(await stockOf(radio), 4, 'two sold, one refunded and restocked');

    const sale = await prisma.posSale.findUnique({ where: { id: results[0].sale.id } });
    assert.deepEqual([sale.offline, sale.status, sale.soldByName, sale.createdAt.toISOString(), Boolean(sale.uploadedAt)], [true, 'refunded', 'cashier Test', at.toISOString(), true]);

    // Sent again (a lost reply): nothing twice.
    const again = await device.post('/v1/pos/device/upload', { entries: [first, oversold, refund] });
    assert.deepEqual(again.json.results.map(row => [row.status, row.sale.number]), [['duplicate', results[0].sale.number], ['duplicate', results[1].sale.number], ['duplicate', results[0].sale.number]]);
    assert.equal(await stockOf(radio), 4);

    // The owner sees what to look at, and marks it looked at.
    const flagged = (await ada.get('/v1/pos/owner/offline/flagged')).json;
    assert.deepEqual(flagged.data.map(row => row.number).sort(), [results[1].sale.number, results[2].sale.number].sort());
    const done = await ada.post(`/v1/pos/owner/sales/${results[1].sale.id}/flags/resolve`);
    assert.equal(done.json.resolved_by, 'Ada Okafor');
    assert.equal((await ada.get('/v1/pos/owner/offline/flagged')).json.total, 1);
    const devices = (await ada.get('/v1/pos/owner/devices')).json.data;
    assert.ok(devices.find(row => row.id === device.id).last_upload_at);
  });

  test('a seller suspended meanwhile is flagged; an unlinked device’s sales wait for the owner', async () => {
    const ada = await owner();
    const till = ada.account.shops[0].tills[0];
    const tv = await product(ada, 'Philips 40 inch TV', { stock: 3 });
    const cashier = await hire(ada, 'cashier', '7391', [till.id]);
    const device = await linkDevice(ada, till.id);
    await prisma.posStaff.update({ where: { id: cashier.id }, data: { status: 'suspended' } });
    const suspended = await device.post('/v1/pos/device/upload', { entries: [offlineSale(cashier.id, tv)] });
    assert.deepEqual(suspended.json.results[0].sale.flags, [{ code: 'staff_suspended', staff: 'cashier Test' }]);
    await prisma.posStaff.update({ where: { id: cashier.id }, data: { status: 'active' } });

    await ada.post(`/v1/pos/owner/devices/${device.id}/unlink`);
    const heldSale = offlineSale(cashier.id, tv, { number: 'T1-0009' });
    const held = await device.post('/v1/pos/device/upload', { entries: [heldSale, offlineSale(cashier.id, tv)] });
    assert.equal(held.status, 200, JSON.stringify(held.json));
    assert.deepEqual(held.json.results.map(row => row.status), ['held', 'held']);
    assert.equal(await stockOf(tv), 2, 'nothing applied');
    assert.equal((await device.get('/v1/pos/device/sync')).status, 401, 'an unlinked device gets no copy');
    const waiting = (await ada.get('/v1/pos/owner/offline/held')).json.data;
    assert.deepEqual(waiting.map(row => [row.client_number, row.total, row.device.name]), [['T1-0009', 100_000, 'Front counter'], ['T1-0001', 100_000, 'Front counter']]);
    const accepted = await ada.post(`/v1/pos/owner/offline/held/${waiting[0].id}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    assert.equal(accepted.json.status, 'accepted');
    const sale = await prisma.posSale.findUnique({ where: { id: accepted.json.sale_id } });
    assert.deepEqual(sale.flags, [{ code: 'device_unlinked' }]);
    assert.equal((await ada.post(`/v1/pos/owner/offline/held/${waiting[1].id}/reject`)).json.status, 'rejected');
    assert.equal((await ada.post(`/v1/pos/owner/offline/held/${waiting[1].id}/accept`)).json.error.code, 'held_decided');
    assert.equal(await stockOf(tv), 1);
  });

  test('shifts, cash and stock changes made offline upload once; approvals and discounts are checked', async () => {
    const ada = await owner();
    const till = ada.account.shops[0].tills[0];
    const tv = await product(ada, 'LG 43 inch TV', { stock: 5 });
    await prisma.posPlan.update({ where: { code: 'multi_shop' }, data: { offlineHours: 24, offlineSales: 200 } });
    const cashier = await hire(ada, 'cashier', '7391', [till.id]);
    const manager = await hire(ada, 'manager', '5820', [till.id]);
    // The cashier's stock changes need a manager's PIN (the owner's own role).
    const role = await ada.post('/v1/pos/owner/roles', { name: 'Counter and stock', permissions: { sell: 'yes', till: 'yes', stock_view: 'yes', own_sales: 'yes', refund: 'approval', stock_adjust: 'approval' }, discount_limit_bps: 500 });
    assert.equal(role.status, 201, JSON.stringify(role.json));
    await prisma.posStaff.update({ where: { id: cashier.id }, data: { roleKey: null, roleId: role.json.id } });
    const device = await linkDevice(ada, till.id);
    assert.deepEqual((await device.get('/v1/pos/device/sync')).json.limits, { hours: 24, sales: 200, warn_hours: 16 });

    const shiftId = randomUUID();
    const base = Date.now() - 120 * 60_000;
    const at = minutes => new Date(base + minutes * 60_000).toISOString();
    const entries = [
      { kind: 'shift_open', client_id: shiftId, staff_id: cashier.id, at: at(0), opening_float: 500_000 },
      offlineSale(cashier.id, tv, { at: new Date(at(10)) }),
      { kind: 'shift_cash', client_id: randomUUID(), staff_id: cashier.id, at: at(20), shift_client_id: shiftId, cash_kind: 'out', amount: 50_000, reason: 'Fuel' },
      { kind: 'stock', client_id: randomUUID(), staff_id: cashier.id, at: at(30), listing_id: tv.id, adjustment: 'damage', quantity: 1 },
      { kind: 'stock', client_id: randomUUID(), staff_id: cashier.id, at: at(31), listing_id: tv.id, adjustment: 'damage', quantity: 1, approved_by_staff_id: manager.id },
      { ...offlineSale(cashier.id, tv, { at: new Date(at(40)), unit: 50_000 }), lines: [{ listing_id: tv.id, quantity: 1, unit_price: 100_000 }], discount: 50_000 },
      { kind: 'shift_close', client_id: randomUUID(), staff_id: cashier.id, at: at(60), shift_client_id: shiftId, counted: 600_000 },
    ];
    const upload = await device.post('/v1/pos/device/upload', { entries });
    assert.equal(upload.status, 200, JSON.stringify(upload.json));
    const results = upload.json.results;
    assert.deepEqual(results.map(row => [row.kind, row.status]), [['shift_open', 'applied'], ['sale', 'applied'], ['shift_cash', 'applied'], ['stock', 'rejected'], ['stock', 'applied'], ['sale', 'applied'], ['shift_close', 'applied']], JSON.stringify(results));
    assert.equal(results[3].error.code, 'approval_required');
    assert.equal(results[5].sale.flags[0].code, 'discount_over_limit');

    const shift = await prisma.posShift.findFirst({ where: { clientId: shiftId } });
    assert.deepEqual([shift.status, shift.openedAt.toISOString(), shift.closedAt.toISOString(), Number(shift.openingFloatMinor)], ['closed', at(0), at(60), 500_000]);
    assert.equal(await prisma.posSale.count({ where: { shiftId: shift.id } }), 2);
    assert.equal(await stockOf(tv), 2, 'two sold, one damaged');
    assert.equal(await prisma.posApproval.count({ where: { action: 'offline_stock', approvedByStaffId: manager.id } }), 1);

    // Sent again: nothing twice.
    const again = await device.post('/v1/pos/device/upload', { entries });
    assert.deepEqual(again.json.results.map(row => row.status), ['duplicate', 'duplicate', 'duplicate', 'rejected', 'duplicate', 'duplicate', 'duplicate']);
    assert.equal(await stockOf(tv), 2);

    // A refund by a cashier with nobody's PIN stands and is flagged.
    const refund = await device.post('/v1/pos/device/upload', { entries: [{ kind: 'refund', client_id: randomUUID(), sale_client_id: entries[1].client_sale_id, reason: 'Faulty', restock: false, staff_id: cashier.id }] });
    assert.equal(refund.json.results[0].status, 'applied', JSON.stringify(refund.json));
    assert.deepEqual(refund.json.results[0].sale.flags, [{ code: 'refund_unapproved', staff: 'cashier Test' }]);
    await prisma.posStaff.update({ where: { id: cashier.id }, data: { roleKey: 'cashier', roleId: null } });

    // The copy carries the till's recent sales to refund offline.
    const copy = (await device.get('/v1/pos/device/sync')).json;
    assert.ok(copy.recent_sales.some(row => row.client_sale_id === entries[5].client_sale_id && row.refundable_offline));
    await prisma.posPlan.update({ where: { code: 'multi_shop' }, data: { offlineHours: 72, offlineSales: 500 } });
  });

  test('a file of unsent sales signed by the till is imported by the owner; a changed one is refused', async () => {
    const ada = await owner();
    const till = ada.account.shops[0].tills[0];
    const tv = await product(ada, 'TCL 55 inch TV', { stock: 3 });
    const cashier = await hire(ada, 'cashier', '7391', [till.id]);
    const device = await linkDevice(ada, till.id);
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    assert.equal((await device.put('/v1/pos/device/key', { public_key: { kty: 'RSA' } })).status, 400);
    assert.equal((await device.put('/v1/pos/device/key', { public_key: jwk })).status, 200);

    const payload = JSON.stringify({ object: 'pos_offline_export', device_id: device.id, entries: [offlineSale(cashier.id, tv, { number: 'T1-0004' })] });
    const signature = sign('sha256', Buffer.from(payload), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    const changed = await ada.post('/v1/pos/owner/offline/import', { payload: payload.replace('T1-0004', 'T1-0005'), signature });
    assert.equal(changed.json.error.code, 'file_signature_invalid');
    const imported = await ada.post('/v1/pos/owner/offline/import', { payload, signature });
    assert.equal(imported.status, 200, JSON.stringify(imported.json));
    assert.deepEqual(imported.json.results.map(row => row.status), ['applied']);
    assert.equal((await ada.post('/v1/pos/owner/offline/import', { payload, signature })).json.results[0].status, 'duplicate');
    assert.equal(await stockOf(tv), 2);
    const other = await owner();
    assert.equal((await other.post('/v1/pos/owner/offline/import', { payload, signature })).status, 404);
  });

  test('the owner is told once when a till has not synced for a day', async () => {
    const ada = await owner();
    const device = await linkDevice(ada, ada.account.shops[0].tills[0].id);
    const service = server.app.get((await import('../dist/pos/offline.service.js')).PosOfflineService);
    const old = new Date(Date.now() - 30 * 3_600_000);
    await prisma.posDevice.update({ where: { id: device.id }, data: { linkedAt: old, lastSyncedAt: old } });
    assert.ok((await service.notifyUnsynced()).told >= 1);
    assert.ok((await prisma.posDevice.findUnique({ where: { id: device.id } })).unsyncedNotifiedAt);
    await service.notifyUnsynced();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await prisma.notification.count({ where: { customerId: ada.customerId, type: 'customer.pos.till' } }), 1);
    await device.get('/v1/pos/device/sync');
    assert.equal((await prisma.posDevice.findUnique({ where: { id: device.id } })).unsyncedNotifiedAt, null);
  });
});
