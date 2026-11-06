// GPS trackers: a subcategory of Electronics with what buyers ask of a tracker, the checks before paying, search words,
// and its brands, Cantrack first with its own bundled mark and its models as its site lists them.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, startApp } from './helpers.mjs';

let server;
let prisma;
let visitor;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server, ['operations']);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  visitor = client(server.base);
});

after(() => server?.close());

describe('GPS trackers', () => {
  test('under Electronics after CCTV and smart home, open where Electronics is, with its own prefix and checks', async () => {
    const electronics = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'electronics' }, include: { countries: true, children: { orderBy: { position: 'asc' } } } });
    const slugs = electronics.children.map(c => c.slug);
    assert.equal(slugs[slugs.indexOf('security-surveillance') + 1], 'gps-trackers');
    assert.equal(slugs.at(-1), 'networking');
    const row = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'gps-trackers' }, include: { countries: true } });
    assert.deepEqual([row.name, row.icon, row.enabled, row.b2b], ['GPS trackers', 'locate-fixed', true, false]);
    assert.deepEqual(row.countries.map(c => `${c.country}:${c.enabled}`).sort(), electronics.countries.map(c => `${c.country}:${c.enabled}`).sort());
    assert.ok(await prisma.classifiedCategorySkuPrefix.findUnique({ where: { prefix: row.skuPrefix } }));
    assert.match(row.safetyChecklist.join(' '), /live on the tracking app/);
    assert.ok(['gps tracker', 'car tracker', 'pet tracker', 'airtag'].every(word => row.keywords.includes(word)));
  });

  test('what buyers ask: what it tracks, its network, whether the app plan is included', async () => {
    const tree = (await visitor.get('/v1/classifieds/categories?country=NG')).json.data;
    const trackers = tree.find(top => top.slug === 'electronics').children.find(child => child.slug === 'gps-trackers');
    const keys = Object.fromEntries(trackers.features.map(feature => [feature.key, feature.filter]));
    assert.deepEqual([keys.brand, keys.tracker_type, keys.tracker_network, keys.tracking_plan], [true, true, true, true]);
    assert.ok('model' in keys && 'installation' in keys);
    const type = trackers.features.find(feature => feature.key === 'tracker_type');
    assert.ok(type.choices.includes('Motorcycle or keke') && type.choices.includes('Pet'));
  });

  test('found by what people call it', async () => {
    const suggest = async q => (await visitor.get(`/v1/classifieds/search/suggest?country=NG&q=${encodeURIComponent(q)}`)).json.categories.map(row => row.slug);
    assert.equal((await suggest('gps tracker'))[0], 'gps-trackers');
    assert.ok((await suggest('car tracker')).includes('gps-trackers'));
  });

  test('Cantrack first, with its own mark and colour; its models; at least ten brands', async () => {
    const brands = (await visitor.get('/v1/classifieds/brands?category=gps-trackers&country=NG')).json.data;
    assert.ok(brands.length >= 10);
    const [cantrack] = brands;
    assert.deepEqual([cantrack.name, cantrack.slug, cantrack.color], ['Cantrack', 'cantrack', '#376AB3']);
    assert.equal(cantrack.logo_url, 'https://udozo.com/brand-logos/cantrack.svg');
    assert.ok(brands.some(b => b.name === 'Teltonika') && brands.some(b => b.name === 'Apple'));

    const svg = fileURLToPath(new URL('../../udozo/public/brand-logos/cantrack.svg', import.meta.url));
    assert.ok(existsSync(svg));
    const text = readFileSync(svg, 'utf8');
    assert.match(text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(!/<script|on\w+=|href="(?!data:image\/png;base64,)/i.test(text), 'a plain image, nothing that runs or reaches elsewhere');

    const models = (await visitor.get('/v1/classifieds/models?category=gps-trackers&brand=cantrack&country=NG&limit=50')).json.data.map(m => m.name);
    assert.ok(['G900LM', 'TK100', 'C32Plus', 'G08L tail light tracker', 'NB20 pet tracker'].every(name => models.includes(name)), JSON.stringify(models));
    const found = (await visitor.get('/v1/classifieds/models?category=gps-trackers&brand=cantrack&q=gt06&country=NG')).json.data.map(m => m.name);
    assert.ok(found.includes('TK100'), 'GT06 is TK100');
    // Every model on its site, the asset and OBD trackers included.
    assert.equal(models.filter(Boolean).length, 38);
    assert.ok(['G200L magnetic tracker', 'GF20 mini magnetic tracker', 'TK200AM disposable tracker', 'G500L OBD tracker', 'G183 OBD tracker', 'G03'].every(name => models.includes(name)), JSON.stringify(models));
    const obd = (await visitor.get('/v1/classifieds/models?category=gps-trackers&brand=cantrack&q=g500l&country=NG')).json.data.map(m => m.name);
    assert.ok(obd.includes('G500L OBD tracker'), 'found by its code alone');
  });
});
