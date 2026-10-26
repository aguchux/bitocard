// B2B reselling, stage 1 (docs/BITOCARD_B2B_RESELLING_PLAN.md): a listing's channels (BitoCard Shop, resellers or
// both) and resale terms within BitoCard's limits per country, suppliers ready before opening listings to resellers,
// resale-only listings kept off BitoCard Shop everywhere, and stock shared by every Safe pay order.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let prisma;
let admin;
let services;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  services = {
    ledger: server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService),
    house: server.app.get((await import('../dist/checkout/house.service.js')).HouseService),
  };
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
});

after(async () => {
  // Leave the switches as they were for the files that follow (Docker runs share one database).
  await admin?.put('/v1/admin/switches/classifieds_resale', { country_code: 'NG', enabled: null });
  await admin?.put('/v1/admin/switches/classifieds_safe_pay', { country_code: 'NG', enabled: null });
  server?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `resale-${Date.now()}-${Math.random()}` } : {}),
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
async function customer(name) {
  const shopper = storeServer();
  const email = `resale${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  shopper.name = name;
  return shopper;
}

/** Identity checked and a payout bank account (live). */
async function ready(seller) {
  const house = await services.house.resellerFor('NG');
  await prisma.identityVerification.create({
    data: { subject: 'customer', resellerId: house.id, mode: 'live', customerReference: seller.id, method: 'document', provider: 'test', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: seller.name },
  });
  await prisma.customerBankAccount.create({
    data: { customerId: seller.id, mode: 'live', country: 'NG', currency: 'NGN', bankCode: '044', bankName: 'Access Bank', accountNumberEncrypted: 'sealed', accountNumberLast4: '6789', accountName: seller.name, payoutsFrom: new Date() },
  });
}

async function fund(buyer, amount) {
  await services.ledger.post({
    mode: 'live',
    type: 'adjustment',
    reference: `test-fund:${randomUUID()}`,
    description: 'Test top-up',
    lines: [
      { account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) },
      { account: { kind: 'customer_wallet', currency: 'NGN', customerId: buyer.id }, credit: BigInt(amount) },
    ],
  });
}

/** A draft with everything a listing needs, and its four photos. */
async function draft(seller, title, extra = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const made = await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'new', category_id: cat.id, area_id: area.id, ...extra });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/${made.json.id}-${position}.jpg` })) });
  return made.json;
}

const resaleTerms = { resale: true, resale_discount_bps: 1000, resale_markup_max_bps: 3000 };

