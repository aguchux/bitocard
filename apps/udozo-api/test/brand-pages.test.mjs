// A brand's public page in a market (`/<cc>/brand/<slug>`): the registry's brand with what is for sale under it there
// (live listings, sellers, categories, states and models, most first), the search's `brand` filter counting a listing
// under any of the brand's words, the categories it sells in while nothing is for sale, and its sitemap entry.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let admin;
let prisma;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server, ['operations']);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.upsert({ where: { country: 'NG' }, create: { country: 'NG', firstListingsReviewed: 0, monthlyListingLimit: 100 }, update: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
});

after(async () => {
  await admin?.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: null });
  await server?.close();
});

let counter = 0;
function shopper() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { 'idempotency-key': `brand-pages-${Date.now()}-${Math.random()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, cache: res.headers.get('cache-control') };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

async function customer(name) {
  const person = shopper();
  const email = `brand-pages${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, person);
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  person.id = signup.json.customer.id;
  return person;
}

async function live(person, { title, brand, model, slug = 'mobile-phones', area = 'ikeja' }) {
  const [category, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug } }), prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: area } })]);
  const features = [{ key: 'brand', value: brand }, ...(model ? [{ key: 'model', value: model }] : [])];
  const draft = await person.post('/v1/classifieds/listings', { title, category_id: category.id, area_id: place.id, price: 25000000, condition: 'used', delivery: 'none', contact: 'chat', description: `${title}. Clean, works perfectly.`, features });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.json.id, kind: 'photo', position, url: `https://media.test/${draft.json.id}/${position}.jpg`, width: 1600, height: 1200 })) });
  const submitted = await person.post(`/v1/classifieds/listings/${draft.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const visitor = shopper();

describe('Brand pages', () => {
  test('a brand gathers its live listings in the market: sellers, categories, states and models, most first', async () => {
    const one = await customer('Chinedu Okafor');
    const two = await customer('Amaka Eze');
    await live(one, { title: 'Samsung Galaxy S23 Ultra 256GB', brand: 'Samsung', model: 'Galaxy S23 Ultra' });
    await live(one, { title: 'Galaxy S23 Ultra, clean', brand: 'samsung', model: 'galaxy s23 ultra' });
    await live(two, { title: 'Samsung Galaxy A54', brand: 'Samsung', model: 'Galaxy A54' });
    await live(two, { title: 'Samsung 55 inch smart TV', brand: 'Samsung', slug: 'tvs', area: 'gwarinpa' });
    const sold = await live(two, { title: 'Samsung Galaxy A14', brand: 'Samsung', model: 'Galaxy A14' });
    await prisma.classifiedListing.update({ where: { id: sold.id }, data: { status: 'sold', soldAt: new Date() } });
    await live(one, { title: 'Tecno Spark 20', brand: 'Tecno' });

    const page = await visitor.get('/v1/classifieds/brands/samsung?country=ng');
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.cache, 'public, max-age=60');
    const brand = page.json;
    assert.deepEqual([brand.object, brand.slug, brand.name, brand.country], ['classified_brand_page', 'samsung', 'Samsung', 'NG']);
    assert.match(brand.url, /\/ng\/brand\/samsung$/);
    assert.deepEqual([brand.listings, brand.sellers], [4, 2], 'live listings only, and who they come from');
    assert.deepEqual(brand.categories.map(item => [item.slug, item.listings]), [['mobile-phones', 3], ['tvs', 1]]);
    assert.ok(brand.categories[0].icon && brand.categories[0].parent?.slug);
    assert.deepEqual(brand.states.map(item => item.listings), [3, 1]);
    assert.equal(brand.models[0].listings, 2, 'a model however it was cased');
    assert.match(brand.models[0].name, /s23 ultra/i);
    assert.ok(brand.models.some(item => /a54/i.test(item.name) && item.listings === 1));
    assert.ok(!brand.models.some(item => /a14/i.test(item.name)), 'never a sold listing');
    assert.doesNotMatch(JSON.stringify(brand), new RegExp(`${one.id}|${two.id}|Okafor|@example\\.com`), 'nothing about the sellers');
  });

  test('the search lists one brand\'s live listings, under any of its words', async () => {
    const seller = await customer('Kemi Adeyemi');
    const iphone = await live(seller, { title: 'Apple iPhone 13 128GB', brand: 'Apple' });
    await live(seller, { title: 'Infinix Hot 40', brand: 'Infinix' });
    // A value saved before the registry knew its spelling still counts under the brand.
    const brandFeature = await prisma.classifiedFeature.findUniqueOrThrow({ where: { key: 'brand' } });
    await prisma.classifiedListingFeature.updateMany({ where: { listingId: iphone.id, featureId: brandFeature.id }, data: { valueText: '  APPLE ' } });

    const apple = await visitor.get('/v1/classifieds/listings?country=NG&brand=apple');
    assert.equal(apple.status, 200, JSON.stringify(apple.json));
    assert.ok(apple.json.data.some(card => card.title === 'Apple iPhone 13 128GB'));
    assert.ok(apple.json.data.every(card => !card.title.startsWith('Infinix')));
    const phones = await visitor.get('/v1/classifieds/listings?country=NG&brand=apple&category=mobile-phones');
    assert.ok(phones.json.data.some(card => card.title === 'Apple iPhone 13 128GB'), 'with a category');
    assert.ok((await visitor.get('/v1/classifieds/brands/apple?country=NG')).json.listings >= 1);

    const unknown = await visitor.get('/v1/classifieds/listings?country=NG&brand=no-such-brand-here');
    assert.deepEqual([unknown.status, unknown.json.error.param], [400, 'brand']);
  });

  test('a brand with nothing for sale shows the categories it sells in; unknown and switched-off brands have no page', async () => {
    const quiet = await prisma.classifiedBrand.findFirstOrThrow({ where: { enabled: true, categories: { some: {} }, slug: { notIn: ['samsung', 'apple', 'tecno', 'infinix'] } }, orderBy: { slug: 'asc' } });
    const page = await visitor.get(`/v1/classifieds/brands/${quiet.slug}?country=NG`);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.json.listings, 0);
    assert.ok(page.json.categories.length >= 1 && page.json.categories.every(item => item.listings === 0));
    assert.deepEqual([page.json.models, page.json.states], [[], []]);

    assert.equal((await visitor.get('/v1/classifieds/brands/no-such-brand-here?country=NG')).status, 404);
    assert.equal((await visitor.get('/v1/classifieds/brands/NOT_A_SLUG?country=NG')).status, 404);
    assert.equal((await visitor.get('/v1/classifieds/brands/samsung')).status, 400, 'a market is needed');

    await prisma.classifiedBrand.update({ where: { id: quiet.id }, data: { enabled: false } });
    const { ClassifiedBrandsService } = await import('../dist/classifieds/brands.service.js');
    server.app.get(ClassifiedBrandsService)['forget']();
    assert.equal((await visitor.get(`/v1/classifieds/brands/${quiet.slug}?country=NG`)).status, 404, 'a brand switched off has no page');
    await prisma.classifiedBrand.update({ where: { id: quiet.id }, data: { enabled: true } });
    server.app.get(ClassifiedBrandsService)['forget']();
  });

  test('the sitemap names the brands with something for sale, with their count and newest change', async () => {
    const sitemap = await visitor.get('/v1/classifieds/sitemap?country=NG');
    assert.equal(sitemap.status, 200, JSON.stringify(sitemap.json));
    const samsung = sitemap.json.brands.find(item => item.slug === 'samsung');
    assert.ok(samsung && samsung.listings >= 4 && samsung.updated_at);
    assert.ok(sitemap.json.brands.every(item => item.listings > 0));
  });

  test('admins give a brand a banner; its page carries it, and taking it off brings back the drawn one', async () => {
    const plain = await visitor.get('/v1/classifieds/brands/samsung?country=NG');
    assert.equal(plain.json.banner_url, null);
    const settings = await admin.get('/v1/admin/media/settings');
    assert.ok(settings.json.purposes.some(item => item.purpose === 'classified_brand_banner' && !item.content_types.includes('image/svg+xml')), 'a raster banner, uploaded by admins');
    const set = await admin.patch('/v1/admin/classifieds/brands/samsung', { banner_url: 'https://media.test/samsung-banner.jpg' });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.banner_url, 'https://media.test/samsung-banner.jpg');
    assert.equal((await admin.patch('/v1/admin/classifieds/brands/samsung', { banner_url: 'http://media.test/plain.jpg' })).status, 400, 'https only');
    const { ClassifiedBrandsService } = await import('../dist/classifieds/brands.service.js');
    server.app.get(ClassifiedBrandsService)['forget']();
    assert.equal((await visitor.get('/v1/classifieds/brands/samsung?country=NG')).json.banner_url, 'https://media.test/samsung-banner.jpg');
    const cleared = await admin.patch('/v1/admin/classifieds/brands/samsung', { banner_url: null });
    assert.equal(cleared.json.banner_url, null);
    server.app.get(ClassifiedBrandsService)['forget']();
    assert.equal((await visitor.get('/v1/classifieds/brands/samsung?country=NG')).json.banner_url, null);
  });
});
