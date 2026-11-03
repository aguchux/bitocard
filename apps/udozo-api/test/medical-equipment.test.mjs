// Hospital and medical equipment (docs/UDOZO_HOME_ROWS_PLAN.md part B): a top category again, with home care and
// monitoring (Health and mobility aids moved here, its slug kept), mobility and patient care, clinic and hospital
// equipment, laboratory equipment, and medical supplies and PPE, each with its features, brands and models, the Safe
// Trade Guide's checks and refused words for what may never be sold.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, startApp } from './helpers.mjs';

let server;
let prisma;
let visitor;
const subcategories = ['health-equipment', 'mobility-patient-care', 'clinic-hospital-equipment', 'lab-equipment', 'medical-supplies'];

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const admin = await adminClient(server, ['operations']);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  visitor = client(server.base);
});

after(() => server?.close());

describe('Hospital and medical equipment', () => {
  test('a top category after Beauty and personal care, with its five subcategories, prefixes and checks', async () => {
    const top = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'medical-equipment' }, include: { children: { orderBy: { position: 'asc' } }, countries: true } });
    assert.deepEqual([top.parentId, top.name, top.enabled, top.b2b], [null, 'Hospital and medical equipment', true, false]);
    const beauty = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'health-beauty' } });
    assert.equal(top.position, beauty.position + 1);
    assert.deepEqual(top.children.map(c => c.slug), subcategories);
    assert.equal(top.children[0].name, 'Home care and monitoring', 'Health and mobility aids moved here, its slug kept');
    assert.ok(top.children.every(c => c.enabled));
    assert.match(top.safetyChecklist.join(' '), /registration number/);

    const prefixes = [top, ...top.children].map(c => c.skuPrefix);
    assert.equal(new Set(prefixes).size, prefixes.length, 'each has its own prefix');
    for (const c of [top, ...top.children]) assert.ok(await prisma.classifiedCategorySkuPrefix.findUnique({ where: { prefix: c.skuPrefix } }), `${c.slug}'s prefix is kept for good`);
    assert.ok(top.countries.length >= 15 && top.countries.every(row => row.enabled), 'open in every market');
  });

  test('features buyers ask about, filters only on filterable keys', async () => {
    const rows = await prisma.classifiedCategory.findMany({ where: { slug: { in: subcategories } }, include: { features: { include: { feature: true } } } });
    const keys = slug => rows.find(c => c.slug === slug).features.map(link => link.feature.key);
    assert.ok(['brand', 'model', 'power_source', 'certification'].every(key => keys('clinic-hospital-equipment').includes(key)));
    assert.ok(['brand', 'pack_size', 'sterile', 'sealed', 'expiry', 'registration_number'].every(key => keys('medical-supplies').includes(key)));
    assert.ok(keys('mobility-patient-care').includes('max_weight'));
    for (const c of rows) for (const link of c.features) if (link.filter) assert.ok(link.feature.filterable, `${c.slug} filters only on filterable keys (${link.feature.key})`);
  });

  test('each subcategory offers its brands, an existing brand linked rather than made twice', async () => {
    const brands = async slug => (await visitor.get(`/v1/classifieds/brands?category=${slug}&country=NG`)).json.data.map(row => row.name);
    assert.deepEqual((await brands('clinic-hospital-equipment')).slice(0, 3), ['Mindray', 'Philips', 'GE HealthCare']);
    assert.ok((await brands('mobility-patient-care')).includes('Invacare'));
    assert.ok((await brands('lab-equipment')).includes('Sysmex'));
    assert.ok((await brands('medical-supplies')).includes('Mölnlycke'));
    assert.equal((await brands('health-equipment'))[0], 'Omron', 'Home care keeps its brands first');
    assert.equal(await prisma.classifiedBrand.count({ where: { nameKey: 'philips' } }), 1);
    assert.equal(await prisma.classifiedBrand.count({ where: { nameKey: 'mindray' } }), 1, 'one Mindray for clinics and labs');
  });

  test('their models, and a title names them', async () => {
    const models = (await visitor.get('/v1/classifieds/models?brand=Mindray&category=clinic-hospital-equipment&country=NG')).json.data.map(row => row.name);
    assert.ok(models.includes('iMEC 10') && models.includes('BeneHeart R3'));
    const labs = (await visitor.get('/v1/classifieds/models?brand=Mindray&category=lab-equipment&country=NG')).json.data.map(row => row.name);
    assert.ok(labs.includes('BC-5150') && !labs.includes('iMEC 10'), "a brand's models are its own per category");
    const found = (await visitor.get(`/v1/classifieds/models/detect?category=clinic-hospital-equipment&title=${encodeURIComponent('Mindray iMEC 10 patient monitor, fairly used')}`)).json;
    assert.deepEqual([found.brand.name, found.model], ['Mindray', 'iMEC 10']);
    const microscope = (await visitor.get(`/v1/classifieds/models/detect?category=lab-equipment&title=${encodeURIComponent('Olympus CX23 binocular microscope')}`)).json;
    assert.deepEqual([microscope.brand.name, microscope.model], ['Olympus', 'CX23']);
    const om = await prisma.classifiedBrand.findUniqueOrThrow({ where: { slug: 'om-system' } });
    assert.ok(!om.matchKeys.includes('olympus'), 'OM System no longer takes Olympus');
  });

  test('used single-use items are refused, prescription medicines reviewed', async () => {
    const words = await prisma.classifiedProhibitedWord.findMany({ where: { phrase: { in: ['used syringes', 'used needles', 'prescription only'] }, country: null } });
    assert.deepEqual(Object.fromEntries(words.map(row => [row.phrase, row.action])), { 'used syringes': 'block', 'used needles': 'block', 'prescription only': 'review' });
  });
});
