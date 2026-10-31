// Listings: BitoCard's own store shows only products an admin has listed (by product, or in bulk by supplier,
// category or words), while each reseller lists what their own hosted store shows. Neither gates a reseller's API
// catalogue, and one never changes the other.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';

let server;
let reloadly;
let admin;
let visitor;
let prisma;

before(async () => {
  reloadly = await fakeReloadly();
  server = await startApp({ env: reloadly.env });
  admin = await adminClient(server);
  visitor = client(server.base);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
});

after(async () => {
  await server?.close();
  await reloadly?.close();
});

const storeKeys = async (query = '') => (await visitor.get(`/v1/store/products?limit=60${query}`)).json.data.map(product => product.key).sort();

describe("BitoCard's store listing", () => {
  test('a synced catalogue is not on the store until an admin lists it', async () => {
    assert.deepEqual(await storeKeys(), [], 'nothing listed yet');
    const all = (await admin.get('/v1/admin/products?supplier=reloadly&limit=100')).json;
    assert.ok(all.total > 0 && all.data.every(product => product.listed === false && product.offers.some(offer => offer.supplier === 'reloadly')));
    assert.equal(all.listed, 0);
    assert.equal((await admin.get('/v1/admin/products?supplier=vtpass')).json.total, 0, "only that supplier's products");
  });

  test('admins list and unlist one product; it shows on the store only while listed', async () => {
    const amazon = await prisma.product.findUniqueOrThrow({ where: { key: 'gift_cards:US:amazon-us' } });
    const listed = await admin.patch(`/v1/admin/products/${amazon.id}`, { listed: true });
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.deepEqual([listed.json.listed, Boolean(listed.json.listed_at)], [true, true]);
    assert.deepEqual(await storeKeys(), ['gift_cards:US:amazon-us']);
    assert.equal((await visitor.get(`/v1/store/products/${encodeURIComponent(amazon.key)}`)).status, 200);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'product.updated', targetId: amazon.id } }));

    const listedOnly = (await admin.get('/v1/admin/products?listed=true')).json;
    assert.deepEqual([listedOnly.total, listedOnly.data.map(product => product.key)], [1, ['gift_cards:US:amazon-us']]);

    await admin.patch(`/v1/admin/products/${amazon.id}`, { listed: false });
    assert.deepEqual(await storeKeys(), []);
    assert.equal((await visitor.get(`/v1/store/products/${encodeURIComponent(amazon.key)}`)).status, 404, 'unlisted products are not found on the store');
  });

  test('admins list in bulk by filter or by ID, audited; unlisting in bulk takes them off', async () => {
    const giftCards = await admin.post('/v1/admin/products/listing', { listed: true, filter: { supplier: 'reloadly', category: 'gift_cards' } });
    assert.equal(giftCards.status, 200, JSON.stringify(giftCards.json));
    const count = await prisma.product.count({ where: { category: 'gift_cards', supplierProducts: { some: { supplierCode: 'reloadly' } } } });
    assert.equal(giftCards.json.updated, count);
    const keys = await storeKeys();
    assert.ok(keys.length > 0 && keys.every(key => key.startsWith('gift_cards:')), 'only the gift cards');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'products.listed' } }));
    assert.equal((await admin.post('/v1/admin/products/listing', { listed: true, filter: { category: 'gift_cards' } })).json.updated, 0, 'already listed ones are not counted again');

    const one = await prisma.product.findFirstOrThrow({ where: { category: 'gift_cards' } });
    assert.equal((await admin.post('/v1/admin/products/listing', { listed: false, product_ids: [one.id] })).json.updated, 1);
    assert.ok(!(await storeKeys()).includes(one.key));
    assert.equal((await admin.post('/v1/admin/products/listing', { listed: false, filter: {} })).json.updated, count - 1);
    assert.deepEqual(await storeKeys(), []);

    const missing = await admin.post('/v1/admin/products/listing', { listed: true });
    assert.deepEqual([missing.status, missing.json.error.param], [400, 'product_ids']);
  });
});

