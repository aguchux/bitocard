// Ledger and wallets: balances, holds (including concurrent spends), earnings and their payout hold,
// admin adjustments, mode separation and the integrity check.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let wallets;
let ledger;
let prisma;

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(() => server?.close());

/** Credits a reseller's wallet the way a confirmed top-up does. */
async function fund(resellerId, amount, mode = 'live', currency = 'NGN') {
  await ledger.post({
    mode,
    type: 'top_up',
    reference: `test-fund:${resellerId}:${Math.random()}`,
    resellerId,
    description: 'Test funding',
    lines: [
      { account: { kind: 'provider_balance', currency, provider: 'sandbox' }, debit: BigInt(amount) },
      { account: { kind: 'reseller_funding', currency, resellerId }, credit: BigInt(amount) },
    ],
  });
}

describe('wallet', () => {
  test('a new wallet is empty, in the country currency, with the country minimum withdrawal', async () => {
    const { browser } = await resellerClient(server, { country: 'GH' });
    const { status, json } = await browser.get('/v1/wallet');
    assert.equal(status, 200);
    assert.deepEqual(
      [json.mode, json.currency, json.available, json.reserved, json.earnings.withdrawable, json.minimum_withdrawal],
      ['live', 'GHS', 0, 0, 0, 15000],
    );
  });

  test('test and live money are separate; API keys use their own mode', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await fund(resellerId, 50_000, 'test');
    assert.equal((await browser.get('/v1/wallet')).json.available, 0, 'live by default');
    assert.equal((await browser.get('/v1/wallet', { 'bitocard-mode': 'test' })).json.available, 50_000);
    assert.equal((await browser.get('/v1/wallet', { 'bitocard-mode': 'demo' })).status, 400);

    const key = (await browser.post('/v1/api-keys', { name: 'Sandbox', mode: 'test' })).json.secret;
    const viaKey = await fetch(`${server.base}/v1/wallet`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal((await viaKey.json()).available, 50_000);
    const mismatch = await fetch(`${server.base}/v1/wallet`, { headers: { authorization: `Bearer ${key}`, 'bitocard-mode': 'live' } });
    assert.equal((await mismatch.json()).error.code, 'mode_mismatch');
  });

  test('transactions list the change to the available balance, newest first, with paging', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await fund(resellerId, 1000);
    await fund(resellerId, 2000);
    await fund(resellerId, 3000);
    const first = (await browser.get('/v1/wallet/transactions?limit=2')).json;
    assert.deepEqual(first.data.map(t => t.amount), [3000, 2000]);
    assert.equal(first.has_more, true);
    const next = (await browser.get(`/v1/wallet/transactions?limit=2&starting_after=${first.data[1].id}`)).json;
    assert.deepEqual([next.data.map(t => t.amount), next.has_more], [[1000], false]);
  });

  test('a wallet needs the business country', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await prisma.reseller.update({ where: { id: resellerId }, data: { country: null } });
    assert.equal((await browser.get('/v1/wallet')).json.error.code, 'country_required');
  });
});

describe('holds', () => {
  test('a hold takes funding first, then earnings, and a release puts each back', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await fund(resellerId, 3000);
    await wallets.adjust(null, { resellerId, mode: 'live', balance: 'earnings', amount: 5000, reason: 'test earnings' });

    const hold = await wallets.hold({ resellerId, mode: 'live', amount: 4000n, reference: `order-${resellerId}`, description: 'Order' });
    assert.deepEqual([hold.fromFundingMinor, hold.fromEarningsMinor], [3000n, 1000n]);
    let wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([wallet.available, wallet.reserved, wallet.earnings.withdrawable], [4000, 4000, 4000]);

    const again = await wallets.hold({ resellerId, mode: 'live', amount: 4000n, reference: `order-${resellerId}`, description: 'Order' });
    assert.equal(again.id, hold.id, 'same reference, same hold');

    await wallets.releaseHold(hold.id);
    await wallets.releaseHold(hold.id);
    wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([wallet.available, wallet.reserved, wallet.earnings.withdrawable], [8000, 0, 5000]);
  });

  test('a captured hold becomes BitoCard revenue and cannot then be released', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await fund(resellerId, 10_000);
    const hold = await wallets.hold({ resellerId, mode: 'live', amount: 2500n, reference: `cap-${resellerId}`, description: 'Order' });
    assert.equal((await wallets.captureHold(hold.id)).status, 'captured');
    assert.equal((await wallets.releaseHold(hold.id)).status, 'captured');
    const wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([wallet.available, wallet.reserved], [7500, 0]);
  });

  test('a hold larger than the available balance is refused', async () => {
    const { resellerId } = await resellerClient(server);
    await fund(resellerId, 1000);
    await assert.rejects(
      wallets.hold({ resellerId, mode: 'live', amount: 1001n, reference: `big-${resellerId}`, description: 'Order' }),
      error => error.code === 'insufficient_funds',
    );
  });

  test('concurrent holds can never overspend', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await fund(resellerId, 10_000);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => wallets.hold({ resellerId, mode: 'live', amount: 3000n, reference: `race-${resellerId}-${i}`, description: 'Order' })),
    );
    const succeeded = attempts.filter(a => a.status === 'fulfilled').length;
    assert.equal(succeeded, 3, '3 x 3000 fit in 10000; a fourth would not');
    assert.ok(attempts.filter(a => a.status === 'rejected').every(a => a.reason.code === 'insufficient_funds'));
    const wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([wallet.available, wallet.reserved], [1000, 9000]);
  });
});

