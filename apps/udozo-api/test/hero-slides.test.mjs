// udozo.com's hero reel (8 November 2026): the home page's top is a reel of columns, each three rows high holding one,
// two (a third and two thirds, either way up) or three banners, placed by Udozo's team per market or for every market,
// in their order. Each banner links to a listing, a brand, a seller or any address, worked out when udozo.com reads it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, startApp } from './helpers.mjs';

let server;
let operations;
let support;
let prisma;
let seller;
let listing;

const houseStoreId = '00000000-0000-4000-8000-0000000000b2';

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate' } });
  operations = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server);
  for (const country of ['NG', 'GH']) assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: country, enabled: true })).status, 200);
  seller = await prisma.customer.create({ data: { storeId: houseStoreId, email: `hero${Date.now()}@example.com`, name: 'Adaeze Nwosu', passwordHash: 'x', country: 'NG', username: 'adaeze_gadgets' } });
  const [category, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'mobile-phones' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' }, include: { parent: true } })]);
  listing = await prisma.classifiedListing.create({
    data: { customerId: seller.id, country: 'NG', currency: 'NGN', title: 'iPhone 13 128GB', slug: 'iphone-13-128gb', status: 'active', onShop: true, sku: 'PHN-009991', categoryId: category.id, areaId: area.id, stateId: area.parentId, condition: 'used', priceKind: 'fixed', priceMinor: 45000000n },
  });
  await prisma.classifiedBrand.upsert({ where: { slug: 'herotest' }, create: { slug: 'herotest', name: 'Herotest', nameKey: 'herotest' }, update: {} });
});

after(() => server?.close());

const image = name => `https://cdn.udozo.test/platform/hero/images/${name}.jpg`;
const tile = (name, link, extra = {}) => ({ image_url: image(name), alt: `Banner ${name}`, link, ...extra });
const showing = async page => {
  const res = await fetch(`${server.base}/v1/classifieds/hero-slides?page=${page}`);
  return { status: res.status, cache: res.headers.get('cache-control'), json: await res.json() };
};

