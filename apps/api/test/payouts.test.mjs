// Payouts: bank accounts confirmed by the bank, withdrawals of matured earnings only, the minimum withdrawal,
// the new-account cooling-off period, and transfer outcomes (paid, failed, unclear) applied exactly once.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { resellerClient, startApp } from './helpers.mjs';
import { fakeFlutterwave } from './fakes.mjs';

let server;
let flw;
let prisma;
let wallets;

before(async () => {
  flw = await fakeFlutterwave();
  server = await startApp({ env: { ...flw.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
});

after(async () => {
  await server?.close();
  await flw?.close();
});

const sandbox = { 'bitocard-mode': 'test' };

/** A reseller with withdrawable earnings in the given mode. */
async function earner({ mode = 'test', earnings = 5_000_000, country = 'NG' } = {}) {
  const reseller = await resellerClient(server, { country });
  if (mode === 'live') await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  if (earnings) await wallets.adjust(null, { resellerId: reseller.resellerId, mode, balance: 'earnings', amount: earnings, reason: 'Matured test earnings' });
  return reseller;
}

describe('bank accounts', () => {
  test('the bank supplies the name; only the last 4 digits are shown and the number is encrypted', async () => {
    const { browser, resellerId } = await earner();
    const banks = (await browser.get('/v1/banks', sandbox)).json.data;
    assert.equal(banks[0].name, 'Sandbox Bank');
    const added = await browser.post('/v1/bank-accounts', { bank_code: banks[0].code, account_number: '1234567890' }, sandbox);
    assert.equal(added.status, 201);
    assert.deepEqual([added.json.account_name, added.json.account_number_last4], ['SANDBOX ACCOUNT HOLDER', '7890']);
    const stored = await prisma.bankAccount.findFirst({ where: { resellerId } });
    assert.ok(!JSON.stringify(stored).includes('1234567890'), 'the full number is never stored in clear');
  });

  test('unknown banks and accounts are refused', async () => {
    const { browser } = await earner();
    assert.equal((await browser.post('/v1/bank-accounts', { bank_code: 'NOPE', account_number: '1234567890' }, sandbox)).json.error.param, 'bank_code');
    assert.equal((await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '0000000000' }, sandbox)).json.error.code, 'bank_account_invalid');
    assert.equal((await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '12ab' }, sandbox)).json.error.param, 'account_number');
  });

  test('API keys can list but never add bank accounts; removed accounts disappear', async () => {
    const { browser } = await earner();
    const key = (await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' })).json.secret;
    const add = await fetch(`${server.base}/v1/bank-accounts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': 'bank-1' },
      body: JSON.stringify({ bank_code: 'SBX001', account_number: '1234567890' }),
    });
    assert.equal(add.status, 403);
    const account = (await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '1234567890' }, sandbox)).json;
    const listed = await fetch(`${server.base}/v1/bank-accounts`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal((await listed.json()).data.length, 1);
    assert.equal((await browser.delete(`/v1/bank-accounts/${account.id}`, sandbox)).json.removed, true);
    assert.equal((await browser.get('/v1/bank-accounts', sandbox)).json.data.length, 0);
  });

  test('a live bank account is confirmed with Flutterwave and the owner is emailed', async () => {
    const { browser, email } = await earner({ mode: 'live', earnings: 0 });
    const added = await browser.post('/v1/bank-accounts', { bank_code: '058', account_number: '0123456789' });
    assert.deepEqual([added.status, added.json.bank_name, added.json.account_name], [201, 'GTBank', 'ADA OBI DIGITAL']);
    const { EmailService } = await import('../dist/notifications/email.service.js');
    const message = server.app.get(EmailService).outbox.findLast(m => m.to === email);
    assert.match(message.subject, /payout bank account was added/);
    assert.ok(new Date(added.json.payouts_available_from) > new Date(Date.now() + 23 * 3600_000), '24-hour cooling-off');
  });
});

describe('sandbox payouts', () => {
  test('a payout sets earnings aside, and paid is final', async () => {
    const { browser } = await earner();
    const account = (await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '1234567890' }, sandbox)).json;
    const payout = await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id }, sandbox);
    assert.equal(payout.status, 201);
    assert.equal(payout.json.status, 'processing');
    let wallet = (await browser.get('/v1/wallet', sandbox)).json;
    assert.deepEqual([wallet.earnings.withdrawable, wallet.payouts_in_progress], [3_000_000, 2_000_000]);

    assert.equal((await browser.post(`/v1/payouts/${payout.json.id}/simulate`, { outcome: 'paid' }, sandbox)).json.status, 'paid');
    assert.equal((await browser.post(`/v1/payouts/${payout.json.id}/simulate`, { outcome: 'failed' }, sandbox)).json.status, 'paid', 'final');
    wallet = (await browser.get('/v1/wallet', sandbox)).json;
    assert.deepEqual([wallet.earnings.withdrawable, wallet.payouts_in_progress], [3_000_000, 0]);
    assert.equal((await browser.get('/v1/payouts', sandbox)).json.data[0].status, 'paid');
  });

  test('payouts name their bank account, even after it is removed (webhooks leave it out)', async () => {
    const { browser } = await earner();
    const account = (await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '1234567890' }, sandbox)).json;
    const payout = await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id }, sandbox);
    assert.deepEqual(payout.json.bank_account, { bank_name: account.bank_name, account_number_last4: '7890', removed: false });
    await browser.delete(`/v1/bank-accounts/${account.id}`, sandbox);
    const [listed] = (await browser.get('/v1/payouts', sandbox)).json.data;
    assert.deepEqual(listed.bank_account, { bank_name: account.bank_name, account_number_last4: '7890', removed: true });
    assert.equal((await browser.get(`/v1/payouts/${payout.json.id}`, sandbox)).json.bank_account.removed, true);
  });

  test('a failed payout returns the money to withdrawable earnings', async () => {
    const { browser } = await earner();
    const account = (await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '1234567890' }, sandbox)).json;
    const payout = (await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id }, sandbox)).json;
    const failed = await browser.post(`/v1/payouts/${payout.id}/simulate`, { outcome: 'failed' }, sandbox);
    assert.deepEqual([failed.json.status, failed.json.failure_reason], ['failed', 'Simulated failure.']);
    const wallet = (await browser.get('/v1/wallet', sandbox)).json;
    assert.deepEqual([wallet.earnings.withdrawable, wallet.payouts_in_progress], [5_000_000, 0]);
  });

  test('only withdrawable earnings can be paid out, at least the country minimum', async () => {
    const { browser, resellerId } = await earner({ earnings: 2_000_000 });
    // Topped-up funds and earnings still on hold are not withdrawable.
    await wallets.adjust(null, { resellerId, mode: 'test', balance: 'funding', amount: 9_000_000, reason: 'Top-up' });
    await wallets.creditEarnings({ resellerId, mode: 'test', amount: 4_000_000n, reference: `held-${resellerId}`, description: 'Recent sale', source: { kind: 'provider_balance', currency: 'NGN', provider: 'sandbox' } });
    const account = (await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '1234567890' }, sandbox)).json;

    const tooMuch = await browser.post('/v1/payouts', { amount: 2_000_001, bank_account_id: account.id }, sandbox);
    assert.equal(tooMuch.json.error.code, 'insufficient_funds');
    const tooSmall = await browser.post('/v1/payouts', { amount: 1_499_999, bank_account_id: account.id }, sandbox);
    assert.deepEqual([tooSmall.json.error.code, tooSmall.json.error.message], ['amount_too_small', 'The smallest withdrawal is NGN 15,000.00.']);
    assert.equal((await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id }, sandbox)).status, 201);
    assert.equal((await prisma.payout.count({ where: { resellerId } })), 1, 'refused payouts leave no record');
  });

  test('concurrent withdrawals cannot exceed earnings', async () => {
    const { browser } = await earner({ earnings: 5_000_000 });
    const account = (await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '1234567890' }, sandbox)).json;
    const results = await Promise.all(Array.from({ length: 4 }, () => browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id }, sandbox)));
    assert.equal(results.filter(r => r.status === 201).length, 2);
    assert.equal((await browser.get('/v1/wallet', sandbox)).json.earnings.withdrawable, 1_000_000);
  });

  test('support staff cannot withdraw', async () => {
    const { browser, resellerId } = await earner();
    const staff = await resellerClient(server);
    await prisma.resellerMember.deleteMany({ where: { userId: staff.userId } });
    await prisma.resellerMember.create({ data: { resellerId, userId: staff.userId, role: 'support' } });
    const account = (await browser.post('/v1/bank-accounts', { bank_code: 'SBX001', account_number: '1234567890' }, sandbox)).json;
    assert.equal((await staff.browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id }, sandbox)).status, 403);
  });
});

describe('live payouts through Flutterwave', () => {
  async function liveAccount() {
    const reseller = await earner({ mode: 'live' });
    const account = (await reseller.browser.post('/v1/bank-accounts', { bank_code: '058', account_number: '0123456789' })).json;
    return { ...reseller, account };
  }

  test('payouts to a new account wait 24 hours', async () => {
    const { browser, account } = await liveAccount();
    const res = await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id });
    assert.equal(res.json.error.code, 'bank_account_cooling_off');
  });

  test('the transfer webhook is re-read from Flutterwave, then paid once with the fee recorded', async () => {
    const { browser, email, account } = await liveAccount();
    await prisma.bankAccount.update({ where: { id: account.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const payout = (await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id })).json;
    assert.equal(payout.status, 'processing');
    const sent = flw.calls.findLast(c => c.url === '/transfers');
    assert.deepEqual([sent.body.amount, sent.body.account_number, sent.body.account_bank], [20000, '0123456789', '058']);

    const transfer = Object.values(flw.state.transfers).find(t => t.reference === sent.body.reference);
    transfer.status = 'SUCCESSFUL';
    const hook = body => fetch(`${server.base}/v1/webhooks/flutterwave`, { method: 'POST', headers: { 'content-type': 'application/json', 'verif-hash': 'flw-webhook-hash' }, body: JSON.stringify(body) });
    assert.equal((await hook({ event: 'transfer.completed', data: { id: transfer.id, status: 'FAILED' } })).status, 200);
    await hook({ event: 'transfer.completed', data: { id: transfer.id } });

    assert.equal((await browser.get(`/v1/payouts/${payout.id}`)).json.status, 'paid', 'the status comes from Flutterwave, not the webhook body');
    const wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([wallet.earnings.withdrawable, wallet.payouts_in_progress], [3_000_000, 0]);
    const fees = await prisma.ledgerAccount.findFirst({ where: { kind: 'processing_fees', ownerKey: 'provider:flutterwave', mode: 'live' } });
    assert.ok(fees.balanceMinor >= 1075n);
    const { EmailService } = await import('../dist/notifications/email.service.js');
    assert.match(server.app.get(EmailService).outbox.findLast(m => m.to === email).subject, /has been paid/);
  });

  test('a refused transfer fails at once and returns the money', async () => {
    const { browser, account } = await liveAccount();
    await prisma.bankAccount.update({ where: { id: account.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    flw.state.fail['/transfers'] = 400;
    try {
      const payout = (await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id })).json;
      assert.equal(payout.status, 'failed');
    } finally {
      delete flw.state.fail['/transfers'];
    }
    assert.equal((await browser.get('/v1/wallet')).json.earnings.withdrawable, 5_000_000);
  });

  test('an unclear transfer stays pending with the money set aside', async () => {
    const { browser, account } = await liveAccount();
    await prisma.bankAccount.update({ where: { id: account.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    flw.state.fail['/transfers'] = 502;
    try {
      const payout = (await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id })).json;
      assert.equal(payout.status, 'pending');
    } finally {
      delete flw.state.fail['/transfers'];
    }
    const wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([wallet.earnings.withdrawable, wallet.payouts_in_progress], [3_000_000, 2_000_000]);
  });

  test('the scheduled job completes payouts Flutterwave did not notify us about', async () => {
    const { browser, account } = await liveAccount();
    await prisma.bankAccount.update({ where: { id: account.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const payout = (await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id })).json;
    const reference = flw.calls.findLast(c => c.url === '/transfers').body.reference;
    Object.values(flw.state.transfers).find(t => t.reference === reference).status = 'SUCCESSFUL';
    await prisma.payout.update({ where: { id: payout.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await fetch(`${server.base}/v1/cron/payments`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal((await browser.get(`/v1/payouts/${payout.id}`)).json.status, 'paid');
  });

  test('live payouts need a verified business', async () => {
    const { browser, resellerId, account } = await liveAccount();
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'pending' } });
    assert.equal((await browser.post('/v1/payouts', { amount: 2_000_000, bank_account_id: account.id })).json.error.code, 'reseller_not_verified');
  });
});
