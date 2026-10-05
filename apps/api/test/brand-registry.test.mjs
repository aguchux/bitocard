// The brand registry: well-known brands (MTN, Airtel, Amazon, Steam…) look branded before an admin sets them up, with
// their name, company, colour, initials and search words; logos resolve from file storage paths or https addresses,
// else the bundled icon on the store; card art likewise falls back to the bundled card art, everywhere the catalogue is
// shown (the store, resellers, admins); admins' settings win; and npm run brands:logos uploads a folder of logos and
// writes their paths into the registry.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';

const { brandInitials, brandRegistry, registryAssetUrl, registryBrand, registryCardArtUrl, registryIconUrl, registrySlugsMatching } = await import('../dist/storefront/brand-registry.js');
const { svgProblem } = await import('../dist/media/images.js');
const storeIcons = fileURLToPath(new URL('../../storefront/public/brand-icons/', import.meta.url));
const storeCards = fileURLToPath(new URL('../../storefront/public/brand-cards/', import.meta.url));

/** A small but real PNG header (the checks read its IHDR chunk). */
function png(width, height) {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe('the registry file', () => {
  test('is valid, covers the main brands, and maps every slug once', () => {
    assert.ok(brandRegistry.length >= 60);
    for (const slug of ['mtn', 'airtel', 'glo', 'safaricom', 'amazon', 'apple', 'google-play', 'steam', 'playstation', 'netflix', 'dstv']) assert.ok(registryBrand(slug), slug);
    assert.equal(registryBrand('psn-plus').slug, 'playstation', 'one entry covers several product brand slugs');
    assert.equal(registryBrand('no-such-brand'), null);
    for (const brand of brandRegistry) assert.match(brand.color, /^#[0-9a-f]{6}$/i, brand.slug);
  });

  test('initials: the registry’s own, else the first letters of the name', () => {
    assert.equal(brandInitials('MTN', 'MTN'), 'MTN');
    assert.equal(brandInitials('Google Play'), 'GP');
    assert.equal(brandInitials('Amazon'), 'AM');
    assert.equal(brandInitials("McDonald's"), 'MC', 'apostrophes do not split words');
    assert.equal(brandInitials('1-800-PetSupplies'), '18');
    assert.equal(brandInitials('   '), '?');
  });

  test('logo locations: https as is, storage paths under the platform folder, nothing without storage', () => {
    const storage = { SPACES_BUCKET: 'media', SPACES_REGION: 'nyc3', SPACES_PUBLIC_URL: 'https://cdn.example/', SPACES_ROOT: 'bitocard' };
    assert.equal(registryAssetUrl('https://logos.example/mtn.svg', storage), 'https://logos.example/mtn.svg');
    assert.equal(registryAssetUrl('brands/mtn/logo.svg', storage), 'https://cdn.example/bitocard/platform/brands/mtn/logo.svg');
    assert.equal(registryAssetUrl('brands/mtn/logo.svg', { ...storage, SPACES_PUBLIC_URL: undefined }), 'https://media.nyc3.digitaloceanspaces.com/bitocard/platform/brands/mtn/logo.svg');
    assert.equal(registryAssetUrl('brands/mtn/logo.svg', { SPACES_REGION: 'nyc3', SPACES_ROOT: 'bitocard' }), null);
    assert.equal(registryAssetUrl(null, storage), null);
  });

  test('search words find the brands they belong to', () => {
    assert.ok(registrySlugsMatching('psn', ['psn']).includes('psn-plus'));
    assert.ok(registrySlugsMatching('robux', ['robux']).includes('roblox'));
    assert.ok(registrySlugsMatching('valve corporation', ['valve', 'corporation']).includes('steam'));
  });

  test('bundled icons: every icon is on the store as a safe SVG, and nothing else is there', () => {
    const withIcons = brandRegistry.filter(brand => brand.icon);
    assert.ok(withIcons.length >= 50, 'most well-known brands have a bundled icon');
    for (const slug of ['mtn', 'airtel', 'glo', 'safaricom', 'amazon', 'apple', 'google-play', 'steam', 'playstation', 'netflix']) assert.ok(registryBrand(slug).icon, slug);
    for (const brand of withIcons) {
      const file = join(storeIcons, `${brand.slug}.svg`);
      assert.ok(existsSync(file), `${brand.slug}.svg is missing: run node scripts/brand-icons.mjs`);
      const text = readFileSync(file, 'utf8');
      assert.equal(svgProblem(text), null, brand.slug);
      assert.doesNotMatch(text, /ns0:|<image|href="(?!#)/, brand.slug);
    }
    assert.deepEqual(readdirSync(storeIcons).sort(), withIcons.map(brand => `${brand.slug}.svg`).sort(), 'no stray files: run node scripts/brand-icons.mjs');
  });

  test('bundled card art: every entry with art has its card on the store as WebP, and nothing else is there', () => {
    const withArt = brandRegistry.filter(brand => brand.art);
    assert.ok(withArt.length >= 140, 'gift card brands have bundled card art');
    for (const slug of ['nike', 'asda', 'playstation', 'marks-spencer', 'costa', 'john-lewis', 'xbox']) assert.ok(registryBrand(slug).art, slug);
    for (const brand of withArt) {
      const file = join(storeCards, `${brand.slug}.webp`);
      assert.ok(existsSync(file), `${brand.slug}.webp is missing: run node scripts/brand-cards.mjs`);
      const bytes = readFileSync(file);
      assert.deepEqual([bytes.subarray(0, 4).toString(), bytes.subarray(8, 12).toString()], ['RIFF', 'WEBP'], brand.slug);
    }
    assert.deepEqual(readdirSync(storeCards).sort(), withArt.map(brand => `${brand.slug}.webp`).sort(), 'no stray files: run node scripts/brand-cards.mjs');
    assert.equal(registryCardArtUrl(registryBrand('marks-and-spencer'), { STOREFRONT_URL: 'https://store.example/' }), 'https://store.example/brand-cards/marks-spencer.webp', 'named after the entry');
    assert.equal(registryCardArtUrl(registryBrand('mtn'), { STOREFRONT_URL: 'https://store.example' }), null, 'entries without art have none');
  });

  test('the bundled icon address is on the store address', () => {
    assert.equal(registryIconUrl(registryBrand('psn-plus'), { STOREFRONT_URL: 'https://store.example/' }), 'https://store.example/brand-icons/playstation.svg', 'named after the entry, for every slug it covers');
    assert.equal(registryIconUrl(registryBrand('dstv'), { STOREFRONT_URL: 'https://store.example' }), null, 'entries without an icon have none');
    assert.equal(registryIconUrl(null, { STOREFRONT_URL: 'https://store.example' }), null);
  });
});

describe('brands on the store', () => {
  let reloadly;
  let server;
  let admin;
  let visitor;

  before(async () => {
    reloadly = await fakeReloadly();
    server = await startApp({ env: { ...reloadly.env, ENCRYPTION_KEY: randomBytes(32).toString('base64'), STOREFRONT_URL: 'https://store.example' } });
    admin = await adminClient(server);
    visitor = client(server.base);
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    for (const source of ['open_exchange_rates', 'flutterwave']) {
      await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
    }
    assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
    // BitoCard's store shows only listed products: list the whole catalogue, as an admin would.
    assert.equal((await admin.post('/v1/admin/products/listing', { listed: true, filter: {} })).status, 200);
  });

  after(async () => {
    await server?.close();
    await reloadly?.close();
  });

  const brandOf = async slug => (await visitor.get('/v1/store/brands?limit=50')).json.data.find(item => item.slug === slug);

  test('registry brands get their name, company, colour and initials before an admin sets them up', async () => {
    const steam = await brandOf('steam');
    assert.deepEqual([steam.name, steam.company, steam.color, steam.initials, steam.logo_url], ['Steam', 'Valve Corporation', '#171A21', 'ST', 'https://store.example/brand-icons/steam.svg'], 'the bundled icon until a logo is uploaded');
    const mtn = await brandOf('mtn');
    assert.deepEqual([mtn.name, mtn.initials, mtn.color], ['MTN', 'MTN', '#FFCB05']);
    assert.ok(mtn.tags.includes('mobile'));
    const found = await visitor.get('/v1/store/search?q=valve');
    assert.ok(found.json.products.some(product => product.brand.slug === 'steam'), 'the registry company is searchable');
    const admins = (await admin.get('/v1/admin/storefront/brands')).json.data.find(item => item.slug === 'steam');
    assert.deepEqual([admins.in_registry, admins.configured, admins.company], [true, false, 'Valve Corporation']);
  });

  test('the Brand registry page lists every entry; an uploaded logo shows for every slug it covers', async () => {
    const list = await admin.get('/v1/admin/storefront/registry');
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.equal(list.json.data.length, brandRegistry.length);
    const steam = list.json.data.find(item => item.slug === 'steam');
    assert.deepEqual([steam.name, steam.initials, steam.logo_url, steam.logo_source, steam.slugs], ['Steam', 'ST', 'https://store.example/brand-icons/steam.svg', 'bundled', ['steam']]);
    assert.ok(steam.products >= 1);
    const dstv = list.json.data.find(item => item.slug === 'dstv');
    assert.deepEqual([dstv.products, dstv.logo_url, dstv.logo_source], [0, null, null], 'entries without products or an icon are listed too, with initials');

    const saved = await admin.put('/v1/admin/storefront/registry/steam', { logo_url: 'https://cdn.example/steam.svg' });
    assert.deepEqual([saved.status, saved.json.logo_url, saved.json.logo_source, saved.json.card_url], [200, 'https://cdn.example/steam.svg', 'upload', null]);
    assert.equal((await brandOf('steam')).logo_url, 'https://cdn.example/steam.svg');
    assert.ok(await server.app.get((await import('../dist/database/prisma.service.js')).PrismaService).auditLog.findFirst({ where: { action: 'brand_registry.assets_updated', targetId: 'steam' } }));

    const card = await admin.put('/v1/admin/storefront/registry/steam', { card_url: 'https://cdn.example/steam-card.png' });
    assert.deepEqual([card.json.logo_url, card.json.card_url], ['https://cdn.example/steam.svg', 'https://cdn.example/steam-card.png'], 'fields change one at a time');
    const cleared = await admin.put('/v1/admin/storefront/registry/steam', { logo_url: null });
    assert.deepEqual([cleared.json.logo_url, cleared.json.logo_source, (await brandOf('steam')).logo_url], ['https://store.example/brand-icons/steam.svg', 'bundled', 'https://store.example/brand-icons/steam.svg'], 'cleared: back to the bundled icon');

    assert.equal((await admin.put('/v1/admin/storefront/registry/psn-plus', { logo_url: 'https://cdn.example/x.png' })).status, 404, 'edited by its main slug');
    assert.equal((await admin.put('/v1/admin/storefront/registry/steam', { logo_url: 'http://insecure.example/x.png' })).status, 400);
  });

  test('card art: the bundled card on the store, to resellers and admins, until an admin uploads one', async () => {
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    const amazon = await prisma.product.findUniqueOrThrow({ where: { key: 'gift_cards:US:amazon-us' } });
    for (const field of ['id', 'key', 'createdAt', 'updatedAt']) delete amazon[field];
    const nike = await prisma.product.create({
      data: { ...amazon, key: 'gift_cards:US:nike', brand: 'nike', name: 'Nike US', imageUrl: null, supplierProducts: { create: { supplierCode: 'reloadly', sku: 'nike-test', costCurrency: 'USD', costRatio: 0.95, syncedAt: new Date() } } },
    });
    const bundled = 'https://store.example/brand-cards/nike.webp';
    assert.equal((await brandOf('nike')).image_url, bundled);
    const entry = (await admin.get('/v1/admin/storefront/registry')).json.data.find(item => item.slug === 'nike');
    assert.deepEqual([entry.card_url, entry.card_source], [bundled, 'bundled']);
    assert.equal((await admin.get('/v1/admin/products?q=nike')).json.data.find(product => product.id === nike.id).card_url, bundled);
    const { browser } = await resellerClient(server);
    const sandbox = { 'bitocard-mode': 'test' };
    assert.equal((await browser.get(`/v1/catalogue/products/${nike.id}`, sandbox)).json.image_url, bundled, 'resellers get it too');

    await admin.put('/v1/admin/storefront/registry/nike', { card_url: 'https://cdn.example/nike-card.png' });
    await server.app.get((await import('../dist/storefront/storefront.service.js')).StorefrontService).refreshBrandAssets(true);
    assert.equal((await brandOf('nike')).image_url, 'https://cdn.example/nike-card.png', 'an upload replaces it');
    assert.equal((await browser.get(`/v1/catalogue/products/${nike.id}`, sandbox)).json.image_url, 'https://cdn.example/nike-card.png');
    await prisma.product.update({ where: { id: nike.id }, data: { imageUrl: 'https://cdn.example/nike-product.png' } });
    assert.equal((await browser.get(`/v1/catalogue/products/${nike.id}`, sandbox)).json.image_url, 'https://cdn.example/nike-product.png', "the product's own image comes first");
  });

  test('a brand’s own settings win over the registry, field by field', async () => {
    await admin.put('/v1/admin/storefront/registry/amazon', { logo_url: 'https://cdn.example/registry-amazon.png' });
    assert.equal((await brandOf('amazon')).logo_url, 'https://cdn.example/registry-amazon.png');
    const saved = await admin.put('/v1/admin/storefront/brands/amazon', { name: 'Amazon', color: '#FF9900', logo_url: 'https://cdn.example/amazon.png' });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const amazon = await brandOf('amazon');
    assert.deepEqual([amazon.color, amazon.logo_url, amazon.company, amazon.initials], ['#FF9900', 'https://cdn.example/amazon.png', 'Amazon.com, Inc.', 'AM']);
  });
});

describe('npm run brands:logos', () => {
  test('checks and uploads a folder of logos to fixed paths, and writes them into the registry', async () => {
    const puts = [];
    const fake = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      puts.push({ method: req.method, url: req.url, headers: req.headers, size: Buffer.concat(chunks).length });
      res.writeHead(String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 ') ? 200 : 403).end();
    });
    await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
    const folder = mkdtempSync(join(tmpdir(), 'logos-'));
    writeFileSync(join(folder, 'mtn.png'), png(256, 256));
    writeFileSync(join(folder, 'psn-plus.png'), png(128, 128));
    writeFileSync(join(folder, 'steam-card.png'), png(640, 400));
    writeFileSync(join(folder, 'netflix.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    writeFileSync(join(folder, 'unknown-brand.png'), png(10, 10));
    writeFileSync(join(folder, 'notes.txt'), 'ignored');
    const registry = join(folder, 'registry.json');
    copyFileSync(fileURLToPath(new URL('../src/storefront/brand-registry.json', import.meta.url)), registry);

    const script = fileURLToPath(new URL('../scripts/brand-logos.mjs', import.meta.url));
    const env = { ...process.env, SPACES_KEY: 'DO00TEST', SPACES_SECRET: 'secret', SPACES_BUCKET: 'media', SPACES_ENDPOINT: `http://127.0.0.1:${fake.address().port}`, SPACES_ROOT: 'test' };
    const result = await promisify(execFile)(process.execPath, [script, folder, '--write', '--registry', registry], { env }).catch(error => error);
    fake.close();

    assert.equal(result.code, 1, 'refused files make the run fail');
    assert.match(result.stdout, /3 uploaded, 2 refused/);
    assert.match(result.stderr, /netflix\.svg: not a plain SVG/);
    assert.match(result.stderr, /unknown-brand\.png: no brand in the registry/);
    assert.deepEqual(puts.map(put => put.url).sort(), ['/media/test/platform/brands/mtn/logo.png', '/media/test/platform/brands/playstation/logo.png', '/media/test/platform/brands/steam/card.png']);
    assert.ok(puts.every(put => put.headers['x-amz-acl'] === 'public-read' && put.headers['content-type'] === 'image/png'));

    const written = JSON.parse(readFileSync(registry, 'utf8')).brands;
    assert.equal(written.find(brand => brand.slug === 'mtn').logo, 'brands/mtn/logo.png');
    assert.equal(written.find(brand => brand.slug === 'playstation').logo, 'brands/playstation/logo.png');
    assert.equal(written.find(brand => brand.slug === 'steam').card, 'brands/steam/card.png');
    assert.equal(written.find(brand => brand.slug === 'netflix').logo, null);
    assert.equal(readFileSync(registry, 'utf8').split('\n').filter(line => line.trim().startsWith('{ "slug"')).length, written.length, 'one brand per line');
  });
});