describe('resale: BitoCard limits and the switch', () => {
  test('closed until the switch is on and finance sets the reseller fee; terms outside the limits are refused', async () => {
    const seller = await customer('Chinedu Okafor');
    const closed = (await seller.get('/v1/classifieds/me/resale')).json;
    assert.deepEqual([closed.open, closed.reason, closed.discount_min_bps, closed.discount_max_bps, closed.markup_max_bps], [false, 'switch_off', 500, 5000, 3000], 'the defaults');

    for (const [terms, code] of [
      [{ ...resaleTerms, resale_discount_bps: 100 }, 'resale_discount_out_of_range'],
      [{ ...resaleTerms, resale_discount_bps: 6000 }, 'resale_discount_out_of_range'],
      [{ ...resaleTerms, resale_markup_max_bps: 9000 }, 'resale_markup_out_of_range'],
      [{ resale: true }, 'resale_discount_out_of_range'],
      [{ ...resaleTerms, price_kind: 'on_request', price: null }, 'resale_price_required'],
      [{ on_shop: false }, 'channel_required'],
    ]) {
      const refused = await seller.post('/v1/classifieds/listings', { title: 'Hisense 50 inch TV', ...terms });
      assert.equal(refused.json.error?.code, code, JSON.stringify(terms));
    }
    const listing = await draft(seller, 'Hisense 50 inch TV', resaleTerms);
    assert.deepEqual(listing.resale, { enabled: true, discount_bps: 1000, markup_max_bps: 3000, paused: false });
    assert.equal(listing.on_shop, true);
    await ready(seller);
    assert.equal((await seller.post(`/v1/classifieds/listings/${listing.id}/submit`)).json.error.code, 'resale_unavailable', 'the switch is off');

    assert.equal((await admin.put('/v1/admin/switches/classifieds_resale', { country_code: 'NG', enabled: true })).status, 200);
    assert.equal((await seller.get('/v1/classifieds/me/resale')).json.reason, 'not_set_up', 'the reseller fee is not set yet');
    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/classifieds/resale-settings/NG', { reseller_fee_bps: 300 })).status, 403, 'finance sets it');
    assert.equal((await admin.put('/v1/admin/classifieds/resale-settings/NG', { discount_min_bps: 6000 })).json.error.param, 'discount_min_bps', 'smallest above largest');
    assert.equal((await admin.put('/v1/admin/classifieds/resale-settings/NG', { markup_max_bps: 15000 })).json.error.param, 'markup_max_bps', 'never above the markup cap');
    const set = await admin.put('/v1/admin/classifieds/resale-settings/NG', { reseller_fee_bps: 300, reseller_fee_cap: 500000 });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual([set.json.open, set.json.reseller_fee_bps, set.json.reseller_fee_cap, set.json.markup_cap_bps], [true, 300, 500000, 10000]);
    assert.ok(await prisma.auditLog.count({ where: { action: 'classifieds.resale_settings_changed' } }));

    const open = (await seller.get('/v1/classifieds/me/resale')).json;
    assert.deepEqual([open.open, open.ready, open.identity_checked, open.payout_account], [true, true, true, true]);
    const live = (await seller.post(`/v1/classifieds/listings/${listing.id}/submit`)).json;
    assert.equal(live.status, 'active', JSON.stringify(live));
  });

  test("a supplier opens listings to resellers only once their identity is checked and they have a payout account", async () => {
    const seller = await customer('Ngozi Obi');
    assert.deepEqual(((await seller.get('/v1/classifieds/me/resale')).json).ready, false);
    const resold = await draft(seller, 'Sony 55 inch TV', resaleTerms);
    const refused = await seller.post(`/v1/classifieds/listings/${resold.id}/submit`);
    assert.equal(refused.json.error.code, 'supplier_not_ready');

    // A live Shop listing cannot be opened to resellers later either.
    const plain = await draft(seller, 'Samsung soundbar');
    assert.equal((await seller.post(`/v1/classifieds/listings/${plain.id}/submit`)).json.status, 'active');
    assert.equal((await seller.patch(`/v1/classifieds/listings/${plain.id}`, resaleTerms)).json.error.code, 'supplier_not_ready');
    await ready(seller);
    const opened = await seller.patch(`/v1/classifieds/listings/${plain.id}`, resaleTerms);
    assert.equal(opened.json.resale.enabled, true, JSON.stringify(opened.json));
    assert.equal((await seller.patch(`/v1/classifieds/listings/${plain.id}`, { resale_discount_bps: 9000 })).json.error.code, 'resale_discount_out_of_range', 'terms stay inside the limits');
    assert.equal((await seller.patch(`/v1/classifieds/listings/${plain.id}`, { resale_paused: true })).json.resale.paused, true);
  });
});

describe('resale-only listings are never on BitoCard Shop', () => {
  test('no page, search result, count, sitemap entry, chat, phone, saving or Safe pay', async () => {
    const seller = await customer('Bola Ade');
    await ready(seller);
    const buyer = await customer('Kemi Adeyemi');
    const listing = await draft(seller, 'Panasonic wholesale TV lot', { ...resaleTerms, on_shop: false });
    const live = (await seller.post(`/v1/classifieds/listings/${listing.id}/submit`)).json;
    assert.deepEqual([live.status, live.on_shop, live.url], ['active', false, null], JSON.stringify(live));

    const get = async path => {
      const res = await fetch(`${server.base}${path}`);
      return { status: res.status, json: await res.json() };
    };
    assert.equal((await get(`/v1/classifieds/listings/${live.ref}?country=NG`)).status, 404, 'no page on the Shop');
    const search = (await get('/v1/classifieds/listings?country=NG&q=panasonic%20wholesale')).json;
    assert.ok(!search.data.some(card => card.id === listing.id), 'not in search');
    assert.ok(!(await get('/v1/classifieds/search/suggest?country=NG&q=panasonic')).json.queries.some(title => /wholesale/i.test(title)), 'not suggested');
    const sitemap = (await get('/v1/classifieds/sitemap?country=NG')).json;
    assert.ok(!sitemap.listings.some(row => row.ref === live.ref), 'not in the sitemap');

    assert.equal((await buyer.post('/v1/classifieds/conversations', { listing_id: listing.id, body: 'Hello' })).status, 404, 'no chat');
    assert.equal((await buyer.post(`/v1/classifieds/listings/${listing.id}/phone`)).status, 404, 'no phone');
    assert.equal((await buyer.post('/v1/classifieds/favourites', { listing_id: listing.id })).status, 404, 'not saved');
    assert.equal((await buyer.get(`/v1/classifieds/listings/${listing.id}/viewer`)).status, 404);
    assert.notEqual((await buyer.get(`/v1/classifieds/listings/${listing.id}/safe-pay`)).status, 200, 'no Safe pay on the Shop');

    // On the Shop too, it shows like any listing.
    const both = await seller.patch(`/v1/classifieds/listings/${listing.id}`, { on_shop: true });
    assert.equal(both.json.on_shop, true);
    assert.equal((await get(`/v1/classifieds/listings/${live.ref}?country=NG`)).status, 200);
    assert.equal((await seller.patch(`/v1/classifieds/listings/${listing.id}`, { on_shop: false, resale: false })).json.error.code, 'channel_required');
  });
});

