// Premium billing: charged monthly from the live wallet in the reseller's currency, cancel at period end,
// renewals with a grace period, and plans set by admins that are not billed.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;
let wallets;
let billing;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  billing = server.app.get((await import('../dist/billing/billing.service.js')).BillingService);
  // Fresh rates: NGN 1500 per USD from both sources, so Premium (US$25) costs 1500 x 1.015 x 25 = NGN 38,062.50.
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
});

after(() => server?.close());

const premiumNgn = 3_806_250;

async function funded(amount) {
  const reseller = await resellerClient(server);
  if (amount) await wallets.adjust(null, { resellerId: reseller.resellerId, mode: 'live', balance: 'funding', amount, reason: 'Top-up' });
  return reseller;
}

const renewsAt = async resellerId => (await prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } })).planRenewsAt;

describe('upgrading', () => {
  test('Premium charges the first month from the live wallet at the published rate', async () => {
    const { browser } = await funded(5_000_000);
    const before = (await browser.get('/v1/subscription')).json;
    assert.deepEqual([before.plan.code, before.renews_at], ['standard', null]);

    const upgraded = await browser.post('/v1/subscription', { plan: 'premium' });
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.json.plan.code, 'premium');
    const days = (new Date(upgraded.json.renews_at) - Date.now()) / 86_400_000;
    assert.ok(days > 27 && days < 32, 'renews in a month');
    assert.equal((await browser.get('/v1/wallet')).json.available, 5_000_000 - premiumNgn);
    const [capture] = (await browser.get('/v1/wallet/transactions')).json.data;
    assert.match(capture.description, /Premium plan: NGN 38,062\.50 \(US\$25\.00 at 1522\.5\)/);
  });

  test('without enough money nothing changes', async () => {
    const { browser } = await funded(1_000_000);
    assert.equal((await browser.post('/v1/subscription', { plan: 'premium' })).json.error.code, 'insufficient_funds');
    assert.equal((await browser.get('/v1/subscription')).json.plan.code, 'standard');
    assert.equal((await browser.get('/v1/wallet')).json.available, 1_000_000);
  });

  test('API keys can read the plan but not change it; unknown plans are refused', async () => {
    const { browser } = await funded(0);
    const testKey = (await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' })).json.secret;
    const read = await fetch(`${server.base}/v1/subscription`, { headers: { authorization: `Bearer ${testKey}` } });
    assert.equal(read.status, 200);
    const change = await fetch(`${server.base}/v1/subscription`, {
      method: 'POST',
      headers: { authorization: `Bearer ${testKey}`, 'content-type': 'application/json', 'idempotency-key': 'plan-1' },
      body: JSON.stringify({ plan: 'premium' }),
    });
    assert.equal(change.status, 403);
    assert.equal((await browser.post('/v1/subscription', { plan: 'gold' })).json.error.param, 'plan');
  });
});

describe('cancelling and renewing', () => {
  test('moving to Standard keeps Premium to the end of the month; choosing Premium again resumes without a charge', async () => {
    const { browser, resellerId } = await funded(5_000_000);
    await browser.post('/v1/subscription', { plan: 'premium' });
    const cancelled = (await browser.post('/v1/subscription', { plan: 'standard' })).json;
    assert.deepEqual([cancelled.plan.code, cancelled.cancel_at_period_end], ['premium', true]);
    const resumed = (await browser.post('/v1/subscription', { plan: 'premium' })).json;
    assert.equal(resumed.cancel_at_period_end, false);
    assert.equal((await browser.get('/v1/wallet')).json.available, 5_000_000 - premiumNgn, 'charged once');

    await browser.post('/v1/subscription', { plan: 'standard' });
    await billing.renewDue(new Date((await renewsAt(resellerId)).getTime() + 1000));
    const ended = (await browser.get('/v1/subscription')).json;
    assert.deepEqual([ended.plan.code, ended.renews_at], ['standard', null]);
  });

  test('a due renewal charges once for the month, even if the job runs twice', async () => {
    const { browser, resellerId } = await funded(10_000_000);
    await browser.post('/v1/subscription', { plan: 'premium' });
    const dueAt = new Date(Date.now() - 1000);
    await prisma.reseller.update({ where: { id: resellerId }, data: { planRenewsAt: dueAt } });
    await billing.renewDue();
    // Run the same renewal again, as a retried job would: the month is not charged twice.
    await prisma.reseller.update({ where: { id: resellerId }, data: { planRenewsAt: dueAt } });
    await billing.renewDue();
    assert.equal((await browser.get('/v1/wallet')).json.available, 10_000_000 - 2 * premiumNgn);
    assert.ok((await renewsAt(resellerId)) > new Date(), 'next renewal a month on');
  });

  test('a failed renewal warns the owner, then drops to Standard after the grace period', async () => {
    const { browser, resellerId, email } = await funded(premiumNgn);
    await browser.post('/v1/subscription', { plan: 'premium' });
    const due = await renewsAt(resellerId);

    // Other tests' resellers may fall due too, so only this reseller's state is checked.
    await billing.renewDue(new Date(due.getTime() + 1000));
    const pastDue = (await browser.get('/v1/subscription')).json;
    assert.deepEqual([pastDue.plan.code, Boolean(pastDue.past_due_since)], ['premium', true]);
    const { EmailService } = await import('../dist/notifications/email.service.js');
    const outbox = server.app.get(EmailService).outbox;
    assert.match(outbox.findLast(m => m.to === email).subject, /could not renew your Premium plan/);
    assert.ok((await browser.get('/v1/notifications')).json.data.some(item => item.type === 'plan.renewal_failed' && item.link === '/settings/plan'));

    await billing.renewDue(new Date(due.getTime() + 2 * 86_400_000));
    assert.equal((await browser.get('/v1/subscription')).json.plan.code, 'premium', 'still inside the grace period');
    await billing.renewDue(new Date(Date.now() + 8 * 86_400_000 + (due.getTime() - Date.now())));
    assert.equal((await browser.get('/v1/subscription')).json.plan.code, 'standard');
    assert.match(outbox.findLast(m => m.to === email).subject, /Premium plan has ended/);
  });

  test('a plan set by an admin is not billed, and moving to Standard ends it at once', async () => {
    const { browser, resellerId } = await funded(0);
    const admin = await adminClient(server);
    await admin.patch(`/v1/admin/resellers/${resellerId}`, { plan: 'premium' });
    assert.equal((await browser.get('/v1/subscription')).json.renews_at, null);
    await billing.renewDue(new Date(Date.now() + 60 * 86_400_000));
    assert.equal((await browser.get('/v1/subscription')).json.plan.code, 'premium');
    assert.equal((await browser.post('/v1/subscription', { plan: 'standard' })).json.plan.code, 'standard');
  });
});
