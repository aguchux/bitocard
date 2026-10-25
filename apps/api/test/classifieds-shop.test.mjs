// BitoCard Shop, phase 1 step 7: what shop.bitocard.com reads besides search. The open markets, the price-free global
// showcase (from the second market), each country's sitemap data, feature highlights on cards, and what a signed-in
// buyer already has with a listing.
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

  made.seller = await customer('Chinedu Okafor');
  made.buyer = await customer('Kemi Adeyemi');
  made.phone = await live(made.seller, { title: 'Samsung Galaxy A54, 128 GB', area: 'ikeja', features: [['brand', 'Samsung'], ['storage', 128], ['colour', 'Black']] });
  made.laptop = await live(made.seller, { title: 'HP EliteBook 840 G5', area: 'yaba', category: 'laptops', features: [['memory', 16], ['storage', 512]] });
  made.sold = await live(made.seller, { title: 'Nokia 3310, classic', area: 'ikeja' });
  assert.equal((await made.seller.post(`/v1/classifieds/listings/${made.sold.id}/sold`)).status, 200);
});

after(async () => {
  // Leave Ghana and Nigeria's Safe pay as they were for the files that follow (Docker runs share one database).
  await admin?.put('/v1/admin/switches/classifieds', { country_code: 'GH', enabled: null });
  await admin?.put('/v1/admin/switches/classifieds_safe_pay', { country_code: 'NG', enabled: null });
  if (made.fees) await prisma.classifiedSafePaySettings.update({ where: { country: 'NG' }, data: made.fees });
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
        ...(method === 'POST' ? { 'idempotency-key': `shop-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

let counter = 0;
async function customer(name, country = 'NG') {
  const shopper = storeServer();
  const email = `shopdir${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  // The BitoCard Shop terms, accepted before posting or Safe pay.
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function live(shopper, { title, area, country = 'NG', price = 25000000, category = 'mobile-phones', features = [] }) {
  const [cat, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: category } }), prisma.classifiedArea.findFirstOrThrow({ where: { country, kind: 'area', slug: area } })]);
  const draft = await shopper.post('/v1/classifieds/listings', {
    title,
    category_id: cat.id,
    area_id: place.id,
    price,
    condition: 'used',
    delivery: 'none',
    contact: 'chat',
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

/** Every key anywhere in a JSON value. */
const keys = value => (Array.isArray(value) ? value.flatMap(keys) : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)]) : []);

describe('cards', () => {
  test("carry the listing's number, slug, country and its first feature values in the category's order", async () => {
    const result = await get('/v1/classifieds/listings?country=NG&q=samsung');
    const card = result.json.data.find(row => row.id === made.phone.id);
    assert.equal(card.slug, 'samsung-galaxy-a54-128-gb');
    assert.equal(card.country, 'NG');
    assert.equal(card.highlights.length, 3);
    assert.ok(card.highlights.includes('128 GB') && card.highlights.includes('Samsung'), JSON.stringify(card.highlights));
    const laptop = (await get('/v1/classifieds/listings?country=NG&category=laptops')).json.data.find(row => row.id === made.laptop.id);
    assert.ok(laptop.highlights.includes('16 GB'), JSON.stringify(laptop.highlights));
  });
});

describe('markets and the global showcase', () => {
  test('one market: listed with its live listings, and no showcase', async () => {
    const markets = await get('/v1/classifieds/markets');
    assert.equal(markets.cache, 'public, max-age=60');
    const ng = markets.json.data.find(row => row.country === 'NG');
    assert.deepEqual([ng.name, ng.currency], ['Nigeria', 'NGN']);
    const before = await prisma.classifiedSafePaySettings.findUniqueOrThrow({ where: { country: 'NG' } });
    made.fees = { buyerFeeBps: before.buyerFeeBps, buyerFeeCapMinor: before.buyerFeeCapMinor, sellerFeeBps: before.sellerFeeBps, sellerFeeCapMinor: before.sellerFeeCapMinor };
    assert.equal((await admin.put('/v1/admin/switches/classifieds_safe_pay', { country_code: 'NG', enabled: false })).status, 200);
    assert.equal((await get('/v1/classifieds/markets')).json.data.find(row => row.country === 'NG').safe_pay, false, 'Safe pay is not open until its switch is on');
    assert.equal((await admin.put('/v1/admin/switches/classifieds_safe_pay', { country_code: 'NG', enabled: true })).status, 200);
    await prisma.classifiedSafePaySettings.update({ where: { country: 'NG' }, data: { buyerFeeBps: null } });
    assert.equal((await get('/v1/classifieds/markets')).json.data.find(row => row.country === 'NG').safe_pay, false, 'nor until both fees are set');
    await prisma.classifiedSafePaySettings.update({ where: { country: 'NG' }, data: { buyerFeeBps: 150, buyerFeeCapMinor: 100000n, sellerFeeBps: 200, sellerFeeCapMinor: 500000n } });
    assert.equal((await get('/v1/classifieds/markets')).json.data.find(row => row.country === 'NG').safe_pay, true);
    assert.ok(ng.listings >= 2);
    assert.equal(markets.json.showcase, markets.json.data.length >= 2);
    if (!markets.json.showcase) assert.equal((await get('/v1/classifieds/showcase')).json.error.code, 'showcase_unavailable');
  });

  test('from the second market: countries, categories and listings across them, never a price', async () => {
    assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'GH', enabled: true })).status, 200);
    await prisma.classifiedMarketSettings.upsert({ where: { country: 'GH' }, create: { country: 'GH', firstListingsReviewed: 0 }, update: { firstListingsReviewed: 0 } });
    const phones = await prisma.classifiedCategory.findMany({ where: { slug: { in: ['phones-tablets', 'mobile-phones'] } } });
    for (const category of phones) await prisma.classifiedCategoryCountry.upsert({ where: { categoryId_country: { categoryId: category.id, country: 'GH' } }, create: { categoryId: category.id, country: 'GH' }, update: { enabled: true } });
    const state =
      (await prisma.classifiedArea.findFirst({ where: { country: 'GH', kind: 'state', slug: 'greater-accra' } })) ??
      (await prisma.classifiedArea.create({ data: { country: 'GH', kind: 'state', slug: 'greater-accra', name: 'Greater Accra', latitude: 5.6, longitude: -0.19 } }));
    if (!(await prisma.classifiedArea.findFirst({ where: { country: 'GH', kind: 'area', slug: 'osu' } }))) {
      await prisma.classifiedArea.create({ data: { country: 'GH', kind: 'area', parentId: state.id, slug: 'osu', name: 'Osu', latitude: 5.556, longitude: -0.18 } });
    }
    const ghana = await customer('Kwame Mensah', 'GH');
    const ghanaPhone = await live(ghana, { title: 'iPhone 12, 64 GB', area: 'osu', country: 'GH', price: 450000, features: [['brand', 'Apple']] });

    const markets = await get('/v1/classifieds/markets');
    assert.ok(['GH', 'NG'].every(code => markets.json.data.some(row => row.country === code)));
    assert.equal(markets.json.showcase, true);

    const showcase = await get('/v1/classifieds/showcase');
    assert.equal(showcase.status, 200, JSON.stringify(showcase.json));
    assert.ok(!keys(showcase.json).includes('price'), 'no prices anywhere in the showcase');
    const recent = showcase.json.recent.map(card => card.id);
    assert.ok(recent.includes(ghanaPhone.id) && recent.includes(made.phone.id));
    assert.equal(showcase.json.recent.find(card => card.id === ghanaPhone.id).country, 'GH');
    assert.ok(!recent.includes(made.sold.id), 'sold listings are not shown');
    const phonesRow = showcase.json.categories.find(row => row.slug === 'phones-tablets');
    assert.deepEqual(phonesRow.countries.filter(code => ['GH', 'NG'].includes(code)), ['GH', 'NG']);
    assert.equal(phonesRow.listings.GH, 1);
    assert.equal(showcase.json.sections, null);

    const category = await get('/v1/classifieds/showcase?category=phones-tablets');
    const sections = Object.fromEntries(category.json.sections.map(section => [section.country, section]));
    assert.deepEqual(sections.GH.cards.map(card => card.id), [ghanaPhone.id]);
    assert.equal(sections.GH.listings, 1);
    assert.ok(sections.NG.cards.some(card => card.id === made.phone.id));
    assert.ok(!sections.NG.cards.some(card => card.id === made.laptop.id), 'only that category');
    assert.ok(!keys(category.json).includes('price'));
    assert.equal((await get('/v1/classifieds/showcase?category=no-such-thing')).status, 404);
  });
});

