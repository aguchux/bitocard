// Udozo POS several shops and yearly billing (docs/UDOZO_POS_PLAN.md, milestone 8): a second shop splits each listing's
// stock between the shops (all of it in the first shop to begin), tills sell only their shop's level, transfers move
// stock between shops and online, stock going down outside the till comes from the shop that fulfils online orders
// (a database trigger), and shops past a plan's limit pause. Plans are paid monthly or yearly.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let ledger;
let billing;
let admin;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  billing = server.app.get((await import('../dist/pos/billing.service.js')).PosBillingService);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'pos']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'premium' }, data: { prices: { NGN: 1_500_000 }, yearlyPrices: { NGN: 15_000_000 }, trialDays: 0, shown: true, limits: { products: null, shops: 1, tills: null, staff: null } } });
  await prisma.posPlan.update({ where: { code: 'multi_shop' }, data: { prices: { NGN: 3_000_000 }, yearlyPrices: {}, trialDays: 0, shown: true, limits: { products: null, shops: 10, tills: null, staff: null } } });
});

after(() => server?.close());

function client(kind = 'customer') {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { [kind === 'staff' ? 'udozo-pos-session' : 'bitocard-customer-session']: token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'idempotency-key': `multi-${randomUUID()}` } : {}),
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

async function fund(customerId, amount) {
  await ledger.post({ mode: 'live', type: 'adjustment', reference: `test-fund:${randomUUID()}`, description: 'Test top-up', lines: [{ account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) }, { account: { kind: 'customer_wallet', currency: 'NGN', customerId }, credit: BigInt(amount) }] });
}

