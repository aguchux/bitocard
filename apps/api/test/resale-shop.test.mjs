// B2B reselling, stage 3 (docs/BITOCARD_B2B_RESELLING_PLAN.md): the Resale shop template. Offered only where reselling is
// open to the reseller; its store sells resale listings, never catalogue products; its sections and public pages show
// only listings on sale, each naming its supplier, with the reseller's price and only an approved note; the supplier's
// page shows them and their listing exactly as written, with no price; the store's words cannot claim to own the items.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let prisma;
let admin;
let house;
let check;

before(async () => {
  // Resale is Udozo's (docs/UDOZO_SPINOFF_PLAN.md): its responses are checked against Udozo's API document.
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  house = server.app.get((await import('../dist/checkout/house.service.js')).HouseService);
  check = await responseChecker(server.app);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_resale']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
  assert.equal((await admin.put('/v1/admin/classifieds/resale-settings/NG', { reseller_fee_bps: 300, reseller_fee_cap: 500000 })).status, 200);
});

after(async () => {
  for (const key of ['classifieds_resale', 'reseller_resale']) await admin?.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: null });
  server?.close();
});

const get = async path => {
  const res = await fetch(`${server.base}${path}`);
  return { status: res.status, json: await res.json() };
};

function shopper() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `resale3-${Date.now()}-${Math.random()}` } : {}),
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
async function supplier(name) {
  const seller = shopper();
  const email = `shop3-${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await seller.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal((await seller.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await seller.post('/v1/classifieds/terms/accept', { version: (await seller.get('/v1/classifieds/terms')).json.version });
  seller.id = signup.json.customer.id;
  const nigeria = await house.resellerFor('NG');
  await prisma.identityVerification.create({
    data: { subject: 'customer', resellerId: nigeria.id, mode: 'live', customerReference: seller.id, method: 'document', provider: 'test', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: name },
  });
  await prisma.customerBankAccount.create({
    data: { customerId: seller.id, mode: 'live', country: 'NG', currency: 'NGN', bankCode: '044', bankName: 'Access Bank', accountNumberEncrypted: 'sealed', accountNumberLast4: '6789', accountName: name, payoutsFrom: new Date() },
  });
  return seller;
}

async function listing(seller, title, extra = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const made = await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'new', category_id: cat.id, area_id: area.id, description: 'Sealed in the box.', resale: true, resale_discount_bps: 1000, resale_markup_max_bps: 3000, stock: 2, ...extra });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/${made.json.id}-${position}.jpg` })) });
  const live = await seller.post(`/v1/classifieds/listings/${made.json.id}/submit`);
  assert.equal(live.json.status, 'active', JSON.stringify(live.json));
  return live.json;
}

