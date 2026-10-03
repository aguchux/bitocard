// The admin dashboard overview (sales and orders by currency, reseller float, supplier health, attention items) and
// the platform-wide activity log.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly, fakeVtpass } from './fakes.mjs';

let server;
let reloadly;
let vtpass;
let admin;
let prisma;
let wallets;

before(async () => {
  reloadly = await fakeReloadly();
  vtpass = await fakeVtpass();
  server = await startApp({ env: { ...reloadly.env, ...vtpass.env } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await admin.post('/v1/admin/suppliers/reloadly/sync');
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  await vtpass?.close();
});

const sandbox = { 'bitocard-mode': 'test' };

describe('admin overview', () => {
  test('sales, orders, float, resellers, supplier health and recent orders for the period', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await wallets.adjust(null, { resellerId, mode: 'test', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
    const product = (await prisma.product.findUniqueOrThrow({ where: { key: 'airtime:NG:mtn:topup' } })).id;
    const order = async simulate => {
      const quote = (await browser.post('/v1/quotes', { product_id: product, face_value: 100_000, recipient: { phone: '+2348031234567' } }, sandbox)).json;
      return (await browser.post('/v1/orders', { quote_id: quote.id, ...(simulate ? { simulate } : {}) }, sandbox)).json;
    };
    const done = await order();
    await order();
    await order('pending');
    // An older sale falls in the previous period.
    const old = await order();
    await prisma.order.update({ where: { id: old.id }, data: { completedAt: new Date(Date.now() - 10 * 24 * 3600_000) } });

    const res = await admin.get('/v1/admin/overview?days=7&mode=test');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const overview = res.json;
    const ngn = overview.totals.find(total => total.currency === 'NGN');
    assert.deepEqual([ngn.orders, ngn.gross, ngn.previous_orders], [2, 2 * done.price, 1]);
    const series = overview.series.find(item => item.currency === 'NGN').points;
    assert.equal(series.length, 7);
    assert.equal(series.at(-1).orders, 2, 'today has both sales');
    assert.ok(overview.wallet_float.find(item => item.currency === 'NGN').amount > 0);
    assert.ok(overview.resellers.joined >= 1);
    assert.ok(overview.attention.orders_processing >= 1);
    const supplier = overview.suppliers.find(item => item.code === 'reloadly');
    assert.equal(supplier.health, 'operational');
    assert.equal(overview.recent_orders[0].reseller.id, resellerId);
    assert.equal(JSON.stringify(overview).includes('SANDBOX-'), false, 'no delivered codes');

    const live = (await admin.get('/v1/admin/overview?days=7')).json;
    assert.equal(live.totals.find(total => total.currency === 'NGN'), undefined, 'live and test are separate');
  });

  test('only admins see it', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.get('/v1/admin/overview')).status, 401);
    assert.equal((await admin.get('/v1/admin/overview?days=0')).status, 400);
  });
});

describe('activity log', () => {
  test('lists admin changes with who made them, newest first, filterable', async () => {
    const { resellerId } = await resellerClient(server);
    await admin.patch(`/v1/admin/resellers/${resellerId}`, { plan: 'premium' });
    const all = (await admin.get('/v1/admin/activity?limit=5')).json;
    assert.equal(all.data[0].action, 'reseller.updated');
    assert.match(all.data[0].actor.email, /@bitocard\.com$/);
    const filtered = (await admin.get('/v1/admin/activity?target_type=reseller')).json.data;
    assert.ok(filtered.every(entry => entry.target_type === 'reseller'));
    const support = await adminClient(server, ['support']);
    assert.equal((await support.get('/v1/admin/activity')).status, 200);
  });
});
