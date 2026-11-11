// Categories rescanned (6 November 2026): what people sell that had no place of its own (plastic chairs and tables,
// mattresses and bedding, carpets, rugs and curtains, plates and cups, plastics and storage, fabrics, tiles and sanitary
// ware, stationery, packaging, tailoring, construction), each in its natural top category, and search words for every
// subcategory, matched on Post an ad, in the search box's suggestions and by the assistants; admins edit them.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, startApp } from './helpers.mjs';

let server;
let prisma;
let visitor;
let operations;

const added = {
  'home-garden': ['plastic-furniture', 'bedding-mattresses', 'carpets-rugs', 'tableware', 'plastics-storage'],
  fashion: ['fabrics'],
  'repair-construction': ['tiles-sanitary'],
  'sports-leisure': ['stationery'],
  'business-industrial': ['packaging'],
  services: ['tailoring', 'construction-services'],
};
const newSlugs = Object.values(added).flat();

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  operations = await adminClient(server, ['operations']);
  assert.equal((await operations.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  visitor = client(server.base);
});

after(() => server?.close());

describe('the new subcategories', () => {
  test('each in its natural top category, in the order shoppers look, with its own prefix, open where its top category is', async () => {
    for (const [parent, slugs] of Object.entries(added)) {
      const top = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: parent }, include: { countries: true } });
      for (const slug of slugs) {
        const row = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug }, include: { countries: true } });
        assert.equal(row.parentId, top.id, `${slug} is under ${parent}`);
        assert.ok(row.enabled);
        assert.ok(await prisma.classifiedCategorySkuPrefix.findUnique({ where: { prefix: row.skuPrefix } }), `${slug}'s prefix is kept for good`);
        assert.deepEqual(row.countries.map(c => `${c.country}:${c.enabled}`).sort(), top.countries.map(c => `${c.country}:${c.enabled}`).sort(), `${slug} is open where ${parent} is`);
      }
    }
    const prefixes = (await prisma.classifiedCategory.findMany({ select: { skuPrefix: true } })).map(row => row.skuPrefix);
    assert.equal(new Set(prefixes).size, prefixes.length, 'no two categories share a prefix');

    const home = await prisma.classifiedCategory.findMany({ where: { parent: { slug: 'home-garden' } }, orderBy: { position: 'asc' } });
    assert.deepEqual(home.map(c => c.slug), ['furniture', 'plastic-furniture', 'bedding-mattresses', 'carpets-rugs', 'home-appliances', 'kitchen-appliances', 'kitchen', 'tableware', 'plastics-storage', 'home-accessories', 'household-supplies', 'generators-solar', 'garden']);
    const names = Object.fromEntries(home.map(c => [c.slug, c.name]));
    assert.equal(names['plastic-furniture'], 'Plastic chairs and tables');
    assert.equal(names['carpets-rugs'], 'Carpets, rugs and curtains');
    assert.equal(names.tableware, 'Plates, cups and dinnerware');
    assert.equal(names['home-appliances'], 'Fridges, ACs and washing machines', 'air conditioners say where they are');
    assert.equal(names.kitchen, 'Pots, pans and cookers', 'plates and cups moved to their own list');
    assert.equal((await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tiles-sanitary' } })).name, 'Tiles and sanitary ware');
  });

  test('features buyers ask about, new ones in the registry, filters only on filterable keys', async () => {
    const features = await prisma.classifiedFeature.findMany({ where: { key: { in: ['tableware_material', 'pieces', 'fabric_type', 'fabric_length'] } } });
    assert.equal(features.length, 4);
    assert.ok(features.find(f => f.key === 'tableware_material').choices.includes('Ceramic'));
    assert.equal(features.find(f => f.key === 'fabric_length').unit, 'yards');
    const rows = await prisma.classifiedCategory.findMany({ where: { slug: { in: newSlugs } }, include: { features: { include: { feature: true } } } });
    const keys = slug => rows.find(c => c.slug === slug).features.map(link => link.feature.key);
    assert.ok(['tableware_material', 'pieces'].every(key => keys('tableware').includes(key)));
    assert.ok(['fabric_type', 'fabric_length', 'colour'].every(key => keys('fabrics').includes(key)));
    assert.ok(['size', 'thickness', 'brand'].every(key => keys('bedding-mattresses').includes(key)));
    assert.ok(['pricing', 'home_service', 'experience'].every(key => keys('construction-services').includes(key)));
    for (const c of rows) {
      assert.ok(c.features.length >= 5 && c.features.length <= 20, `${c.slug} suggests enough, within a listing's 20`);
      for (const link of c.features) if (link.filter) assert.ok(link.feature.filterable, `${c.slug} filters only on filterable keys (${link.feature.key})`);
    }
  });

  test('their brands: existing ones linked, never made twice, new ones added once', async () => {
    const brands = async slug => (await visitor.get(`/v1/classifieds/brands?category=${slug}&country=NG`)).json.data.map(row => row.name);
    assert.ok((await brands('tableware')).includes('Luminarc'));
    assert.ok((await brands('bedding-mattresses')).includes('Vitafoam'));
    assert.ok((await brands('fabrics')).includes('Vlisco'));
    assert.ok((await brands('tiles-sanitary')).includes('Grohe'));
    assert.ok((await brands('stationery')).includes('Faber-Castell'));
    for (const key of ['royalford', 'grohe', 'vitafoam', 'kenpoly']) assert.equal(await prisma.classifiedBrand.count({ where: { nameKey: key } }), 1, `${key} once`);
  });

  test('the checks to make before paying, where the top category does not cover them', async () => {
    const checks = async slug => (await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug } })).safetyChecklist.join(' ');
    assert.match(await checks('tiles-sanitary'), /batch and shade/);
    assert.match(await checks('fabrics'), /yards/);
    assert.match(await checks('bedding-mattresses'), /Measure the mattress/);
  });
});

