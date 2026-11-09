// udozo.com's home pages in rows (docs/UDOZO_HOME_ROWS_PLAN.md): every part of a page belongs to a row of blocks; pages
// from before rows read as rows that look the same; listing marquees (picks first, then a source), stores marquees of
// resellers' live shops, masonry grids of any tile, banners for a category; and the editor's view of rows not saved yet.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, resellerClient, startApp, testMobile } from './helpers.mjs';

let server;
let admin;
let support;
let prisma;
const made = {};
const full = { lg: 12, md: 6 };
const half = { lg: 6, md: 3 };

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
  for (const country of ['NG', 'GH']) {
    assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: country, enabled: true })).status, 200);
    await prisma.classifiedMarketSettings.upsert({ where: { country }, create: { country, firstListingsReviewed: 0, monthlyListingLimit: 100 }, update: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
  }
  made.seller = await customer('Chinedu Okafor');
  made.phone = await live(made.seller, 'Samsung Galaxy A54');
  made.tv = await live(made.seller, 'Infinix Hot 40');
  made.sold = await live(made.seller, 'Tecno Spark 20');
  await prisma.classifiedListing.update({ where: { id: made.sold.id }, data: { status: 'sold' } });
});

after(async () => {
  for (const country of ['NG', 'GH']) await admin?.put('/v1/admin/switches/classifieds', { country_code: country, enabled: null });
  server?.close();
});

let counter = 0;
function shopper() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { 'idempotency-key': `rows-${Date.now()}-${Math.random()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

async function customer(name, country = 'NG') {
  const person = shopper();
  const email = `rows${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country, phone: testMobile(country) });
  await confirmMobile(server.app, person);
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  return person;
}

