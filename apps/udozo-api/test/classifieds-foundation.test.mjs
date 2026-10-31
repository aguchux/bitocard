// BitoCard Shop, phase 1 step 1: the seeded feature registry, categories, Nigerian areas, Safe pay settings and switches.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { adminClient, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  // BitoCard Shop is Udozo's (docs/UDOZO_SPINOFF_PLAN.md).
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(() => server?.close());

const lucideIcons = new URL('../../../node_modules/lucide-react/dist/esm/icons/', import.meta.url);

/** The SQL error a statement fails with, or null when it succeeds. */
async function failure(statement) {
  try {
    await prisma.$executeRawUnsafe(statement);
    return null;
  } catch (error) {
    return String(error.message ?? error);
  }
}

describe('feature registry', () => {
  test('every feature is complete for its data type', async () => {
    const features = await prisma.classifiedFeature.findMany();
    assert.ok(features.length >= 40, 'the common keys are seeded');
    for (const f of features) {
      assert.match(f.key, /^[a-z][a-z0-9_]*$/, f.key);
      assert.ok(['text', 'number', 'choice', 'boolean'].includes(f.dataType), f.key);
      if (f.dataType === 'choice') assert.ok(f.choices.length >= 2, `${f.key} offers choices`);
      else assert.equal(f.choices.length, 0, `${f.key} has no choices`);
      if (f.dataType === 'boolean') assert.ok(['true', 'false'].includes(f.defaultValue), `${f.key} defaults to yes or no`);
      if (f.dataType === 'number') {
        assert.ok(f.min !== null && f.max !== null && f.min < f.max, `${f.key} has limits`);
        assert.match(f.placeholder ?? '', /^e\.g\. /, `${f.key} has a placeholder`);
      } else assert.equal(f.unit, null, `${f.key} has no unit`);
      if (f.dataType === 'text') assert.match(f.placeholder ?? '', /^e\.g\. /, `${f.key} has a placeholder`);
      assert.ok(f.synonyms.length > 0, `${f.key} has search words`);
    }
    const byKey = Object.fromEntries(features.map(f => [f.key, f]));
    assert.deepEqual([byKey.memory.dataType, byKey.memory.unit, byKey.memory.placeholder], ['number', 'GB', 'e.g. 8']);
    assert.ok(byKey.memory.synonyms.includes('ram'), 'typing "ram" finds Memory');
    assert.ok(byKey.storage.synonyms.includes('rom'), 'typing "rom" finds Storage (ROM)');
    assert.deepEqual([byKey.furnished.dataType, byKey.furnished.defaultValue], ['boolean', 'false'], 'Furnished: yes or no, default No');
    assert.equal(byKey.colour.dataType, 'choice');
  });

  test('every icon is a lucide icon the apps can draw', async () => {
    const icons = [...(await prisma.classifiedFeature.findMany({ select: { icon: true } })), ...(await prisma.classifiedCategory.findMany({ select: { icon: true } }))].map(row => row.icon);
    const missing = [...new Set(icons)].filter(icon => !existsSync(new URL(`${icon}.mjs`, lucideIcons)));
    assert.deepEqual(missing, []);
  });

  test('the database refuses a feature that does not fit its type', async () => {
    const insert = (columns, values) => failure(`INSERT INTO "classified_features" ("id", "key", "name", "icon", "updated_at", ${columns}) VALUES (gen_random_uuid(), 'test_key', 'Test', 'tag', now(), ${values})`);
    assert.match(await insert('"data_type"', "'colour'"), /classified_features_data_type_check/);
    assert.match(await insert('"data_type"', "'choice'"), /classified_features_choices_check/, 'a choice needs choices');
    assert.match(await insert('"data_type", "unit"', "'text', 'GB'"), /classified_features_limits_check/, 'only numbers have units');
    assert.match(await insert('"data_type", "default_value"', "'boolean', 'yes'"), /classified_features_boolean_default_check/);
    assert.match(await insert('"data_type", "min", "max"', "'number', 10, 1"), /classified_features_range_check/);
    assert.match(await failure(`INSERT INTO "classified_features" ("id", "key", "name", "icon", "data_type", "updated_at") VALUES (gen_random_uuid(), 'Bad Key', 'Bad', 'tag', 'text', now())`), /classified_features_key_check/);
  });
});