describe('search words', () => {
  test('every open subcategory has its own, clean: lower case, each once, short', async () => {
    const rows = await prisma.classifiedCategory.findMany({ where: { enabled: true, parentId: { not: null } } });
    for (const row of rows) {
      assert.ok(row.keywords.length >= 4, `${row.slug} has search words`);
      assert.equal(new Set(row.keywords).size, row.keywords.length, `${row.slug}'s words are each once`);
      for (const word of row.keywords) assert.ok(word === word.toLowerCase().trim() && word.length >= 2 && word.length <= 40 && !/[%_]/.test(word), `${row.slug}: "${word}"`);
    }
  });

  test('the public tree carries them for Post an ad', async () => {
    const tree = (await visitor.get('/v1/classifieds/categories?country=NG')).json.data;
    const home = tree.find(top => top.slug === 'home-garden');
    const carpets = home.children.find(child => child.slug === 'carpets-rugs');
    assert.ok(carpets.keywords.includes('rug') && carpets.keywords.includes('curtain'));
  });

  test("the search box's suggestions find a subcategory by what people call things, its own name first", async () => {
    const suggest = async q => (await visitor.get(`/v1/classifieds/search/suggest?country=NG&q=${encodeURIComponent(q)}`)).json.categories.map(row => row.slug);
    assert.equal((await suggest('carpet'))[0], 'carpets-rugs');
    assert.equal((await suggest('plastic chairs'))[0], 'plastic-furniture', 'the words hold "plastic chair"');
    assert.ok((await suggest('cups')).includes('tableware'));
    assert.ok((await suggest('ankara')).includes('fabrics'));
    assert.ok((await suggest('mattress')).includes('bedding-mattresses'));
    assert.ok((await suggest('wash hand basin')).includes('tiles-sanitary'));
    assert.equal((await suggest('tablets'))[0], 'tablets', "a name's match comes first");
    assert.ok(!(await suggest('ac')).includes('bags'), 'a short word matches only the start of a search word');
  });

  test('the assistants are told what goes where', async () => {
    const { ShopKnowledgeService } = await import('../dist/classifieds/assistant/shop-knowledge.js');
    const data = await server.app.get(ShopKnowledgeService).gather('NG');
    const home = data.categories.find(category => category.name === 'Home and living');
    assert.ok(home.includes.some(line => line.startsWith('Plastic chairs and tables: plastic chair')));
  });

  test('operations change them (cleaned, audited); support only reads them', async () => {
    const list = (await operations.get('/v1/admin/classifieds/categories?country=NG')).json.data;
    const furniture = list.find(top => top.slug === 'home-garden').children.find(child => child.slug === 'furniture');
    assert.ok(furniture.keywords.includes('sofa'));
    const saved = await operations.patch(`/v1/admin/classifieds/categories/${furniture.id}`, { keywords: ['  Sofa ', 'Bean  Bag', 'sofa', '50%_off'] });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.keywords, ['sofa', 'bean bag', '50off']);
    assert.deepEqual((await prisma.classifiedCategory.findUniqueOrThrow({ where: { id: furniture.id } })).keywords, ['sofa', 'bean bag', '50off']);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'classifieds.category_changed', targetId: furniture.id }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual(audit.after.keywords, ['sofa', 'bean bag', '50off']);
    assert.equal((await operations.patch(`/v1/admin/classifieds/categories/${furniture.id}`, { keywords: Array.from({ length: 61 }, (_, i) => `word ${i}`) })).status, 400);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.patch(`/v1/admin/classifieds/categories/${furniture.id}`, { keywords: ['sofa'] })).status, 403);
  });
});

describe('somewhere for what fits no category', () => {
  test('Other services last under Services, as Jiji has it, and Everything else last of all with Other items', async () => {
    const services = await prisma.classifiedCategory.findMany({ where: { parent: { slug: 'services' } }, orderBy: { position: 'asc' } });
    assert.deepEqual([services.at(-1).slug, services.at(-1).name], ['other-services', 'Other services']);
    const tops = await prisma.classifiedCategory.findMany({ where: { parentId: null, shopOnly: false }, orderBy: { position: 'asc' }, include: { children: true, countries: true } });
    const last = tops.at(-1);
    assert.deepEqual([last.slug, last.name, last.b2b], ['everything-else', 'Everything else', false]);
    assert.deepEqual(last.children.map(c => [c.slug, c.name]), [['other-items', 'Other items']]);
    assert.ok(last.safetyChecklist.length >= 3, 'with the general checks');
    const servicesTop = tops.find(top => top.slug === 'services');
    assert.deepEqual(last.countries.map(c => `${c.country}:${c.enabled}`).sort(), servicesTop.countries.map(c => `${c.country}:${c.enabled}`).sort(), 'open where Services is');
    const tree = (await visitor.get('/v1/classifieds/categories?country=NG')).json.data;
    assert.equal(tree.at(-1).slug, 'everything-else', 'last in the menu');
  });

  test('found by what people call such things', async () => {
    const suggest = async q => (await visitor.get(`/v1/classifieds/search/suggest?country=NG&q=${encodeURIComponent(q)}`)).json.categories.map(row => row.slug);
    assert.ok((await suggest('house sitting')).includes('other-services'));
    assert.ok((await suggest('borehole drilling')).includes('other-services'));
    assert.ok((await suggest('miscellaneous')).includes('other-items'));
    assert.ok((await suggest('antique')).includes('other-items'));
  });
});