describe('sitemap data', () => {
  test("a country's categories and places with their counts, and its listings a page at a time", async () => {
    const sitemap = await get('/v1/classifieds/sitemap?country=ng');
    assert.equal(sitemap.status, 200, JSON.stringify(sitemap.json));
    assert.equal(sitemap.cache, 'public, max-age=300');
    const count = slug => sitemap.json.categories.find(row => row.slug === slug)?.listings;
    assert.ok(count('mobile-phones') >= 1 && count('laptops') >= 1);
    assert.ok(count('phones-tablets') >= count('mobile-phones'), 'a top category counts its subcategories');
    const lagos = sitemap.json.places.find(row => row.state === 'lagos' && row.area === null);
    const ikeja = sitemap.json.places.find(row => row.state === 'lagos' && row.area === 'ikeja');
    assert.ok(lagos.listings >= ikeja.listings && ikeja.listings >= 1);
    const refs = sitemap.json.listings.map(row => row.ref);
    assert.ok(refs.includes(made.phone.ref) && refs.includes(made.sold.ref), 'live and recently sold listings');
    assert.deepEqual([...refs].sort((a, b) => a - b), refs);
    assert.ok(sitemap.json.listings.every(row => row.slug && row.updated_at));
    assert.equal(sitemap.json.next_after, null);
    const later = await get(`/v1/classifieds/sitemap?country=NG&after=${made.phone.ref}`);
    assert.ok(!later.json.listings.some(row => row.ref <= made.phone.ref));
    assert.equal((await get('/v1/classifieds/sitemap?country=KE')).json.error.code, 'classifieds_unavailable');
  });
});