describe('the Resale shop template', () => {
  test('offered only where reselling is open; it sells resale listings and never catalogue products', async () => {
    const owner = await resellerClient(server, { business: 'Template Store' });
    const api = owner.browser;
    const closed = (await api.get('/v1/store-templates')).json.data.find(item => item.key === 'resale_shop');
    check('GET /v1/store-templates', 200, (await api.get('/v1/store-templates')).json);
    assert.deepEqual([closed.available, closed.resale, closed.categories], [false, true, []]);
    assert.equal((await api.post('/v1/stores', { name: 'Resale One', subdomain: `resaleone${Date.now() % 100000}`, template: 'resale_shop' })).json.error.code, 'template_unavailable');

    assert.equal((await admin.put('/v1/admin/switches/reseller_resale', { country_code: 'NG', enabled: true })).status, 200);
    assert.match((await api.get('/v1/store-templates')).json.data.find(item => item.key === 'resale_shop').reason, /identity check/, 'a verified account too');
    await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
    const made = await api.post('/v1/stores', { name: 'Resale One', subdomain: `resaleone${Date.now() % 100000}`, template: 'resale_shop', variant: 'aisle' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const editor = (await api.get(`/v1/stores/${made.json.id}/home`)).json;
    assert.deepEqual(editor.sections_allowed, ['hero', 'listing_rail', 'listing_grid', 'resale_categories', 'promo', 'features', 'faq', 'trust_bar']);
    assert.ok(editor.draft.some(section => section.type === 'listing_rail'), 'the starting page has listings');

    // No catalogue products: the store's catalogue and menu are empty.
    await prisma.store.update({ where: { id: made.json.id }, data: { status: 'published' } });
    const products = await get(`/v1/store/products?store=${made.json.subdomain}`);
    assert.deepEqual([products.status, products.json.data.length], [200, 0]);
  });
});

describe('a Resale shop’s pages', () => {
  test('only listings on sale, each naming its supplier, with the store’s price and only an approved note', async () => {
    const seller = await supplier('Chinedu Okafor');
    const tv = await listing(seller, 'Hisense 50 inch TV');
    const other = await listing(seller, 'Sony 55 inch TV');
    const owner = await resellerClient(server, { business: 'Ada Gadgets' });
    await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
    const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Ada Gadgets', subdomain: `adagad${(counter += 1)}x${Date.now() % 10000}`, status: 'published', template: 'resale_shop', variant: 'showroom', theme: 'ink_coral' } });
    const api = owner.browser;
    const mine = (await api.post('/v1/resale/listings', { store_id: store.id, listing_id: tv.id, markup_bps: 1500 })).json;
    const paused = (await api.post('/v1/resale/listings', { store_id: store.id, listing_id: other.id, markup_bps: 0 })).json;
    await api.patch(`/v1/resale/listings/${paused.id}`, { status: 'paused' });
    await api.put(`/v1/resale/listings/${mine.id}/note`, { note: 'Free wall bracket this month.' });

    const page = await get(`/v1/store/resale/listings?store=${store.subdomain}`);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.deepEqual(page.json.data.map(card => card.title), ['Hisense 50 inch TV'], 'the paused one is not on sale');
    const card = page.json.data[0];
    assert.deepEqual([card.price, card.currency, card.note, card.supplier.name, card.supplier.id], [28750000, 'NGN', null, 'Chinedu O.', mine.supplier_relationship_id], 'the note is not shown until approved; the supplier is the relationship');

    const relationship = (await seller.get('/v1/classifieds/me/resellers')).json.data[0];
    await seller.post(`/v1/classifieds/me/resale-notes/${mine.id}/approve`, { note: 'Free wall bracket this month.' });
    const detail = await get(`/v1/store/resale/listings/${tv.ref}?store=${store.subdomain}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.deepEqual([detail.json.note, detail.json.description, detail.json.photos.length, detail.json.supplier.name], ['Free wall bracket this month.', 'Sealed in the box.', 4, 'Chinedu O.']);
    assert.equal((await get(`/v1/store/resale/listings/${other.ref}?store=${store.subdomain}`)).status, 404, 'not on sale here');

    // The supplier's page: them and their listing as written, with no price.
    const profile = await get(`/v1/store/resale/suppliers/${relationship.id}?store=${store.subdomain}&listing=${tv.ref}`);
    assert.equal(profile.status, 200, JSON.stringify(profile.json));
    assert.deepEqual([profile.json.name, profile.json.listings_here, profile.json.listing.title, profile.json.listing.description], ['Chinedu O.', 1, 'Hisense 50 inch TV', 'Sealed in the box.']);
    assert.ok(!JSON.stringify(profile.json).includes('"price"'), 'no price on the supplier’s page');
    assert.ok(!JSON.stringify(profile.json).includes(seller.id), 'never the supplier’s own account ID');

    // The template's sections and hero are filled with what is on sale.
    const home = await get(`/v1/store/resale/home?store=${store.subdomain}`);
    assert.equal(home.status, 200, JSON.stringify(home.json));
    assert.deepEqual([home.json.object, home.json.published, 'navigation' in home.json, 'countries' in home.json], ['store_home', false, false, false], 'the sections alone, no catalogue menu');
    assert.equal((await get(`/v1/store/resale/home?store=${store.subdomain}&preview=1700000000000.nonsense`)).json.error.code, 'preview_expired');
    const rail = home.json.sections.find(section => section.type === 'listing_rail');
    assert.deepEqual(rail.data.listings.map(item => item.title), ['Hisense 50 inch TV']);
    assert.deepEqual(home.json.sections.find(section => section.type === 'hero').data.listings.length, 1);
    assert.deepEqual(home.json.sections.find(section => section.type === 'resale_categories').data.categories.map(item => [item.slug, item.count]), [['tvs', 1]]);
    assert.deepEqual((await get(`/v1/store/resale/categories?store=${store.subdomain}`)).json.data.length, 1);

    // The supplier stops the reseller: nothing of theirs is on sale any more.
    await seller.post(`/v1/classifieds/me/resellers/${relationship.id}/stop`);
    assert.equal((await get(`/v1/store/resale/listings?store=${store.subdomain}`)).json.total, 0);
    assert.equal((await get(`/v1/store/resale/suppliers/${relationship.id}?store=${store.subdomain}`)).status, 404);

    // Another template's store has no resale pages.
    const plain = await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Plain', subdomain: `plain${counter}x${Date.now() % 10000}`, status: 'published' } });
    assert.equal((await get(`/v1/store/resale/listings?store=${plain.subdomain}`)).json.error.code, 'store_unavailable');
    assert.equal((await get(`/v1/store/resale/home?store=${plain.subdomain}`)).json.error.code, 'store_unavailable');
  });
});

describe('the store’s own words', () => {
  test('cannot claim to own, make or stock the items; admins keep the phrases', async () => {
    const owner = await resellerClient(server, { business: 'Claim Store' });
    await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
    const made = await owner.browser.post('/v1/stores', { name: 'Claim Store', subdomain: `claims${Date.now() % 100000}`, template: 'resale_shop' });
    const draft = (await owner.browser.get(`/v1/stores/${made.json.id}/home`)).json.draft;
    const hero = draft.findIndex(section => section.type === 'hero');
    const claimed = draft.map((section, index) => (index === hero ? { ...section, subtitle: 'Everything here is made by us in Lagos.' } : section));
    const refused = await owner.browser.put(`/v1/stores/${made.json.id}/home/draft`, { sections: claimed });
    assert.deepEqual([refused.json.error?.code, refused.json.error?.param], ['store_text_refused', `sections[${hero}].subtitle`]);

    const phrase = await admin.post('/v1/admin/classifieds/resale-claim-phrases', { phrase: 'Our Own Brand' });
    assert.equal(phrase.json.phrase, 'our own brand');
    const branded = draft.map((section, index) => (index === hero ? { ...section, title: 'Our own brand of phones' } : section));
    assert.equal((await owner.browser.put(`/v1/stores/${made.json.id}/home/draft`, { sections: branded })).json.error.code, 'store_text_refused');
    await admin.delete(`/v1/admin/classifieds/resale-claim-phrases/${phrase.json.id}`);
    assert.equal((await owner.browser.put(`/v1/stores/${made.json.id}/home/draft`, { sections: branded })).status, 200);
    assert.ok(await prisma.auditLog.count({ where: { action: 'classifieds.resale_phrase_added' } }));

    // Other templates' stores are not checked (made directly: Udozo's own stores are Resale shops only).
    const gift = { json: await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Gift Store', subdomain: `gifts${Date.now() % 100000}`, template: 'gift_cards' } }) };
    const giftDraft = (await owner.browser.get(`/v1/stores/${gift.json.id}/home`)).json.draft.map((section, index) => (index === 0 && section.type === 'hero' ? { ...section, subtitle: 'Made by us.' } : section));
    assert.equal((await owner.browser.put(`/v1/stores/${gift.json.id}/home/draft`, { sections: giftDraft })).status, 200);
  });
});
