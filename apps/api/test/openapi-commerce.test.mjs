// Real responses of the catalogue, quotes, orders, stores and BitoCard's own store match their documented schemas
// (src/openapi/responses/commerce.ts and stores.ts), so the API reference cannot drift from what the API returns.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly, fakeVtpass } from './fakes.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let reloadly;
let vtpass;
let admin;
let prisma;
let wallets;
let check;

before(async () => {
  reloadly = await fakeReloadly();
  vtpass = await fakeVtpass();
  server = await startApp({ env: { ...reloadly.env, ...vtpass.env, ENCRYPTION_KEY: randomBytes(32).toString('base64') } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
  assert.equal((await admin.post('/v1/admin/suppliers/vtpass/sync')).status, 200);
  assert.equal((await admin.post('/v1/admin/products/listing', { listed: true, filter: {} })).status, 200);
  check = await responseChecker(server.app);
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  await vtpass?.close();
});

const sandbox = { 'bitocard-mode': 'test' };
const productId = async key => (await prisma.product.findUniqueOrThrow({ where: { key } })).id;

/** Calls an endpoint, asserts the status and checks the body against the documented schema. */
async function call(browser, key, status, method, path, body, headers) {
  const res = method === 'GET' || method === 'DELETE' ? await browser[method.toLowerCase()](path, headers) : await browser[method.toLowerCase()](path, body, headers);
  assert.equal(res.status, status, `${key}: ${JSON.stringify(res.json)}`);
  check(key, status, res.json);
  return res.json;
}

/** A verified reseller with a confirmed email and money in both wallets. */
async function funded() {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  for (const mode of ['live', 'test']) await wallets.adjust(null, { resellerId: reseller.resellerId, mode, balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
  return reseller;
}

describe('catalogue, pricing, quotes and orders', () => {
  test('match their documented schemas', async () => {
    const { browser } = await funded();
    const amazon = await productId('gift_cards:US:amazon-us');
    const mtn = await productId('airtime:NG:mtn:topup');

    const catalogue = await call(browser, 'GET /v1/catalogue/products', 200, 'GET', '/v1/catalogue/products?limit=3', undefined, sandbox);
    assert.ok(catalogue.data.length > 0);
    assert.equal(catalogue.has_more, true);
    await call(browser, 'GET /v1/catalogue/products', 200, 'GET', `/v1/catalogue/products?limit=100`, undefined, sandbox);
    await call(browser, 'GET /v1/catalogue/products/{id}', 200, 'GET', `/v1/catalogue/products/${amazon}`, undefined, sandbox);
    await call(browser, 'POST /v1/catalogue/listing', 200, 'POST', '/v1/catalogue/listing', { listed: true, product_ids: [amazon, mtn] }, sandbox);
    const listed = await call(browser, 'GET /v1/catalogue/products/{id}', 200, 'GET', `/v1/catalogue/products/${mtn}`, undefined, sandbox);
    assert.equal(listed.listed, true);
    await call(browser, 'POST /v1/catalogue/listing', 200, 'POST', '/v1/catalogue/listing', { listed: false, product_ids: [mtn] }, sandbox);

    await call(browser, 'GET /v1/pricing', 200, 'GET', '/v1/pricing');
    await call(browser, 'PUT /v1/pricing/markups', 200, 'PUT', '/v1/pricing/markups', { category: 'airtime', markup_bps: 1000 });
    const pricing = await call(browser, 'PUT /v1/pricing/markups', 200, 'PUT', '/v1/pricing/markups', { category: 'gift_cards', product_id: amazon, markup_bps: 1000 });
    assert.equal(pricing.markups.find(item => item.product_id === amazon).product_name, 'Amazon US');
    await call(browser, 'DELETE /v1/pricing/markups', 200, 'DELETE', `/v1/pricing/markups?category=gift_cards&product_id=${amazon}`);

    // Quotes: a gift card, airtime (phone), pay-TV (checked smartcard) and electricity (meter), one with tax.
    const giftQuote = await call(browser, 'POST /v1/quotes', 201, 'POST', '/v1/quotes', { product_id: amazon, face_value: 1000, quantity: 2, customer_reference: 'cust-1042' }, sandbox);
    await call(browser, 'GET /v1/quotes/{id}', 200, 'GET', `/v1/quotes/${giftQuote.id}`, undefined, sandbox);
    const tvQuote = await call(
      browser,
      'POST /v1/quotes',
      201,
      'POST',
      '/v1/quotes',
      { product_id: await productId('pay_tv:NG:dstv:dstv-padi'), face_value: (await prisma.product.findUniqueOrThrow({ where: { key: 'pay_tv:NG:dstv:dstv-padi' } })).fixedValues.map(Number)[0], recipient: { account_number: '7023456789', transaction_type: 'renew' } },
      sandbox,
    );
    assert.equal(tvQuote.recipient.account_name, 'SANDBOX CUSTOMER');
    const meterQuote = await call(browser, 'POST /v1/quotes', 201, 'POST', '/v1/quotes', { product_id: await productId('bills:NG:ikeja-electric:prepaid'), face_value: 500_000, recipient: { account_number: '45012345678' } }, sandbox);

    await admin.put('/v1/admin/countries/NG/categories/airtime', { taxable: true });
    let taxedQuote;
    try {
      taxedQuote = await call(browser, 'POST /v1/quotes', 201, 'POST', '/v1/quotes', { product_id: mtn, face_value: 100_000, recipient: { phone: '08031234567' } }, sandbox);
      assert.equal(taxedQuote.tax.name, 'VAT');
    } finally {
      await admin.put('/v1/admin/countries/NG/categories/airtime', { taxable: false });
    }

    // Orders: completed (codes), failed, pending then simulated, electricity token, pay-TV confirmation, taxed airtime.
    const gift = await call(browser, 'POST /v1/orders', 201, 'POST', '/v1/orders', { quote_id: giftQuote.id }, sandbox);
    assert.deepEqual([gift.status, gift.deliveries.length], ['completed', 2]);
    assert.match(gift.deliveries[0].code, /^SANDBOX-/);
    const failedQuote = await call(browser, 'POST /v1/quotes', 201, 'POST', '/v1/quotes', { product_id: amazon, face_value: 1000 }, sandbox);
    const failed = await call(browser, 'POST /v1/orders', 201, 'POST', '/v1/orders', { quote_id: failedQuote.id, simulate: 'failed' }, sandbox);
    assert.equal(failed.status, 'failed');
    const pendingQuote = await call(browser, 'POST /v1/quotes', 201, 'POST', '/v1/quotes', { product_id: amazon, face_value: 2500 }, sandbox);
    const pending = await call(browser, 'POST /v1/orders', 201, 'POST', '/v1/orders', { quote_id: pendingQuote.id, simulate: 'pending' }, sandbox);
    assert.deepEqual([pending.status, pending.deliveries], ['processing', []]);
    const simulated = await call(browser, 'POST /v1/orders/{id}/simulate', 200, 'POST', `/v1/orders/${pending.id}/simulate`, { outcome: 'completed' }, sandbox);
    assert.equal(simulated.status, 'completed');
    const token = await call(browser, 'POST /v1/orders', 201, 'POST', '/v1/orders', { quote_id: meterQuote.id }, sandbox);
    assert.equal(token.deliveries[0].kind, 'token');
    const tv = await call(browser, 'POST /v1/orders', 201, 'POST', '/v1/orders', { quote_id: tvQuote.id }, sandbox);
    assert.equal(tv.deliveries[0].kind, 'confirmation');
    const taxed = await call(browser, 'POST /v1/orders', 201, 'POST', '/v1/orders', { quote_id: taxedQuote.id }, sandbox);

    const orders = await call(browser, 'GET /v1/orders', 200, 'GET', '/v1/orders', undefined, sandbox);
    assert.deepEqual(new Set(orders.data.map(order => order.status)), new Set(['completed', 'failed']));
    await call(browser, 'GET /v1/orders/{id}', 200, 'GET', `/v1/orders/${gift.id}`, undefined, sandbox);
    const replaced = await call(browser, 'POST /v1/orders/{id}/access/replace', 200, 'POST', `/v1/orders/${gift.id}/access/replace`, {}, sandbox);
    assert.ok(replaced.replaced_at && replaced.url !== gift.access.url, 'a new link');
    await call(browser, 'GET /v1/orders/{id}', 200, 'GET', `/v1/orders/${failed.id}`, undefined, sandbox);
    const receipt = await call(browser, 'GET /v1/orders/{id}/receipt', 200, 'GET', `/v1/orders/${gift.id}/receipt`, undefined, sandbox);
    assert.equal(receipt.seller.rc_number, 'RC 1606658');
    const taxedReceipt = await call(browser, 'GET /v1/orders/{id}/receipt', 200, 'GET', `/v1/orders/${taxed.id}/receipt`, undefined, sandbox);
    assert.equal(taxedReceipt.tax.name, 'VAT');
  });
});

describe('stores', () => {
  test('match their documented schemas', async () => {
    const { browser } = await funded();
    const subdomain = `ada${Date.now().toString(36)}`;
    await call(browser, 'GET /v1/stores/subdomains/{subdomain}', 200, 'GET', `/v1/stores/subdomains/${subdomain}`);
    await call(browser, 'GET /v1/stores/subdomains/{subdomain}', 200, 'GET', '/v1/stores/subdomains/admin');
    const store = await call(browser, 'POST /v1/stores', 201, 'POST', '/v1/stores', { name: 'Ada Digital', subdomain });
    await call(browser, 'GET /v1/stores', 200, 'GET', '/v1/stores');
    await call(browser, 'PATCH /v1/stores/{id}', 200, 'PATCH', `/v1/stores/${store.id}`, { logo_url: 'https://cdn.example/ada.png', primary_color: '#0A1B2C' });
    await call(browser, 'POST /v1/stores/{id}/publish', 200, 'POST', `/v1/stores/${store.id}/publish`);
    await call(client(server.base), 'GET /v1/storefronts/{subdomain}', 200, 'GET', `/v1/storefronts/${subdomain}`);
    await call(browser, 'POST /v1/stores/{id}/unpublish', 200, 'POST', `/v1/stores/${store.id}/unpublish`);
  });
});

describe("BitoCard's store", () => {
  test('matches its documented schemas', async () => {
    const visitor = client(server.base);
    // The default layout, then a published one.
    const draft = await call(visitor, 'GET /v1/store/home', 200, 'GET', '/v1/store/home');
    assert.equal(draft.published, false);
    assert.deepEqual(new Set(draft.sections.map(section => section.type)), new Set(['hero', 'product_rail', 'promo', 'category_grid', 'brand_grid', 'trust_bar']));
    assert.equal((await admin.get('/v1/admin/storefront/home')).status, 200);
    assert.equal((await admin.post('/v1/admin/storefront/home/publish')).status, 200);
    const home = await call(visitor, 'GET /v1/store/home', 200, 'GET', '/v1/store/home');
    assert.deepEqual([home.published, typeof home.version], [true, 'number']);
    assert.ok(home.sections.some(section => section.type === 'product_rail' && section.data.products.length > 0));

    const products = await call(visitor, 'GET /v1/store/products', 200, 'GET', '/v1/store/products?sort=name&limit=60');
    assert.ok(products.data.length > 3);
    await call(visitor, 'GET /v1/store/products', 200, 'GET', '/v1/store/products?group=mobile');
    for (const key of ['gift_cards:US:amazon-us', 'pay_tv:NG:dstv:dstv-padi', 'airtime:NG:mtn:topup']) {
      await call(visitor, 'GET /v1/store/products/{key}', 200, 'GET', `/v1/store/products/${encodeURIComponent(key)}`);
    }
    const search = await call(visitor, 'GET /v1/store/search', 200, 'GET', '/v1/store/search?q=amazon');
    assert.ok(search.products.length > 0 && search.brands.length > 0);
    const byCategory = await call(visitor, 'GET /v1/store/search', 200, 'GET', `/v1/store/search?q=${encodeURIComponent('top up')}`);
    assert.ok(byCategory.categories.length > 0);
    const byCountry = await call(visitor, 'GET /v1/store/search', 200, 'GET', '/v1/store/search?q=nigeria');
    assert.ok(byCountry.countries.length > 0);
    const categories = await call(visitor, 'GET /v1/store/categories', 200, 'GET', '/v1/store/categories');
    assert.ok(categories.data.length > 0);
    const brands = await call(visitor, 'GET /v1/store/brands', 200, 'GET', '/v1/store/brands');
    assert.ok(brands.data.length > 0);
    const navigation = await call(visitor, 'GET /v1/store/navigation', 200, 'GET', '/v1/store/navigation');
    assert.ok(navigation.groups.some(group => group.brands.length > 0));
  });
});