describe('earnings', () => {
  test('profit is on hold for the country payout period, then becomes withdrawable once', async () => {
    const { browser, resellerId } = await resellerClient(server, { country: 'KE' });
    const lot = await wallets.creditEarnings({
      resellerId,
      mode: 'live',
      amount: 7000n,
      reference: `sale-${resellerId}`,
      description: 'Profit on order',
      source: { kind: 'provider_balance', currency: 'KES', provider: 'sandbox' },
    });
    const days = (lot.releaseAt.getTime() - lot.createdAt.getTime()) / 86_400_000;
    assert.ok(Math.abs(days - 15) < 0.01, 'Kenya holds earnings for 15 days');
    let wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([wallet.available, wallet.earnings.on_hold, wallet.earnings.next_release_at], [0, 7000, lot.releaseAt.toISOString()]);

    assert.equal((await wallets.releaseDueEarnings()).released, 0, 'not due yet');
    const later = new Date(lot.releaseAt.getTime() + 1000);
    await wallets.releaseDueEarnings(later);
    await wallets.releaseDueEarnings(later);
    wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([wallet.available, wallet.earnings.withdrawable, wallet.earnings.on_hold], [7000, 7000, 0]);
  });
});

describe('admin', () => {
  test('finance admins adjust wallets with a reason; it is audited and cannot overdraw', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const credit = await admin.post(`/v1/admin/resellers/${resellerId}/wallet/adjustments`, { mode: 'live', balance: 'funding', amount: 9000, reason: 'Goodwill credit' });
    assert.equal(credit.json.available, 9000);
    const overdraw = await admin.post(`/v1/admin/resellers/${resellerId}/wallet/adjustments`, { mode: 'live', balance: 'funding', amount: -9001, reason: 'Too much' });
    assert.equal(overdraw.json.error.code, 'insufficient_funds');
    assert.equal((await admin.post(`/v1/admin/resellers/${resellerId}/wallet/adjustments`, { mode: 'live', balance: 'funding', amount: 10, reason: '' })).status, 400);

    const history = (await admin.get(`/v1/admin/resellers/${resellerId}/history`)).json.data;
    assert.ok(history.some(entry => entry.action === 'wallet.adjusted' && entry.after.reason === 'Goodwill credit'));
    const txns = (await browser.get('/v1/wallet/transactions')).json.data;
    assert.deepEqual([txns[0].type, txns[0].description], ['adjustment', 'Adjustment: Goodwill credit']);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/resellers/${resellerId}/wallet/adjustments`, { mode: 'live', balance: 'funding', amount: 5, reason: 'Not allowed' })).status, 403);
    assert.equal((await support.get(`/v1/admin/resellers/${resellerId}/wallet`)).json.available, 9000);
  });

  test('the ledger check finds no problems, and spots a tampered balance', async () => {
    const clean = (await admin.get('/v1/admin/ledger/check')).json;
    assert.equal(clean.ok, true, JSON.stringify(clean));
    assert.ok(clean.accounts_checked > 0);

    const { resellerId } = await resellerClient(server);
    await fund(resellerId, 500);
    await prisma.ledgerAccount.updateMany({ where: { resellerId, kind: 'reseller_funding' }, data: { balanceMinor: 999 } });
    const tampered = (await admin.get('/v1/admin/ledger/check')).json;
    assert.equal(tampered.ok, false);
    assert.equal(tampered.account_mismatches[0].balance, '999');
    await prisma.ledgerAccount.updateMany({ where: { resellerId, kind: 'reseller_funding' }, data: { balanceMinor: 500 } });
  });

  test('the database itself refuses a negative reseller balance', async () => {
    const { resellerId } = await resellerClient(server);
    await fund(resellerId, 100);
    await assert.rejects(prisma.ledgerAccount.updateMany({ where: { resellerId, kind: 'reseller_funding' }, data: { balanceMinor: -1 } }));
  });

  test('unbalanced entries are rejected before reaching the database', async () => {
    await assert.rejects(
      ledger.post({
        mode: 'live',
        type: 'test',
        reference: `unbalanced-${Date.now()}`,
        description: 'Broken',
        lines: [{ account: { kind: 'platform_revenue', currency: 'NGN' }, credit: 5n }],
      }),
      /Unbalanced/,
    );
  });
});

describe('access', () => {
  test('support staff and keys without wallet:read cannot see the wallet', async () => {
    const { browser } = await resellerClient(server);
    const narrow = (await browser.post('/v1/api-keys', { name: 'Catalogue', mode: 'test', scopes: ['catalogue:read'] })).json.secret;
    const res = await fetch(`${server.base}/v1/wallet`, { headers: { authorization: `Bearer ${narrow}` } });
    assert.equal(res.status, 403);
  });
});
