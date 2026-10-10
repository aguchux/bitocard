// Product logos come only from BitoCard's own files (the admin's product image, then the brand's logo from its
// settings, the registry or the bundled icons): a supplier's logo address would tell resellers and customers who
// BitoCard buys from. Only admins see the supplier's logo.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp, listForTest } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';

let server;
let reloadly;
let admin;
let prisma;
let visitor;

const supplierHost = 'media.supplier-cdn.example';

before(async () => {
  reloadly = await fakeReloadly();
  server = await startApp({ env: { ...reloadly.env, ENCRYPTION_KEY: randomBytes(32).toString('base64') } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
  await listForTest(server);
  // As a supplier's catalogue gives them: a logo on the supplier's own servers.
  for (const product of await prisma.product.findMany()) {
    await prisma.product.update({ where: { id: product.id }, data: { logoUrl: `https://${supplierHost}/logos/${product.brand}.png` } });
  }
  visitor = client(server.base);
});

after(async () => {
  await server?.close();
  await reloadly?.close();
});

const noSupplierLogo = (json, where) => assert.ok(!JSON.stringify(json).includes(supplierHost), `${where} shows a supplier's logo address`);

describe('product logos', () => {
  test('the public store never shows a supplier logo; products show the brand logo from BitoCard files instead', async () => {
    const products = await visitor.get('/v1/store/products?limit=60');
    assert.equal(products.status, 200);
    noSupplierLogo(products.json, 'the product list');
    const mtn = products.json.data.find(item => item.brand.slug === 'mtn');
    assert.ok(mtn, 'an MTN product is on sale');
    assert.equal(mtn.logo_url, mtn.brand.logo_url, 'the brand logo stands in for the product logo');
    assert.ok(mtn.logo_url === null || !mtn.logo_url.includes(supplierHost));

    const page = await visitor.get(`/v1/store/products/${encodeURIComponent(mtn.key)}`);
    noSupplierLogo(page.json, 'the product page');
    noSupplierLogo((await visitor.get('/v1/store/search?q=mtn')).json, 'search');
    noSupplierLogo((await visitor.get('/v1/store/home')).json, 'the home page');
  });

  test("a reseller's catalogue never shows a supplier logo", async () => {
    const reseller = await resellerClient(server);
    const list = await reseller.browser.get('/v1/catalogue/products?limit=100', { 'bitocard-mode': 'test' });
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.ok(list.json.data.length > 0);
    noSupplierLogo(list.json, 'the reseller catalogue');
    const one = await reseller.browser.get(`/v1/catalogue/products/${list.json.data[0].id}`, { 'bitocard-mode': 'test' });
    noSupplierLogo(one.json, 'a catalogue product');
  });

  test("the admin's product image is the logo everywhere; admins still see the supplier's logo", async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { brand: 'mtn', listed: true } });
    const image = 'https://cdn.bitocard.com/bitocard/platform/products/mtn.png';
    await prisma.product.update({ where: { id: product.id }, data: { imageUrl: image } });
    const page = await visitor.get(`/v1/store/products/${encodeURIComponent(product.key)}`);
    assert.equal(page.json.logo_url, image);

    const adminList = await admin.get(`/v1/admin/products?q=${encodeURIComponent(product.name)}`);
    const row = adminList.json.data.find(item => item.id === product.id);
    assert.ok(row.logo_url.includes(supplierHost), 'admins see where the supplier logo is');
  });
});
