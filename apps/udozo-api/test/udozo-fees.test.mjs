// Udozo's Seller HQ setup fee and Premium's free domain (docs/UDOZO_SPINOFF_PLAN.md, step 3): the fee is set per market
// by finance and paid once per seller, with their first Premium month or on its own, before any store goes live; each
// Premium store gets a free domain, bought and renewed with nothing taken from the wallet, as long as it costs no more
// than its Premium collected.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeDomains } from './fakes.mjs';

let server;
let fake;
let admin;
let prisma;
let wallets;

before(async () => {
  fake = await fakeDomains();
  server = await startApp({ env: { ...fake.env, APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  // NGN 1,500 per USD from both sources: Udozo charges 1,522.50 per dollar.
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  // What the product seed does on Udozo's database: Premium includes one free domain per store.
  assert.equal((await admin.put('/v1/admin/plans/premium/limits/free_domains', { value: 1 })).status, 200);
});

after(async () => {
  await server?.close();
  await fake?.close();
});

let counter = 0;
const contact = { first_name: 'Ada', last_name: 'Obi', email: 'ada@example.com', phone: '+2348031234567', address1: '1 Marina', city: 'Lagos', state: 'Lagos', zip: '100001', country: 'NG' };

/** A verified seller with money in the wallet, domains switched on, and a published store. */
async function seller(funding = 50_000_000) {
  const created = await resellerClient(server);
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: funding, reason: 'Top-up' });
  assert.equal((await admin.put('/v1/admin/switches/custom_domains', { reseller_id: created.resellerId, enabled: true })).status, 200);
  await prisma.featureSwitch.create({ data: { key: 'reseller_resale', resellerId: created.resellerId, enabled: true } });
  const store = await newStore(created);
  return { ...created, store };
}

async function newStore(owner) {
  counter += 1;
  const made = await owner.browser.post('/v1/stores', { name: `Gadgets ${counter}`, subdomain: `gadgets${counter}x${Date.now() % 10000}` });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await prisma.store.update({ where: { id: made.json.id }, data: { status: 'published', publishedAt: new Date() } });
  return made.json;
}

const available = async owner => (await owner.browser.get('/v1/wallet')).json.available;

describe('the setup fee', () => {
  test('finance sets it per market; admins see whether it and a Premium month pay for a domain', async () => {
    const low = await admin.put('/v1/admin/setup-fees/NG', { enabled: true, amount: 100 });
    assert.equal(low.status, 200, JSON.stringify(low.json));
    assert.equal(low.json.dearest_domain, 2_055_375, 'US$13.50 at NGN 1,522.50');
    const covered = low.json.amount + low.json.premium_month >= low.json.dearest_domain;
    assert.deepEqual(low.json.warnings, covered ? [] : ['fees_below_domain_price']);
    // With Premium priced at ₦1,000 a month, ₦1 of setup fee is not enough: admins are warned.
    assert.equal((await admin.patch('/v1/admin/plans/premium', { local_prices: { NGN: 100_000 } })).status, 200);
    assert.deepEqual((await admin.put('/v1/admin/setup-fees/NG', { enabled: true, amount: 100 })).json.warnings, ['fees_below_domain_price']);
    const enough = await admin.put('/v1/admin/setup-fees/NG', { enabled: true, amount: 2_000_000 });
    assert.deepEqual([enough.json.enabled, enough.json.amount, enough.json.premium_month, enough.json.warnings], [true, 2_000_000, 100_000, []]);
    assert.equal((await admin.put('/v1/admin/setup-fees/NG', { enabled: true, amount: 0 })).json.error.param, 'amount');
    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/setup-fees/NG', { enabled: false, amount: 0 })).status, 403);
    assert.equal((await support.get('/v1/admin/setup-fees')).json.data.find(row => row.country === 'NG').amount, 2_000_000);
  });

  test('no store goes live before it is paid; paid on its own, once', async () => {
    const s = await seller();
    assert.deepEqual((await s.browser.get('/v1/billing/setup-fee')).json, { object: 'setup_fee', charged: true, due: true, amount: 2_000_000, currency: 'NGN', paid_at: null });
    await prisma.storeDomain.create({ data: { storeId: s.store.id, resellerId: s.resellerId, name: `own${Date.now()}.example`, source: 'connected', status: 'active', primary: true } });
    const refused = await s.browser.patch(`/v1/stores/${s.store.id}`, { checkout_mode: 'live' });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'setup_fee_unpaid']);

    const before = await available(s);
    const paid = await s.browser.post('/v1/billing/setup-fee');
    assert.deepEqual([paid.json.due, paid.json.amount], [false, 2_000_000]);
    assert.equal(before - (await available(s)), 2_000_000);
    assert.equal((await s.browser.post('/v1/billing/setup-fee')).json.due, false);
    assert.equal(before - (await available(s)), 2_000_000, 'taken once');
    assert.equal((await s.browser.patch(`/v1/stores/${s.store.id}`, { checkout_mode: 'live' })).status, 200);
    assert.equal((await s.browser.post('/v1/billing/setup-fee', {}, { 'bitocard-mode': 'test' })).json.error.code, 'live_only');
  });
});