describe('discount products need a reseller share before listing', () => {
  const sandbox = { 'bitocard-mode': 'test' };

  test('no share, or one the supplier discount does not cover, blocks listing for admins (named) and resellers', async () => {
    const mtn = await prisma.product.findUniqueOrThrow({ where: { key: 'airtime:NG:mtn:topup' } });
    const single = await admin.patch(`/v1/admin/products/${mtn.id}`, { listed: true });
    assert.deepEqual([single.status, single.json.error.code, single.json.error.param], [400, 'reseller_discount_missing', 'listed']);
    assert.match(single.json.error.message, /in NG no reseller discount share is set/);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: mtn.id } })).listed, false);

    const bulk = await admin.post('/v1/admin/products/listing', { listed: true, filter: { category: 'airtime' } });
    assert.equal(bulk.status, 200);
    assert.ok(bulk.json.blocked.some(item => item.product_id === mtn.id && item.country === 'NG' && item.reseller_discount_bps === 0), 'named, so admins can set a share');
    assert.equal(await prisma.product.count({ where: { category: 'airtime', listed: true } }), bulk.json.updated, 'the rest are listed');
    await admin.post('/v1/admin/products/listing', { listed: false, filter: {} });

    const { browser } = await resellerClient(server);
    const reseller = await browser.post('/v1/catalogue/listing', { listed: true, product_ids: [mtn.id] }, sandbox);
    assert.deepEqual([reseller.status, reseller.json.error.code], [400, 'reseller_discount_missing']);
    assert.doesNotMatch(reseller.json.error.message, /supplier/i, 'resellers are never told about the supplier');

    // MTN's supplier gives 3%: a 4% share is not covered; a 1% share is.
    const finance = await adminClient(server, ['finance']);
    const rule = (await finance.put('/v1/admin/pricing-rules', { category: 'airtime', country: 'NG', kind: 'discount', reseller_discount_bps: 400 })).json;
    try {
      const uncovered = await admin.patch(`/v1/admin/products/${mtn.id}`, { listed: true });
      assert.match(uncovered.json.error.message, /the reseller share \(4%\) is not less than the supplier's discount \(3%\)/);
      await finance.put('/v1/admin/pricing-rules', { category: 'airtime', country: 'NG', kind: 'discount', reseller_discount_bps: 100 });
      assert.equal((await admin.patch(`/v1/admin/products/${mtn.id}`, { listed: true })).status, 200);
      assert.equal((await browser.post('/v1/catalogue/listing', { listed: true, product_ids: [mtn.id] }, sandbox)).status, 200);
    } finally {
      await admin.patch(`/v1/admin/products/${mtn.id}`, { listed: false });
      await finance.delete(`/v1/admin/pricing-rules/${rule.id}`);
    }
  });
});

describe("a reseller's own store listing", () => {
  const sandbox = { 'bitocard-mode': 'test' };

  test('resellers list what their store shows; their API catalogue is never gated by either listing', async () => {
    const { browser } = await resellerClient(server);
    // Gift cards (sold by markup here): discount products need a share first (above).
    const catalogue = (await browser.get('/v1/catalogue/products?category=gift_cards&limit=50', sandbox)).json;
    assert.ok(catalogue.data.length > 0, 'the whole catalogue, though BitoCard has listed nothing');
    assert.ok(catalogue.data.every(product => product.listed === false));

    const [first, second] = catalogue.data;
    const listed = await browser.post('/v1/catalogue/listing', { listed: true, product_ids: [first.id, second.id] }, sandbox);
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.equal(listed.json.updated, 2);
    assert.equal((await browser.get(`/v1/catalogue/products/${first.id}`, sandbox)).json.listed, true);
    const mine = (await browser.get('/v1/catalogue/products?listed=true', sandbox)).json.data.map(product => product.id).sort();
    assert.deepEqual(mine, [first.id, second.id].sort());
    assert.ok(!(await browser.get('/v1/catalogue/products?listed=false&limit=50', sandbox)).json.data.some(product => product.id === first.id));

    assert.deepEqual(await storeKeys(), [], "a reseller's listing never puts a product on BitoCard's store");
    assert.equal((await browser.post('/v1/catalogue/listing', { listed: false, product_ids: [first.id] }, sandbox)).json.updated, 1);
    assert.equal((await browser.get(`/v1/catalogue/products/${first.id}`, sandbox)).json.listed, false);

    const other = await resellerClient(server);
    assert.equal((await other.browser.get(`/v1/catalogue/products/${second.id}`, sandbox)).json.listed, false, 'listings are per reseller');
  });

  test('only products available to the reseller can be listed', async () => {
    const { browser } = await resellerClient(server);
    const hidden = await prisma.product.findFirstOrThrow({ where: { category: 'gift_cards' } });
    await prisma.product.update({ where: { id: hidden.id }, data: { active: false } });
    try {
      const refused = await browser.post('/v1/catalogue/listing', { listed: true, product_ids: [hidden.id] }, sandbox);
      assert.deepEqual([refused.status, refused.json.error.code], [400, 'product_unavailable']);
    } finally {
      await prisma.product.update({ where: { id: hidden.id }, data: { active: true } });
    }
    const unknown = await browser.post('/v1/catalogue/listing', { listed: true, product_ids: ['00000000-0000-4000-8000-000000000000'] }, sandbox);
    assert.equal(unknown.json.error.code, 'product_unavailable');
  });
});