describe('stock', () => {
  test('units sell to as many buyers as there are; each release takes one, the last sells the listing', async () => {
    assert.equal((await admin.put('/v1/admin/switches/classifieds_safe_pay', { country_code: 'NG', enabled: true })).status, 200);
    assert.equal((await admin.put('/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150, buyer_fee_cap: 100000, seller_fee_bps: 200, seller_fee_cap: 500000, new_seller_order_limit: 1_000_000_000 })).status, 200);
    const seller = await customer('Tunde Bakare');
    await ready(seller);
    const listing = await draft(seller, 'Infinix 32 inch TV', { stock: 2 });
    assert.equal(listing.stock, 2);
    assert.equal((await seller.post(`/v1/classifieds/listings/${listing.id}/submit`)).json.status, 'active');
    assert.equal((await seller.patch(`/v1/classifieds/listings/${listing.id}`, { stock: 0 })).status, 400, 'at least one');

    const buyers = [await customer('Kemi Adeyemi'), await customer('Musa Bello'), await customer('Ada Eze')];
    const orders = [];
    for (const buyer of buyers) {
      const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json;
      assert.equal(order.status, 'requested', JSON.stringify(order));
      assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/accept`)).json.status, 'awaiting_payment');
      await fund(buyer, order.total);
      orders.push(order);
    }
    assert.equal((await buyers[0].post(`/v1/classifieds/orders/${orders[0].id}/pay`)).json.status, 'paid');
    assert.deepEqual(
      (({ available, reserved }) => [available, reserved])((await buyers[2].get(`/v1/classifieds/listings/${listing.id}/safe-pay`)).json),
      [1, false],
      'one unit left',
    );
    assert.equal((await buyers[1].post(`/v1/classifieds/orders/${orders[1].id}/pay`)).json.status, 'paid', 'the second unit');
    // Both units held: the third buyer's request ends.
    assert.deepEqual([(await buyers[2].get(`/v1/classifieds/orders/${orders[2].id}`)).json.status], ['cancelled']);
    assert.equal((await seller.patch(`/v1/classifieds/listings/${listing.id}`, { stock: 1 })).json.error.code, 'stock_below_held', 'two are paid for');

    const release = async (buyer, order) => {
      const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
      assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/release`, { code })).json.status, 'released');
    };
    await release(buyers[0], orders[0]);
    let row = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: listing.id } });
    assert.deepEqual([row.stock, row.status], [1, 'active'], 'one sold, one still held');
    await release(buyers[1], orders[1]);
    row = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: listing.id } });
    assert.deepEqual([row.stock, row.status], [0, 'sold'], 'the last unit sells the listing');
  });

  test('two buyers paying for the last unit at once: one pays, the other is refused and keeps their money', async () => {
    const seller = await customer('Femi Ade');
    await ready(seller);
    const listing = await draft(seller, 'TCL 40 inch TV', { stock: 1 });
    assert.equal((await seller.post(`/v1/classifieds/listings/${listing.id}/submit`)).json.status, 'active');
    const pair = [await customer('Kemi Adeyemi'), await customer('Musa Bello')];
    const orders = [];
    for (const buyer of pair) {
      const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json;
      await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
      await fund(buyer, order.total);
      orders.push(order);
    }
    const results = await Promise.all(pair.map((buyer, index) => buyer.post(`/v1/classifieds/orders/${orders[index].id}/pay`)));
    // The loser is refused: the unit is taken, or (once the winner's payment closed their request) their order changed.
    assert.equal(results.filter(result => result.json.status === 'paid').length, 1, JSON.stringify(results));
    const loser = results.findIndex(result => result.json.status !== 'paid');
    assert.ok(['listing_reserved', 'order_changed'].includes(results[loser].json.error?.code), JSON.stringify(results[loser].json));
    const wallet = await prisma.ledgerAccount.findFirst({ where: { kind: 'customer_wallet', mode: 'live', currency: 'NGN', customerId: pair[loser].id } });
    assert.equal(wallet.balanceMinor, BigInt(orders[loser].total), 'the loser keeps their money');
    assert.equal(await prisma.classifiedOrder.count({ where: { listingId: listing.id, status: 'paid' } }), 1);
  });
});
