// Udozo POS milestone 2 (docs/UDOZO_POS_PLAN.md): the catalogue. A udozo.com listing ticked Sell at POS (the seller's POS
// account first, within its plan's product limit), sold at the shop only when it is on neither Udozo nor resellers, with
// a barcode (EANs checked, one per listing of the seller's) and a reorder level; and pos.udozo.com's catalogue reading
// those listings live: what the till can sell, what is low or out, what the plan's limit holds back, and unticking one
// taking it off.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { cleanBarcode, gtinValid } from '../dist/pos/catalogue-rules.js';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_auctions', 'pos']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'free' }, data: { limits: { products: 3, shops: 1, tills: 2, staff: 3 } } });
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
        ...(method === 'POST' ? { 'idempotency-key': `catalogue-${randomUUID()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function seller(pos = true) {
  const person = storeServer();
  const email = `catalogue${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name: 'Ada Okafor', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, person);
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  if (pos) assert.equal((await person.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: "Ada's Gadget Hub", vat_bps: 0 } })).status, 201);
  person.id = signup.json.customer.id;
  return person;
}

async function draft(person, title, extra = {}) {
  const [category, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const made = await person.post('/v1/classifieds/listings', { title, price: 25_000_000, condition: 'new', category_id: category.id, area_id: area.id, stock: 5, ...extra });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/${made.json.id}-${position}.jpg` })) });
  return made.json;
}

async function live(person, title, extra = {}) {
  const made = await draft(person, title, extra);
  const submitted = await person.post(`/v1/classifieds/listings/${made.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const catalogue = async (person, query = '') => {
  const res = await person.get(`/v1/pos/owner/catalogue${query}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json;
};

describe('barcodes', () => {
  test('EANs and UPCs need their check digit; other codes are 3 to 48 characters without spaces', () => {
    for (const code of ['4006381333931', '036000291452', '96385074', '10614141000415']) assert.equal(gtinValid(code), true, code);
    for (const code of ['4006381333932', '036000291453', '1234']) assert.equal(gtinValid(code), false, code);
    assert.equal(cleanBarcode('  4006381333931 '), '4006381333931');
    assert.equal(cleanBarcode('SKU-TV-43'), 'SKU-TV-43');
    assert.equal(cleanBarcode(''), null);
    assert.equal(cleanBarcode(null), null);
    for (const code of ['4006381333932', 'AB', 'has space', 'x'.repeat(49)]) assert.throws(() => cleanBarcode(code), error => error.code === 'barcode_invalid', code);
  });
});

describe('Sell at POS on a listing', () => {
  test('needs the seller’s Udozo POS account, and says how many their plan allows', async () => {
    const person = await seller(false);
    const status = await person.get('/v1/classifieds/me/pos');
    assert.deepEqual(status.json, { object: 'pos_status', account: false, plan: null, products: { used: 0, limit: null } });
    const tv = await draft(person, 'Hisense 43 inch smart TV');
    const refused = await person.patch(`/v1/classifieds/listings/${tv.id}`, { pos_enabled: true });
    assert.equal(refused.status, 409);
    assert.deepEqual([refused.json.error.code, refused.json.error.param], ['pos_account_required', 'pos_enabled']);

    assert.equal((await person.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: 'Ada Stores' } })).status, 201);
    const ticked = await person.patch(`/v1/classifieds/listings/${tv.id}`, { pos_enabled: true, barcode: '4006381333931', reorder_level: 2 });
    assert.equal(ticked.status, 200, JSON.stringify(ticked.json));
    assert.deepEqual([ticked.json.pos_enabled, ticked.json.barcode, ticked.json.reorder_level], [true, '4006381333931', 2]);
    assert.deepEqual((await person.get('/v1/classifieds/me/pos')).json.products, { used: 1, limit: 3 });
  });

  test('Free’s product limit stops the next tick, not anything already ticked; sold and deleted listings free a place', async () => {
    const person = await seller();
    const made = [];
    for (const title of ['Samsung 50 inch TV', 'LG 32 inch TV', 'TCL 55 inch TV']) made.push(await live(person, title, { pos_enabled: true }));
    const fourth = await person.post('/v1/classifieds/listings', { title: 'Sony 65 inch TV', pos_enabled: true });
    assert.equal(fourth.status, 409);
    assert.deepEqual([fourth.json.error.code, fourth.json.error.param], ['pos_limit_reached', 'pos_enabled']);
    assert.match(fourth.json.error.message, /Free sells 3 products at your shop/);
    // Saving a ticked listing again is not ticking it again.
    assert.equal((await person.patch(`/v1/classifieds/listings/${made[0].id}`, { pos_enabled: true, reorder_level: 1 })).status, 200);

    assert.equal((await person.del(`/v1/classifieds/listings/${made[2].id}`)).status, 204);
    const fifth = await person.post('/v1/classifieds/listings', { title: 'Sony 65 inch TV', pos_enabled: true });
    assert.equal(fifth.status, 201, JSON.stringify(fifth.json));
    assert.equal(fifth.json.pos_enabled, true);
  });

  test('a shop-only listing is sold at the shop and never on udozo.com; one sold nowhere is refused', async () => {
    const person = await seller();
    const nowhere = await person.post('/v1/classifieds/listings', { title: 'Panasonic microwave oven', on_shop: false });
    assert.equal(nowhere.json.error?.code, 'channel_required');
    const shopOnly = await live(person, 'Panasonic microwave oven', { on_shop: false, pos_enabled: true });
    assert.deepEqual([shopOnly.on_shop, shopOnly.pos_enabled, shopOnly.url], [false, true, null]);
    // Unticking it would leave it sold nowhere.
    assert.equal((await person.patch(`/v1/classifieds/listings/${shopOnly.id}`, { pos_enabled: false })).json.error?.code, 'channel_required');
    // udozo.com never shows it.
    assert.equal((await storeServer().get(`/v1/classifieds/listings/${shopOnly.ref}?country=NG`)).status, 404);
    const search = await storeServer().get(`/v1/classifieds/listings?country=NG&q=${encodeURIComponent('Panasonic microwave')}`);
    assert.ok(!(search.json?.data ?? []).some(card => card.ref === shopOnly.ref), 'not in search');
  });

  test('a barcode is checked and names one of the seller’s listings; deleting frees it', async () => {
    const person = await seller();
    const first = await draft(person, 'Philips steam iron', { barcode: '4006381333931' });
    assert.equal(first.barcode, '4006381333931');
    const typo = await person.post('/v1/classifieds/listings', { title: 'Philips kettle', barcode: '4006381333932' });
    assert.deepEqual([typo.status, typo.json.error.code, typo.json.error.param], [400, 'barcode_invalid', 'barcode']);
    const taken = await person.post('/v1/classifieds/listings', { title: 'Philips kettle', barcode: '4006381333931' });
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'barcode_taken']);
    // Another seller's listing may carry the same code.
    const other = await seller();
    assert.equal((await other.post('/v1/classifieds/listings', { title: 'Philips steam iron', barcode: '4006381333931' })).status, 201);
    // Emptied, it is removed.
    assert.equal((await person.patch(`/v1/classifieds/listings/${first.id}`, { barcode: '' })).json.barcode, null);
    assert.equal((await person.post('/v1/classifieds/listings', { title: 'Philips kettle', barcode: '4006381333931' })).status, 201);
  });

  test('an auction is sold on Udozo only', async () => {
    const person = await seller();
    const refused = await person.post('/v1/classifieds/listings', { title: 'Vintage gramophone', sale_method: 'auction', pos_enabled: true });
    assert.deepEqual([refused.status, refused.json.error.param], [400, 'pos_enabled']);
  });
});

describe('the POS catalogue', () => {
  test('reads the ticked listings live: what sells, what is low or out, and why the rest cannot sell', async () => {
    const person = await seller();
    const stranger = await seller();
    await live(stranger, 'Not mine: Hisense TV', { pos_enabled: true });
    assert.equal((await storeServer().get('/v1/pos/owner/catalogue')).status, 401);
    assert.equal((await (await seller(false)).get('/v1/pos/owner/catalogue')).json.error.code, 'pos_account_missing');

    const tv = await live(person, 'Samsung 43 inch smart TV', { pos_enabled: true, barcode: '036000291452', reorder_level: 5, stock: 4 });
    const fan = await live(person, 'Binatone standing fan', { pos_enabled: true, stock: 0 });
    const asking = await draft(person, 'Thermocool freezer', { pos_enabled: true, price_kind: 'on_request' });
    await live(person, 'Not at the shop: Nokia phone');

    const all = await catalogue(person);
    assert.equal(all.total, 3, 'only the ticked listings, never another seller’s');
    assert.deepEqual(all.summary, { products: 3, limit: 3, over_limit: 0, sellable: 1, low_stock: 1, out_of_stock: 1 });
    assert.equal(all.currency, 'NGN');
    const byId = Object.fromEntries(all.data.map(item => [item.id, item]));
    assert.deepEqual(
      [byId[tv.id].blocked, byId[tv.id].available, byId[tv.id].low_stock, byId[tv.id].barcode, byId[tv.id].price.amount, byId[tv.id].on_udozo],
      [null, 4, true, '036000291452', 25_000_000, true],
    );
    assert.equal(byId[tv.id].photo_url, `https://media.test/${tv.id}-0.jpg`);
    assert.equal(byId[tv.id].edit_url, `https://udozo.com/account/listings/${tv.id}`);
    assert.equal(byId[tv.id].category.name, 'TVs and home cinema');
    assert.equal(byId[fan.id].blocked, 'out_of_stock');
    assert.equal(byId[asking.id].blocked, 'no_price', 'the till sells at a price');
    assert.deepEqual(all.categories.map(item => item.count), [3]);

    // Found by barcode, words or number; filtered.
    assert.deepEqual((await catalogue(person, '?barcode=036000291452')).data.map(item => item.id), [tv.id]);
    assert.deepEqual((await catalogue(person, '?q=fan')).data.map(item => item.id), [fan.id]);
    assert.deepEqual((await catalogue(person, `?q=${tv.ref}`)).data.map(item => item.id), [tv.id]);
    assert.deepEqual((await catalogue(person, '?show=sellable')).data.map(item => item.id), [tv.id]);
    assert.deepEqual((await catalogue(person, '?show=low_stock')).data.map(item => item.id), [tv.id]);
    assert.deepEqual((await catalogue(person, '?show=out_of_stock')).data.map(item => item.id), [fan.id]);
    assert.deepEqual((await catalogue(person, '?show=blocked')).data.map(item => item.id), [asking.id]);
    const page = await catalogue(person, '?limit=2');
    assert.deepEqual([page.data.length, page.has_more], [2, true]);

    // Live: a new price shows at once, and unticking takes it off.
    await person.patch(`/v1/classifieds/listings/${tv.id}`, { price: 24_000_000 });
    assert.equal((await catalogue(person, '?barcode=036000291452')).data[0].price.amount, 24_000_000);
    await person.patch(`/v1/classifieds/listings/${fan.id}`, { pos_enabled: false });
    assert.equal((await catalogue(person)).total, 2);
  });

  test('when the plan allows fewer than are ticked, the first ticked keep selling and the rest say why', async () => {
    const person = await seller();
    const first = await live(person, 'Hisense 32 inch TV', { pos_enabled: true });
    const second = await live(person, 'Hisense 40 inch TV', { pos_enabled: true });
    const account = await prisma.posAccount.findUniqueOrThrow({ where: { customerId: person.id } });
    // As a lapsed paid plan dropping to a Free that allows one.
    const plan = await prisma.posPlan.create({ data: { code: `test-${randomUUID().slice(0, 8)}`, name: 'Tiny', description: 'Test plan', limits: { products: 1, shops: 1, tills: 1, staff: 1 }, prices: {}, shown: false, trialDays: 0, position: 99 } });
    await prisma.posAccount.update({ where: { id: account.id }, data: { planCode: plan.code } });
    const listed = await catalogue(person);
    const byId = Object.fromEntries(listed.data.map(item => [item.id, item.blocked]));
    assert.deepEqual([byId[first.id], byId[second.id]], [null, 'plan_limit']);
    assert.deepEqual([listed.summary.limit, listed.summary.over_limit, listed.summary.sellable], [1, 1, 1]);
    await prisma.posAccount.update({ where: { id: account.id }, data: { planCode: 'free' } });
    await prisma.posPlan.delete({ where: { code: plan.code } });
  });
});

describe('selling at the shop only', () => {
  test('a shop-only listing needs only a title, category and price, goes live at once with no end, and never leaves the till for running out', async () => {
    const person = await seller();
    const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
    const made = await person.post('/v1/classifieds/listings', { title: 'Shop counter TV', category_id: category.id, price: 9_000_000, on_shop: false, pos_enabled: true, stock: 2 });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    // A draft with its price already sells at the till.
    assert.equal((await catalogue(person)).data.find(item => item.id === made.json.id).blocked, null);
    const posted = await person.post(`/v1/classifieds/listings/${made.json.id}/submit`);
    assert.equal(posted.status, 200, JSON.stringify(posted.json));
    assert.deepEqual([posted.json.status, posted.json.expires_at, posted.json.published_at, posted.json.url], ['active', null, null, null], 'no photos, area, condition, review or end date');
    const out = await person.patch(`/v1/classifieds/listings/${made.json.id}`, { stock: 0 });
    assert.deepEqual([out.json.status, out.json.expires_at, out.json.delist_at], ['active', null, null], 'out of stock, it stays at the till');
    // Sold on Udozo too from now: back to a draft, posted through the public checks.
    const opened = await person.patch(`/v1/classifieds/listings/${made.json.id}`, { on_shop: true });
    assert.equal(opened.json.status, 'draft');
    assert.equal((await person.post(`/v1/classifieds/listings/${made.json.id}/submit`)).json.error?.code, 'listing_incomplete');
  });

  test('shop-only categories are offered only to sellers with Udozo POS, never on the public market, and keep their listings at the shop', async () => {
    const person = await seller();
    const shopCategories = (await person.get('/v1/classifieds/me/shop-categories')).json.data;
    assert.deepEqual(shopCategories.map(top => top.slug), ['pharmacy']);
    assert.deepEqual(shopCategories[0].children.map(child => child.slug), ['prescription-medicines', 'otc-medicines', 'herbal-medicines', 'vitamins-supplements']);
    assert.equal(shopCategories[0].shop_only, true);
    assert.ok(shopCategories[0].children[0].features.some(feature => feature.key === 'expiry'));
    assert.deepEqual((await (await seller(false)).get('/v1/classifieds/me/shop-categories')).json.data, []);
    const market = await storeServer().get('/v1/classifieds/categories?country=NG');
    assert.ok(!market.json.data.some(top => top.slug === 'pharmacy'), 'never in the public market');

    const rx = shopCategories[0].children[0];
    const made = await person.post('/v1/classifieds/listings', { title: 'Amoxicillin 500mg capsules, pack of 21', category_id: rx.id, price: 350_000, stock: 30 });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.on_shop, made.json.resale.enabled, made.json.pos_enabled], [false, false, true], 'made shop-only by its category');
    assert.equal((await person.post(`/v1/classifieds/listings/${made.json.id}/submit`)).json.status, 'active');
    for (const change of [{ on_shop: true }, { resale: true }, { pos_enabled: false }]) {
      assert.equal((await person.patch(`/v1/classifieds/listings/${made.json.id}`, change)).json.error?.code, 'shop_only_category', JSON.stringify(change));
    }
    assert.equal((await storeServer().get(`/v1/classifieds/listings/${made.json.ref}?country=NG`)).status, 404);

    const without = await seller(false);
    assert.equal((await without.post('/v1/classifieds/listings', { title: 'Amoxicillin capsules', category_id: rx.id })).json.error?.code, 'pos_account_required');
  });
});

