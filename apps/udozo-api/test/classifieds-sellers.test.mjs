// Every account's public seller page (`/<cc>/seller/<handle>`): a random handle, never the account's id; only what the
// listings already make public (first name and initial, badges, when they joined), gathered with their live listings'
// categories and states, their sales, how to reach them, and their listings through the search's `seller` filter.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(async () => {
  await server?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `sellers-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, headers: res.headers };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `seller${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function live(seller, title, { category = 'tvs', area = 'gwarinpa', contact = 'both' } = {}) {
  const [cat, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: category } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: area } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: place.id, contact })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

const handleOf = async id => (await prisma.customer.findUniqueOrThrow({ where: { id }, select: { sellerHandle: true } })).sellerHandle;

describe('Seller pages', () => {
  test('every account has a random handle; its page gathers what the listings already show, and nothing more', async () => {
    const seller = await customer('Chinedu Okafor');
    const handle = await handleOf(seller.id);
    assert.match(handle, /^[a-z0-9]{10}$/, 'every account gets a handle');
    assert.notEqual(handle, (await handleOf((await customer('Kemi Adeyemi')).id)), 'each its own');

    const tv = await live(seller, 'Hisense 50 inch TV');
    await live(seller, 'Samsung 43 inch TV', { contact: 'chat' });
    const phone = await live(seller, 'Tecno Spark 20', { category: 'mobile-phones' });
    await prisma.classifiedListing.update({ where: { id: phone.id }, data: { status: 'sold', soldAt: new Date() } });

    const page = await storeServer().get(`/v1/classifieds/sellers/${handle}`);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.headers.get('cache-control'), 'public, max-age=60');
    const profile = page.json;
    assert.deepEqual([profile.object, profile.handle, profile.name, profile.country], ['classified_seller', handle, 'Chinedu O.', 'NG']);
    assert.match(profile.url, new RegExp(`/ng/seller/${handle}$`));
    assert.deepEqual([profile.active_listings, profile.sold_listings, profile.safe_pay_sales], [2, 1, 0]);
    assert.deepEqual(profile.categories.map(item => [item.slug, item.listings]), [['tvs', 2]], 'live listings only, by category');
    assert.ok(profile.categories[0].icon && profile.categories[0].parent?.slug);
    assert.equal(profile.states.length, 1);
    assert.equal(profile.states[0].listings, 2);
    assert.ok(profile.badges.includes('phone_confirmed'));
    assert.deepEqual(profile.contact, { chat: true, phone: true });
    assert.equal(profile.contact_listings.length, 2);
    assert.ok(profile.contact_listings.some(item => item.id === tv.id && item.chat && item.phone));
    assert.ok(profile.contact_listings.some(item => item.title === 'Samsung 43 inch TV' && item.chat && !item.phone), 'a chat-only listing takes no calls');

    const text = JSON.stringify(profile);
    assert.doesNotMatch(text, new RegExp(`${seller.id}|Okafor|@example\\.com|\\+234`), 'no account id, full name, email or phone');

    assert.equal((await storeServer().get('/v1/classifieds/sellers/zzzzzzzzzz')).status, 404);
    assert.equal((await storeServer().get('/v1/classifieds/sellers/NOT-A-HANDLE')).status, 404);
  });

  test('the search lists one seller\'s live listings; their handle is on cards and listing pages', async () => {
    const seller = await customer('Amaka Eze');
    const other = await customer('Bola Tinubu');
    const handle = await handleOf(seller.id);
    const tv = await live(seller, 'LG 55 inch smart TV');
    await live(seller, 'Nokia G21 phone', { category: 'mobile-phones' });
    await live(other, 'Panasonic 32 inch TV');

    const all = await storeServer().get(`/v1/classifieds/listings?country=NG&seller=${handle}`);
    assert.equal(all.status, 200, JSON.stringify(all.json));
    assert.deepEqual(all.json.data.map(card => card.title).sort(), ['LG 55 inch smart TV', 'Nokia G21 phone']);
    assert.ok(all.json.data.every(card => card.seller.handle === handle));
    const tvs = await storeServer().get(`/v1/classifieds/listings?country=NG&seller=${handle}&category=tvs`);
    assert.deepEqual(tvs.json.data.map(card => card.title), ['LG 55 inch smart TV'], 'with a category');
    assert.equal((await storeServer().get('/v1/classifieds/listings?country=NG&seller=zzzzzzzzzz')).json.error.param, 'seller');

    const listing = await storeServer().get(`/v1/classifieds/listings/${tv.ref}?country=NG`);
    assert.equal(listing.json.seller.handle, handle);
  });

  test('a suspended account has no page and no listings by handle', async () => {
    const seller = await customer('Musa Bello');
    const handle = await handleOf(seller.id);
    await live(seller, 'Toshiba 40 inch TV');
    await prisma.customer.update({ where: { id: seller.id }, data: { status: 'disabled' } });
    assert.equal((await storeServer().get(`/v1/classifieds/sellers/${handle}`)).status, 404);
    assert.equal((await storeServer().get(`/v1/classifieds/listings?country=NG&seller=${handle}`)).status, 400);
  });
});
