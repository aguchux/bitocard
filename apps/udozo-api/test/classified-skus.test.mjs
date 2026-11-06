// Listing SKUs on Udozo: every category has a three-letter prefix, and every ad its category's prefix and next number
// (PHN-000123), given as soon as it has a category and again in a new category it moves to; buyers and admins find an ad
// by its SKU; admins change a category's prefix without touching SKUs given, and a prefix once used stays its category's.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let admin;
let support;
let prisma;
let seller;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.upsert({ where: { country: 'NG' }, create: { country: 'NG', firstListingsReviewed: 0, monthlyListingLimit: 100 }, update: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
  seller = await customer('Ada Nwosu');
});

after(async () => {
  await admin?.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: null });
  server?.close();
});

function shopper() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(['POST', 'PATCH'].includes(method) ? { 'idempotency-key': `skus-${Date.now()}-${Math.random()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

async function customer(name) {
  const person = shopper();
  const email = `skus-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, person);
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  person.id = signup.json.customer.id;
  return person;
}

const category = slug => prisma.classifiedCategory.findUniqueOrThrow({ where: { slug } });
const draft = async (slug, title = 'Samsung Galaxy A15 128GB') => {
  const made = await seller.post('/v1/classifieds/listings', { title, ...(slug ? { category_id: (await category(slug)).id } : {}) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json;
};

describe('the prefixes', () => {
  test('every category has its own three letters', async () => {
    const rows = await prisma.classifiedCategory.findMany({ select: { slug: true, skuPrefix: true } });
    assert.equal(rows.length, 120);
    assert.ok(rows.every(row => /^[A-Z]{3}$/.test(row.skuPrefix)));
    assert.equal(new Set(rows.map(row => row.skuPrefix)).size, rows.length);
    const bySlug = Object.fromEntries(rows.map(row => [row.slug, row.skuPrefix]));
    assert.deepEqual([bySlug['mobile-phones'], bySlug.cars, bySlug.laptops, bySlug['houses-for-rent']], ['PHN', 'CAR', 'LAP', 'RNT']);
    const listed = await support.get('/v1/admin/classifieds/categories?country=NG');
    assert.equal(listed.json.data.find(item => item.slug === 'phones-tablets').children.find(item => item.slug === 'mobile-phones').sku_prefix, 'PHN');
  });
});

describe('listing SKUs', () => {
  test("an ad takes its category's prefix and next number, and a new one in a category it moves to", async () => {
    const first = await draft('mobile-phones');
    const second = await draft('mobile-phones');
    assert.match(first.sku, /^PHN-\d{6}$/);
    assert.equal(Number(second.sku.slice(4)), Number(first.sku.slice(4)) + 1, 'numbered in its category');
    const none = await draft(null);
    assert.equal(none.sku, null, 'no category, no SKU yet');
    const given = await seller.patch(`/v1/classifieds/listings/${none.id}`, { category_id: (await category('tablets')).id });
    assert.match(given.json.sku, /^TAB-\d{6}$/);
    const moved = await seller.patch(`/v1/classifieds/listings/${first.id}`, { category_id: (await category('smart-watches')).id });
    assert.match(moved.json.sku, /^SWT-\d{6}$/);
    const unchanged = await seller.patch(`/v1/classifieds/listings/${second.id}`, { title: 'Samsung Galaxy A15 128GB, boxed' });
    assert.equal(unchanged.json.sku, second.sku, 'other changes keep it');
    assert.equal((await seller.get(`/v1/classifieds/me/listings/${second.id}`)).json.sku, second.sku);
  });

  test('two ads made at once never share one', async () => {
    const made = await Promise.all(Array.from({ length: 6 }, () => draft('laptops', 'HP EliteBook 840 G5')));
    assert.equal(new Set(made.map(item => item.sku)).size, 6);
  });

  test('buyers and admins find an ad by its SKU, however it is typed', async () => {
    const [category, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'cars' } }), prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } })]);
    const made = await seller.post('/v1/classifieds/listings', { title: 'Toyota Corolla 2014 LE', category_id: category.id, area_id: place.id, price: 650000000, condition: 'used', delivery: 'none', contact: 'chat', description: 'Toyota Corolla 2014 LE. Clean, first body, works perfectly.', features: [{ key: 'brand', value: 'Toyota' }] });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/${made.json.id}/${position}.jpg`, width: 1600, height: 1200 })) });
    await prisma.classifiedListing.updateMany({ where: { customerId: seller.id, NOT: { id: made.json.id } }, data: { submittedAt: new Date(Date.now() - 86_400_000) } });
    const live = await seller.post(`/v1/classifieds/listings/${made.json.id}/submit`);
    assert.equal(live.json.status, 'active', JSON.stringify(live.json));
    const sku = live.json.sku;
    assert.match(sku, /^CAR-\d{6}$/);

    const page = await shopper().get(`/v1/classifieds/listings/${live.json.ref}?country=NG`);
    assert.equal(page.json.sku, sku);
    for (const typed of [sku, sku.toLowerCase(), sku.replace('-', ''), `car-${Number(sku.slice(4))}`]) {
      const found = await shopper().get(`/v1/classifieds/listings?country=NG&q=${encodeURIComponent(typed)}`);
      assert.equal(found.status, 200, JSON.stringify(found.json));
      assert.equal(found.json.data[0]?.ref, live.json.ref, `searching ${typed}`);
    }
    const listed = await support.get(`/v1/admin/classifieds/listings?q=${encodeURIComponent(sku.toLowerCase())}`);
    assert.deepEqual(listed.json.data.map(item => item.sku), [sku]);
  });
});

describe('changing a prefix', () => {
  test('new ads take the new prefix, given SKUs keep theirs, and a used prefix stays its category’s', async () => {
    const shoes = await category('shoes');
    const before = await draft('shoes', 'Nike Air Force 1 size 43');
    assert.match(before.sku, /^SHO-/);
    assert.equal((await support.patch(`/v1/admin/classifieds/categories/${shoes.id}`, { sku_prefix: 'SNK' })).status, 403, 'support only looks');
    const changed = await admin.patch(`/v1/admin/classifieds/categories/${shoes.id}`, { sku_prefix: 'snk' });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal(changed.json.sku_prefix, 'SNK');
    const after = await draft('shoes', 'Adidas Samba size 42');
    assert.equal(after.sku, `SNK-${String(Number(before.sku.slice(4)) + 1).padStart(6, '0')}`, 'the count goes on');
    assert.equal((await seller.get(`/v1/classifieds/me/listings/${before.id}`)).json.sku, before.sku);

    const bags = await category('bags');
    const taken = await admin.patch(`/v1/admin/classifieds/categories/${bags.id}`, { sku_prefix: 'SHO' });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.error.code, 'sku_prefix_taken');
    assert.equal((await admin.patch(`/v1/admin/classifieds/categories/${bags.id}`, { sku_prefix: 'PHN' })).json.error.code, 'sku_prefix_taken');
    assert.equal((await admin.patch(`/v1/admin/classifieds/categories/${bags.id}`, { sku_prefix: 'B4G' })).status, 400);
    assert.equal((await admin.patch(`/v1/admin/classifieds/categories/${shoes.id}`, { sku_prefix: 'SHO' })).json.sku_prefix, 'SHO', 'a category may go back to its own');
    const audit = await prisma.auditLog.findFirst({ where: { targetId: shoes.id, action: 'classifieds.category_changed' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([audit.before.sku_prefix, audit.after.sku_prefix], ['SNK', 'SHO']);
    // Switching it off still works on its own.
    assert.equal((await admin.patch(`/v1/admin/classifieds/categories/${bags.id}`, { enabled: true })).json.enabled, true);
  });
});
