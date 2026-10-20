// Plans per store: each store is on Startup or pays for its own plan from the live wallet; the account's plan is the
// highest among its stores; per-store features and limits read the store's own plan; upgrades credit unused days,
// downgrades wait for the end of the month; resellers moved from account plans are told before their first renewal.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;
let wallets;
let subscriptions;
let finance;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  subscriptions = server.app.get((await import('../dist/billing/store-subscriptions.service.js')).StoreSubscriptionsService);
  // NGN 1500 per USD from both sources: Premium (US$25) is NGN 38,062.50, Enterprise (US$299) NGN 455,227.50.
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  finance = await adminClient(server, ['finance']);
  await finance.patch('/v1/admin/plans/enterprise', { available: true });
});

after(() => server?.close());

const premiumNgn = 3_806_250;
const enterpriseNgn = 45_522_750;
const day = 86_400_000;

/** A reseller in Nigeria with money in the live wallet and two stores. */
async function reseller(amount = 100_000_000) {
  const owner = await resellerClient(server);
  await prisma.reseller.update({ where: { id: owner.resellerId }, data: { country: 'NG' } });
  if (amount) await wallets.adjust(null, { resellerId: owner.resellerId, mode: 'live', balance: 'funding', amount, reason: 'Top-up' });
  const store = async name => (await owner.browser.post('/v1/stores', { name, subdomain: `${name.toLowerCase().replace(/\W/g, '')}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` })).json;
  const first = await store('First Shop');
  const second = await store('Second Shop');
  assert.ok(first.id && second.id);
  return { ...owner, first, second };
}
const available = async browser => (await browser.get('/v1/wallet')).json.available;
const plan = (browser, store, code) => browser.post(`/v1/stores/${store}/subscription`, { plan: code });
const accountPlan = async id => (await prisma.reseller.findUniqueOrThrow({ where: { id } })).planCode;