describe('the signed-in viewer of a listing', () => {
  test('saved, a chat, own listings, and whether they can contact the seller', async () => {
    const { buyer, seller, phone } = made;
    const fresh = await buyer.get(`/v1/classifieds/listings/${phone.id}/viewer`);
    assert.equal(fresh.status, 200, JSON.stringify(fresh.json));
    assert.deepEqual(
      { own: fresh.json.own, favourite: fresh.json.favourite, conversation_id: fresh.json.conversation_id, order: fresh.json.order, can_contact: fresh.json.can_contact },
      { own: false, favourite: false, conversation_id: null, order: null, can_contact: true },
    );
    assert.equal((await buyer.post('/v1/classifieds/favourites', { listing_id: phone.id })).status, 200);
    const chat = await buyer.post('/v1/classifieds/conversations', { listing_id: phone.id, body: 'Is it still available?' });
    assert.equal(chat.status, 201, JSON.stringify(chat.json));
    const after = (await buyer.get(`/v1/classifieds/listings/${phone.id}/viewer`)).json;
    assert.deepEqual([after.favourite, after.conversation_id], [true, chat.json.id]);

    const mine = (await seller.get(`/v1/classifieds/listings/${phone.id}/viewer`)).json;
    assert.deepEqual([mine.own, mine.can_contact, mine.conversation_id], [true, false, null]);
    const sold = (await buyer.get(`/v1/classifieds/listings/${made.sold.id}/viewer`)).json;
    assert.equal(sold.can_contact, false, 'a sold listing takes no new contact');
    const signedOut = await fetch(`${server.base}/v1/classifieds/listings/${phone.id}/viewer`);
    assert.equal(signedOut.status, 401);
    assert.equal((await buyer.get('/v1/classifieds/listings/00000000-0000-4000-8000-000000000000/viewer')).status, 404);
  });
});