describe('categories', () => {
  test('two levels, each subcategory with suggested features and a checklist to inherit', async () => {
    const categories = await prisma.classifiedCategory.findMany({ include: { features: { include: { feature: true } }, countries: true } });
    const top = categories.filter(c => !c.parentId);
    const subs = categories.filter(c => c.parentId);
    assert.equal(top.length, 14);
    assert.ok(subs.length >= 50);
    const ids = new Map(categories.map(c => [c.id, c]));
    for (const sub of subs) {
      const parent = ids.get(sub.parentId);
      assert.equal(parent.parentId, null, `${sub.slug} is only two levels deep`);
      assert.equal(sub.b2b, parent.b2b, `${sub.slug} follows its parent's B2B flag`);
      assert.ok(sub.features.length >= 1, `${sub.slug} suggests features`);
      assert.ok(sub.safetyChecklist.length > 0 || parent.safetyChecklist.length > 0, `${sub.slug} has a checklist`);
      for (const link of sub.features) if (link.filter) assert.ok(link.feature.filterable, `${sub.slug} filters only on filterable keys (${link.feature.key})`);
    }
    for (const c of categories) assert.deepEqual(c.countries.map(row => [row.country, row.enabled]), [['NG', true]], `${c.slug} is open in Nigeria`);
    assert.deepEqual(top.filter(c => c.b2b).map(c => c.slug), ['business-industrial']);

    const phones = categories.find(c => c.slug === 'mobile-phones');
    const keys = phones.features.sort((a, b) => a.position - b.position).map(link => link.feature.key);
    assert.deepEqual(keys.slice(0, 4), ['brand', 'model', 'storage', 'memory'], 'phones suggest brand, model, storage and memory first');
    assert.equal(categories.find(c => c.slug === 'shoes').features.find(link => link.feature.key === 'size').placeholder, 'e.g. 42', 'a category sets its own placeholder');
    assert.match(categories.find(c => c.slug === 'phones-tablets').safetyChecklist.join(' '), /IMEI/);
  });

  test("Udozo's own tree: its order and words, every category with an icon, and categories that are not Udozo's dropped", async () => {
    const categories = await prisma.classifiedCategory.findMany({ orderBy: { position: 'asc' } });
    const top = categories.filter(c => !c.parentId);
    assert.deepEqual(top.map(c => [c.slug, c.name]), [
      ['phones-tablets', 'Phones and tablets'], ['electronics', 'Electronics'], ['vehicles', 'Vehicles'], ['property', 'Property'],
      ['home-garden', 'Home and living'], ['fashion', 'Fashion'], ['health-beauty', 'Beauty and personal care'], ['babies-kids', 'Kids and baby'],
      ['sports-leisure', 'Sports and hobbies'], ['animals-pets', 'Pets'], ['agriculture-food', 'Farm and food'], ['repair-construction', 'Building and tools'],
      ['business-industrial', 'Wholesale and business'], ['services', 'Services'],
    ]);
    for (const c of categories) assert.match(c.icon, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${c.slug} has a lucide icon name`);
    const bySlug = new Map(categories.map(c => [c.slug, c]));
    for (const slug of ['computers', 'jobs', 'job-vacancies', 'seeking-work', 'cv-it', 'software', 'boats', 'reptiles', 'vitamins-supplements', 'medical-equipment', 'legal-financial', 'travel', 'watches']) {
      assert.equal(bySlug.get(slug), undefined, `${slug} is not one of Udozo's`);
    }
    for (const slug of ['laptops', 'desktops', 'computer-accessories', 'printers']) assert.equal(bySlug.get(slug).parentId, bySlug.get('electronics').id, `${slug} is under Electronics`);
    assert.match(bySlug.get('laptops').safetyChecklist.join(' '), /charger/, "laptops keep the computer checks");
    assert.equal(bySlug.get('livestock-poultry').parentId, bySlug.get('agriculture-food').id, 'livestock is farming');
    assert.match(bySlug.get('livestock-poultry').safetyChecklist.join(' '), /vaccination/, 'with the animal checks');
    assert.equal(bySlug.get('motorcycles').name, 'Motorbikes, scooters and kekes');
  });

  test('a category cannot be its own parent', async () => {
    const [{ id }] = await prisma.$queryRawUnsafe(`SELECT "id" FROM "classified_categories" WHERE "slug" = 'cars'`);
    assert.match(await failure(`UPDATE "classified_categories" SET "parent_id" = "id" WHERE "id" = '${id}'`), /classified_categories_not_own_parent_check/);
  });
});

