// udozo.com's home pages: a page across countries and one per country, each with one of three layouts and its sections
// (masonry categories, deals, Sponsored, top selling, groups, banners, countries), drafted, previewed and published by
// admins; filled with listings when read, never showing one twice, never a price across countries; Sponsored placements;
// and listings' page views (counted once per visitor, never the seller's own, never robots).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let admin;
let support;
let prisma;
const made = {};
const day = 86_400_000;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
  for (const country of ['NG', 'GH']) {
    assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: country, enabled: true })).status, 200);
    await prisma.classifiedMarketSettings.upsert({ where: { country }, create: { country, firstListingsReviewed: 0, monthlyListingLimit: 100 }, update: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
  }
  const phones = await prisma.classifiedCategory.findMany({ where: { slug: { in: ['phones-tablets', 'mobile-phones'] } } });
  for (const category of phones) await prisma.classifiedCategoryCountry.upsert({ where: { categoryId_country: { categoryId: category.id, country: 'GH' } }, create: { categoryId: category.id, country: 'GH' }, update: { enabled: true } });
  made.ghArea = (await prisma.classifiedArea.findFirst({ where: { country: 'GH', kind: 'area' } })).slug;

  made.seller = await customer('Chinedu Okafor');
  made.buyer = await customer('Kemi Adeyemi');
  made.ghSeller = await customer('Ama Mensah', 'GH');
  made.phone = await live(made.seller, { title: 'Samsung Galaxy A54', area: 'ikeja' });
  made.tv = await live(made.seller, { title: 'LG 55 inch television', area: 'yaba' });
  made.fridge = await live(made.seller, { title: 'Hisense fridge', area: 'ikeja' });
  made.gh = await live(made.ghSeller, { title: 'iPhone 13 in Accra', area: made.ghArea, country: 'GH', price: 800000 });
});

after(async () => {
  for (const country of ['NG', 'GH']) await admin?.put('/v1/admin/switches/classifieds', { country_code: country, enabled: null });
  server?.close();
});

let counter = 0;
function shopper() {
  let token = null;
  const request = async (method, path, body, headers = {}) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { 'idempotency-key': `home-${Date.now()}-${Math.random()}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, cache: res.headers.get('cache-control') };
  };
  return { get: (path, headers) => request('GET', path, undefined, headers), post: (path, body = {}, headers) => request('POST', path, body, headers), token: () => token };
}

async function customer(name, country = 'NG') {
  const person = shopper();
  const email = `home${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country, phone: testMobile(country) });
  await confirmMobile(server.app, person);
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  person.id = signup.json.customer.id;
  return person;
}

