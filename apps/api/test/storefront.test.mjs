// BitoCard's own storefront: the public catalogue, search, product pages and the published home page, and the
// admin Storefront Manager (draft, validation, preview links, publish, versions, take offline, brands).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';

let server;
let reloadly;
let admin;
let prisma;
let wallets;
let visitor;

before(async () => {
  reloadly = await fakeReloadly();
  server = await startApp({ env: { ...reloadly.env, ENCRYPTION_KEY: randomBytes(32).toString('base64') } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
  visitor = client(server.base);
});

after(async () => {
  await server?.close();
  await reloadly?.close();
});

const productKey = async brand => (await prisma.product.findFirstOrThrow({ where: { brand } })).key;
/** Nothing a visitor sees may name BitoCard's suppliers. */
const noSuppliers = json => assert.ok(!/reloadly|vtpass|didww/i.test(JSON.stringify(json)), 'supplier named in a public response');

describe('the public catalogue', () => {
  test('lists what is on sale with face values, filters and paging, and never names suppliers', async () => {
    const all = await visitor.get('/v1/store/products?sort=name&limit=60');
    assert.equal(all.status, 200, JSON.stringify(all.json));
    assert.equal(all.res.headers.get('cache-control'), 'public, max-age=60');
    assert.ok(all.json.total >= 4);
    const amazon = all.json.data.find(item => item.brand.slug === 'amazon');
    assert.deepEqual([amazon.object, amazon.category, amazon.category_label, amazon.global, amazon.face_currency], ['store_product', 'gift_cards', 'Gift cards', true, 'USD']);
    assert.ok(amazon.from > 0 && amazon.to >= amazon.from);
    assert.equal(amazon.brand.name, 'Amazon', 'named from the brand until an admin presents it');
    noSuppliers(all.json);

    const airtime = await visitor.get('/v1/store/products?category=airtime');
    assert.ok(airtime.json.data.length >= 2 && airtime.json.data.every(item => item.category === 'airtime'));
    const mobile = await visitor.get('/v1/store/products?group=mobile');
    assert.ok(mobile.json.data.every(item => ['airtime', 'data', 'virtual_numbers'].includes(item.category)));
    assert.ok(mobile.json.data.some(item => item.category === 'data'));
    const nigeria = await visitor.get('/v1/store/products?country=ng');
    assert.ok(nigeria.json.data.every(item => item.country === 'NG'));
    const global = await visitor.get('/v1/store/products?country=global');
    assert.ok(global.json.data.length > 0 && global.json.data.every(item => item.global));
    const page = await visitor.get('/v1/store/products?sort=name&limit=2&offset=2');
    assert.deepEqual([page.json.data.length, page.json.has_more], [2, all.json.total > 4]);
    assert.equal((await visitor.get('/v1/store/products?category=nope')).status, 400);
  });

  test('a product page has its face values and related products; unavailable ones are not found', async () => {
    const key = await productKey('amazon');
    const res = await visitor.get(`/v1/store/products/${encodeURIComponent(key)}`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(Array.isArray(res.json.denominations) || res.json.range);
    assert.ok(Array.isArray(res.json.related));
    noSuppliers(res.json);
    assert.equal((await visitor.get('/v1/store/products/gift_cards:US:nothing')).status, 404);

    await prisma.product.update({ where: { key }, data: { active: false } });
    assert.equal((await visitor.get(`/v1/store/products/${encodeURIComponent(key)}`)).status, 404);
    await prisma.product.update({ where: { key }, data: { active: true } });
  });

  test('categories and brands list only what is on sale; the menu lists every group; countries every market', async () => {
    const categories = (await visitor.get('/v1/store/categories')).json.data;
    assert.ok(categories.some(item => item.category === 'airtime' && item.label === 'Airtime' && item.group === 'mobile' && item.products >= 2));
    assert.ok(categories.every(item => item.products > 0 && item.on_sale));
    const navigation = (await visitor.get('/v1/store/navigation')).json;
    assert.deepEqual(
      navigation.groups.map(group => group.key),
      ['gift-cards', 'mobile', 'bills', 'esims', 'software', 'virtual-cards'],
      'the menus never come and go',
    );
    const mobile = navigation.groups.find(group => group.key === 'mobile');
    assert.ok(mobile.on_sale && mobile.brands.length > 0);
    const cards = navigation.groups.find(group => group.key === 'virtual-cards');
    assert.deepEqual([cards.on_sale, cards.brands, cards.categories.map(item => [item.category, item.on_sale, item.products])], [false, [], [['virtual_cards', false, 0]]], 'not open yet: listed, marked, empty');
    assert.ok(navigation.countries.some(item => item.code === 'NG' && item.name === 'Nigeria'));
    const markets = await prisma.country.findMany();
    for (const market of markets) assert.ok(navigation.countries.some(item => item.code === market.code && item.name === market.name), `market ${market.code} is in the picker, with or without products`);
    noSuppliers(navigation);
  });
});

describe('search', () => {
  test('finds products, brands, categories and countries, best matches first', async () => {
    const amazon = (await visitor.get('/v1/store/search?q=amazon')).json;
    assert.equal(amazon.products[0].brand.slug, 'amazon');
    assert.ok(amazon.brands.some(item => item.slug === 'amazon'));
    noSuppliers(amazon);

    const topUp = (await visitor.get('/v1/store/search?q=top%20up')).json;
    assert.ok(topUp.categories.some(item => item.category === 'airtime'));
    assert.ok(topUp.products.some(item => item.category === 'airtime'));

    const nigeria = (await visitor.get('/v1/store/search?q=nigeria')).json;
    assert.ok(nigeria.countries.some(item => item.code === 'NG'));

    const inCountry = (await visitor.get('/v1/store/search?q=mtn&country=NG')).json;
    assert.ok(inCountry.products.length > 0 && inCountry.products.every(item => item.country === 'NG'));
    assert.equal((await visitor.get('/v1/store/search?q=')).status, 400);
  });

  test('brand presentation: names, companies and aliases are searchable; hidden brands disappear', async () => {
    const steam = await prisma.product.findFirstOrThrow({ where: { name: { contains: 'Steam' } } });
    const saved = await admin.put(`/v1/admin/storefront/brands/${steam.brand}`, {
      name: 'Steam',
      company: 'Valve Corporation',
      tags: ['Gaming', 'gaming'],
      aliases: ['PC Games'],
      featured: true,
      sort_order: 1,
      color: '#0b1d33',
      image_url: 'https://cdn.example.com/steam.png',
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.name, saved.json.tags, saved.json.aliases, saved.json.featured, saved.json.configured], ['Steam', ['gaming'], ['pc games'], true, true]);
    assert.equal((await admin.put(`/v1/admin/storefront/brands/${steam.brand}`, { name: 'Steam', image_url: 'http://insecure.example/x.png' })).status, 400);

    assert.ok((await visitor.get('/v1/store/search?q=valve')).json.products.some(item => item.id === steam.id), 'by company');
    assert.ok((await visitor.get('/v1/store/search?q=pc%20games')).json.products.some(item => item.id === steam.id), 'by alias');
    const tagged = (await visitor.get('/v1/store/products?tag=gaming')).json.data;
    assert.deepEqual(tagged.map(item => item.id), [steam.id]);
    assert.equal(tagged[0].brand.image_url, 'https://cdn.example.com/steam.png');
    assert.equal((await visitor.get('/v1/store/brands')).json.data[0].slug, steam.brand, 'featured first');

    await admin.put(`/v1/admin/storefront/brands/${steam.brand}`, { name: 'Steam', visible: false });
    assert.ok(!(await visitor.get('/v1/store/products?limit=60')).json.data.some(item => item.id === steam.id));
    await admin.put(`/v1/admin/storefront/brands/${steam.brand}`, { name: 'Steam', company: 'Valve Corporation', tags: ['gaming'], aliases: ['pc games'], featured: true, sort_order: 1 });
    const brands = (await admin.get('/v1/admin/storefront/brands')).json.data;
    assert.ok(brands.some(item => item.slug === 'amazon' && item.configured === false && item.products >= 1));
  });
});

describe('the Storefront Manager', () => {
  test('until a layout is published the store shows the approved default; the draft starts from it', async () => {
    const shown = await visitor.get('/v1/store/home');
    assert.equal(shown.status, 200, JSON.stringify(shown.json));
    assert.deepEqual([shown.json.published, shown.json.version], [false, null]);
    assert.deepEqual(shown.json.sections.slice(0, 4).map(item => item.type), ['hero', 'product_rail', 'promo', 'promo']);
    assert.ok(shown.json.sections.find(item => item.type === 'product_rail').data.products.length > 0, 'filled with what is on sale');
    noSuppliers(shown.json);
    const page = (await admin.get('/v1/admin/storefront/home')).json;
    assert.deepEqual([page.live, page.version, page.unpublished_changes], [false, 0, true]);
    assert.deepEqual(page.draft.slice(0, 4).map(item => item.type), ['hero', 'product_rail', 'promo', 'promo']);
    assert.deepEqual(page.draft[1].span, { lg: 8, md: 6, rows: 2 }, 'trending beside two stacked promos');
    assert.equal(page.draft.find(item => item.title === 'Reseller spotlight').cta.href, '/resellers');
  });

  test('drafts are validated, with the field named', async () => {
    const page = (await admin.get('/v1/admin/storefront/home')).json;
    const bad = async (sections, param) => {
      const res = await admin.put('/v1/admin/storefront/home/draft', { sections });
      assert.deepEqual([res.status, res.json.error.code], [400, 'layout_invalid'], JSON.stringify(res.json));
      if (param) assert.equal(res.json.error.param, param);
    };
    await bad([{ ...page.draft[0], span: { lg: 5, md: 6 } }], 'sections[0].span.lg');
    await bad([page.draft[0], { ...page.draft[0] }], 'sections[1].id');
    await bad([{ id: 'x', type: 'product_rail', span: { lg: 12, md: 6 }, title: 'Picks', source: 'manual' }], 'sections[0].productKeys');
    await bad([{ id: 'x', type: 'promo', span: { lg: 4, md: 3 }, title: 'Bad', cta: { label: 'Go', href: 'javascript:alert(1)' } }], 'sections[0].cta.href');
    await bad([{ id: 'x', type: 'promo', span: { lg: 4, md: 3 }, title: 'Bad', cta: { label: 'Go', href: '//evil.example' } }]);
    await bad([{ id: 'x', type: 'widget', span: { lg: 4, md: 3 } }]);
  });

  test('preview links show the draft; publishing makes it live as a version; offline and restore', async () => {
    const page = (await admin.get('/v1/admin/storefront/home')).json;
    const key = await productKey('amazon');
    const draft = [
      ...page.draft.filter(item => item.type !== 'trust_bar'),
      { id: 'picks', type: 'product_rail', span: { lg: 12, md: 6 }, title: 'Staff picks', source: 'manual', productKeys: [key, 'gift_cards:US:gone'] },
      { id: 'hidden', type: 'promo', span: { lg: 4, md: 3 }, title: 'Secret', hidden: true },
    ];
    const saved = await admin.put('/v1/admin/storefront/home/draft', { sections: draft });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal((await visitor.get('/v1/store/home')).json.published, false, 'saving does not publish');

    const { token } = (await admin.post('/v1/admin/storefront/home/preview')).json;
    const preview = await visitor.get(`/v1/store/home?preview=${encodeURIComponent(token)}`);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.equal(preview.json.preview, true);
    const picks = preview.json.sections.find(item => item.id === 'picks');
    assert.deepEqual(picks.data.products.map(item => item.key), [key], 'unavailable picks are skipped');
    assert.ok(!preview.json.sections.some(item => item.id === 'hidden'), 'hidden sections are not shown');
    assert.equal((await visitor.get(`/v1/store/home?preview=${encodeURIComponent(`${token}x`)}`)).json.error.code, 'preview_expired');
    assert.equal((await visitor.get(`/v1/store/home?preview=${Date.now() - 1000}.abc`)).status, 401);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post('/v1/admin/storefront/home/publish')).status, 403);
    assert.equal((await support.get('/v1/admin/storefront/home')).status, 200);
    const published = await admin.post('/v1/admin/storefront/home/publish');
    assert.deepEqual([published.json.live, published.json.version, published.json.unpublished_changes], [true, 1, false]);
    assert.equal(await prisma.auditLog.count({ where: { action: 'storefront.published' } }), 1);

    const home = await visitor.get('/v1/store/home');
    assert.equal(home.status, 200);
    assert.deepEqual([home.json.version, home.json.preview, home.json.published], [1, false, true]);
    const types = home.json.sections.map(item => item.type);
    assert.ok(types.includes('hero') && types.includes('category_grid') && types.includes('brand_grid') && !types.includes('trust_bar'));
    const trending = home.json.sections.find(item => item.type === 'product_rail' && item.source === 'trending');
    assert.ok(trending.data.products.length > 0, 'filled from featured brands and the newest while there are no sales');
    assert.ok(home.json.navigation.length > 0 && home.json.countries.length > 0);
    noSuppliers(home.json);

    // A second version, then back to the first.
    await admin.put('/v1/admin/storefront/home/draft', { sections: draft.slice(0, 2) });
    await admin.post('/v1/admin/storefront/home/publish');
    assert.equal((await visitor.get('/v1/store/home')).json.sections.length, 2);
    const restored = await admin.post('/v1/admin/storefront/home/restore', { version: 1 });
    assert.deepEqual([restored.json.version, restored.json.unpublished_changes, restored.json.versions.map(item => item.version)], [2, true, [2, 1]]);
    assert.equal((await admin.post('/v1/admin/storefront/home/restore', { version: 9 })).status, 404);

    const offline = await admin.post('/v1/admin/storefront/home/unpublish');
    assert.equal(offline.json.live, false);
    const fallback = await visitor.get('/v1/store/home');
    assert.deepEqual([fallback.status, fallback.json.published, fallback.json.sections[0].type], [200, false, 'hero'], 'taken offline: back to the default layout, never a redirect');
    assert.equal((await admin.post('/v1/admin/storefront/home/unpublish')).json.error.code, 'storefront_not_published');
    await admin.post('/v1/admin/storefront/home/publish');
    const reseller = await resellerClient(server);
    assert.equal((await reseller.browser.get('/v1/admin/storefront/home')).status, 401);
  });

  test('trending and top selling rank what sells', async () => {
    reloadly.state.orderReply = { status: 'SUCCESSFUL' };
    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
    await wallets.adjust(null, { resellerId: reseller.resellerId, mode: 'live', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
    const mtn = await prisma.product.findUniqueOrThrow({ where: { key: 'airtime:NG:mtn:topup' } });
    for (let i = 0; i < 2; i += 1) {
      const quoted = await reseller.browser.post('/v1/quotes', { product_id: mtn.id, face_value: 100_000, recipient: { phone: '08031234567' } });
      assert.equal(quoted.status, 201, JSON.stringify(quoted.json));
      const quote = quoted.json;
      const order = await reseller.browser.post('/v1/orders', { quote_id: quote.id });
      assert.equal(order.json.status, 'completed', JSON.stringify(order.json));
    }
    const storefront = server.app.get((await import('../dist/storefront/storefront.service.js')).StorefrontService);
    assert.equal((await storefront.ranked('trending', 3))[0].id, mtn.id);
    assert.equal((await storefront.ranked('top_selling', 3))[0].id, mtn.id);
    assert.equal((await visitor.get('/v1/store/products?limit=1')).json.data[0].id, mtn.id, 'popular first');
    // Sandbox orders never count.
    assert.equal(await prisma.order.count({ where: { productId: mtn.id, mode: 'live', status: 'completed' } }), 2);
  });
});
