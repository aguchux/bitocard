// Withdrawals to mobile money through pawaPay (phase 7 of store plans): only to the owner's own confirmed phone, on a
// network open for payouts, with the bank payout rules (verified, 24-hour wait, minimum), the fee taken out of the
// amount withdrawn, and outcomes (paid, failed, callbacks) applied once.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { resellerClient, startApp } from './helpers.mjs';
import { fakePawapay } from './fakes.mjs';

let server;
let pawapay;
let prisma;
let wallets;

before(async () => {
  pawapay = await fakePawapay();
  server = await startApp({ env: { ...pawapay.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
});

after(async () => {
  await server?.close();
  await pawapay?.close();
});

const sandbox = { 'bitocard-mode': 'test' };
let phones = 0;

/** A Ghanaian reseller with withdrawable earnings and a confirmed phone of their own. */
async function earner({ mode = 'test', earnings = 5_000_000 } = {}) {
  const reseller = await resellerClient(server, { country: 'GH' });
  if (mode === 'live') await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ama Mensah' } });
  if (earnings) await wallets.adjust(null, { resellerId: reseller.resellerId, mode, balance: 'earnings', amount: earnings, reason: 'Matured test earnings' });
  phones += 1;
  const phone = `+23324${String(1_000_000 + phones).padStart(7, '0')}`;
  await prisma.userPhone.create({ data: { userId: reseller.userId, realm: 'reseller', phone, verifiedAt: new Date() } });
  return { ...reseller, phone };
}

const earnings = async (resellerId, mode) => BigInt((await wallets.wallet(resellerId, mode)).earnings.withdrawable);

describe('mobile money payout accounts', () => {
  test('only the owner’s own confirmed phone, listed with bank accounts and never shown in full', async () => {
    const { browser, phone, resellerId } = await earner();
    const other = await browser.post('/v1/mobile-money-accounts', { phone: '+233249999999' }, sandbox);
    assert.equal(other.json.error.code, 'phone_not_confirmed');
    const added = await browser.post('/v1/mobile-money-accounts', { phone }, sandbox);
    assert.equal(added.status, 201);
    assert.deepEqual([added.json.kind, added.json.bank_name, added.json.account_number_last4], ['mobile_money', 'Sandbox mobile money', phone.slice(-4)]);
    assert.equal((await browser.post('/v1/mobile-money-accounts', { phone }, sandbox)).json.error.code, 'bank_account_exists');
    assert.equal((await browser.get('/v1/bank-accounts', sandbox)).json.data[0].kind, 'mobile_money');
    const stored = await prisma.bankAccount.findFirst({ where: { resellerId } });
    assert.ok(!JSON.stringify(stored).includes(phone.slice(1)), 'the number is encrypted');
  });

  test('live: the network comes from pawaPay; a network closed for payouts and an unverified reseller are refused', async () => {
    const { browser, phone } = await earner({ mode: 'live', earnings: 0 });
    pawapay.state.predict = { [phone.slice(1)]: 'VODAFONE_GHA' };
    assert.equal((await browser.post('/v1/mobile-money-accounts', { phone })).json.error.code, 'mobile_money_unavailable');
    pawapay.state.predict = {};
    const added = await browser.post('/v1/mobile-money-accounts', { phone });
    assert.deepEqual([added.status, added.json.bank_code, added.json.bank_name, added.json.account_name], [201, 'MTN_MOMO_GHA', 'MTN', 'Ama Mensah']);
    assert.ok(new Date(added.json.payouts_available_from) > new Date(Date.now() + 23 * 3600_000), '24-hour wait');

    const unverified = await earner({ earnings: 0 });
    assert.equal((await unverified.browser.post('/v1/mobile-money-accounts', { phone: unverified.phone })).status, 403);
  });
});

describe('withdrawing to mobile money', () => {
  test('sandbox: the fee comes out of the amount, earnings move once, paid is final', async () => {
    const { browser, phone, resellerId } = await earner();
    const account = (await browser.post('/v1/mobile-money-accounts', { phone }, sandbox)).json;
    const payout = await browser.post('/v1/payouts', { amount: 1_000_000, bank_account_id: account.id }, sandbox);
    assert.equal(payout.status, 201);
    // 1.5% on what is sent: 985,221 sent costs 985,221 + 14,779 = 1,000,000.
    assert.deepEqual([payout.json.status, payout.json.fee, payout.json.sent], ['processing', 14_779, 985_221]);
    assert.equal(payout.json.bank_account.kind, 'mobile_money');
    assert.equal(await earnings(resellerId, 'test'), 4_000_000n);
    assert.equal((await browser.post(`/v1/payouts/${payout.json.id}/simulate`, { outcome: 'paid' }, sandbox)).json.status, 'paid');
    assert.equal(await earnings(resellerId, 'test'), 4_000_000n);
  });

  test('live: pawaPay is paid what is left after its fee, in whole units, and a completed payout is paid at once', async () => {
    const { browser, phone, resellerId } = await earner({ mode: 'live' });
    const account = (await browser.post('/v1/mobile-money-accounts', { phone })).json;
    assert.equal((await browser.post('/v1/payouts', { amount: 1_000_000, bank_account_id: account.id })).json.error.code, 'bank_account_cooling_off');
    await prisma.bankAccount.update({ where: { id: account.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });

    pawapay.state.reply = 'COMPLETED';
    const payout = (await browser.post('/v1/payouts', { amount: 100_000, bank_account_id: account.id })).json;
    // GHS on MTN takes no decimals: 985.22 sent is cut to 985, so the fee is 15.00.
    assert.deepEqual([payout.status, payout.sent, payout.fee], ['paid', 98_500, 1_500], JSON.stringify(payout));
    const sent = Object.values(pawapay.state.payouts).find(item => item.body.clientReferenceId?.startsWith('bc_po_') && item.body.recipient.accountDetails.phoneNumber === phone.slice(1));
    assert.deepEqual([sent.body.amount, sent.body.currency, sent.body.recipient.accountDetails.provider], ['985', 'GHS', 'MTN_MOMO_GHA']);
    assert.equal(await earnings(resellerId, 'live'), 4_900_000n);
  });

  test('live: a refused payout returns the money; a callback settles one still on its way', async () => {
    const { browser, phone, resellerId } = await earner({ mode: 'live' });
    const account = (await browser.post('/v1/mobile-money-accounts', { phone })).json;
    await prisma.bankAccount.update({ where: { id: account.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });

    pawapay.state.reply = 'REJECTED';
    const refused = (await browser.post('/v1/payouts', { amount: 100_000, bank_account_id: account.id })).json;
    assert.deepEqual([refused.status, refused.failure_reason], ['failed', 'The mobile money payout was refused.']);
    assert.equal(await earnings(resellerId, 'live'), 5_000_000n);

    pawapay.state.reply = 'PROCESSING';
    const waiting = (await browser.post('/v1/payouts', { amount: 100_000, bank_account_id: account.id })).json;
    assert.equal(waiting.status, 'processing');
    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: waiting.id } });
    const [id, entry] = Object.entries(pawapay.state.payouts).find(([, item]) => item.body.clientReferenceId === stored.reference);
    entry.status = 'COMPLETED';
    const notice = await fetch(`${server.base}/v1/webhooks/pawapay?token=pawapay-callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payoutId: id, status: 'COMPLETED', clientReferenceId: stored.reference }),
    });
    assert.equal(notice.status, 200);
    assert.equal((await browser.get(`/v1/payouts/${waiting.id}`)).json.status, 'paid');
    assert.equal(await prisma.supplierWebhook.count({ where: { reference: stored.reference } }), 0, 'withdrawals are not stored as order notifications');
    assert.equal(await earnings(resellerId, 'live'), 4_900_000n);
  });

  test('the split never costs more than the amount withdrawn', async () => {
    const { mobileMoneySplit } = await import('../dist/payouts/mobile-money.js');
    for (const amount of [1n, 99n, 100n, 101n, 12_345n, 1_000_000n]) {
      for (const percent of ['0', '1.5', '3', '0.25']) {
        const split = mobileMoneySplit(amount, percent, false);
        if (!split) continue;
        const cost = split.sent + BigInt(Math.ceil((Number(split.sent) * Number(percent)) / 100));
        assert.ok(cost <= amount && split.sent + split.fee === amount, `${amount} at ${percent}%`);
      }
    }
    assert.equal(mobileMoneySplit(99n, '1.5', true), null, 'nothing whole left to send');
  });
});
