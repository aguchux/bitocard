// The models of Udozo's brands: a brand's list in each category, listings' models kept in the list's words ("prado" is
// Land Cruiser Prado), reading a brand and model out of a title, buyers filtering by model, models sellers typed joining
// by themselves once enough different sellers typed one, and admins adding, changing and turning off models.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
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
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(['POST', 'PATCH'].includes(method) ? { 'idempotency-key': `models-${Date.now()}-${Math.random()}` } : {}) },
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
  const email = `models${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, person);
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  person.id = signup.json.customer.id;
  return person;
}

async function live(person, { title, brand, model, slug = 'cars' }) {
  // These tests post faster than a person would, which sends ads to review.
  await prisma.classifiedListing.updateMany({ where: { customerId: person.id }, data: { submittedAt: new Date(Date.now() - 86_400_000) } });
  const [category, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug } }), prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } })]);
  const features = [{ key: 'brand', value: brand }, ...(model ? [{ key: 'model', value: model }] : [])];
  const draft = await person.post('/v1/classifieds/listings', { title, category_id: category.id, area_id: place.id, price: 25000000, condition: 'used', delivery: 'none', contact: 'chat', description: `${title}. Clean, works perfectly.`, features });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.json.id, kind: 'photo', position, url: `https://media.test/${draft.json.id}/${position}.jpg`, width: 1600, height: 1200 })) });
  const submitted = await person.post(`/v1/classifieds/listings/${draft.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const modelOf = listing => listing.features.find(feature => feature.key === 'model')?.value;
const visitor = shopper();
const names = response => response.json.data.map(item => item.name);
async function forget(slug = 'cars') {
  const { ClassifiedModelsService } = await import('../dist/classifieds/models.service.js');
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug } });
  server.app.get(ClassifiedModelsService)['forget'](category.id);
}

describe('the seeded lists', () => {
  test('every model is of a brand that sells in its category, and the categories buyers ask by model have them', async () => {
    const strays = await prisma.$queryRaw`
      SELECT count(*)::int AS "n" FROM "classified_brand_models" m
      WHERE NOT EXISTS (SELECT 1 FROM "classified_brand_categories" l WHERE l."brand_id" = m."brand_id" AND l."category_id" = m."category_id")`;
    assert.equal(strays[0].n, 0);
    for (const [slug, least] of [['cars', 1000], ['mobile-phones', 1000], ['laptops', 300], ['motorcycles', 100], ['tablets', 50], ['video-games', 10], ['heavy-equipment', 50]]) {
      const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug } });
      assert.ok((await prisma.classifiedBrandModel.count({ where: { categoryId: category.id } })) >= least, slug);
    }
    // Generators are bought by model, so the category asks for one.
    const generators = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'generators-solar' }, include: { features: { include: { feature: true } } } });
    assert.ok(generators.features.some(link => link.feature.key === 'model'));
    assert.equal((await prisma.classifiedFeature.findUniqueOrThrow({ where: { key: 'model' } })).filterable, true);
  });

  test("a brand's models in a category, its own list in that category; cached a minute", async () => {
    const cars = await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars');
    assert.equal(cars.status, 200, JSON.stringify(cars.json));
    assert.equal(cars.cache, 'public, max-age=60');
    assert.ok(names(cars).includes('Corolla'));
    assert.ok(names(cars).includes('Hiace') || names(cars).includes('Camry'));
    assert.equal(cars.json.data[0].object, 'classified_model');
    assert.equal('brand' in cars.json.data[0], false);
    // The same brand has different models in another category.
    const bikes = await visitor.get('/v1/classifieds/models?brand=Honda&category=motorcycles');
    const hondas = await visitor.get('/v1/classifieds/models?brand=Honda&category=cars');
    assert.ok(names(hondas).includes('Accord'));
    assert.equal(names(bikes).includes('Accord'), false);
    // The registry's other words for a brand work, and a brand it lacks has no list rather than an error.
    assert.ok(names(await visitor.get('/v1/classifieds/models?brand=benz&category=cars')).includes('C-Class'));
    assert.deepEqual((await visitor.get('/v1/classifieds/models?brand=Nothing%20Like%20This&category=cars')).json.data, []);
    assert.equal((await visitor.get('/v1/classifieds/models?category=cars')).json.error.code, 'parameter_missing');
    assert.equal((await visitor.get('/v1/classifieds/models?brand=Toyota&category=nothing-here')).json.error.param, 'category');
    assert.equal((await visitor.get('/v1/classifieds/models?brand=Toyota')).status, 400);
  });

  test('typing narrows a brand\'s list; with no brand it finds any brand\'s model, with its brand', async () => {
    const typed = await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars&q=prado');
    assert.equal(names(typed)[0], 'Land Cruiser Prado');
    // The brand in front is not part of the model.
    assert.equal(names(await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars&q=toyota%20corolla'))[0], 'Corolla');
    const open = await visitor.get('/v1/classifieds/models?category=cars&q=corolla');
    assert.equal(open.json.data[0].name, 'Corolla');
    assert.equal(open.json.data[0].brand.slug, 'toyota');
    assert.match(open.json.data[0].brand.logo_url ?? '', /toyota\.svg$/);
    // A top category reads its subcategories' models.
    assert.ok(names(await visitor.get('/v1/classifieds/models?brand=Toyota&category=vehicles')).includes('Corolla'));
  });
});

describe('reading a title', () => {
  const detect = async (title, category) => (await visitor.get(`/v1/classifieds/models/detect?category=${category}&title=${encodeURIComponent(title)}`)).json;

  test('the brand and model a title names, the longest words first', async () => {
    const camry = await detect('Toyota Camry 2015 LE, very clean', 'cars');
    assert.equal(camry.brand.name, 'Toyota');
    assert.equal(camry.model, 'Camry');
    const iphone = await detect('Neat iPhone 13 Pro Max 256GB', 'mobile-phones');
    assert.equal(iphone.brand.name, 'Apple');
    assert.equal(iphone.model, 'iPhone 13 Pro Max');
    const galaxy = await detect('Samsung A54 for sale', 'mobile-phones');
    assert.equal(galaxy.brand.name, 'Samsung');
    assert.match(galaxy.model, /A54/);
  });

  test('a model only one brand has names its brand; a word several brands share names nothing', async () => {
    const pulsar = await detect('Clean Highlander for quick sale', 'cars');
    assert.equal(pulsar.brand.name, 'Toyota');
    assert.equal(pulsar.model, 'Highlander');
    const nothing = await detect('Very clean family saloon', 'cars');
    assert.deepEqual([nothing.brand, nothing.model], [null, null]);
    // A brand the category does not sell is not this title's brand.
    assert.equal((await detect('Apple juice carton', 'cars')).brand, null);
    // The brand alone, when the list has no such model.
    const brandOnly = await detect('Toyota project car', 'cars');
    assert.equal(brandOnly.brand.name, 'Toyota');
    assert.equal(brandOnly.model, null);
  });

  test('IEE (Initial Entropy Energy, sold as IEETek): its bundled logo and every model on its site, found by its trade name', async () => {
    const iee = await prisma.classifiedBrand.findUniqueOrThrow({ where: { slug: 'iee' }, include: { categories: { include: { category: true } } } });
    assert.deepEqual([iee.name, iee.logoFile, iee.color, iee.categories.map(link => link.category.slug)], ['IEE', 'iee', '#384254', ['generators-solar']]);
    const models = await visitor.get('/v1/classifieds/models?brand=IEE&category=generators-solar&limit=50');
    assert.equal(models.status, 200, JSON.stringify(models.json));
    assert.equal(models.json.data.length, 19);
    assert.ok(models.json.data.some(model => model.name === 'SH4000 all-in-one ESS'));
    const station = await detect('IEETek P2400 portable power station, 2048Wh', 'generators-solar');
    assert.deepEqual([station.brand?.name, station.model], ['IEE', 'P2400 power station']);
    const panel = await detect('Initial Entropy Energy SP200 foldable solar panel', 'generators-solar');
    assert.deepEqual([panel.brand?.name, panel.model], ['IEE', 'SP200 solar panel']);
  });
});

describe("listings' models", () => {
  test("a model is saved in the list's words, for its brand and category, and an unknown one as typed", async () => {
    made.prado = await live(made.seller, { title: 'Toyota Prado 2012', brand: 'toyota', model: 'prado' });
    assert.equal(modelOf(made.prado), 'Land Cruiser Prado');
    made.corolla = await live(made.seller, { title: 'Corolla 2010', brand: 'Toyota', model: 'TOYOTA COROLLA' });
    assert.equal(modelOf(made.corolla), 'Corolla');
    // No brand to read it against, so it stays as typed.
    const bare = await made.seller.post('/v1/classifieds/listings', { title: 'A car', features: [{ key: 'model', value: 'corolla' }] });
    assert.equal(modelOf(bare.json), 'corolla');
  });

  test('buyers filter by model, and the list counts live listings in a country', async () => {
    const found = await visitor.get(`/v1/classifieds/listings?country=NG&category=cars&f=${encodeURIComponent('model:corolla')}`);
    assert.equal(found.status, 200, JSON.stringify(found.json));
    assert.deepEqual(found.json.data.map(row => row.id), [made.corolla.id]);
    const counted = await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars&country=NG');
    assert.deepEqual(counted.json.data.slice(0, 2).map(item => [item.name, item.listings]).sort(), [['Corolla', 1], ['Land Cruiser Prado', 1]]);
    assert.equal(counted.json.data[2].listings, 0);
  });

  test('a model three different sellers type joins the list by itself, and their ads read alike', async () => {
    const typed = ['Hilux Vigo Champ', 'hilux vigo champ', 'Hilux Vigo Champ'];
    const sellers = [made.seller, await customer('Bisi Adebayo'), await customer('Musa Ibrahim')];
    made.first = await live(sellers[0], { title: 'Toyota pickup one', brand: 'Toyota', model: typed[0] });
    await live(sellers[0], { title: 'Toyota pickup again', brand: 'Toyota', model: typed[0] });
    await live(sellers[1], { title: 'Toyota pickup two', brand: 'Toyota', model: typed[1] });
    assert.equal(modelOf(made.first), 'Hilux Vigo Champ');
    // Two sellers, however many ads, is not yet enough.
    await forget();
    assert.equal(names(await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars&q=vigo%20champ')).includes('Hilux Vigo Champ'), false);
    const waiting = await support.get('/v1/admin/classifieds/model-suggestions');
    assert.equal(waiting.status, 200);
    const row = waiting.json.data.find(item => item.name_key === 'hiluxvigochamp');
    assert.equal(row.sellers, 2);
    assert.equal(row.brand.slug, 'toyota');
    assert.equal(row.category.slug, 'cars');
    assert.equal(waiting.json.learn_from, 3);

    await live(sellers[2], { title: 'Toyota pickup three', brand: 'Toyota', model: typed[2] });
    await forget();
    assert.ok(names(await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars&q=vigo%20champ')).includes('Hilux Vigo Champ'));
    const model = await prisma.classifiedBrandModel.findFirstOrThrow({ where: { nameKey: 'hiluxvigochamp' } });
    assert.equal(model.source, 'sellers');
    assert.equal((await prisma.classifiedListingFeature.count({ where: { valueText: 'hilux vigo champ' } })), 0);
    assert.equal((await support.get('/v1/admin/classifieds/model-suggestions')).json.data.some(item => item.name_key === 'hiluxvigochamp'), false);
    assert.equal((await prisma.auditLog.count({ where: { action: 'classifieds.model_learned', targetId: model.id } })), 1);
    made.learned = model;
    made.sellers = sellers;
  });

  test('refused words never join by themselves, and neither does a model a brand the registry lacks has', async () => {
    await prisma.classifiedProhibitedWord.create({ data: { phrase: 'badword', action: 'review' } });
    for (const seller of made.sellers) await live(seller, { title: 'Toyota odd one', brand: 'Toyota', model: 'Badword Edition' }).catch(() => null);
    await forget();
    assert.equal(names(await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars&q=badword')).length, 0);
    for (const seller of made.sellers) await live(seller, { title: 'Unknown make', brand: 'Zzyzx Motors', model: 'Roadster' });
    assert.equal(await prisma.classifiedBrandModel.count({ where: { nameKey: 'roadster', brand: { nameKey: 'zzyzxmotors' } } }), 0);
    assert.equal(await prisma.classifiedModelSuggestion.count({ where: { nameKey: 'roadster' } }), 0);
  });
});

describe('admins', () => {
  test("support reads a brand's models a page at a time; only operations change them", async () => {
    const page = await support.get('/v1/admin/classifieds/brands/toyota/models?category=cars&limit=5');
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.json.data.length, 5);
    assert.ok(page.json.total > 40);
    assert.equal(page.json.brand.name, 'Toyota');
    assert.ok(page.json.categories.find(category => category.slug === 'cars').models > 40);
    const corolla = await support.get('/v1/admin/classifieds/brands/toyota/models?q=corolla');
    const row = corolla.json.data.find(item => item.name === 'Corolla');
    assert.equal(row.listings, 1);
    assert.equal(row.category.slug, 'cars');
    assert.equal((await support.get('/v1/admin/classifieds/brands/toyota')).json.models >= page.json.total, true);
    const from = await support.get('/v1/admin/classifieds/brands/toyota/models?source=sellers');
    assert.deepEqual(from.json.data.map(item => item.name), ['Hilux Vigo Champ']);
    assert.equal((await support.patch(`/v1/admin/classifieds/models/${row.id}`, { enabled: false })).status, 403);
    assert.equal((await support.get('/v1/admin/classifieds/brands/no-such-brand/models')).status, 404);
  });

  test("adding a model answers sellers' suggestions and turns their ads into it; it never takes another's words", async () => {
    const seller = made.seller;
    const typed = await live(seller, { title: 'Toyota special', brand: 'Toyota', model: 'Zenith Rover Special' });
    assert.equal(modelOf(typed), 'Zenith Rover Special');
    const cars = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'cars' } });
    const created = await admin.post('/v1/admin/classifieds/brands/toyota/models', { name: 'Zenith Rover S', aliases: ['zenith rover special'], category_id: cars.id });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.source, 'admin');
    assert.equal(created.json.listings_renamed, 1);
    assert.equal(created.json.suggestions_answered, 1);
    assert.equal((await prisma.classifiedListingFeature.findFirst({ where: { listingId: typed.id, feature: { key: 'model' } } })).valueText, 'Zenith Rover S');
    made.created = created.json;
    const twice = await admin.post('/v1/admin/classifieds/brands/toyota/models', { name: 'Zenith-Rover S', category_id: cars.id });
    assert.equal(twice.json.error.code, 'model_exists');
    const alias = await admin.post('/v1/admin/classifieds/brands/toyota/models', { name: 'Something Else', aliases: ['corolla'], category_id: cars.id });
    assert.equal(alias.json.error.code, 'model_alias_taken');
    assert.match(alias.json.error.message, /Corolla/);
    const phones = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'mobile-phones' } });
    assert.equal((await admin.post('/v1/admin/classifieds/brands/toyota/models', { name: 'Phone', category_id: phones.id })).json.error.param, 'category_id');
  });

  test('many at once: new ones added, those the list has skipped with why', async () => {
    const cars = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'cars' } });
    const result = await admin.post('/v1/admin/classifieds/brands/toyota/models/import', { category_id: cars.id, models: [{ name: 'Imported One' }, { name: 'Imported Two', aliases: ['imp two'] }, { name: 'Corolla' }] });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.added, 2);
    assert.deepEqual(result.json.skipped.map(item => item.name), ['Corolla']);
    await forget();
    assert.equal(names(await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars&q=imp%20two'))[0], 'Imported Two');
  });

  test('a new name keeps the old one as a search word and ads follow; a model turned off stays out however many type it', async () => {
    const renamed = await admin.patch(`/v1/admin/classifieds/models/${made.created.id}`, { name: 'Zenith Rover' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.ok(renamed.json.aliases.includes('zenith rover s'));
    assert.equal(renamed.json.listings_renamed, 1);
    await forget();
    const typed = await live(made.seller, { title: 'Toyota special again', brand: 'Toyota', model: 'zenith rover s' });
    assert.equal(modelOf(typed), 'Zenith Rover');

    const off = await admin.patch(`/v1/admin/classifieds/models/${made.learned.id}`, { enabled: false });
    assert.equal(off.json.enabled, false);
    await forget();
    assert.equal(names(await visitor.get('/v1/classifieds/models?brand=Toyota&category=cars&q=vigo%20champ')).includes('Hilux Vigo Champ'), false);
    await live(made.seller, { title: 'Toyota pickup four', brand: 'Toyota', model: 'Hilux Vigo Champ' });
    assert.equal(await prisma.classifiedModelSuggestion.count({ where: { nameKey: 'hiluxvigochamp', status: 'open' } }), 0);
    assert.deepEqual((await prisma.auditLog.findMany({ where: { targetType: 'classified_brand_model', targetId: made.created.id }, orderBy: { createdAt: 'asc' } })).map(row => row.action), ['classifieds.model_created', 'classifieds.model_changed']);
  });

  test('a dismissed model stays out however many type it', async () => {
    const cars = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'cars' } });
    const toyota = await prisma.classifiedBrand.findUniqueOrThrow({ where: { slug: 'toyota' } });
    await live(made.sellers[0], { title: 'Toyota mystery', brand: 'Toyota', model: 'Mystery Wagon' });
    const body = { brand_id: toyota.id, category_id: cars.id, name_key: 'mysterywagon' };
    assert.equal((await support.post('/v1/admin/classifieds/model-suggestions/dismiss', body)).status, 403);
    const dismissed = await admin.post('/v1/admin/classifieds/model-suggestions/dismiss', body);
    assert.equal(dismissed.status, 200, JSON.stringify(dismissed.json));
    assert.equal(dismissed.json.dismissed, 1);
    assert.equal((await admin.post('/v1/admin/classifieds/model-suggestions/dismiss', body)).status, 404);
    await live(made.sellers[1], { title: 'Toyota mystery two', brand: 'Toyota', model: 'Mystery Wagon' });
    await live(made.sellers[2], { title: 'Toyota mystery three', brand: 'Toyota', model: 'Mystery Wagon' });
    assert.equal(await prisma.classifiedBrandModel.count({ where: { nameKey: 'mysterywagon' } }), 0);
    assert.equal(await prisma.classifiedModelSuggestion.count({ where: { nameKey: 'mysterywagon', status: 'open' } }), 0);
  });
});