describe('areas', () => {
  test("Nigeria's 36 states and the FCT, each with areas near its centre", async () => {
    const states = await prisma.classifiedArea.findMany({ where: { country: 'NG', kind: 'state' }, include: { children: true } });
    assert.equal(states.length, 37);
    for (const state of states) {
      assert.ok(state.children.length >= 1, `${state.slug} has areas`);
      for (const area of [state, ...state.children]) {
        const [lat, lng] = [Number(area.latitude), Number(area.longitude)];
        assert.ok(lat >= 4 && lat <= 14 && lng >= 2.6 && lng <= 14.7, `${area.slug} is in Nigeria`);
        assert.ok(Math.hypot(lat - Number(state.latitude), lng - Number(state.longitude)) < 2.5, `${area.slug} is near ${state.slug}`);
      }
    }
    const lagos = states.find(s => s.slug === 'lagos');
    assert.ok(['ikeja', 'lekki', 'yaba', 'surulere', 'ikorodu'].every(slug => lagos.children.some(a => a.slug === slug)));
    assert.ok(states.find(s => s.slug === 'abuja').children.some(a => a.slug === 'gwarinpa'));
  });

  test('slugs are unique where they are looked up, and a state has no parent', async () => {
    const lagos = await prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', slug: 'lagos' } });
    assert.match(await failure(`INSERT INTO "classified_areas" ("id", "country", "parent_id", "kind", "slug", "name", "latitude", "longitude") VALUES (gen_random_uuid(), 'NG', '${lagos.id}', 'area', 'ikeja', 'Ikeja again', 6.6, 3.35)`), /classified_areas_area_slug_key/);
    assert.match(await failure(`INSERT INTO "classified_areas" ("id", "country", "kind", "slug", "name", "latitude", "longitude") VALUES (gen_random_uuid(), 'NG', 'state', 'lagos', 'Lagos again', 6.5, 3.4)`), /classified_areas_state_slug_key/);
    assert.match(await failure(`INSERT INTO "classified_areas" ("id", "country", "kind", "slug", "name", "latitude", "longitude") VALUES (gen_random_uuid(), 'NG', 'area', 'nowhere', 'Nowhere', 6.5, 3.4)`), /classified_areas_kind_check/);
    const ikeja = await prisma.classifiedArea.findFirstOrThrow({ where: { parentId: lagos.id, slug: 'ikeja' } });
    assert.ok(ikeja, 'the same slug may exist in another state (Bauchi, Kano…) but once per state');
  });
});

describe('Safe pay settings', () => {
  test('Nigeria has its time limits and no fees until finance sets them', async () => {
    const ng = await prisma.classifiedSafePaySettings.findUniqueOrThrow({ where: { country: 'NG' } });
    assert.deepEqual([ng.buyerFeeBps, ng.buyerFeeCapMinor, ng.sellerFeeBps, ng.sellerFeeCapMinor], [null, null, null, null]);
    assert.deepEqual([ng.acceptHours, ng.payHours, ng.handoverDays, ng.confirmDays], [24, 24, 5, 3]);
    assert.match(await failure(`UPDATE "classified_safe_pay_settings" SET "buyer_fee_bps" = 10001 WHERE "country" = 'NG'`), /classified_safe_pay_settings_fees_check/);
    assert.match(await failure(`UPDATE "classified_safe_pay_settings" SET "seller_fee_cap_minor" = -1 WHERE "country" = 'NG'`), /classified_safe_pay_settings_fees_check/);
    assert.match(await failure(`UPDATE "classified_safe_pay_settings" SET "accept_hours" = 0 WHERE "country" = 'NG'`), /classified_safe_pay_settings_times_check/);
  });
});

describe('switches', () => {
  test('the Shop, Safe pay and shop assistants are off until an admin opens them, globally or per market', async () => {
    const admin = await adminClient(server);
    const { status, json } = await admin.get('/v1/admin/switches');
    assert.equal(status, 200);
    for (const key of ['classifieds', 'classifieds_safe_pay', 'classifieds_assistant']) {
      const definition = json.definitions[key];
      assert.ok(definition, `${key} is listed`);
      assert.equal(definition.default, false, `${key} is off by default`);
      assert.deepEqual(definition.scopes, ['global', 'country'], `${key} is set globally or per market, never per reseller`);
    }
  });
});
