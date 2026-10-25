// BitoCard Shop, phase 1 step 2c: public reads. Search in one country (full text, typos forgiven, filters on price,
// condition and feature values), local first (the buyer's area, nearby, their state, the country), a listing's public
// page (live, or sold for 30 days, then gone), and suggestions as the buyer types.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
const made = {};

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });

  const seller = await customer('Chinedu Okafor');
  const other = await customer('Amina Bello');
  await prisma.customer.update({ where: { id: other.id }, data: { phone: '+2348031234567', phoneVerifiedAt: new Date() } });
  made.ikeja = await live(seller, { title: 'Samsung Galaxy A54, 128 GB', area: 'ikeja', price: 28000000, features: [['brand', 'Samsung'], ['storage', 128], ['colour', 'Black']] });
  made.ogba = await live(seller, { title: 'iPhone 13, 128 GB, Midnight', area: 'ogba', price: 36500000, features: [['brand', 'Apple'], ['storage', 128], ['colour', 'Black']] });
  made.lekki = await live(other, { title: 'iPhone 14 Pro, 256 GB', area: 'lekki', price: 72000000, condition: 'new', contact: 'both', features: [['brand', 'Apple'], ['storage', 256], ['colour', 'Gold']] });
  made.kano = await live(other, { title: 'Tecno Camon 20, 256 GB', area: 'kano', price: 19000000, features: [['brand', 'Tecno'], ['storage', 256]] });
  made.nationwide = await live(other, { title: 'Infinix Note 30, 64 GB', area: 'kano', price: 15000000, delivery: 'nationwide', features: [['storage', 64]] });
  made.laptop = await live(seller, { title: 'HP EliteBook 840 G5 laptop', area: 'ikeja', price: 31000000, category: 'laptops', features: [['memory', 16], ['storage', 512]] });
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
        ...(method === 'POST' ? { 'idempotency-key': `shop-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `search${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function live(shopper, { title, area, price, condition = 'used', category = 'mobile-phones', delivery = 'none', contact = 'chat', features = [] }) {
  const [cat, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: category } }), prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: area } })]);
  const draft = await shopper.post('/v1/classifieds/listings', {
    title,
    category_id: cat.id,
    area_id: place.id,
    price,
    condition,
    delivery,
    contact,
    description: `${title}. Clean, works perfectly.`,
    features: features.map(([key, value]) => ({ key, value })),
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.json.id, kind: 'photo', position, url: `https://media.test/${draft.json.id}/${position}.jpg`, width: 1600, height: 1200 })) });
  const submitted = await shopper.post(`/v1/classifieds/listings/${draft.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const get = async path => {
  const res = await fetch(`${server.base}${path}`);
  return { status: res.status, json: await res.json(), cache: res.headers.get('cache-control') };
};
const titles = result => result.json.data.map(row => row.title);

describe('search', () => {
  test('words, stems and typos, within one country only', async () => {
    const samsung = await get('/v1/classifieds/listings?country=NG&q=samsung');
    assert.equal(samsung.cache, 'public, max-age=60');
    assert.deepEqual(titles(samsung), ['Samsung Galaxy A54, 128 GB']);
    assert.deepEqual(titles(await get('/v1/classifieds/listings?country=NG&q=samung')), ['Samsung Galaxy A54, 128 GB'], 'a misspelt word still finds it');
    assert.ok(titles(await get('/v1/classifieds/listings?country=NG&q=laptops')).includes('HP EliteBook 840 G5 laptop'), 'plurals match');
    assert.ok(titles(await get('/v1/classifieds/listings?country=NG&q=mobile%20phones')).length >= 5, 'the category name is searched');
    assert.deepEqual(titles(await get('/v1/classifieds/listings?country=NG&q=midnight')), ['iPhone 13, 128 GB, Midnight']);
    assert.deepEqual((await get('/v1/classifieds/listings?country=GH&q=samsung')).json.error.code, 'classifieds_unavailable');
  });

  test('filters: category with its subcategories, price, condition and feature values', async () => {
    assert.equal((await get('/v1/classifieds/listings?country=NG&category=phones-tablets')).json.total, 5);
    assert.equal((await get('/v1/classifieds/listings?country=NG&category=computers')).json.total, 1);
    assert.deepEqual(titles(await get('/v1/classifieds/listings?country=NG&category=mobile-phones&condition=new')), ['iPhone 14 Pro, 256 GB']);
    const range = await get('/v1/classifieds/listings?country=NG&price_min=19000000&price_max=36500000&sort=price_asc');
    assert.deepEqual(titles(range), ['Tecno Camon 20, 256 GB', 'Samsung Galaxy A54, 128 GB', 'HP EliteBook 840 G5 laptop', 'iPhone 13, 128 GB, Midnight']);
    assert.deepEqual(titles(await get('/v1/classifieds/listings?country=NG&f=storage:200..&f=brand:apple,tecno&sort=price_desc')), ['iPhone 14 Pro, 256 GB', 'Tecno Camon 20, 256 GB']);
    assert.deepEqual(titles(await get('/v1/classifieds/listings?country=NG&f=memory:16')), ['HP EliteBook 840 G5 laptop']);
    assert.deepEqual(titles(await get('/v1/classifieds/listings?country=NG&f=colour:black&q=iphone')), ['iPhone 13, 128 GB, Midnight']);
    const bad = await get('/v1/classifieds/listings?country=NG&f=model:iphone');
    assert.deepEqual([bad.status, bad.json.error.param], [400, 'f[0]'], 'only filterable keys');
    assert.equal((await get('/v1/classifieds/listings?country=NG&price_min=5&price_max=1')).json.error.param, 'price_min');
  });

  test("local first from the buyer's area: the area, nearby, the state (and who delivers), then the country", async () => {
    const result = await get('/v1/classifieds/listings?country=NG&category=mobile-phones&area=ikeja');
    assert.deepEqual(
      result.json.data.map(row => [row.title, row.tier, row.delivers_to_you]),
      [
        ['Samsung Galaxy A54, 128 GB', 'area', false],
        ['iPhone 13, 128 GB, Midnight', 'nearby', false],
        ['Infinix Note 30, 64 GB', 'state', true],
        ['iPhone 14 Pro, 256 GB', 'state', false],
        ['Tecno Camon 20, 256 GB', 'country', false],
      ].sort((a, b) => ['area', 'nearby', 'state', 'country'].indexOf(a[1]) - ['area', 'nearby', 'state', 'country'].indexOf(b[1])),
    );
    assert.deepEqual(result.json.tiers, { area: 1, nearby: 1, state: 2, country: 1 });
    const kano = await get('/v1/classifieds/listings?country=NG&category=mobile-phones&state=kano');
    assert.deepEqual(kano.json.data.slice(0, 2).map(row => row.tier), ['state', 'state'], 'a state alone ranks its own listings first');
    assert.equal((await get('/v1/classifieds/listings?country=NG')).json.tiers, null, 'no place chosen: no tiers');
    assert.equal((await get('/v1/classifieds/listings?country=NG&area=nowhere')).json.error.param, 'area');
  });

  test('cards carry what a buyer scans: price, cover, place and badges, never a full name or a phone', async () => {
    const [card] = (await get('/v1/classifieds/listings?country=NG&q=samsung')).json.data;
    assert.equal(card.url, `https://shop.bitocard.com/ng/l/${made.ikeja.ref}-samsung-galaxy-a54-128-gb`);
    assert.deepEqual(card.price, { kind: 'fixed', amount: 28000000, currency: 'NGN' });
    assert.deepEqual([card.cover.url.endsWith('/0.jpg'), card.photo_count, card.area.name, card.area.state.name], [true, 4, 'Ikeja', 'Lagos']);
    assert.deepEqual(card.seller, { name: 'Chinedu O.', badges: [] });
    const amina = (await get('/v1/classifieds/listings?country=NG&q=tecno')).json.data[0];
    assert.deepEqual(amina.seller.badges, ['phone_confirmed']);
    assert.ok(!JSON.stringify(amina).includes('2348031234567'));
  });
});