describe('the setup fee for every market', () => {
  test("set in US dollars and charged in the market's currency, unless the market has its own", async () => {
    const all = await admin.put('/v1/admin/setup-fees/WW', { enabled: true, amount: 1000 });
    assert.deepEqual([all.status, all.json.currency, all.json.amount], [200, 'USD', 1000], JSON.stringify(all.json));
    // Nigeria's own fee wins until it is cleared; then US$10 at NGN 1,522.50.
    assert.equal((await admin.get('/v1/admin/setup-fees')).json.data.find(row => row.country === 'NG').source, 'market');
    const cleared = await admin.delete('/v1/admin/setup-fees/NG');
    assert.deepEqual([cleared.status, cleared.json.source, cleared.json.enabled, cleared.json.amount], [200, 'every_market', true, 1_522_500], JSON.stringify(cleared.json));
    const listed = (await admin.get('/v1/admin/setup-fees')).json;
    assert.deepEqual(listed.every_market, { object: 'setup_fee_default', currency: 'USD', enabled: true, amount: 1000 });
    assert.equal((await admin.delete('/v1/admin/setup-fees/WW')).json.error.code, 'resource_missing', 'the fee for every market is switched off, never cleared');

    const s = await seller();
    assert.deepEqual([(await s.browser.get('/v1/billing/setup-fee')).json.amount, (await s.browser.get('/v1/billing/setup-fee')).json.currency], [1_522_500, 'NGN']);
    const before = await available(s);
    assert.equal((await s.browser.post('/v1/billing/setup-fee')).json.due, false);
    assert.equal(before - (await available(s)), 1_522_500);
    // Put back as it was for the tests below.
    assert.equal((await admin.put('/v1/admin/setup-fees/NG', { enabled: true, amount: 2_000_000 })).status, 200);
  });
});

describe("Premium's free domain", () => {
  test('taking Premium takes the setup fee and the first month together; the free domain is then bought with nothing more', async () => {
    const s = await seller();
    const none = (await s.browser.get(`/v1/stores/${s.store.id}/free-domain`)).json;
    assert.deepEqual([none.allowance, none.used, none.available], [0, 0, false]);
    assert.equal((await s.browser.post(`/v1/stores/${s.store.id}/free-domain`, { domain: 'gadgetsfree.com', contact })).json.error.code, 'free_domain_unavailable');

    const before = await available(s);
    const premium = await s.browser.post(`/v1/stores/${s.store.id}/subscription`, { plan: 'premium' });
    assert.equal(premium.status, 200, JSON.stringify(premium.json));
    assert.equal(before - (await available(s)), 2_000_000 + 100_000, 'the setup fee and the first month');
    const reseller = await prisma.reseller.findUniqueOrThrow({ where: { id: s.resellerId } });
    assert.equal(reseller.setupFeeStoreId, s.store.id);

    const status = (await s.browser.get(`/v1/stores/${s.store.id}/free-domain`)).json;
    assert.deepEqual([status.allowance, status.used, status.available, status.covers_up_to], [1, 0, true, { amount: 2_100_000, currency: 'NGN' }]);
    const searched = (await s.browser.get(`/v1/stores/${s.store.id}/free-domain?q=gadgetsfree`)).json.offers;
    assert.deepEqual(searched, [{ domain: 'gadgetsfree.com', available: true, price: { amount: 2_055_375, currency: 'NGN' }, covered: true }]);
    const paidSoFar = await available(s);
    const bought = await s.browser.post(`/v1/stores/${s.store.id}/free-domain`, { domain: 'gadgetsfree.com', contact });
    assert.equal(bought.status, 201, JSON.stringify(bought.json));
    assert.deepEqual([bought.json.status, bought.json.source], ['active', 'purchased']);
    assert.equal(await available(s), paidSoFar, 'nothing taken from the wallet');
    const domain = await prisma.storeDomain.findUniqueOrThrow({ where: { id: bought.json.id } });
    assert.deepEqual([domain.free, domain.holdId], [true, null]);
    assert.ok(await prisma.journalEntry.findUnique({ where: { reference: `domain_cost:${domain.id}:register` } }), "Vercel's price is still Udozo's cost");
    assert.equal((await s.browser.post(`/v1/stores/${s.store.id}/free-domain`, { domain: 'gadgetstwo.com', contact })).json.error.code, 'free_domain_unavailable', 'one per store');

    // Renewed free while the store keeps Premium.
    await prisma.storeDomain.update({ where: { id: domain.id }, data: { expiresAt: new Date(Date.now() + 5 * 24 * 3600_000) } });
    const renewed = await s.browser.post(`/v1/stores/${s.store.id}/domains/${domain.id}/renew`);
    assert.equal(renewed.status, 200, JSON.stringify(renewed.json));
    assert.equal(await available(s), paidSoFar, 'a free renewal');
    assert.equal(fake.state.renewals, 1);
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

    // A second store's Premium: the setup fee is not taken again, so its month alone must pay for its domain.
    const second = await newStore(s);
    const beforeSecond = await available(s);
    assert.equal((await s.browser.post(`/v1/stores/${second.id}/subscription`, { plan: 'premium' })).status, 200);
    assert.equal(beforeSecond - (await available(s)), 100_000, 'the month only');
    assert.equal((await s.browser.get(`/v1/stores/${second.id}/free-domain?q=gadgetsshort`)).json.offers[0].covered, false, 'the search says so first');
    const short = await s.browser.post(`/v1/stores/${second.id}/free-domain`, { domain: 'gadgetsshort.com', contact });
    assert.deepEqual([short.status, short.json.error.code, short.json.error.param], [409, 'domain_not_covered', 'domain']);
    assert.match(short.json.error.message, /costs NGN 20,553\.75, more than the NGN 1,000\.00 your Premium covers/);
  });

  test('a store an admin put on Premium without billing collected nothing, so has no free domain', async () => {
    const s = await seller();
    assert.equal((await admin.put(`/v1/admin/stores/${s.store.id}/subscription`, { plan: 'premium' })).status, 200);
    assert.equal((await s.browser.get(`/v1/stores/${s.store.id}/free-domain`)).json.available, false);
  });
});