describe('the hero reel', () => {
  test('a column of each split, linking to a listing, a brand, a seller and an address; udozo.com reads them without the note', async () => {
    await prisma.classifiedHeroSlide.deleteMany();
    const full = await operations.post('/v1/admin/classifieds/hero-slides', { layout: 'full', tiles: [tile('full', { kind: 'listing', target: String(listing.ref) })], note: 'Launch week' });
    assert.equal(full.status, 201, JSON.stringify(full.json));
    assert.deepEqual([full.json.country, full.json.layout, full.json.position, full.json.state], [null, 'full', 0, 'showing']);
    assert.deepEqual(full.json.tiles[0].link, { kind: 'listing', target: String(listing.ref), label: 'iPhone 13 128GB', href: `/ng/l/${listing.ref}-iphone-13-128gb` });

    const two = await operations.post('/v1/admin/classifieds/hero-slides', {
      country: 'ng',
      layout: 'two_thirds_third',
      tiles: [tile('big', { kind: 'brand', target: 'https://udozo.com/ng/brand/herotest' }), tile('small', { kind: 'seller', target: '@adaeze_gadgets' }, { ad: false })],
    });
    assert.equal(two.status, 201, JSON.stringify(two.json));
    assert.equal(two.json.country, 'NG');
    assert.deepEqual(two.json.tiles.map(item => [item.slot, item.link.kind, item.link.href, item.ad]), [
      [0, 'brand', '/ng/brand/herotest', true],
      [1, 'seller', '/ng/seller/adaeze_gadgets', false],
    ]);
    const three = await operations.post('/v1/admin/classifieds/hero-slides', {
      layout: 'thirds',
      tiles: [tile('a', { kind: 'url', target: '/ng/c/mobile-phones' }), tile('b', { kind: 'url', target: 'https://partner.example.com/offer' }), tile('c', { kind: 'listing', target: 'phn 9991' })],
    });
    assert.equal(three.status, 201, JSON.stringify(three.json));
    assert.equal(three.json.position, 1, 'last among every market’s');
    assert.equal(three.json.tiles[2].link.href, `/ng/l/${listing.ref}-iphone-13-128gb`, 'a SKU finds the listing');

    const nigeria = await showing('NG');
    assert.equal(nigeria.status, 200);
    assert.equal(nigeria.cache, 'public, max-age=60');
    assert.deepEqual(nigeria.json.data.map(item => item.id), [two.json.id, full.json.id, three.json.id], 'the market’s own first');
    assert.deepEqual(nigeria.json.data[0].tiles, [
      { id: two.json.tiles[0].id, image_url: image('big'), alt: 'Banner big', href: '/ng/brand/herotest', ad: true },
      { id: two.json.tiles[1].id, image_url: image('small'), alt: 'Banner small', href: '/ng/seller/adaeze_gadgets', ad: false },
    ]);
    assert.ok(!JSON.stringify(nigeria.json).includes('Launch week'), 'never the note');
    // Ghana and the page across countries see only those for every market.
    assert.deepEqual((await showing('GH')).json.data.map(item => item.id), [full.json.id, three.json.id]);
    assert.deepEqual((await showing('global')).json.data.map(item => item.id), [full.json.id, three.json.id]);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'hero_slide.created', targetId: two.json.id } }));
  });

  test('a column must hold as many banners as its split, each with an image, words and a link that exists', async () => {
    const post = body => operations.post('/v1/admin/classifieds/hero-slides', body);
    const refused = async (body, code, param) => {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(res.json));
      assert.deepEqual([res.json.error.code, res.json.error.param], [code, param]);
    };
    await refused({ layout: 'thirds', tiles: [tile('a', { kind: 'url', target: '/ng' })] }, 'tiles_mismatch', 'tiles');
    await refused({ layout: 'sideways', tiles: [] }, 'parameter_invalid', 'layout');
    await refused({ layout: 'full', tiles: [tile('a', { kind: 'url', target: 'http://plain.example.com' })] }, 'parameter_invalid', 'tiles[0].link.target');
    await refused({ layout: 'full', tiles: [tile('a', { kind: 'url', target: '//evil.example.com' })] }, 'parameter_invalid', 'tiles[0].link.target');
    await refused({ layout: 'full', tiles: [tile('a', { kind: 'listing', target: '99999999' })] }, 'listing_unknown', 'tiles[0].link.target');
    await refused({ layout: 'full', tiles: [tile('a', { kind: 'brand', target: 'no-such-brand' })] }, 'brand_unknown', 'tiles[0].link.target');
    await refused({ layout: 'full', tiles: [tile('a', { kind: 'seller', target: 'nobody_here' })] }, 'seller_unknown', 'tiles[0].link.target');
    await refused({ layout: 'full', tiles: [{ ...tile('a', { kind: 'url', target: '/ng' }), alt: ' ' }] }, 'parameter_missing', 'tiles[0].alt');
    await refused({ layout: 'full', tiles: [{ ...tile('a', { kind: 'url', target: '/ng' }), image_url: 'http://x.test/a.jpg' }] }, 'parameter_invalid', 'tiles[0].image_url');
    await refused({ country: 'ZZ', layout: 'full', tiles: [tile('a', { kind: 'url', target: '/ng' })] }, 'market_unavailable', 'country');
    // Changing the split needs its banners.
    const made = await post({ layout: 'full', tiles: [tile('a', { kind: 'url', target: '/ng' })] });
    const res = await operations.patch(`/v1/admin/classifieds/hero-slides/${made.json.id}`, { layout: 'thirds' });
    assert.deepEqual([res.status, res.json.error.code], [400, 'tiles_mismatch']);
    await operations.delete(`/v1/admin/classifieds/hero-slides/${made.json.id}`);
  });

  test('order, the on and off switch, dates, flipping a split, and links that are gone', async () => {
    await prisma.classifiedHeroSlide.deleteMany();
    const make = name => operations.post('/v1/admin/classifieds/hero-slides', { layout: 'full', tiles: [tile(name, { kind: 'url', target: `/ng/${name}` })] }).then(res => res.json);
    const [a, b, c] = [await make('a'), await make('b'), await make('c')];
    const reordered = await operations.post('/v1/admin/classifieds/hero-slides/order', { scope: 'global', ids: [c.id, a.id, b.id] });
    assert.equal(reordered.status, 200, JSON.stringify(reordered.json));
    assert.deepEqual(reordered.json.data.map(item => item.id), [c.id, a.id, b.id]);
    assert.deepEqual((await showing('NG')).json.data.map(item => item.id), [c.id, a.id, b.id]);
    const partial = await operations.post('/v1/admin/classifieds/hero-slides/order', { scope: 'global', ids: [a.id, b.id] });
    assert.deepEqual([partial.status, partial.json.error.code], [400, 'order_mismatch']);

    // Off (the gate), and a date not reached yet, hide a column.
    assert.equal((await operations.patch(`/v1/admin/classifieds/hero-slides/${a.id}`, { enabled: false })).json.state, 'off');
    assert.equal((await operations.patch(`/v1/admin/classifieds/hero-slides/${b.id}`, { starts_at: new Date(Date.now() + 86_400_000).toISOString() })).json.state, 'scheduled');
    assert.deepEqual((await showing('NG')).json.data.map(item => item.id), [c.id]);

    // A third over two thirds turned the other way up, its banners kept in their new order.
    const two = await operations.post('/v1/admin/classifieds/hero-slides', { layout: 'third_two_thirds', tiles: [tile('top', { kind: 'listing', target: String(listing.ref) }), tile('bottom', { kind: 'seller', target: seller.sellerHandle })] });
    const flipped = await operations.patch(`/v1/admin/classifieds/hero-slides/${two.json.id}`, {
      layout: 'two_thirds_third',
      tiles: two.json.tiles.reverse().map(item => ({ image_url: item.image_url, alt: item.alt, link: { kind: item.link.kind, target: item.link.target } })),
    });
    assert.equal(flipped.status, 200, JSON.stringify(flipped.json));
    assert.deepEqual(flipped.json.tiles.map(item => item.image_url), [image('bottom'), image('top')]);

    // A seller suspended and a listing deleted: the banners stay, without a link.
    await prisma.classifiedSeller.upsert({ where: { customerId: seller.id }, create: { customerId: seller.id, suspendedAt: new Date() }, update: { suspendedAt: new Date() } });
    await prisma.classifiedListing.update({ where: { id: listing.id }, data: { status: 'deleted' } });
    const shown = (await showing('NG')).json.data.find(item => item.id === two.json.id);
    assert.deepEqual(shown.tiles.map(item => item.href), [null, null]);
    await prisma.classifiedSeller.update({ where: { customerId: seller.id }, data: { suspendedAt: null } });
    await prisma.classifiedListing.update({ where: { id: listing.id }, data: { status: 'active' } });

    const removed = await operations.delete(`/v1/admin/classifieds/hero-slides/${c.id}`);
    assert.deepEqual(removed.json, { object: 'hero_slide', id: c.id, deleted: true });
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'hero_slide.reordered', targetId: 'global' } }));
  });

  test('support reads but never changes; the uploads are counted as in use', async () => {
    assert.equal((await support.get('/v1/admin/classifieds/hero-slides?scope=NG')).status, 200);
    assert.equal((await support.post('/v1/admin/classifieds/hero-slides', { layout: 'full', tiles: [tile('x', { kind: 'url', target: '/ng' })] })).status, 403);
    const media = server.app.get((await import('../dist/media/media.service.js')).MediaService);
    const uses = await media.usage([image('bottom')]);
    assert.match(uses.get(image('bottom'))?.[0] ?? '', /^hero_slide:/);
  });
});
