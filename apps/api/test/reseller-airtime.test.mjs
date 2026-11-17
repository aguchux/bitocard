// The airtime exchange on resellers' stores: where `reseller_airtime_exchange` is on, their customers sell airtime at
// BitoCard's payout less the reseller's cut and buy it at BitoCard's price plus the cut, the cut being their airtime
// markup capped per network, credited to the reseller's earnings (after the payout hold) once the trade settles.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, lastSmsCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let ledger;

before(async () => {
  server = await startApp({ env: { CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
});

function storeClient(store) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'bitocard-store': store,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `ra-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

async function customer(store, phone) {
  const shopper = storeClient(store);
  const email = `ra${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  assert.equal((await shopper.post('/v1/store/account/phones', { phone })).status, 202);
  assert.equal((await shopper.post('/v1/store/account/phones/verify', { code: await lastSmsCode(server.app, phone) })).status, 200);
  return shopper;
}

const balance = async (kind, where) => (await prisma.ledgerAccount.findFirst({ where: { kind, mode: 'test', currency: 'NGN', ...where } }))?.balanceMinor ?? 0n;

describe('the airtime exchange on a reseller’s store', () => {
  test('their customers trade at BitoCard’s rates with the reseller’s airtime markup (capped), the cut to their earnings', async () => {
    assert.equal((await admin.put('/v1/admin/switches/airtime_exchange', { country_code: 'NG', enabled: true })).status, 200);
    assert.equal((await admin.post('/v1/admin/airtime/lines', { country: 'NG', network: 'mtn', number: '08039990101' })).status, 201);
    const network = await admin.patch('/v1/admin/airtime/networks/NG/mtn', { credit_hold_hours: 0, reseller_cap_bps: 500 });
    assert.equal(network.status, 200, JSON.stringify(network.json));
    assert.equal(network.json.networks.find(item => item.network === 'mtn').reseller_cap_bps, 500);

    const owner = await resellerClient(server);
    await owner.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, owner.email) });
    await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', country: 'NG' } });
    await prisma.resellerMarkup.create({ data: { resellerId: owner.resellerId, category: 'airtime', markupBps: 300 } });
    const subdomain = `airtime${Date.now().toString(36)}`.slice(0, 30);
    const store = await owner.browser.post('/v1/stores', { name: 'Ada Mobile', subdomain });
    assert.equal(store.status, 201, JSON.stringify(store.json));
    assert.equal((await owner.browser.post(`/v1/stores/${store.json.id}/publish`)).status, 200);
    const poolAt = () => fetch(`${server.base}/v1/store/airtime/pool?country=GH&store=${subdomain}`).then(res => res.json());
    const shq = () => owner.browser.get('/v1/airtime/exchange', { 'bitocard-mode': 'test' });

    // Off by default: the store's pool is closed, its customers are refused, and SHQ says why.
    assert.equal((await poolAt()).open, false);
    assert.deepEqual([(await shq()).json.available, (await shq()).json.reason], [false, 'not_enabled']);
    const shopper = await customer(subdomain, '+2348031230001');
    assert.equal((await shopper.post('/v1/store/airtime/sales', { network: 'mtn', amount: 100_000 })).json.error.code, 'airtime_unavailable');

    assert.equal((await admin.put('/v1/admin/switches/reseller_airtime_exchange', { reseller_id: owner.resellerId, enabled: true })).status, 200);
    const open = await poolAt();
    const mtn = open.networks.find(item => item.network === 'mtn');
    // The reseller's own market whatever country was asked, at their customers' rates: 80% less 3%, 88% plus 3%.
    assert.deepEqual([open.country, open.mode, open.open, mtn.open, mtn.sell_rate_bps, mtn.buy_rate_bps], ['NG', 'test', true, true, 7760, 9064]);

    // Selling ₦1,000: BitoCard pays ₦800, the customer gets ₦776 and the reseller ₦24.
    const quote = await shopper.post('/v1/store/airtime/sales', { network: 'mtn', amount: 100_000, preview: true });
    assert.deepEqual([quote.json.payout, quote.json.rate_bps], [77_600, 7760], JSON.stringify(quote.json));
    const sale = await shopper.post('/v1/store/airtime/sales', { network: 'mtn', amount: 100_000 });
    assert.equal(sale.status, 201, JSON.stringify(sale.json));
    assert.equal(sale.json.mode, 'test', 'the store’s own mode');
    const received = await shopper.post(`/v1/store/airtime/sales/${sale.json.id}/simulate`, { outcome: 'received' });
    assert.equal(received.json.status, 'credited', JSON.stringify(received.json));
    assert.equal(await balance('customer_wallet', { customerId: shopper.id }), 77_600n);
    assert.equal(await balance('reseller_earnings_held', { resellerId: owner.resellerId }), 2_400n);
    assert.equal((await prisma.earningsLot.findUnique({ where: { reference: `airtime_sale:${sale.json.id}` } })).amountMinor, 2_400n);
    const pool = await prisma.airtimePool.findUnique({ where: { mode_country_network: { mode: 'test', country: 'NG', network: 'mtn' } } });
    assert.deepEqual([pool.availableMinor, pool.costMinor], [100_000n, 80_000n], 'the pool holds it at what BitoCard paid');

    // Buying ₦500: BitoCard's ₦440 plus the reseller's 3% (₦13.20).
    await ledger.post({
      mode: 'test',
      type: 'adjustment',
      reference: `test-fund:${shopper.id}`,
      description: 'Test funds',
      lines: [
        { account: { kind: 'adjustments', currency: 'NGN' }, debit: 100_000n },
        { account: { kind: 'customer_wallet', currency: 'NGN', customerId: shopper.id }, credit: 100_000n },
      ],
    });
    const priced = await shopper.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 50_000, phone: '+2348031230001', preview: true });
    assert.deepEqual([priced.json.price, priced.json.rate_bps], [45_320, 9064], JSON.stringify(priced.json));
    const bought = await shopper.post('/v1/store/airtime/purchases', { network: 'mtn', amount: 50_000, phone: '+2348031230001', expected_price: 45_320 });
    assert.equal(bought.status, 201, JSON.stringify(bought.json));
    const revenueBefore = await balance('platform_revenue', {});
    const sent = await shopper.post(`/v1/store/airtime/purchases/${bought.json.id}/simulate`, { outcome: 'delivered' });
    assert.equal(sent.json.status, 'delivered', JSON.stringify(sent.json));
    // Cost ₦400 (half the pool's ₦800), BitoCard keeps ₦40, the reseller ₦13.20.
    assert.equal((await balance('platform_revenue', {})) - revenueBefore, 4_000n);
    assert.equal(await balance('reseller_earnings_held', { resellerId: owner.resellerId }), 3_720n);
    assert.equal((await prisma.earningsLot.findUnique({ where: { reference: `airtime_purchase:${bought.json.id}` } })).amountMinor, 1_320n);
    assert.equal((await admin.get('/v1/admin/ledger/check?mode=test')).json.ok, true);

    const seen = (await shq()).json;
    assert.deepEqual([seen.available, seen.markup_bps, seen.currency], [true, 300, 'NGN']);
    assert.deepEqual(
      seen.networks.filter(item => item.network === 'mtn').map(item => [item.cut_bps, item.cap_bps, item.sell_rate_bps, item.buy_rate_bps]),
      [[300, 500, 7760, 9064]],
    );
    assert.deepEqual(seen.sales.map(item => [item.status, item.payout, item.earned, item.customer.id]), [['credited', 77_600, 2_400, shopper.id]]);
    assert.deepEqual(seen.purchases.map(item => [item.status, item.price, item.earned]), [['delivered', 45_320, 1_320]]);
    assert.doesNotMatch(JSON.stringify(seen), /collector|"line"|0803999/);

    // A markup above the cap takes only the cap; switched off, the store trades no more.
    await prisma.resellerMarkup.updateMany({ where: { resellerId: owner.resellerId }, data: { markupBps: 3000 } });
    assert.equal((await poolAt()).networks.find(item => item.network === 'mtn').sell_rate_bps, 7600);
    assert.equal((await admin.put('/v1/admin/switches/reseller_airtime_exchange', { reseller_id: owner.resellerId, enabled: false })).status, 200);
    assert.equal((await shopper.post('/v1/store/airtime/sales', { network: 'mtn', amount: 100_000 })).json.error.code, 'airtime_unavailable');

    // bitocard.com's own customers are unchanged: BitoCard's rates.
    const root = await fetch(`${server.base}/v1/store/airtime/pool?country=NG`).then(res => res.json());
    assert.deepEqual([root.networks[0].sell_rate_bps, root.networks[0].buy_rate_bps], [8000, 8800]);
  });
});
