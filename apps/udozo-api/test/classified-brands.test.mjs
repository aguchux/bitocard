// Udozo's brand registry: the seeded brands of every category that asks for one (with udozo.com's bundled logos), the
// lists the listing form and the filters read, listings' brands kept in the registry's words ("samsung" is Samsung,
// "benz" Mercedes-Benz), brands sellers typed that it lacks going to admins, and admins adding and changing brands.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let admin;
let support;
let prisma;
const made = {};

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.upsert({ where: { country: 'NG' }, create: { country: 'NG', firstListingsReviewed: 0, monthlyListingLimit: 100 }, update: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
  made.seller = await customer('Chinedu Okafor');
});

after(async () => {
  await admin?.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: null });
  server?.close();
});

let counter = 0;
function shopper() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(['POST', 'PATCH'].includes(method) ? { 'idempotency-key': `brands-${Date.now()}-${Math.random()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, cache: res.headers.get('cache-control') };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

async function customer(name) {
  const person = shopper();
  const email = `brands${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, person);
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  person.id = signup.json.customer.id;
  return person;
}

async function live(person, { title, brand, slug = 'mobile-phones' }) {
  const [category, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug } }), prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } })]);
  const draft = await person.post('/v1/classifieds/listings', { title, category_id: category.id, area_id: place.id, price: 25000000, condition: 'used', delivery: 'none', contact: 'chat', description: `${title}. Clean, works perfectly.`, features: [{ key: 'brand', value: brand }] });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.json.id, kind: 'photo', position, url: `https://media.test/${draft.json.id}/${position}.jpg`, width: 1600, height: 1200 })) });
  const submitted = await person.post(`/v1/classifieds/listings/${draft.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const brandOf = listing => listing.features.find(feature => feature.key === 'brand')?.value;
const visitor = shopper();
async function forget() {
  const { ClassifiedBrandsService } = await import('../dist/classifieds/brands.service.js');
  server.app.get(ClassifiedBrandsService)['forget']();
}

describe('the seeded registry', () => {
  test('every category that asks for a brand has its brands, and every bundled logo is a file on udozo.com', async () => {
    const brandFeature = await prisma.classifiedFeature.findUniqueOrThrow({ where: { key: 'brand' } });
    const asking = await prisma.classifiedCategoryFeature.findMany({ where: { featureId: brandFeature.id }, include: { category: true } });
    assert.ok(asking.length >= 60);
    for (const link of asking) {
      assert.ok((await prisma.classifiedBrandCategory.count({ where: { categoryId: link.categoryId } })) >= 10, `${link.category.slug} has its brands`);
      // Buyers filter on brand wherever it is asked.
      assert.equal(link.filter, true, link.category.slug);
    }
    assert.ok((await prisma.classifiedBrand.count()) > 1000);
    const bundled = await prisma.classifiedBrand.findMany({ where: { logoFile: { not: null } }, select: { logoFile: true } });
    assert.ok(bundled.length > 100);
    const folder = fileURLToPath(new URL('../../udozo/public/brand-logos/', import.meta.url));
    for (const { logoFile } of bundled) assert.ok(existsSync(`${folder}${logoFile}.svg`), `${logoFile}.svg`);
  });

  test("a category's brands, its own first in the registry's order, each with its logo or colour; cached a minute", async () => {
    const phones = await visitor.get('/v1/classifieds/brands?category=mobile-phones');
    assert.equal(phones.status, 200, JSON.stringify(phones.json));
    assert.equal(phones.cache, 'public, max-age=60');
    assert.deepEqual(phones.json.data.slice(0, 3).map(brand => brand.name), ['Samsung', 'Apple', 'Tecno']);
    const samsung = phones.json.data[0];
    assert.equal(samsung.slug, 'samsung');
    assert.match(samsung.logo_url, /^https:\/\/udozo\.com\/brand-logos\/samsung\.svg$/);
    assert.match(samsung.color, /^#[0-9A-F]{6}$/);
    assert.equal('listings' in samsung, false);
    // A top category has its subcategories' brands.
    const top = await visitor.get('/v1/classifieds/brands?category=vehicles');
    assert.ok(top.json.data.some(brand => brand.name === 'Toyota') && top.json.data.some(brand => brand.name === 'Bajaj'));
    assert.equal((await visitor.get('/v1/classifieds/brands')).json.error.code, 'parameter_missing');
    assert.equal((await visitor.get('/v1/classifieds/brands?category=nothing-here')).json.error.param, 'category');
  });

  test('typing finds a brand by its name or what sellers call it, the category\'s own first', async () => {
    const iphone = await visitor.get('/v1/classifieds/brands?q=iphone');
    assert.equal(iphone.json.data[0].name, 'Apple');
    const benz = await visitor.get('/v1/classifieds/brands?q=Mercedes%20Benz&category=cars');
    assert.equal(benz.json.data[0].name, 'Mercedes-Benz');
    // "To" in cars: Toyota before anything elsewhere that starts the same.
    const to = await visitor.get('/v1/classifieds/brands?q=to&category=cars');
    assert.equal(to.json.data[0].name, 'Toyota');
  });
});

describe("listings' brands", () => {
  test('a brand is saved as the registry writes it, and counted on the filters', async () => {
    made.galaxy = await live(made.seller, { title: 'Samsung Galaxy A54', brand: 'SAMSUNG' });
    assert.equal(brandOf(made.galaxy), 'Samsung');
    made.iphone = await live(made.seller, { title: 'iPhone 13 Pro', brand: 'iphone' });
    assert.equal(brandOf(made.iphone), 'Apple');
    const counted = await visitor.get('/v1/classifieds/brands?category=mobile-phones&country=NG');
    const counts = Object.fromEntries(counted.json.data.map(brand => [brand.name, brand.listings]));
    assert.equal(counts.Samsung, 1);
    assert.equal(counts.Apple, 1);
    assert.equal(counts.Tecno, 0);
    // The search filter finds it in any case.
    const filtered = await visitor.get('/v1/classifieds/listings?country=NG&category=mobile-phones&f=brand:samsung');
    assert.deepEqual(filtered.json.data.map(row => row.id), [made.galaxy.id]);
  });

  test("a brand the registry lacks is saved as typed and goes to admins as sellers' suggestion", async () => {
    made.odd = await live(made.seller, { title: 'Zenphone Max 5G', brand: 'Zenphone' });
    assert.equal(brandOf(made.odd), 'Zenphone');
    const other = await customer('Bisi Adebayo');
    await live(other, { title: 'Zenphone Lite', brand: 'ZENPHONE' });
    const suggestions = await support.get('/v1/admin/classifieds/brand-suggestions');
    assert.equal(suggestions.status, 200);
    const row = suggestions.json.data.find(item => item.name_key === 'zenphone');
    assert.equal(row.sellers, 2);
    assert.deepEqual(row.categories.map(category => category.slug), ['mobile-phones']);
  });
});

describe('admins', () => {
  test('support reads the registry a page at a time; only operations change it', async () => {
    const page = await support.get('/v1/admin/classifieds/brands?category=mobile-phones&limit=5');
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.json.data.length, 5);
    assert.ok(page.json.total >= 30);
    const missing = await support.get('/v1/admin/classifieds/brands?logo=missing&q=tecno');
    assert.equal(missing.json.data[0].name, 'Tecno');
    assert.equal(missing.json.data[0].logo_source, null);
    const samsung = await support.get('/v1/admin/classifieds/brands/samsung');
    assert.equal(samsung.json.logo_source, 'bundled');
    assert.equal(samsung.json.listings, 1);
    assert.ok(samsung.json.categories.some(category => category.slug === 'tvs'));
    assert.equal((await support.patch('/v1/admin/classifieds/brands/samsung', { color: '#000000' })).status, 403);
  });

  test("adding a brand answers sellers' suggestions and turns their listings into it", async () => {
    const phones = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'mobile-phones' } });
    const created = await admin.post('/v1/admin/classifieds/brands', { name: 'ZenPhone', aliases: ['zen phone', 'Zen'], color: '#12ab34', category_ids: [phones.id] });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.slug, 'zenphone');
    assert.equal(created.json.color, '#12AB34');
    assert.equal(created.json.listings_renamed, 2);
    assert.equal(created.json.suggestions_answered, 2);
    assert.equal((await support.get('/v1/admin/classifieds/brand-suggestions')).json.data.some(item => item.name_key === 'zenphone'), false);
    const listing = await prisma.classifiedListingFeature.findFirst({ where: { listingId: made.odd.id, feature: { key: 'brand' } } });
    assert.equal(listing.valueText, 'ZenPhone');
    // Last among the category's brands until admins move it.
    const link = await prisma.classifiedBrandCategory.findFirstOrThrow({ where: { brandId: created.json.id } });
    assert.equal(link.position, (await prisma.classifiedBrandCategory.aggregate({ where: { categoryId: phones.id }, _max: { position: true } }))._max.position);
    await forget();
    assert.equal((await visitor.get('/v1/classifieds/brands?q=zen')).json.data[0].name, 'ZenPhone');
    // The same words cannot find two brands.
    const twice = await admin.post('/v1/admin/classifieds/brands', { name: 'Zen-Phone' });
    assert.equal(twice.status, 409);
    assert.equal(twice.json.error.code, 'brand_exists');
    const alias = await admin.post('/v1/admin/classifieds/brands', { name: 'Galaxy Phones', aliases: ['galaxy'] });
    assert.equal(alias.json.error.code, 'brand_alias_taken');
    assert.match(alias.json.error.message, /Samsung/);
    assert.equal((await admin.post('/v1/admin/classifieds/brands', { name: 'Fake', category_ids: [phones.parentId] })).json.error.param, 'category_ids');
  });

  test('a new name keeps the old one as an alias and listings follow it; a logo upload wins over the bundled one', async () => {
    const renamed = await admin.patch('/v1/admin/classifieds/brands/zenphone', { name: 'Zen Mobile', logo_url: 'https://media.test/zen.png' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.equal(renamed.json.slug, 'zenphone');
    assert.ok(renamed.json.aliases.includes('zenphone'));
    assert.equal(renamed.json.logo_url, 'https://media.test/zen.png');
    assert.equal(renamed.json.logo_source, 'uploaded');
    assert.equal((await prisma.classifiedListingFeature.findFirst({ where: { listingId: made.odd.id, feature: { key: 'brand' } } })).valueText, 'Zen Mobile');
    await forget();
    const typed = await live(made.seller, { title: 'Zenphone Note 2', brand: 'zenphone' });
    assert.equal(brandOf(typed), 'Zen Mobile');
    const off = await admin.patch('/v1/admin/classifieds/brands/zenphone', { enabled: false, category_ids: [] });
    assert.equal(off.json.enabled, false);
    assert.deepEqual(off.json.categories, []);
    await forget();
    assert.equal((await visitor.get('/v1/classifieds/brands?q=zen')).json.data.some(brand => brand.slug === 'zenphone'), false);
    const audit = await prisma.auditLog.findMany({ where: { targetType: 'classified_brand', targetId: renamed.json.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(audit.map(row => row.action), ['classifieds.brand_created', 'classifieds.brand_changed', 'classifieds.brand_changed']);
  });

  test("dismissing sellers' suggestion of a brand", async () => {
    await live(made.seller, { title: 'Phonix Star 10', brand: 'Phonix' });
    assert.equal((await support.post('/v1/admin/classifieds/brand-suggestions/dismiss', { name_key: 'phonix' })).status, 403);
    const dismissed = await admin.post('/v1/admin/classifieds/brand-suggestions/dismiss', { name_key: 'Phonix' });
    assert.equal(dismissed.status, 200, JSON.stringify(dismissed.json));
    assert.equal(dismissed.json.dismissed, 1);
    assert.equal((await admin.post('/v1/admin/classifieds/brand-suggestions/dismiss', { name_key: 'phonix' })).status, 404);
  });
});