describe('a plan per store', () => {
  test('stores start on Startup; one store’s Premium is charged once and makes it the account’s plan, the other stays on Startup', async () => {
    const { browser, resellerId, first, second } = await reseller();
    const start = (await browser.get('/v1/subscriptions')).json;
    assert.deepEqual([start.account_plan.code, start.data.map(item => item.plan.code)], ['standard', ['standard', 'standard']]);

    const upgraded = await plan(browser, first.id, 'premium');
    assert.equal(upgraded.status, 200, JSON.stringify(upgraded.json));
    assert.deepEqual([upgraded.json.plan.code, upgraded.json.store.name, Boolean(upgraded.json.renews_at)], ['premium', 'First Shop', true]);
    assert.equal(await available(browser), 100_000_000 - premiumNgn);
    assert.equal(await accountPlan(resellerId), 'premium', 'the account follows its highest store');
    assert.equal((await browser.get(`/v1/stores/${second.id}/subscription`)).json.plan.code, 'standard');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'store.plan_changed', targetId: first.id } }));
    // In the sandbox a plan cannot be changed.
    assert.equal((await browser.post(`/v1/stores/${second.id}/subscription`, { plan: 'premium' }, { 'bitocard-mode': 'test' })).json.error.code, 'live_only');
  });

  test('per-store features follow the store’s own plan', async () => {
    const { browser, first, second } = await reseller();
    await finance.put('/v1/admin/plans/standard/features/store_traffic', { enabled: false });
    try {
      await plan(browser, first.id, 'premium');
      assert.equal((await browser.get(`/v1/stores/${first.id}/traffic`)).status, 200, 'the Premium store has traffic');
      const refused = await browser.get(`/v1/stores/${second.id}/traffic`);
      assert.deepEqual([refused.status, refused.json.error.code], [403, 'plan_feature_required']);
      assert.match(refused.json.error.message, /this store’s Startup plan/);
    } finally {
      await finance.put('/v1/admin/plans/standard/features/store_traffic', { enabled: true });
    }
  });

  test('moving up charges the new price less the unused part of this month', async () => {
    const { browser, first } = await reseller();
    await plan(browser, first.id, 'premium');
    // Half the month gone: half of Premium is credited towards Enterprise.
    const row = await prisma.storeSubscription.findUniqueOrThrow({ where: { storeId: first.id } });
    const period = row.renewsAt.getTime() - row.periodStartedAt.getTime();
    await prisma.storeSubscription.update({ where: { storeId: first.id }, data: { periodStartedAt: new Date(Date.now() - period / 2), renewsAt: new Date(Date.now() + period / 2) } });
    const before = await available(browser);
    const up = await plan(browser, first.id, 'enterprise');
    assert.equal(up.json.plan.code, 'enterprise');
    const charged = before - (await available(browser));
    assert.ok(Math.abs(charged - (enterpriseNgn - premiumNgn / 2)) <= 50, `charged ${charged}`);
  });

  test('moving down waits for the end of the month; cancelling goes back to Startup then', async () => {
    const { browser, resellerId, first } = await reseller();
    await plan(browser, first.id, 'enterprise');
    const down = (await plan(browser, first.id, 'premium')).json;
    assert.deepEqual([down.plan.code, down.next_plan?.code], ['enterprise', 'premium']);
    const due = new Date(down.renews_at);
    const before = await available(browser);
    await subscriptions.renewDue(new Date(due.getTime() + 1000));
    const renewed = (await browser.get(`/v1/stores/${first.id}/subscription`)).json;
    assert.deepEqual([renewed.plan.code, renewed.next_plan], ['premium', null]);
    assert.equal(before - (await available(browser)), premiumNgn, 'the new month at the cheaper price');
    assert.equal(await accountPlan(resellerId), 'premium');

    const cancelled = (await plan(browser, first.id, 'standard')).json;
    assert.equal(cancelled.cancel_at_period_end, true);
    assert.equal((await plan(browser, first.id, 'premium')).json.cancel_at_period_end, false, 'choosing it again takes the cancellation back');
    await plan(browser, first.id, 'standard');
    await subscriptions.renewDue(new Date(new Date(renewed.renews_at).getTime() + 1000));
    assert.equal((await browser.get(`/v1/stores/${first.id}/subscription`)).json.plan.code, 'standard');
    assert.equal(await accountPlan(resellerId), 'standard', 'no paid store left');
  });

  test('a renewal the wallet cannot pay keeps the plan 7 days, then the store goes back to Startup', async () => {
    const { browser, resellerId, first } = await reseller(premiumNgn);
    await plan(browser, first.id, 'premium');
    const due = new Date((await browser.get(`/v1/stores/${first.id}/subscription`)).json.renews_at);
    await subscriptions.renewDue(new Date(due.getTime() + 1000));
    const pastDue = (await browser.get(`/v1/stores/${first.id}/subscription`)).json;
    assert.deepEqual([pastDue.plan.code, Boolean(pastDue.past_due_since)], ['premium', true]);
    await subscriptions.renewDue(new Date(due.getTime() + 8 * day));
    assert.equal((await browser.get(`/v1/stores/${first.id}/subscription`)).json.plan.code, 'standard');
    assert.equal(await accountPlan(resellerId), 'standard');
  });

  test('/v1/subscription acts on the first store; a reseller without a store is asked to create one', async () => {
    const { browser, first } = await reseller();
    assert.equal((await browser.post('/v1/subscription', { plan: 'premium' })).json.plan.code, 'premium');
    assert.equal((await browser.get(`/v1/stores/${first.id}/subscription`)).json.plan.code, 'premium');
    const storeless = await resellerClient(server);
    const refused = await storeless.browser.post('/v1/subscription', { plan: 'premium' });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'store_required']);
  });

  test('admins put a store, or every store of a reseller, on a plan without billing it', async () => {
    const { browser, resellerId, first, second } = await reseller(0);
    const operations = await adminClient(server, ['operations']);
    const one = await operations.put(`/v1/admin/stores/${second.id}/subscription`, { plan: 'enterprise' });
    assert.equal(one.status, 200, JSON.stringify(one.json));
    assert.deepEqual([one.json.plan.code, one.json.renews_at], ['enterprise', null]);
    assert.equal(await accountPlan(resellerId), 'enterprise');
    await operations.patch(`/v1/admin/resellers/${resellerId}`, { plan: 'premium' });
    const all = (await browser.get('/v1/subscriptions')).json;
    assert.deepEqual(all.data.map(item => [item.plan.code, item.renews_at]), [['premium', null], ['premium', null]]);
    await subscriptions.renewDue(new Date(Date.now() + 60 * day));
    assert.equal((await browser.get(`/v1/stores/${first.id}/subscription`)).json.plan.code, 'premium', 'never billed, never ended');
    await operations.patch(`/v1/admin/resellers/${resellerId}`, { plan: 'standard' });
    assert.equal(await accountPlan(resellerId), 'standard');
  });

  test('resellers moved from an account plan are told once, two weeks before the first renewal', async () => {
    const { browser, resellerId, first, second } = await reseller();
    const renewsAt = new Date(Date.now() + 20 * day);
    for (const [store, cancel] of [[first, false], [second, true]]) {
      await prisma.storeSubscription.create({ data: { storeId: store.id, resellerId, planCode: 'premium', renewsAt, periodStartedAt: new Date(), cancelAtPeriodEnd: cancel, migrated: true } });
    }
    await subscriptions.renewDue(new Date());
    const tooEarly = (await browser.get('/v1/notifications')).json.data.filter(item => item.type === 'plan.stores_renewing');
    assert.equal(tooEarly.length, 0, 'not yet: 20 days out');
    await subscriptions.renewDue(new Date(Date.now() + 7 * day));
    await subscriptions.renewDue(new Date(Date.now() + 8 * day));
    const notices = (await browser.get('/v1/notifications')).json.data.filter(item => item.type === 'plan.stores_renewing');
    assert.equal(notices.length, 1, 'told once');
    assert.match(notices[0].body, /Renewing: First Shop\. Going back to Startup: Second Shop\./);
  });
});
