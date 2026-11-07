// In stock and out of stock (6 November 2026, the owner's request): a listing's stock is tracked from posting and
// starts at none; out of stock, nobody can buy it (buy orders, offers; Safe pay in classifieds-safe-pay.test.mjs) and
// it stays live 90 days, then Anjio (the job) takes it off; restocking brings back a listing period. Results show
// those in stock first, and cards and the listing page say whether it is in stock.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let listings;
const day = 86_400_000;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  listings = server.app.get((await import('../dist/classifieds/listings.service.js')).ListingsService);
  const admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_buy_orders']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
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
        ...(method === 'POST' ? { 'idempotency-key': `stock-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `stock${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** A complete draft, with its photos, ready to submit (no stock given unless asked). */
async function draft(seller, title, extra = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const made = await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: area.id, ...extra });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/${made.json.id}-${position}.jpg` })) });
  return made.json;
}

async function live(seller, title, extra = {}) {
  const made = await draft(seller, title, extra);
  const submitted = await seller.post(`/v1/classifieds/listings/${made.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const daysFromNow = iso => (new Date(iso).getTime() - Date.now()) / day;
const notices = (customerId, type) => prisma.notification.findMany({ where: { customerId, type }, orderBy: { createdAt: 'asc' } });

describe('stock', () => {
  test('a new ad starts out of stock; posted at none it is live 90 days, nobody can buy it, then Anjio takes it off', async () => {
    const seller = await customer('Ada Eze');
    const buyer = await customer('Musa Bello');

    const tv = await draft(seller, 'Samsung 43 inch smart TV');
    assert.deepEqual([tv.stock, tv.in_stock, tv.out_of_stock_at, tv.delist_at], [0, false, null, null], 'none until the seller says how many');
    for (const stock of [-1, 100001, 1.5]) assert.equal((await seller.patch(`/v1/classifieds/listings/${tv.id}`, { stock })).json.error?.param, 'stock', String(stock));

    const posted = (await seller.post(`/v1/classifieds/listings/${tv.id}/submit`)).json;
    assert.deepEqual([posted.status, posted.in_stock], ['active', false]);
    assert.ok(posted.out_of_stock_at);
    assert.ok(Math.abs(daysFromNow(posted.delist_at) - 90) < 0.01, 'live 90 days out of stock');
    assert.equal(posted.delist_at, posted.expires_at);

    // The listing page says so, and buying is closed.
    const page = (await buyer.get(`/v1/classifieds/listings/${posted.ref}?country=NG`)).json;
    assert.deepEqual([page.in_stock, page.available, page.reserved], [false, 0, false]);
    const asked = await buyer.post(`/v1/classifieds/listings/${tv.id}/buy-orders`, { price: 24000000 });
    assert.deepEqual([asked.status, asked.json.error.code], [409, 'out_of_stock']);
    const chat = await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Will you have more of these?' });
    assert.equal(chat.status, 201, 'chatting is still open');
    const offer = await buyer.post(`/v1/classifieds/conversations/${chat.json.id}/offers`, { price: 23000000 });
    assert.deepEqual([offer.status, offer.json.error.code], [409, 'out_of_stock']);

    // Renewing needs stock: out of stock, an ad is live 90 days at most.
    assert.equal((await seller.post(`/v1/classifieds/listings/${tv.id}/renew`)).json.error.code, 'restock_required');

    // 90 days on, the job (Anjio) takes it off and tells the seller.
    await prisma.classifiedListing.update({ where: { id: tv.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const ran = await listings.expireDue();
    assert.equal(ran.out_of_stock, 1);
    const off = (await seller.get(`/v1/classifieds/me/listings/${tv.id}`)).json;
    assert.deepEqual([off.status, off.expired_reason, off.delist_at], ['expired', 'out_of_stock', null]);
    const told = await notices(seller.id, 'customer.classifieds.listing_expired');
    assert.equal(told.at(-1).title, 'Anjio took your ad off Udozo');
    assert.equal(told.at(-1).link, `/account/listings/${tv.id}`);

    // Taken off, only its stock may change; restocked and renewed, it is back for a listing period.
    assert.equal((await seller.patch(`/v1/classifieds/listings/${tv.id}`, { title: 'Samsung 43 inch smart TV, new' })).json.error.code, 'listing_closed');
    const restocked = (await seller.patch(`/v1/classifieds/listings/${tv.id}`, { stock: 2 })).json;
    assert.deepEqual([restocked.status, restocked.stock, restocked.in_stock, restocked.out_of_stock_at], ['expired', 2, true, null]);
    const renewed = (await seller.post(`/v1/classifieds/listings/${tv.id}/renew`)).json;
    assert.deepEqual([renewed.status, renewed.expired_reason], ['active', null]);
    assert.ok(Math.abs(daysFromNow(renewed.expires_at) - 30) < 0.01);
    assert.equal((await buyer.post(`/v1/classifieds/listings/${tv.id}/buy-orders`, { price: 24000000 })).status, 201, 'in stock, buyers can buy again');
  });

  test('running out and restocking move the clock; results show those in stock first, and cards say which', async () => {
    const seller = await customer('Bisi Ade');
    const stocked = await live(seller, 'Hisense 50 inch 4K TV', { stock: 2 });
    assert.deepEqual([stocked.in_stock, stocked.delist_at], [true, null]);
    assert.ok(Math.abs(daysFromNow(stocked.expires_at) - 30) < 0.01, 'a listing period');

    const ran = (await seller.patch(`/v1/classifieds/listings/${stocked.id}`, { stock: 0 })).json;
    assert.deepEqual([ran.in_stock, Boolean(ran.out_of_stock_at)], [false, true]);
    assert.ok(Math.abs(daysFromNow(ran.delist_at) - 90) < 0.01, 'running out gives it 90 days');

    const back = (await seller.patch(`/v1/classifieds/listings/${stocked.id}`, { stock: 3 })).json;
    assert.deepEqual([back.in_stock, back.out_of_stock_at, back.delist_at], [true, null, null]);
    assert.ok(daysFromNow(back.expires_at) > 29, 'never less than a listing period');

    // A newer ad out of stock comes after the one in stock, whatever the sort.
    const none = await live(seller, 'Hisense 50 inch TV, wall mount');
    const results = (await storeServer().get('/v1/classifieds/listings?country=NG&q=hisense')).json;
    const order = results.data.map(card => [card.id, card.in_stock]);
    assert.deepEqual(order.filter(([id]) => [stocked.id, none.id].includes(id)), [[stocked.id, true], [none.id, false]]);
  });
});