describe('shop kinds', () => {
  test('a shop says what kind it is, and the catalogue leads with that kind’s categories', async () => {
    const kinds = (await storeServer().get('/v1/pos/shop-kinds')).json.data;
    assert.deepEqual(kinds.map(kind => kind.code), ['general', 'pharmacy', 'auto_parts', 'phones_electronics', 'supermarket', 'fashion_beauty', 'building_hardware']);
    const person = await seller();
    const owner = (await person.get('/v1/pos/owner')).json;
    const shop = owner.account.shops[0];
    assert.equal(shop.kind.code, 'general');
    assert.equal((await person.patch(`/v1/pos/owner/shops/${shop.id}`, { kind: 'bakery' })).status, 400);
    const changed = await person.patch(`/v1/pos/owner/shops/${shop.id}`, { kind: 'pharmacy' });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));

    const tv = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
    const rx = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'otc-medicines' } });
    for (const title of ['Hisense 32 inch TV', 'Sony 40 inch TV']) await person.post('/v1/classifieds/listings', { title, category_id: tv.id, price: 100_000, on_shop: false, pos_enabled: true });
    await person.post('/v1/classifieds/listings', { title: 'Paracetamol 500mg tablets', category_id: rx.id, price: 50_000 });
    const listed = await catalogue(person);
    assert.deepEqual(listed.shop_kind, { code: 'pharmacy', name: 'Pharmacy or chemist' });
    assert.deepEqual(listed.categories.map(item => [item.name, item.count, item.featured]), [['Pharmacy and medicines', 1, true], ['Electronics', 2, false]]);
  });
});