async function live(person, title) {
  const [category, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'mobile-phones' } }), prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } })]);
  const draft = await person.post('/v1/classifieds/listings', { title, category_id: category.id, area_id: place.id, price: 25000000, condition: 'used', delivery: 'none', contact: 'chat', description: `${title}. Clean, works perfectly.` });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.json.id, kind: 'photo', position, url: `https://media.test/${draft.json.id}/${position}.jpg`, width: 1600, height: 1200 })) });
  const submitted = await person.post(`/v1/classifieds/listings/${draft.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  const row = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: draft.json.id }, select: { ref: true } });
  return { ...submitted.json, ref: row.ref.toString() };
}

/** A reseller's Resale shop: live on its own domain (shown), or not (never shown). */
async function shop(name, { live = true, domain = true, country = 'NG' } = {}) {
  const owner = await resellerClient(server, { country, business: name });
  const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name, subdomain: `rows${Date.now() % 1_000_000}${(counter += 1)}`, status: 'published', template: 'resale_shop', checkoutMode: live ? 'live' : 'test', logoUrl: 'https://media.test/logo.png' } });
  if (domain) await prisma.storeDomain.create({ data: { resellerId: owner.resellerId, storeId: store.id, name: `${store.subdomain}.shop.test`, source: 'connected', status: 'active', primary: true } });
  return store;
}

const visitor = shopper();
const row = (blocks, settings = {}) => ({ id: `row-${blocks[0].id}`, ...settings, blocks });
const save = rows => admin.put('/v1/admin/classifieds/home/NG/draft', { rows });
const publish = async rows => {
  assert.equal((await save(rows)).status, 200);
  assert.equal((await admin.post('/v1/admin/classifieds/home/NG/publish')).status, 200);
  return visitor.get(`/v1/classifieds/home?page=NG&preview=${(await admin.post('/v1/admin/classifieds/home/NG/preview')).json.token}`);
};

describe('rows', () => {
  test('rows of up to six blocks, each id its own, a photo for a photo background; refusals name the field', async () => {
    const seven = Array.from({ length: 7 }, (_, n) => ({ id: `t${n}`, type: 'trust_bar', span: full, items: [{ icon: 'shield', title: 'UdozoPay' }] }));
    assert.equal((await save([row(seven)])).json.error.param, 'rows[0].blocks');
    assert.equal((await save([row([seven[0]]), row([seven[0]])])).json.error.code, 'layout_invalid', 'a block id used twice');
    const photo = await save([row([seven[0]], { background: 'image' })]);
    assert.equal(photo.json.error.param, 'rows[0].image');
    const empty = await save([{ id: 'r', blocks: [] }]);
    assert.equal(empty.json.error.param, 'rows[0].blocks');
    const saved = await save([row([seven[0], { ...seven[1], span: half }], { title: 'Why Udozo', background: 'soft', viewAll: { kind: 'category', slug: 'phones-tablets' } })]);
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.rows[0].title, saved.json.rows[0].width, saved.json.rows[0].blocks.length], ['Why Udozo', 'contained', 2]);
    assert.equal((await support.put('/v1/admin/classifieds/home/NG/draft', { rows: [] })).status, 403);
  });

  test('a page from before rows reads as rows that look the same, drafts, published pages and versions alike', async () => {
    const sections = [
      { id: 'h', type: 'home_hero', span: full, style: 'search', title: 'Buy and sell near you' },
      { id: 'a', type: 'sponsored_rail', span: half },
      { id: 'b', type: 'top_selling_rail', span: half },
      { id: 'c', type: 'listing_group', span: full, title: 'Just listed', by: 'newest' },
    ];
    const envelope = { layout: 'marketplace', sections };
    await prisma.storefrontPage.upsert({ where: { key: 'home:GH' }, create: { key: 'home:GH', draft: envelope, published: envelope, version: 1 }, update: { draft: envelope, published: envelope, version: 1 } });
    await prisma.storefrontPageVersion.create({ data: { pageKey: 'home:GH', version: 1, sections: envelope } });
    const page = await support.get('/v1/admin/classifieds/home/GH');
    assert.deepEqual(page.json.rows.map(item => [item.width, item.blocks.map(block => block.id)]), [['full', ['h']], ['contained', ['a', 'b']], ['contained', ['c']]]);
    assert.deepEqual(page.json.published_rows.map(item => item.blocks.length), [1, 2, 1]);
    const restored = await admin.post('/v1/admin/classifieds/home/GH/restore', { version: 1 });
    assert.deepEqual(restored.json.rows.map(item => item.blocks.map(block => block.id)), [['h'], ['a', 'b'], ['c']]);
    // Visitors' page answers in rows, with the flat list of before beside it.
    const served = await visitor.get('/v1/classifieds/home?page=GH');
    assert.deepEqual(served.json.rows.map(item => item.blocks.map(block => block.id)), [['h'], ['a', 'b'], ['c']]);
    assert.deepEqual(served.json.sections.map(block => block.id), ['h', 'a', 'b', 'c']);
  });

  test('hidden rows and blocks are left out; a row links to its "See all"', async () => {
    const result = await publish([
      row([{ id: 'x1', type: 'listing_group', span: full, title: 'Newest', by: 'newest' }], { title: 'Fresh', viewAll: { kind: 'category', slug: 'phones-tablets' } }),
      row([{ id: 'x2', type: 'listing_group', span: full, title: 'Hidden', by: 'newest' }], { hidden: true }),
      row([{ id: 'x3', type: 'listing_group', span: full, title: 'Shown', by: 'trending' }, { id: 'x4', type: 'listing_group', span: full, title: 'Hidden block', by: 'newest', hidden: true }]),
    ]);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.deepEqual(result.json.rows.map(item => item.blocks.map(block => block.id)), [['x1'], ['x3']]);
    assert.equal(result.json.rows[0].view_all_href, '/ng/c/phones-tablets');
  });
});

describe('blocks', () => {
  test('a listing marquee shows its picks in order (a sold one left out), then fills from its source, never twice on the page', async () => {
    const result = await publish([
      row([{ id: 'm', type: 'listing_marquee', span: full, picks: [made.tv.ref, made.sold.ref], fill: { by: 'newest', value: null }, limit: 6 }]),
      row([{ id: 'g', type: 'listing_group', span: full, title: 'Newest', by: 'newest' }]),
    ]);
    const marquee = result.json.rows[0].blocks[0];
    assert.equal(marquee.data.items[0].id, made.tv.id, 'picks first');
    assert.ok(!marquee.data.items.some(card => card.id === made.sold.id), 'a sold pick drops out');
    assert.ok(marquee.data.items.some(card => card.id === made.phone.id), 'topped up from the newest');
    const group = result.json.rows[1].blocks[0];
    for (const card of group.data.items) assert.ok(!marquee.data.items.some(item => item.id === card.id), 'never shown twice');
    // Picks only: nothing to fill from is refused without picks.
    assert.equal((await save([row([{ id: 'n', type: 'listing_marquee', span: full, fill: { by: 'none' } }])])).json.error.param, 'rows[0].blocks[0].picks');
    const global = await admin.put('/v1/admin/classifieds/home/global/draft', { rows: [row([{ id: 'q', type: 'listing_marquee', span: full, fill: { by: 'deals' } }])] });
    assert.equal(global.json.error.param, 'rows[0].blocks[0].fill.by');
  });

  test("a stores marquee shows resellers' shops live on their own domain in the country, picks first", async () => {
    const first = await shop('Gadget Hub');
    const second = await shop('Phone Palace');
    const sandbox = await shop('Test Shop', { live: false });
    const bare = await shop('No Domain', { domain: false });
    const abroad = await shop('Accra Phones', { country: 'GH' });
    const result = await publish([row([{ id: 's', type: 'store_marquee', span: full, picks: [second.id, sandbox.id], fill: 'newest' }])]);
    const stores = result.json.rows[0].blocks[0].data.stores;
    assert.equal(stores[0].id, second.id, 'the pick first');
    assert.ok(stores.some(item => item.id === first.id));
    for (const hidden of [sandbox, bare, abroad]) assert.ok(!stores.some(item => item.id === hidden.id), `${hidden.name} is not shown`);
    assert.deepEqual([stores[0].name, stores[0].url, stores[0].logo_url, stores[0].listings], ['Phone Palace', `https://${second.subdomain}.shop.test`, 'https://media.test/logo.png', 0]);
    // Admins pick from the same stores.
    const picker = await support.get('/v1/admin/classifieds/home/NG/stores?q=gadget');
    assert.deepEqual(picker.json.data.map(item => item.name), ['Gadget Hub']);
    const finance = await adminClient(server, ['finance']);
    assert.equal((await finance.get('/v1/admin/classifieds/home/NG/stores')).status, 403);
  });

  test('a category banner names its category, shows a listing photo and counts; a masonry grid mixes tiles', async () => {
    const result = await publish([
      row([
        { id: 'c1', type: 'category_banner', span: half, category: 'phones-tablets' },
        { id: 'c2', type: 'category_banner', span: half, category: 'mobile-phones', title: 'Phones near you', image: 'https://media.test/banner.jpg' },
      ]),
      row([
        {
          id: 'mg',
          type: 'masonry_grid',
          span: full,
          tiles: [
            { kind: 'category', slug: 'mobile-phones', size: 'lg' },
            { kind: 'listing', ref: made.phone.ref },
            { kind: 'image', image: 'https://media.test/promo.jpg', title: 'Sell now', link: { kind: 'href', href: '/sell' } },
            { kind: 'listing', ref: made.sold.ref },
          ],
        },
      ]),
    ]);
    const [top, sub] = result.json.rows[0].blocks;
    assert.equal(top.data.title, 'Phones and tablets');
    assert.equal(top.data.href, '/ng/c/phones-tablets');
    assert.ok(top.data.category.listings >= 2, 'its subcategories counted');
    assert.match(top.data.image, /^https:\/\/media\.test\//);
    assert.deepEqual([sub.data.title, sub.data.image, sub.data.href], ['Phones near you', 'https://media.test/banner.jpg', '/ng/c/mobile-phones']);
    const tiles = result.json.rows[1].blocks[0].data.tiles;
    assert.deepEqual(tiles.map(tile => tile.kind), ['category', 'listing', 'image'], 'a sold listing tile is left out');
    assert.deepEqual([tiles[0].size, tiles[0].href, tiles[2].href], ['lg', '/ng/c/mobile-phones', '/sell']);
  });

  test('category spotlights: every top category (or those chosen, in order) with its spotlight image and listings', async () => {
    const phones = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'phones-tablets' } });
    await prisma.classifiedCategory.update({ where: { id: phones.id }, data: { spotlightUrl: 'https://media.test/spot-phones.png' } });
    try {
      const result = await publish([
        row([{ id: 'sa', type: 'category_spotlights', span: full }]),
        row([{ id: 'sb', type: 'category_spotlights', span: full, categories: ['vehicles', 'phones-tablets', 'mobile-phones', 'no-such'], rows: 1, speed: 'fast' }]),
      ]);
      assert.equal(result.status, 200, JSON.stringify(result.json));
      const every = result.json.rows[0].blocks[0];
      assert.deepEqual([every.rows, every.showCount, every.viewAll], [2, true, true], 'two rows on computers, counts and View all by default');
      assert.equal(every.data.view_all_href, '/ng/search', 'View all opens everything for sale in the country');
      const counts = every.data.tiles.map(item => item.listings > 0);
      assert.ok(counts.indexOf(false) === -1 || !counts.slice(counts.indexOf(false)).includes(true), 'the categories with listings come first');
      const tops = await prisma.classifiedCategory.count({ where: { enabled: true, parentId: null, countries: { some: { country: 'NG', enabled: true } } } });
      assert.equal(every.data.tiles.length, tops, 'every top category open in the market');
      const tile = every.data.tiles.find(item => item.slug === 'phones-tablets');
      assert.deepEqual([tile.image, tile.href, tile.icon], ['https://media.test/spot-phones.png', '/ng/c/phones-tablets', phones.icon]);
      assert.ok(tile.listings >= 2, 'its subcategories counted');
      assert.equal(every.data.tiles.find(item => item.slug === 'vehicles').image, null, 'no spotlight image: udozo.com draws its icon');
      const chosen = result.json.rows[1].blocks[0].data.tiles;
      assert.deepEqual(chosen.map(item => item.slug), ['vehicles', 'phones-tablets'], 'in the order chosen; subcategories and unknown slugs left out');
      const hidden = await publish([row([{ id: 'sd', type: 'category_spotlights', span: full, viewAll: false }])]);
      assert.equal(hidden.json.rows[0].blocks[0].data.view_all_href, null);
      const invalid = await admin.put('/v1/admin/classifieds/home/NG/draft', { rows: [row([{ id: 'sc', type: 'category_spotlights', span: full, rows: 4 }])] });
      assert.equal(invalid.json.error.param, 'rows[0].blocks[0].rows');
    } finally {
      await prisma.classifiedCategory.update({ where: { id: phones.id }, data: { spotlightUrl: null } });
    }
  });

  test('the starter pages show the categories as spotlights right under the hero, never the two category banners', async () => {
    for (const layout of ['marketplace', 'deals']) {
      const chosen = await admin.post('/v1/admin/classifieds/home/NG/layout', { layout, replace: true });
      const types = chosen.json.rows.flatMap(item => item.blocks.map(block => block.type));
      assert.deepEqual(types.slice(0, 2), ['home_hero', 'category_spotlights'], layout);
      assert.equal(types.filter(type => type === 'category_spotlights').length, 1, layout);
      assert.equal(chosen.json.rows[1].blocks[0].title, 'Shop by category', layout);
      assert.equal(chosen.json.rows[1].spacing, 'tight', `${layout}: close under the hero`);
      const grid = chosen.json.rows.flatMap(item => item.blocks).find(block => block.type === 'listing_group' && block.display === 'grid');
      assert.equal(grid.limit, 10, `${layout}: two full rows of five on computers`);
      assert.ok(!types.includes('category_banner'), layout);
    }
  });

  test("the editor's view: rows not saved yet filled as visitors would see them, for operations and support", async () => {
    const preview = await support.post('/v1/admin/classifieds/home/NG/resolve', { rows: [row([{ id: 'p', type: 'listing_marquee', span: full, picks: [made.phone.ref], fill: { by: 'none' } }])] });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.deepEqual(preview.json.rows[0].blocks[0].data.items.map(card => card.id), [made.phone.id]);
    const invalid = await support.post('/v1/admin/classifieds/home/NG/resolve', { rows: [{ id: 'r', blocks: [] }] });
    assert.equal(invalid.json.error.param, 'rows[0].blocks');
    const finance = await adminClient(server, ['finance']);
    assert.equal((await finance.post('/v1/admin/classifieds/home/NG/resolve', {})).status, 403);
  });

  test('every starter layout is rows of blocks this page offers', async () => {
    for (const layout of ['marketplace', 'deals', 'explorer']) {
      for (const page of ['NG', 'global']) {
        const chosen = await admin.post(`/v1/admin/classifieds/home/${page}/layout`, { layout, replace: true });
        assert.equal(chosen.status, 200, `${layout} on ${page}: ${JSON.stringify(chosen.json)}`);
        assert.ok(chosen.json.rows.length >= 5 && chosen.json.rows.every(item => item.blocks.length >= 1));
        const types = chosen.json.rows.flatMap(item => item.blocks.map(block => block.type));
        assert.ok(types.includes('listing_marquee'));
        assert.ok(types.every(type => chosen.json.blocks_allowed.includes(type)), `${layout} on ${page}`);
      }
    }
  });
});