async function live(person, { title, area, country = 'NG', price = 25000000 }) {
  const [category, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'mobile-phones' } }), prisma.classifiedArea.findFirstOrThrow({ where: { country, kind: 'area', slug: area } })]);
  const draft = await person.post('/v1/classifieds/listings', { title, category_id: category.id, area_id: place.id, price, condition: 'used', delivery: 'none', contact: 'chat', description: `${title}. Clean, works perfectly.` });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.json.id, kind: 'photo', position, url: `https://media.test/${draft.json.id}/${position}.jpg`, width: 1600, height: 1200 })) });
  const submitted = await person.post(`/v1/classifieds/listings/${draft.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const visitor = shopper();
const home = async (page, query = '') => visitor.get(`/v1/classifieds/home?page=${page}${query}`);
const sectionOf = (result, type) => result.json.sections.find(section => section.type === type);
const idsIn = section => (section?.data.items ?? []).map(item => item.id);
/** Public reads are cached a minute per instance; tests read through a fresh preview, or after the service forgets. */
async function fresh(page) {
  const { HomeService } = await import('../dist/classifieds/home/home.service.js');
  server.app.get(HomeService).forget();
  return home(page);
}

describe('the pages', () => {
  test('admins list the page across countries and each open market, each with its default layout', async () => {
    const list = await support.get('/v1/admin/classifieds/home');
    assert.equal(list.status, 200, JSON.stringify(list.json));
    const pages = Object.fromEntries(list.json.data.map(row => [row.page, row]));
    assert.equal(pages.global.layout, 'explorer');
    assert.equal(pages.NG.layout, 'marketplace');
    assert.equal(pages.GH.scope, 'country');
    assert.equal(pages.NG.live, false);
  });

  test("a country's page offers no country tiles, the global page no deals; the editor's field is named", async () => {
    const ng = await support.get('/v1/admin/classifieds/home/ng');
    assert.equal(ng.status, 200);
    assert.ok(!ng.json.blocks_allowed.includes('country_tiles'));
    assert.deepEqual(ng.json.layouts.map(layout => layout.key), ['marketplace', 'deals', 'explorer']);
    assert.equal(ng.json.rows[0].blocks[0].type, 'home_hero');
    const row = blocks => ({ id: `row-${blocks[0].id}`, blocks });
    const tiles = await admin.put('/v1/admin/classifieds/home/NG/draft', { rows: [row([{ id: 'a', type: 'country_tiles', span: { lg: 12, md: 6 } }])] });
    assert.equal(tiles.status, 400);
    assert.equal(tiles.json.error.code, 'layout_invalid');
    assert.equal(tiles.json.error.param, 'rows[0].blocks[0].type');
    const deals = await admin.put('/v1/admin/classifieds/home/global/draft', { rows: [row([{ id: 'a', type: 'deals_rail', span: { lg: 12, md: 6 } }])] });
    assert.equal(deals.json.error.param, 'rows[0].blocks[0].type');
    // Across countries a banner cannot send people to a search (searches are a country's).
    const search = await admin.put('/v1/admin/classifieds/home/global/draft', { rows: [row([{ id: 'b', type: 'banner', span: { lg: 12, md: 6 }, items: [{ title: 'Phones', link: { kind: 'search', q: 'iphone' } }] }])] });
    assert.equal(search.json.error.param, 'rows[0].blocks[0].items[0].link.kind');
    const group = await admin.put('/v1/admin/classifieds/home/NG/draft', { rows: [row([{ id: 'c', type: 'listing_group', span: { lg: 12, md: 6 }, title: 'By place', by: 'area' }])] });
    assert.equal(group.json.error.param, 'rows[0].blocks[0].value');
    // The editor of before still saves sections, as rows.
    const sections = await admin.put('/v1/admin/classifieds/home/NG/draft', { sections: [{ id: 'd', type: 'trust_bar', span: { lg: 12, md: 6 }, items: [{ icon: 'shield', title: 'UdozoPay' }] }] });
    assert.equal(sections.status, 200, JSON.stringify(sections.json));
    assert.deepEqual(sections.json.rows.map(item => item.blocks.map(block => block.id)), [['d']]);
    // Support reads, never changes.
    assert.equal((await support.put('/v1/admin/classifieds/home/NG/draft', { rows: [] })).status, 403);
    assert.equal((await support.get('/v1/admin/classifieds/home/ZZ')).status, 404);
  });

  test('a layout chosen with its own sections, published as a version and served (cached a minute)', async () => {
    const chosen = await admin.post('/v1/admin/classifieds/home/NG/layout', { layout: 'deals', replace: true });
    assert.equal(chosen.status, 200, JSON.stringify(chosen.json));
    assert.equal(chosen.json.layout, 'deals');
    assert.equal(chosen.json.draft[0].style, 'carousel');
    assert.equal(chosen.json.unpublished_changes, true);
    const published = await admin.post('/v1/admin/classifieds/home/NG/publish');
    assert.equal(published.status, 200, JSON.stringify(published.json));
    assert.equal(published.json.version, 1);
    assert.equal(published.json.live, true);
    const page = await fresh('NG');
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.cache, 'public, max-age=60');
    assert.equal(page.json.source, 'published');
    assert.equal(page.json.layout, 'deals');
    assert.deepEqual(page.json.look, { hero: 'brand', cards: 'compact', corners: 'soft', density: 'compact' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'home_page.published', targetId: 'NG' } });
    assert.ok(audit);
  });

  test("a draft previewed with the page's own link; restoring a version brings its layout back", async () => {
    const changed = await admin.post('/v1/admin/classifieds/home/NG/layout', { layout: 'explorer', replace: false });
    assert.equal(changed.json.layout, 'explorer');
    const link = await support.post('/v1/admin/classifieds/home/NG/preview');
    assert.equal(link.status, 200);
    const preview = await home('NG', `&preview=${encodeURIComponent(link.json.token)}`);
    assert.equal(preview.json.source, 'draft');
    assert.equal(preview.json.layout, 'explorer');
    assert.equal(preview.cache, 'no-store');
    // Another page's link, or a forged one, shows nothing.
    const other = await support.post('/v1/admin/classifieds/home/GH/preview');
    assert.equal((await home('NG', `&preview=${encodeURIComponent(other.json.token)}`)).status, 401);
    const restored = await admin.post('/v1/admin/classifieds/home/NG/restore', { version: 1 });
    assert.equal(restored.json.layout, 'deals');
    assert.equal(restored.json.unpublished_changes, false);
  });

  test('taken offline, a page shows its default layout again; the page across countries needs two markets', async () => {
    const offline = await admin.post('/v1/admin/classifieds/home/GH/unpublish');
    assert.equal(offline.json.error.code, 'home_page_not_published');
    const gh = await fresh('GH');
    assert.equal(gh.json.source, 'default');
    assert.equal(gh.json.layout, 'marketplace');
    const global = await fresh('global');
    assert.equal(global.status, 200);
    assert.equal(global.json.layout, 'explorer');
    const tiles = sectionOf(global, 'country_tiles');
    assert.deepEqual(tiles.data.countries.map(item => item.country).sort(), ['GH', 'NG']);
    assert.equal(tiles.data.countries.find(item => item.country === 'NG').href, '/market/ng');
  });
});

describe('what the pages show', () => {
  const page = sections => admin.put('/v1/admin/classifieds/home/NG/draft', { sections }).then(async saved => {
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    await admin.post('/v1/admin/classifieds/home/NG/publish');
    return fresh('NG');
  });
  const full = { lg: 12, md: 6 };

  test('Sponsored placements come first, labelled, and are never repeated in the rails after them', async () => {
    const start = new Date(Date.now() - day).toISOString();
    const end = new Date(Date.now() + 7 * day).toISOString();
    const placed = await admin.post('/v1/admin/classifieds/sponsored', { listing_ref: made.tv.ref, country: 'NG', starts_at: start, ends_at: end, note: 'Launch week' });
    assert.equal(placed.status, 201, JSON.stringify(placed.json));
    assert.equal(placed.json.state, 'active');
    // A listing is placed on its own country's page, or across countries; at most 90 days.
    assert.equal((await admin.post('/v1/admin/classifieds/sponsored', { listing_ref: made.gh.ref, country: 'NG', starts_at: start, ends_at: end })).json.error.param, 'country');
    assert.equal((await admin.post('/v1/admin/classifieds/sponsored', { listing_ref: made.tv.ref, country: 'NG', starts_at: start, ends_at: new Date(Date.now() + 100 * day).toISOString() })).json.error.param, 'ends_at');
    assert.equal((await support.post('/v1/admin/classifieds/sponsored', { listing_ref: made.tv.ref, country: 'NG', starts_at: start, ends_at: end })).status, 403);

    const result = await page([
      { id: 'n', type: 'listing_group', span: full, title: 'Newest', by: 'newest' },
      { id: 's', type: 'sponsored_rail', span: full },
    ]);
    const sponsored = sectionOf(result, 'sponsored_rail');
    assert.deepEqual(idsIn(sponsored), [made.tv.id]);
    assert.equal(sponsored.data.items[0].sponsored, true);
    assert.ok(!idsIn(sectionOf(result, 'listing_group')).includes(made.tv.id));
    // The page keeps the admin's order, whatever was filled first.
    assert.deepEqual(result.json.sections.map(section => section.id), ['n', 's']);

    // Ended early: gone from the page at once, kept for the record.
    assert.equal((await admin.post(`/v1/admin/classifieds/sponsored/${placed.json.id}/end`)).json.state, 'ended');
    assert.deepEqual(idsIn(sectionOf(await fresh('NG'), 'sponsored_rail')), []);
    assert.equal((await support.get('/v1/admin/classifieds/sponsored?country=NG&state=ended')).json.data.length, 1);
  });

  test('across countries: placements of its own, cards without prices, naming their country', async () => {
    const start = new Date(Date.now() - day).toISOString();
    const end = new Date(Date.now() + 7 * day).toISOString();
    assert.equal((await admin.post('/v1/admin/classifieds/sponsored', { listing_ref: made.gh.ref, country: null, starts_at: start, ends_at: end })).status, 201);
    const global = await fresh('global');
    const sponsored = sectionOf(global, 'sponsored_rail');
    assert.deepEqual(idsIn(sponsored), [made.gh.id]);
    assert.equal(sponsored.data.items[0].country, 'GH');
    for (const section of global.json.sections) for (const item of section.data.items ?? []) assert.equal(item.price, undefined, `${section.type} shows a price`);
    // The global placement is not on Nigeria's page.
    assert.ok(!idsIn(sectionOf(await fresh('NG'), 'sponsored_rail') ?? { data: {} }).includes(made.gh.id));
  });

  test('top selling is released UdozoPay sales; with too few, the most contacted, titled Popular, never both', async () => {
    const section = { id: 't', type: 'top_selling_rail', span: full, minimum: 1 };
    await prisma.classifiedListing.update({ where: { id: made.fridge.id }, data: { leads: 5 } });
    const popular = sectionOf(await page([section]), 'top_selling_rail');
    assert.equal(popular.data.basis, 'popular');
    assert.equal(popular.data.heading, 'Popular');
    assert.equal(idsIn(popular)[0], made.fridge.id);

    await prisma.classifiedOrder.create({
      data: {
        listingId: made.phone.id, buyerId: made.buyer.id, sellerId: made.seller.id, mode: 'live', country: 'NG', currency: 'NGN', priceMinor: 25000000,
        buyerFeeBps: 100, buyerFeeCapMinor: 100000, buyerFeeMinor: 100000, sellerFeeBps: 100, sellerFeeCapMinor: 100000, fulfilment: 'meet_up', acceptBy: new Date(), status: 'released', releasedAt: new Date(),
      },
    });
    const sales = sectionOf(await fresh('NG'), 'top_selling_rail');
    assert.equal(sales.data.basis, 'sales');
    assert.equal(sales.data.heading, 'Top selling');
    assert.deepEqual(idsIn(sales), [made.phone.id]);
  });

  test('deals: a price that came down, with the lowest price of the 30 days before as its was-price', async () => {
    const now = Date.now();
    await prisma.classifiedPriceHistory.deleteMany({ where: { listingId: made.fridge.id } });
    await prisma.classifiedPriceHistory.createMany({
      data: [
        { listingId: made.fridge.id, priceMinor: 30000000n, from: new Date(now - 20 * day), to: new Date(now - 9 * day) },
        { listingId: made.fridge.id, priceMinor: 26000000n, from: new Date(now - 9 * day), to: new Date(now - 2 * day) },
        { listingId: made.fridge.id, priceMinor: 20000000n, from: new Date(now - 2 * day), to: null },
      ],
    });
    await prisma.classifiedListing.update({ where: { id: made.fridge.id }, data: { priceMinor: 20000000n } });
    const deals = sectionOf(await page([{ id: 'd', type: 'deals_rail', span: full }]), 'deals_rail');
    assert.deepEqual(idsIn(deals), [made.fridge.id]);
    assert.equal(deals.data.items[0].was_price, 26000000);
    assert.equal(deals.data.items[0].price.amount, 20000000);
  });

  test("category tiles: the categories chosen, linking to the country's own pages, an admin's photo first", async () => {
    const result = await page([{ id: 'm', type: 'category_masonry', span: full, tiles: [{ slug: 'phones-tablets', size: 'lg', image: 'https://media.test/phones.jpg' }, { slug: 'no-such-category' }] }]);
    const tiles = sectionOf(result, 'category_masonry').data.tiles;
    assert.equal(tiles.length, 1);
    assert.deepEqual([tiles[0].href, tiles[0].size, tiles[0].image], ['/ng/c/phones-tablets', 'lg', 'https://media.test/phones.jpg']);
    assert.ok(tiles[0].listings >= 3);
  });
});

describe("a listing's page views", () => {
  const view = (ref, { agent = 'Mozilla/5.0 (Linux; Android 14) Chrome/141', person = visitor } = {}) => person.post(`/v1/classifieds/listings/${ref}/view`, undefined, { 'user-agent': agent });

  test('count once per visitor in half an hour; never robots or the seller themselves', async () => {
    const before = (await prisma.classifiedListing.findUniqueOrThrow({ where: { id: made.phone.id } })).views;
    assert.equal((await view(made.phone.ref)).status, 204);
    await view(made.phone.ref);
    await view(made.phone.ref, { agent: 'Googlebot/2.1' });
    await view(made.phone.ref, { person: made.seller });
    const row = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: made.phone.id } });
    assert.equal(row.views, before + 1);
    const days = await prisma.classifiedListingViewDay.findMany({ where: { listingId: made.phone.id } });
    assert.equal(days.reduce((sum, item) => sum + item.views, 0), 1);
    // An unknown listing answers the same, telling nothing.
    assert.equal((await view(99999999)).status, 204);
  });
});
