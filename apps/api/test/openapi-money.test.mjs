// The wallet, top-up, reserved account, fee, exchange rate, payout and plan responses match their documented schemas:
// each endpoint is called for real (sandbox where it can be, live where only live works) and checked against the docs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let check;
let prisma;
let wallets;
let fees;
let admin;

before(async () => {
  server = await startApp();
  check = await responseChecker(server.app);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  fees = server.app.get((await import('../dist/fees/platform-fees.service.js')).PlatformFeesService);
  admin = await adminClient(server, ['finance']);
  // Fresh NGN rates from both sources, so NGN converts and Premium can be charged; GHS and KES stay unavailable.
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
});

after(() => server?.close());

const sandbox = { 'bitocard-mode': 'test' };

/** Calls the API and checks the status and the documented schema. */
async function expect(browser, method, path, key, status, body, headers) {
  const res = method === 'GET' ? await browser.get(path, headers) : method === 'DELETE' ? await browser.delete(path, headers) : await browser.post(path, body, headers);
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(res.json)}`);
  check(key, status, res.json);
  return res.json;
}

describe('sandbox wallet money', () => {
  test('top-ups, reserved accounts, the wallet and its transactions', async () => {
    const { browser } = await resellerClient(server);
    const topUp = await expect(browser, 'POST', '/v1/wallet/top-ups', 'POST /v1/wallet/top-ups', 201, { amount: 500_000 }, sandbox);
    assert.equal(topUp.status, 'pending');
    assert.ok(topUp.checkout_url);
    await expect(browser, 'GET', `/v1/wallet/top-ups/${topUp.id}`, 'GET /v1/wallet/top-ups/{id}', 200, undefined, sandbox);
    const paid = await expect(browser, 'POST', `/v1/wallet/top-ups/${topUp.id}/simulate`, 'POST /v1/wallet/top-ups/{id}/simulate', 200, { outcome: 'succeeded' }, sandbox);
    assert.equal(paid.status, 'succeeded');
    const failing = (await browser.post('/v1/wallet/top-ups', { amount: 20_000 }, sandbox)).json;
    await expect(browser, 'POST', `/v1/wallet/top-ups/${failing.id}/simulate`, 'POST /v1/wallet/top-ups/{id}/simulate', 200, { outcome: 'failed' }, sandbox);

    const accounts = await expect(browser, 'POST', '/v1/wallet/reserved-accounts', 'POST /v1/wallet/reserved-accounts', 201, {}, sandbox);
    assert.equal(accounts.data.length, 1);
    await expect(browser, 'GET', '/v1/wallet/reserved-accounts', 'GET /v1/wallet/reserved-accounts', 200, undefined, sandbox);
    const deposit = await expect(browser, 'POST', `/v1/wallet/reserved-accounts/${accounts.data[0].id}/simulate-deposit`, 'POST /v1/wallet/reserved-accounts/{id}/simulate-deposit', 200, { amount: 70_000 }, sandbox);
    assert.equal(deposit.credited, true);

    const list = await expect(browser, 'GET', '/v1/wallet/top-ups', 'GET /v1/wallet/top-ups', 200, undefined, sandbox);
    assert.deepEqual(list.data.map(item => item.source).sort(), ['bank_transfer', 'checkout', 'checkout']);
    const wallet = await expect(browser, 'GET', '/v1/wallet', 'GET /v1/wallet', 200, undefined, sandbox);
    assert.deepEqual([wallet.available, wallet.startup_allowance], [570_000, null]);
    const transactions = await expect(browser, 'GET', '/v1/wallet/transactions', 'GET /v1/wallet/transactions', 200, undefined, sandbox);
    assert.deepEqual(transactions.data.map(item => item.type).sort(), ['deposit', 'top_up']);
  });

  test('banks, bank accounts and payouts', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await wallets.adjust(null, { resellerId, mode: 'test', balance: 'earnings', amount: 5_000_000, reason: 'Matured test earnings' });
    const banks = await expect(browser, 'GET', '/v1/banks', 'GET /v1/banks', 200, undefined, sandbox);
    const account = await expect(browser, 'POST', '/v1/bank-accounts', 'POST /v1/bank-accounts', 201, { bank_code: banks.data[0].code, account_number: '0123456789' }, sandbox);
    await expect(browser, 'GET', '/v1/bank-accounts', 'GET /v1/bank-accounts', 200, undefined, sandbox);

    const payout = await expect(browser, 'POST', '/v1/payouts', 'POST /v1/payouts', 201, { amount: 2_000_000, bank_account_id: account.id }, sandbox);
    await expect(browser, 'GET', `/v1/payouts/${payout.id}`, 'GET /v1/payouts/{id}', 200, undefined, sandbox);
    await expect(browser, 'POST', `/v1/payouts/${payout.id}/simulate`, 'POST /v1/payouts/{id}/simulate', 200, { outcome: 'paid' }, sandbox);
    const second = (await browser.post('/v1/payouts', { amount: 1_500_000, bank_account_id: account.id }, sandbox)).json;
    const failed = await expect(browser, 'POST', `/v1/payouts/${second.id}/simulate`, 'POST /v1/payouts/{id}/simulate', 200, { outcome: 'failed' }, sandbox);
    assert.equal(failed.failure_reason, 'Simulated failure.');

    const removed = await expect(browser, 'DELETE', `/v1/bank-accounts/${account.id}`, 'DELETE /v1/bank-accounts/{id}', 200, undefined, sandbox);
    assert.equal(removed.removed, true);
    const payouts = await expect(browser, 'GET', '/v1/payouts', 'GET /v1/payouts', 200, undefined, sandbox);
    assert.deepEqual(payouts.data.map(item => item.bank_account.removed), [true, true]);
    const wallet = await expect(browser, 'GET', '/v1/wallet', 'GET /v1/wallet', 200, undefined, sandbox);
    assert.equal(wallet.earnings.withdrawable, 3_000_000);
    const transactions = await expect(browser, 'GET', '/v1/wallet/transactions?limit=2', 'GET /v1/wallet/transactions', 200, undefined, sandbox);
    assert.equal(transactions.has_more, true);
  });
});

describe('live wallet money', () => {
  test('BitoCard fees: charges (held and charged), the statement and the rates', async () => {
    assert.equal((await admin.put('/v1/admin/fee-rules', { kind: 'supplier_order', country_code: 'NG', rate_ppb: 2_500_000 })).status, 200);
    assert.equal((await admin.put('/v1/admin/fee-rules', { kind: 'supplier_order', country_code: 'NG', category: 'gift_cards', rate_ppb: 5_000_000, min_fee_minor: 5_000 })).status, 200);
    const { browser, resellerId } = await resellerClient(server);
    await wallets.adjust(null, { resellerId, mode: 'live', balance: 'funding', amount: 1_000_000, reason: 'Top-up' });
    const order = () => ({ type: 'order', id: randomUUID() });
    await fees.settle((await fees.hold({ resellerId, mode: 'live', kind: 'supplier_order', category: 'airtime', baseMinor: 1_234_567n, source: order(), description: 'Order' })).id);
    await fees.hold({ resellerId, mode: 'live', kind: 'supplier_order', category: 'gift_cards', baseMinor: 400_000n, source: order(), description: 'Order' });

    const list = await expect(browser, 'GET', '/v1/wallet/fees', 'GET /v1/wallet/fees', 200);
    assert.deepEqual(list.data.map(item => item.status), ['held', 'charged']);
    const month = new Date().toISOString().slice(0, 7);
    const statement = await expect(browser, 'GET', `/v1/wallet/fees/statement?month=${month}`, 'GET /v1/wallet/fees/statement', 200);
    assert.equal(statement.fees.charged, 3_086);
    await expect(browser, 'GET', '/v1/wallet/fees/statement', 'GET /v1/wallet/fees/statement', 200);
    const rates = await expect(browser, 'GET', '/v1/wallet/fee-rates', 'GET /v1/wallet/fee-rates', 200);
    assert.equal(rates.data.find(rate => rate.category === 'gift_cards').min_fee, 5_000);
    const transactions = await expect(browser, 'GET', '/v1/wallet/transactions', 'GET /v1/wallet/transactions', 200);
    assert.ok(transactions.data.some(item => item.type === 'platform_fee' && item.fee?.source?.type === 'order'));
  });

  test('plans: the list, the subscription and upgrading from the live wallet', async () => {
    const plans = await expect(client(server.base), 'GET', '/v1/plans', 'GET /v1/plans', 200);
    assert.deepEqual(plans.data.map(plan => plan.code), ['standard', 'premium']);
    const { browser, resellerId } = await resellerClient(server);
    await wallets.adjust(null, { resellerId, mode: 'live', balance: 'funding', amount: 5_000_000, reason: 'Top-up' });
    await expect(browser, 'GET', '/v1/subscription', 'GET /v1/subscription', 200);
    const upgraded = await expect(browser, 'POST', '/v1/subscription', 'POST /v1/subscription', 200, { plan: 'premium' });
    assert.ok(upgraded.renews_at);
    const cancelled = await expect(browser, 'POST', '/v1/subscription', 'POST /v1/subscription', 200, { plan: 'standard' });
    assert.equal(cancelled.cancel_at_period_end, true);
    const transactions = await expect(browser, 'GET', '/v1/wallet/transactions', 'GET /v1/wallet/transactions', 200);
    assert.deepEqual(transactions.data.map(item => item.type), ['hold_capture', 'hold', 'adjustment']);
    const wallet = await expect(browser, 'GET', '/v1/wallet', 'GET /v1/wallet', 200);
    assert.equal(wallet.mode, 'live');
  });

  test('exchange rates, available and paused', async () => {
    const rates = await expect(client(server.base), 'GET', '/v1/exchange-rates', 'GET /v1/exchange-rates', 200);
    const byCurrency = Object.fromEntries(rates.data.map(rate => [rate.currency, rate]));
    assert.deepEqual([byCurrency.NGN.available, byCurrency.NGN.pay, byCurrency.GHS.available], [true, '1522.5', false]);
  });
});