describe('a listing page', () => {
  test('everything a buyer needs, features in the category order, the checklist, contact options', async () => {
    const page = await get(`/v1/classifieds/listings/${made.lekki.ref}?country=NG`);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.deepEqual(page.json.features.map(f => f.key), ['brand', 'storage', 'colour'], "the category's order");
    assert.deepEqual(page.json.features.find(f => f.key === 'storage'), { key: 'storage', name: 'Storage (ROM)', icon: 'hard-drive', unit: 'GB', value: 256 });
    assert.match(page.json.category.safety_checklist.join(' '), /IMEI/);
    assert.deepEqual(page.json.contact, { chat: true, phone: true }, 'the phone is offered (revealed later), never shown here');
    assert.ok(!JSON.stringify(page.json).includes('2348031234567'));
    assert.equal(page.json.seller.active_listings, 3);
    assert.equal((await get(`/v1/classifieds/listings/${made.ikeja.ref}?country=NG`)).json.contact.phone, false);
    assert.equal((await get(`/v1/classifieds/listings/${made.lekki.ref}?country=GH`)).status, 403, 'another country');
  });

  test('drafts are not found; sold listings show for 30 days, then they and closed ones are gone', async () => {
    const shopper = await customer('Bola Ade');
    const draft = (await shopper.post('/v1/classifieds/listings', { title: 'Unfinished draft listing' })).json;
    assert.equal((await get(`/v1/classifieds/listings/${draft.ref}?country=NG`)).status, 404);
    const sold = await live(shopper, { title: 'Nokia 3310, classic', area: 'yaba', price: 1500000 });
    await shopper.post(`/v1/classifieds/listings/${sold.id}/sold`);
    const page = await get(`/v1/classifieds/listings/${sold.ref}?country=NG`);
    assert.deepEqual([page.status, page.json.status], [200, 'sold']);
    assert.ok(!titles(await get('/v1/classifieds/listings?country=NG&q=nokia')).length, 'sold listings leave the results');
    await prisma.classifiedListing.update({ where: { id: sold.id }, data: { soldAt: new Date(Date.now() - 31 * 86_400_000) } });
    const old = await get(`/v1/classifieds/listings/${sold.ref}?country=NG`);
    assert.deepEqual([old.status, old.json.error.code], [410, 'listing_gone']);
    await prisma.classifiedListing.update({ where: { id: made.kano.id }, data: { status: 'removed' } });
    assert.equal((await get(`/v1/classifieds/listings/${made.kano.ref}?country=NG`)).status, 410);
    await prisma.classifiedListing.update({ where: { id: made.kano.id }, data: { status: 'active' } });
  });
});

describe('suggestions', () => {
  test('categories and live titles as the buyer types', async () => {
    const iphone = await get('/v1/classifieds/search/suggest?country=NG&q=iphone');
    assert.deepEqual(iphone.json.queries.sort(), ['iPhone 13, 128 GB, Midnight', 'iPhone 14 Pro, 256 GB']);
    const phones = await get('/v1/classifieds/search/suggest?country=NG&q=phone');
    assert.ok(phones.json.categories.some(c => c.slug === 'mobile-phones'));
    assert.deepEqual((await get('/v1/classifieds/search/suggest?country=NG&q=x')).json.queries, []);
  });
});