let counter = 0;
async function owner(plan = 'multi_shop', { interval, wallet = 100_000_000 } = {}) {
  const who = client();
  const email = `multi${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await who.post('/v1/store/account/signup', { name: 'Ada Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, who);
  assert.equal((await who.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await who.post('/v1/classifieds/terms/accept', { version: (await who.get('/v1/classifieds/terms')).json.version });
  who.customerId = signup.json.customer.id;
  await prisma.customer.update({ where: { id: who.customerId }, data: { phoneVerifiedAt: new Date() } });
  if (wallet) await fund(who.customerId, wallet);
  const made = await who.post('/v1/pos/owner/signup', { plan, shop: { name: 'Ikeja shop', vat_bps: 0 }, ...(interval ? { interval } : {}) });
  who.signup = made;
  if (made.status === 201) who.account = made.json;
  return who;
}

async function product(who, title, stock = 10) {
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
  const made = await who.post('/v1/classifieds/listings', { title, price: 100_000, category_id: category.id, stock, pos_enabled: true, on_shop: false });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return (await who.post(`/v1/classifieds/listings/${made.json.id}/submit`)).json;
}

const sell = (who, till, listing, quantity = 1) => who.post('/v1/pos/owner/sales', { till_id: till, client_sale_id: randomUUID(), lines: [{ listing_id: listing.id, quantity }], payments: [{ method: 'cash', amount: 100_000 * quantity }], expected_total: 100_000 * quantity });
const levels = async listing => Object.fromEntries((await prisma.posStockLevel.findMany({ where: { listingId: listing.id } })).map(row => [row.shopId, row.quantity]));
const stockOf = async listing => (await prisma.classifiedListing.findUniqueOrThrow({ where: { id: listing.id } })).stock;

describe('yearly billing', () => {
  test('sign up yearly where the plan has a yearly price; refused where it has none', async () => {
    const ada = await owner('premium', { interval: 'year' });
    assert.equal(ada.signup.status, 201, JSON.stringify(ada.signup.json));
    assert.equal(ada.account.billing_interval, 'year');
    const days = (new Date(ada.account.period_end) - new Date(ada.account.period_start)) / 86_400_000;
    assert.ok(days >= 365 && days <= 366, `a year: ${days} days`);
    const charges = (await ada.get('/v1/pos/owner/charges')).json.data;
    assert.deepEqual([charges[0].interval, charges[0].amount], ['year', 15_000_000]);
    assert.equal((await ada.get('/v1/pos/plans?country=NG')).json.data.find(plan => plan.code === 'premium').yearly_price.amount, 15_000_000);

    const kemi = await owner('multi_shop', { interval: 'year' });
    assert.deepEqual([kemi.signup.status, kemi.signup.json.error.code], [409, 'interval_unavailable']);
  });

  test('monthly to yearly is charged now less what is unused; yearly to monthly waits for the period end, then renews monthly', async () => {
    const ada = await owner('premium');
    assert.equal(ada.account.billing_interval, 'month');
    const yearly = await ada.post('/v1/pos/owner/plan', { plan: 'premium', interval: 'year' });
    assert.equal(yearly.status, 200, JSON.stringify(yearly.json));
    assert.equal(yearly.json.billing_interval, 'year');
    const upgrade = (await ada.get('/v1/pos/owner/charges')).json.data[0];
    assert.equal(upgrade.kind, 'upgrade');
    assert.ok(upgrade.credit > 1_490_000 && upgrade.amount === 15_000_000 - upgrade.credit, 'the unused month is credited');

    const monthly = await ada.post('/v1/pos/owner/plan', { plan: 'premium', interval: 'month' });
    assert.deepEqual([monthly.json.billing_interval, monthly.json.next_interval], ['year', 'month']);
    // The year runs out: the renewal is monthly.
    await prisma.posAccount.update({ where: { id: ada.account.id }, data: { periodEnd: new Date(Date.now() - 60_000) } });
    await billing.run();
    const renewed = (await ada.get('/v1/pos/owner')).json.account;
    assert.deepEqual([renewed.billing_interval, renewed.next_interval], ['month', null]);
    const latest = (await ada.get('/v1/pos/owner/charges')).json.data[0];
    assert.deepEqual([latest.kind, latest.interval, latest.amount], ['renewal', 'month', 1_500_000]);
  });

  test('admins set yearly prices only beside monthly ones', async () => {
    const refused = await admin.patch('/v1/admin/pos/plans/multi_shop', { yearly_prices: { GHS: 100_000 } });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error.param, 'yearly_prices.GHS');
    const set = await admin.patch('/v1/admin/pos/plans/multi_shop', { yearly_prices: { NGN: 30_000_000 } });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual((await admin.get('/v1/admin/pos/plans')).json.data.find(plan => plan.code === 'multi_shop').yearly_prices, { NGN: 30_000_000 });
    await admin.patch('/v1/admin/pos/plans/multi_shop', { yearly_prices: { NGN: null } });
  });
});

describe('several shops', () => {
  test('a second shop splits the stock: all in the first shop; each till sells its own shop level; transfers move it', async () => {
    const ada = await owner();
    const tv = await product(ada, 'Hisense 32 inch TV', 10);
    const first = ada.account.shops[0];
    assert.deepEqual([first.main, first.fulfils_online, first.paused], [true, true, false]);
    const one = await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: first.id, lines: [{ listing_id: tv.id, quantity: 1 }] });
    assert.deepEqual([one.status, one.json.error.code], [409, 'single_shop']);

    const added = await ada.post('/v1/pos/owner/shops', { name: 'Lekki shop' });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const second = added.json.shops[1];
    assert.deepEqual([second.main, second.fulfils_online, second.paused], [false, false, false]);
    assert.deepEqual(await levels(tv), { [first.id]: 10 });

    const empty = await sell(ada, second.tills[0].id, tv);
    assert.deepEqual([empty.status, empty.json.error.code], [409, 'stock_short']);
    assert.match(empty.json.error.message, /at this shop/);

    const moved = await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: first.id, to_shop_id: second.id, lines: [{ listing_id: tv.id, quantity: 3 }], note: 'Weekend stock' });
    assert.equal(moved.status, 201, JSON.stringify(moved.json));
    assert.deepEqual([moved.json.number.startsWith('ST-'), moved.json.from.name, moved.json.to.name, moved.json.units], [true, 'Ikeja shop', 'Lekki shop', 3]);
    assert.equal((await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: second.id, to_shop_id: first.id, lines: [{ listing_id: tv.id, quantity: 4 }] })).json.error.code, 'stock_short');

    assert.equal((await sell(ada, second.tills[0].id, tv, 2)).status, 201);
    assert.deepEqual(await levels(tv), { [first.id]: 7, [second.id]: 1 });
    assert.equal(await stockOf(tv), 8);

    // The catalogue: each shop's level and what the asked shop can sell.
    const catalogue = (await ada.get(`/v1/pos/owner/catalogue?shop=${second.id}`)).json;
    const row = catalogue.data.find(item => item.id === tv.id);
    assert.deepEqual([catalogue.split, row.available, row.levels.online], [true, 1, 0]);
    assert.deepEqual(row.levels.shops.map(item => item.quantity), [7, 1]);

    // A refund goes back into the sale's shop; a count is of one shop's shelf.
    const sale = (await sell(ada, first.tills[0].id, tv)).json;
    await ada.post(`/v1/pos/owner/sales/${sale.id}/refund`, { reason: 'Changed mind' });
    assert.deepEqual(await levels(tv), { [first.id]: 7, [second.id]: 1 });
    assert.equal((await ada.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'count', quantity: 5 })).json.error.code, 'shop_required');
    assert.equal((await ada.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'count', quantity: 5, shop_id: second.id })).status, 200);
    assert.deepEqual([await levels(tv), await stockOf(tv)], [{ [first.id]: 7, [second.id]: 5 }, 12]);
    assert.equal((await ada.post(`/v1/pos/owner/stock/${tv.id}`, { kind: 'damage', quantity: 6, shop_id: second.id })).json.error.code, 'stock_short');

    // To online and back.
    assert.equal((await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: first.id, lines: [{ listing_id: tv.id, quantity: 2 }] })).status, 201);
    assert.deepEqual([await levels(tv), await stockOf(tv)], [{ [first.id]: 5, [second.id]: 5 }, 12]);
    assert.equal((await ada.get('/v1/pos/owner/stock-transfers')).json.data[0].to.name, 'Online');
  });

  test('stock going down outside the till takes the online level, then the shop that fulfils online orders', async () => {
    const ada = await owner();
    const tv = await product(ada, 'LG 43 inch TV', 10);
    const first = ada.account.shops[0];
    const second = (await ada.post('/v1/pos/owner/shops', { name: 'Lekki shop' })).json.shops[1];
    await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: first.id, to_shop_id: second.id, lines: [{ listing_id: tv.id, quantity: 4 }] });
    await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: first.id, lines: [{ listing_id: tv.id, quantity: 1 }] });
    assert.equal((await ada.patch(`/v1/pos/owner/shops/${second.id}`, { fulfils_online: true })).status, 200);
    const shops = (await ada.get('/v1/pos/owner')).json.account.shops;
    assert.deepEqual(shops.map(shop => shop.fulfils_online), [false, true]);

    // An online sale of three (or the seller lowering stock on udozo.com): one from online, two from Lekki.
    await prisma.classifiedListing.update({ where: { id: tv.id }, data: { stock: 7 } });
    assert.deepEqual(await levels(tv), { [first.id]: 5, [second.id]: 2 });
    // More than Lekki holds: the rest from the other shops.
    await prisma.classifiedListing.update({ where: { id: tv.id }, data: { stock: 1 } });
    assert.deepEqual(await levels(tv), { [first.id]: 1, [second.id]: 0 });
  });

  test('on a plan of one shop the others pause; the owner chooses which is main; staff move stock with stock_adjust', async () => {
    const ada = await owner();
    const tv = await product(ada, 'Samsung 50 inch TV', 10);
    const first = ada.account.shops[0];
    const second = (await ada.post('/v1/pos/owner/shops', { name: 'Lekki shop' })).json.shops[1];
    await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: first.id, to_shop_id: second.id, lines: [{ listing_id: tv.id, quantity: 5 }] });

    // Staff: a stock keeper moves stock; a cashier may not.
    const hire = async role => {
      const invited = await ada.post('/v1/pos/owner/staff', { first_name: role, last_name: 'Test', phone: testMobile('NG'), role, all_tills: true, send_via: 'link' });
      assert.equal(invited.status, 201, JSON.stringify(invited.json));
      const who = client('staff');
      assert.equal((await who.post('/v1/pos/invites/accept', { token: new URL(invited.json.invite.url).hash.slice(3), pin: '3917' })).status, 201);
      return who;
    };
    const keeper = await hire('stock_keeper');
    assert.equal((await keeper.post('/v1/pos/staff/stock-transfers', { from_shop_id: second.id, to_shop_id: first.id, lines: [{ listing_id: tv.id, quantity: 1 }] })).status, 201);
    const cashier = await hire('cashier');
    assert.equal((await cashier.post('/v1/pos/staff/stock-transfers', { from_shop_id: second.id, to_shop_id: first.id, lines: [{ listing_id: tv.id, quantity: 1 }] })).status, 403);
    // Staff never choose the main shop or the one fulfilling online orders.
    const manager = await hire('manager');
    await manager.patch(`/v1/pos/staff/shops/${second.id}`, { main: true, fulfils_online: true, name: 'Lekki' });
    const after = (await ada.get('/v1/pos/owner')).json.account.shops;
    assert.deepEqual(after.map(shop => [shop.name, shop.main, shop.fulfils_online]), [['Ikeja shop', true, true], ['Lekki', false, false]]);

    // Down to a plan of one shop: Lekki pauses; the main shop sells on.
    await prisma.posAccount.update({ where: { id: ada.account.id }, data: { planCode: 'premium' } });
    const paused = (await ada.get('/v1/pos/owner')).json.account.shops;
    assert.deepEqual(paused.map(shop => shop.paused), [false, true]);
    assert.equal((await sell(ada, second.tills[0].id, tv)).json.error.code, 'shop_paused');
    assert.equal((await sell(ada, first.tills[0].id, tv)).status, 201);

    // Lekki made main: it sells, Ikeja pauses.
    await ada.patch(`/v1/pos/owner/shops/${second.id}`, { main: true });
    const swapped = (await ada.get('/v1/pos/owner')).json.account.shops;
    assert.deepEqual(swapped.map(shop => [shop.name, shop.main, shop.paused]), [['Lekki', true, false], ['Ikeja shop', false, true]]);
    assert.equal((await sell(ada, second.tills[0].id, tv)).status, 201);
    assert.equal((await sell(ada, first.tills[0].id, tv)).json.error.code, 'shop_paused');
  });

  test('the overview gives each shop its takings', async () => {
    const ada = await owner();
    const tv = await product(ada, 'TCL 32 inch TV', 10);
    const first = ada.account.shops[0];
    const second = (await ada.post('/v1/pos/owner/shops', { name: 'Lekki shop' })).json.shops[1];
    await ada.post('/v1/pos/owner/stock-transfers', { from_shop_id: first.id, to_shop_id: second.id, lines: [{ listing_id: tv.id, quantity: 3 }] });
    await sell(ada, first.tills[0].id, tv, 2);
    await sell(ada, second.tills[0].id, tv);
    const view = (await ada.get('/v1/pos/owner/reports/overview')).json;
    assert.deepEqual(view.by_shop.map(row => [row.name, row.sales, row.total]), [['Ikeja shop', 1, 200_000], ['Lekki shop', 1, 100_000]]);
    assert.equal((await ada.get(`/v1/pos/owner/reports/overview?shop=${second.id}`)).json.totals.sales.value, 100_000);
  });
});

describe('stock level helpers', () => {
  test('what a shop may sell, with online holds on the shop that fulfils online orders', async () => {
    const { freeAtShop, freeOnline, onlineLevel, pausedShops } = await import('../dist/pos/stock-levels.js');
    const levels = new Map([['a', 5], ['b', 3]]);
    assert.equal(onlineLevel(10, levels), 2);
    assert.equal(freeAtShop({ stock: 10, held: 0, levels, shopId: 'a', fulfilsOnline: true }), 5);
    assert.equal(freeAtShop({ stock: 10, held: 4, levels, shopId: 'a', fulfilsOnline: true }), 3, 'two held beyond online come from this shop');
    assert.equal(freeAtShop({ stock: 10, held: 4, levels, shopId: 'b', fulfilsOnline: false }), 3);
    assert.equal(freeOnline(10, 1, levels), 1);
    assert.deepEqual([...pausedShops([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { limits: { shops: 2 } })], ['c']);
    assert.deepEqual([...pausedShops([{ id: 'a' }, { id: 'b' }], { limits: {} })], []);
  });
});
