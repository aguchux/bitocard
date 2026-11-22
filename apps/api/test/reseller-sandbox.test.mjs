// The reseller sandbox: every product BitoCard has from its suppliers can be seen, quoted and ordered (simulated, with
// test codes and never a supplier call), whatever is switched on for live selling in the reseller's market; live
// selling still follows the market's switches, and a pending (not yet activated) reseller tests freely.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly, fakeVtpass } from './fakes.mjs';

let server;
let reloadly;
let vtpass;
let prisma;
let wallets;

before(async () => {
  reloadly = await fakeReloadly();
  vtpass = await fakeVtpass();
  server = await startApp({ env: { ...reloadly.env, ...vtpass.env } });
  const admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await admin.post('/v1/admin/suppliers/reloadly/sync');
  await admin.post('/v1/admin/suppliers/vtpass/sync');
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  await vtpass?.close();
});

const sandbox = { 'bitocard-mode': 'test' };
const productId = async key => (await prisma.product.findUniqueOrThrow({ where: { key } })).id;

/** Pay-TV switched off for live selling in Nigeria, VTpass's market off and the supplier itself off. */
async function payTvOffForLive(work) {
  const category = { countryCode_category: { countryCode: 'NG', category: 'pay_tv' } };
  const before = await prisma.countryCategory.findUnique({ where: category });
  const markets = await prisma.supplierMarket.findMany({ where: { supplierCode: 'vtpass', category: 'pay_tv' } });
  await prisma.countryCategory.upsert({ where: category, create: { countryCode: 'NG', category: 'pay_tv', enabled: false }, update: { enabled: false } });
  await prisma.supplierMarket.updateMany({ where: { supplierCode: 'vtpass', category: 'pay_tv' }, data: { enabled: false } });
  await prisma.supplier.update({ where: { code: 'vtpass' }, data: { enabled: false } });
  try {
    await work();
  } finally {
    if (before) await prisma.countryCategory.update({ where: category, data: { enabled: before.enabled } });
    for (const market of markets) await prisma.supplierMarket.update({ where: { supplierCode_countryCode_category: { supplierCode: market.supplierCode, countryCode: market.countryCode, category: market.category } }, data: { enabled: market.enabled } });
    await prisma.supplier.update({ where: { code: 'vtpass' }, data: { enabled: true } });
  }
}

describe('reseller sandbox', () => {
  test('a product switched off for live selling is listed, quoted and ordered in the sandbox with test deliveries; live refuses it', async () => {
    await payTvOffForLive(async () => {
      const { browser, resellerId } = await resellerClient(server);
      // Not activated yet: the sandbox needs no verification or admin approval.
      assert.equal((await prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } })).status, 'pending');
      await wallets.adjust(null, { resellerId, mode: 'test', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
      const padi = await productId('pay_tv:NG:dstv:dstv-padi');

      const sandboxList = (await browser.get('/v1/catalogue/products?category=pay_tv', sandbox)).json;
      assert.ok(sandboxList.data.some(product => product.id === padi), 'the sandbox shows the whole catalogue');
      const liveList = (await browser.get('/v1/catalogue/products?category=pay_tv')).json;
      assert.ok(!(liveList.data ?? []).some(product => product.id === padi), 'live selling follows the market');

      const calls = vtpass.calls.length;
      const quote = await browser.post('/v1/quotes', { product_id: padi, face_value: 360_000, recipient: { account_number: '1212121212' } }, sandbox);
      assert.equal(quote.status, 201, JSON.stringify(quote.json));
      assert.equal(quote.json.recipient.account_name, 'SANDBOX CUSTOMER');
      const order = await browser.post('/v1/orders', { quote_id: quote.json.id }, sandbox);
      assert.equal(order.status, 201, JSON.stringify(order.json));
      assert.deepEqual([order.json.status, order.json.mode], ['completed', 'test']);
      assert.ok(order.json.deliveries.length >= 1);
      assert.equal(vtpass.calls.length, calls, 'the sandbox never calls the supplier');

      const live = await browser.post('/v1/quotes', { product_id: padi, face_value: 360_000, recipient: { account_number: '1212121212' } });
      assert.notEqual(live.status, 201);
    });
  });

  test('a gift card in the sandbox delivers test codes for a pending reseller', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await wallets.adjust(null, { resellerId, mode: 'test', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
    const quote = await browser.post('/v1/quotes', { product_id: await productId('gift_cards:US:amazon-us'), face_value: 1000 }, sandbox);
    assert.equal(quote.status, 201, JSON.stringify(quote.json));
    const order = (await browser.post('/v1/orders', { quote_id: quote.json.id }, sandbox)).json;
    assert.equal(order.status, 'completed');
    assert.match(order.deliveries[0].code, /^SANDBOX-/);
  });
});
