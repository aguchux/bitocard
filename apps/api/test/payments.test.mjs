// Money coming in: sandbox and Flutterwave top-ups, reserved bank accounts (Flutterwave, then Monnify), provider
// webhooks and requeries. A wallet is credited only once the provider confirms, and each payment only once.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeFlutterwave, fakeMonnify } from './fakes.mjs';

let server;
let flw;
let monnify;
let prisma;
let admin;

before(async () => {
  flw = await fakeFlutterwave();
  monnify = await fakeMonnify();
  server = await startApp({ env: { ...flw.env, ...monnify.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
  await flw?.close();
  await monnify?.close();
});

const sandbox = { 'bitocard-mode': 'test' };

async function verifiedReseller(options) {
  const reseller = await resellerClient(server, options);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  return reseller;
}

/**
 * A verified Nigerian reseller ready for live reserved accounts: BitoCard's switch on for them, and the owner's BVN
 * checked with Flutterwave (its name matching the verified owner).
 */
async function bvnReseller(options) {
  const reseller = await verifiedReseller(options);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  await prisma.featureSwitch.create({ data: { key: 'reserved_accounts', resellerId: reseller.resellerId, enabled: true } });
  flw.state.bvns['22222222222'] = 'ADA OBI';
  const started = await reseller.browser.post('/v1/account/bvn', { bvn: '22222222222', consent: true });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const check = await prisma.identityVerification.findFirstOrThrow({ where: { resellerId: reseller.resellerId, method: 'bvn' }, orderBy: { createdAt: 'desc' } });
  flw.state.bvnChecks[check.providerReference].status = 'COMPLETED';
  const done = await reseller.browser.get('/v1/account/bvn');
  assert.deepEqual([done.json.status, done.json.verified], ['approved', true], JSON.stringify(done.json));
  return reseller;
}

const flutterwaveWebhook = (body, hash = 'flw-webhook-hash') =>
  fetch(`${server.base}/v1/webhooks/flutterwave`, { method: 'POST', headers: { 'content-type': 'application/json', 'verif-hash': hash }, body: JSON.stringify(body) });

function monnifyWebhook(body, secret = 'monnify-secret') {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha512', secret).update(raw).digest('hex');
  return fetch(`${server.base}/v1/webhooks/monnify`, { method: 'POST', headers: { 'content-type': 'application/json', 'monnify-signature': signature }, body: raw });
}

describe('sandbox top-ups', () => {
  test('a test top-up stays pending until simulated, then credits the wallet once', async () => {
    const { browser } = await resellerClient(server);
    const created = await browser.post('/v1/wallet/top-ups', { amount: 500_000 }, sandbox);
    assert.equal(created.status, 201);
    assert.deepEqual([created.json.status, created.json.mode, created.json.currency], ['pending', 'test', 'NGN']);
    assert.match(created.json.checkout_url, /\/sandbox\/checkout\/bc_top_/);
    assert.equal(flw.calls.filter(c => c.url === '/payments').length, 0, 'the sandbox never calls a provider');

    const paid = await browser.post(`/v1/wallet/top-ups/${created.json.id}/simulate`, { outcome: 'succeeded' }, sandbox);
    assert.deepEqual([paid.status, paid.json.status, paid.json.checkout_url], [200, 'succeeded', null]);
    await browser.post(`/v1/wallet/top-ups/${created.json.id}/simulate`, { outcome: 'succeeded' }, sandbox);
    await browser.post(`/v1/wallet/top-ups/${created.json.id}/simulate`, { outcome: 'failed' }, sandbox);

    assert.equal((await browser.get('/v1/wallet', sandbox)).json.available, 500_000);
    assert.equal((await browser.get('/v1/wallet')).json.available, 0, 'live wallet untouched');
    const [txn] = (await browser.get('/v1/wallet/transactions', sandbox)).json.data;
    assert.deepEqual([txn.type, txn.amount], ['top_up', 500_000]);
    assert.equal((await browser.get(`/v1/wallet/top-ups/${created.json.id}`, sandbox)).json.status, 'succeeded');
  });

  test('a failed simulation credits nothing', async () => {
    const { browser } = await resellerClient(server);
    const { json } = await browser.post('/v1/wallet/top-ups', { amount: 10_000 }, sandbox);
    const failed = await browser.post(`/v1/wallet/top-ups/${json.id}/simulate`, { outcome: 'failed' }, sandbox);
    assert.deepEqual([failed.json.status, failed.json.failure_reason], ['failed', 'Simulated failure.']);
    assert.equal((await browser.get('/v1/wallet', sandbox)).json.available, 0);
  });

  test('amounts are validated, simulations are test-only, and keys need wallet:write', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.post('/v1/wallet/top-ups', { amount: 99 }, sandbox)).json.error.param, 'amount');
    assert.equal((await browser.post('/v1/wallet/top-ups', { amount: 1000, return_url: 'http://insecure.test' }, sandbox)).json.error.param, 'return_url');
    const { json } = await browser.post('/v1/wallet/top-ups', { amount: 1000 }, sandbox);
    assert.equal((await browser.post(`/v1/wallet/top-ups/${json.id}/simulate`, { outcome: 'succeeded' })).json.error.code, 'livemode_not_allowed');

    const readOnly = (await browser.post('/v1/api-keys', { name: 'Read', mode: 'test', scopes: ['wallet:read'] })).json.secret;
    const full = (await browser.post('/v1/api-keys', { name: 'Full', mode: 'test' })).json.secret;
    const topUp = secret =>
      fetch(`${server.base}/v1/wallet/top-ups`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'idempotency-key': `k-${secret.slice(-8)}` },
        body: JSON.stringify({ amount: 2000 }),
      });
    assert.equal((await topUp(readOnly)).status, 403);
    assert.equal((await topUp(full)).status, 201);
  });
});

describe('live top-ups through Flutterwave', () => {
  test('live top-ups need a verified business', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.post('/v1/wallet/top-ups', { amount: 10_000 })).json.error.code, 'reseller_not_verified');
  });

  test('the webhook is re-checked with Flutterwave, credits once and records the fee', async () => {
    const { browser, resellerId } = await verifiedReseller();
    const created = await browser.post('/v1/wallet/top-ups', { amount: 1_000_000, return_url: 'https://ada.example/wallet' });
    assert.equal(created.status, 201);
    assert.match(created.json.checkout_url, /^https:\/\/checkout\.flutterwave\.test\/pay\//);
    const call = flw.calls.findLast(c => c.url === '/payments');
    assert.deepEqual([call.body.amount, call.body.currency, call.body.redirect_url, call.headers.authorization], ['10000.00', 'NGN', 'https://ada.example/wallet', 'Bearer FLWSECK_TEST-fake']);
    const reference = call.body.tx_ref;

    assert.equal((await browser.get(`/v1/wallet/top-ups/${created.json.id}`)).json.status, 'pending', 'nothing paid yet');

    flw.state.charges[reference] = { id: 9001, status: 'successful', amount: 10000, currency: 'NGN', app_fee: 140 };
    // The webhook body is not trusted: even a wrong amount in it changes nothing.
    const res = await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9001, tx_ref: reference, amount: 99999999, status: 'successful' } });
    assert.equal(res.status, 200);
    assert.equal((await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9001 } })).status, 200);

    const wallet = (await browser.get('/v1/wallet')).json;
    assert.equal(wallet.available, 1_000_000, 'the reseller gets the full amount; the fee is BitoCard’s cost');
    assert.equal((await browser.get(`/v1/wallet/top-ups/${created.json.id}`)).json.status, 'succeeded');
    const fees = await prisma.ledgerAccount.findFirst({ where: { kind: 'processing_fees', ownerKey: 'provider:flutterwave', mode: 'live', currency: 'NGN' } });
    assert.ok(fees.balanceMinor >= 14_000n);
    assert.equal((await prisma.journalEntry.count({ where: { resellerId, type: 'top_up' } })), 1);
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });

  test('webhooks without the secret hash are refused', async () => {
    assert.equal((await flutterwaveWebhook({ event: 'charge.completed', data: { id: 1 } }, 'wrong')).status, 401);
    assert.equal((await fetch(`${server.base}/v1/webhooks/flutterwave`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  });

  test('a top-up without a webhook is settled by requerying', async () => {
    const { browser } = await verifiedReseller();
    const { json } = await browser.post('/v1/wallet/top-ups', { amount: 250_000 });
    const reference = flw.calls.findLast(c => c.url === '/payments').body.tx_ref;
    flw.state.charges[reference] = { id: 9002, status: 'successful', amount: 2500, currency: 'NGN', app_fee: 35 };
    assert.equal((await browser.get(`/v1/wallet/top-ups/${json.id}`)).json.status, 'succeeded');
    assert.equal((await browser.get('/v1/wallet')).json.available, 250_000);
  });

  test('the scheduled job requeries pending top-ups; it needs the cron secret', async () => {
    const { browser, resellerId } = await verifiedReseller();
    const { json } = await browser.post('/v1/wallet/top-ups', { amount: 300_000 });
    const reference = flw.calls.findLast(c => c.url === '/payments').body.tx_ref;
    flw.state.charges[reference] = { id: 9003, status: 'successful', amount: 3000, currency: 'NGN', app_fee: 0 };
    await prisma.payment.update({ where: { id: json.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });

    assert.equal((await fetch(`${server.base}/v1/cron/payments`)).status, 401);
    assert.equal((await fetch(`${server.base}/v1/cron/payments`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const run = await fetch(`${server.base}/v1/cron/payments`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal(run.status, 200);
    assert.ok((await run.json()).result.top_ups.settled >= 1);
    const wallet = await prisma.ledgerAccount.findFirst({ where: { resellerId, kind: 'reseller_funding', mode: 'live' } });
    assert.equal(wallet.balanceMinor, 300_000n);
  });

  test('a payment that does not match the top-up is not credited', async () => {
    const { browser } = await verifiedReseller();
    const { json } = await browser.post('/v1/wallet/top-ups', { amount: 400_000 });
    const reference = flw.calls.findLast(c => c.url === '/payments').body.tx_ref;
    flw.state.charges[reference] = { id: 9004, status: 'successful', amount: 40, currency: 'NGN', app_fee: 0 };
    await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9004 } });
    const topUp = (await browser.get(`/v1/wallet/top-ups/${json.id}`)).json;
    assert.equal(topUp.status, 'failed');
    assert.match(topUp.failure_reason, /did not match/);
    assert.equal((await browser.get('/v1/wallet')).json.available, 0);
  });

  test('a failed payment is recorded as failed', async () => {
    const { browser } = await verifiedReseller();
    const { json } = await browser.post('/v1/wallet/top-ups', { amount: 50_000 });
    const reference = flw.calls.findLast(c => c.url === '/payments').body.tx_ref;
    flw.state.charges[reference] = { id: 9005, status: 'failed', amount: 500, currency: 'NGN', processor_response: 'Insufficient funds' };
    await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9005 } });
    const topUp = (await browser.get(`/v1/wallet/top-ups/${json.id}`)).json;
    assert.deepEqual([topUp.status, topUp.failure_reason], ['failed', 'Insufficient funds']);
  });

  test('Kenya top-ups also use Flutterwave, in shillings', async () => {
    const { browser } = await verifiedReseller({ country: 'KE' });
    const created = await browser.post('/v1/wallet/top-ups', { amount: 100_000 });
    assert.equal(created.json.currency, 'KES');
    assert.equal(flw.calls.findLast(c => c.url === '/payments').body.currency, 'KES');
  });
});

describe('reserved bank accounts', () => {
  test('sandbox: create once, then simulated transfers credit the test wallet', async () => {
    const { browser } = await resellerClient(server);
    const created = await browser.post('/v1/wallet/reserved-accounts', {}, sandbox);
    assert.equal(created.status, 201);
    const [account] = created.json.data;
    assert.deepEqual([account.bank_name, account.account_name, account.mode], ['Sandbox Bank', 'Ada Digital', 'test']);
    assert.equal((await browser.post('/v1/wallet/reserved-accounts', {}, sandbox)).json.data[0].id, account.id, 'asking again returns the same account');

    const deposit = await browser.post(`/v1/wallet/reserved-accounts/${account.id}/simulate-deposit`, { amount: 70_000 }, sandbox);
    assert.equal(deposit.json.credited, true);
    assert.equal((await browser.get('/v1/wallet', sandbox)).json.available, 70_000);
    const [txn] = (await browser.get('/v1/wallet/transactions', sandbox)).json.data;
    assert.deepEqual([txn.type, txn.amount], ['deposit', 70_000]);
  });

  test('not offered where the country has no reserved accounts', async () => {
    const { browser } = await resellerClient(server, { country: 'KE' });
    assert.equal((await browser.post('/v1/wallet/reserved-accounts', {}, sandbox)).json.error.code, 'reserved_accounts_unavailable');
  });

  test('live: Flutterwave first, with the checked BVN passed to the bank and then erased', async () => {
    const { browser, resellerId } = await bvnReseller();
    const held = await prisma.identityVerification.findFirstOrThrow({ where: { resellerId, method: 'bvn' } });
    assert.ok(held.secretEncrypted && !held.secretEncrypted.includes('22222222222'), 'held encrypted until the accounts exist');
    const created = await browser.post('/v1/wallet/reserved-accounts');
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.data[0].bank_name, 'Wema Bank');
    assert.equal(flw.calls.findLast(c => c.url === '/virtual-account-numbers').body.bvn, '22222222222');
    assert.equal((await prisma.identityVerification.findUniqueOrThrow({ where: { id: held.id } })).secretEncrypted, null, 'erased once the bank has it');
    const stored = JSON.stringify([await prisma.reservedAccount.findMany({ where: { resellerId } }), await prisma.identityVerification.findMany({ where: { resellerId } })]);
    assert.ok(!stored.includes('22222222222'));
  });

  test('live: off until BitoCard switches them on for the reseller', async () => {
    const { browser } = await verifiedReseller();
    const res = await browser.post('/v1/wallet/reserved-accounts');
    assert.deepEqual([res.status, res.json.error.code], [409, 'reserved_accounts_not_enabled']);
  });

  test('live, Nigeria: the owner must pass the BVN check first, and its name must match the verified owner', async () => {
    const reseller = await verifiedReseller();
    await prisma.featureSwitch.create({ data: { key: 'reserved_accounts', resellerId: reseller.resellerId, enabled: true } });
    assert.equal((await reseller.browser.post('/v1/wallet/reserved-accounts')).json.error.code, 'bvn_check_required');
    // Not before the identity check (the BVN is matched to the verified owner).
    assert.equal((await reseller.browser.post('/v1/account/bvn', { bvn: '44444444444', consent: true })).json.error.code, 'verification_required');
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
    assert.equal((await reseller.browser.post('/v1/account/bvn', { bvn: '44444444444', consent: false })).json.error.code, 'consent_required');

    flw.state.bvns['44444444444'] = 'SOMEONE ELSE';
    const started = await reseller.browser.post('/v1/account/bvn', { bvn: '44444444444', consent: true });
    assert.equal(started.json.status, 'in_progress');
    assert.match(started.json.url, /nibss-consent/);
    assert.equal(flw.calls.findLast(c => c.url === '/bvn/verifications').body.redirect_url, 'https://shq.bitocard.com/wallet/reserved-accounts');
    const check = await prisma.identityVerification.findFirstOrThrow({ where: { resellerId: reseller.resellerId, method: 'bvn' } });
    flw.state.bvnChecks[check.providerReference].status = 'COMPLETED';
    const declined = (await reseller.browser.get('/v1/account/bvn')).json;
    assert.deepEqual([declined.status, declined.reason, declined.verified], ['declined', 'name_mismatch', false]);
    assert.equal((await prisma.identityVerification.findUniqueOrThrow({ where: { id: check.id } })).secretEncrypted, null, 'a failed check keeps no BVN');
    assert.equal((await reseller.browser.post('/v1/wallet/reserved-accounts')).json.error.code, 'bvn_check_required');
    // The owner's document check is not affected by the BVN check.
    assert.equal((await reseller.browser.get('/v1/account/verification')).json.status, 'not_started');
    assert.equal((await prisma.reseller.findUniqueOrThrow({ where: { id: reseller.resellerId } })).status, 'active');
  });

  test('live: only the owner starts the BVN check', async () => {
    const owner = await verifiedReseller();
    const person = await resellerClient(server);
    await prisma.resellerMember.create({ data: { resellerId: owner.resellerId, userId: person.userId, role: 'finance' } });
    const res = await person.browser.post('/v1/account/bvn', { bvn: '22222222222', consent: true }, { 'bitocard-reseller': owner.resellerId });
    assert.equal(res.status, 403);
  });

  test('bank transfers into reserved accounts are listed with top-ups', async () => {
    const { browser } = await resellerClient(server);
    const [account] = (await browser.post('/v1/wallet/reserved-accounts', {}, sandbox)).json.data;
    await browser.post(`/v1/wallet/reserved-accounts/${account.id}/simulate-deposit`, { amount: 40_000 }, sandbox);
    const listed = (await browser.get('/v1/wallet/top-ups', sandbox)).json.data;
    assert.deepEqual([listed[0].source, listed[0].status, listed[0].amount], ['bank_transfer', 'succeeded', 40_000]);
  });

  test('live: Monnify takes over when Flutterwave fails; both failing is reported', async () => {
    flw.state.fail['/virtual-account-numbers'] = 500;
    try {
      const first = await bvnReseller();
      const created = await first.browser.post('/v1/wallet/reserved-accounts');
      assert.equal(created.json.data[0].bank_name, 'Moniepoint MFB');
      assert.equal(monnify.calls.findLast(c => c.url === '/api/v2/bank-transfer/reserved-accounts').headers.authorization, 'Bearer monnify-token');

      monnify.state.down = true;
      const second = await bvnReseller();
      const failed = await second.browser.post('/v1/wallet/reserved-accounts');
      assert.deepEqual([failed.status, failed.json.error.code], [502, 'provider_error']);
    } finally {
      delete flw.state.fail['/virtual-account-numbers'];
      monnify.state.down = false;
    }
  });

  test('live: Flutterwave transfers into the account credit the wallet exactly once', async () => {
    const { browser, resellerId } = await bvnReseller();
    await browser.post('/v1/wallet/reserved-accounts');
    const account = await prisma.reservedAccount.findFirst({ where: { resellerId, provider: 'flutterwave' } });
    flw.state.charges[account.providerReference] = { id: 9100, status: 'successful', amount: 25000, currency: 'NGN', app_fee: 50 };
    await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9100 } });
    await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9100 } });
    assert.equal((await browser.get('/v1/wallet')).json.available, 2_500_000);
  });

  test('live: Monnify deposits are signature-checked, re-read from Monnify and credited once', async () => {
    flw.state.fail['/virtual-account-numbers'] = 500;
    let reseller;
    try {
      reseller = await bvnReseller();
      await reseller.browser.post('/v1/wallet/reserved-accounts');
    } finally {
      delete flw.state.fail['/virtual-account-numbers'];
    }
    const account = await prisma.reservedAccount.findFirst({ where: { resellerId: reseller.resellerId, provider: 'monnify' } });
    monnify.state.transactions['MNFY|TX|1'] = {
      transactionReference: 'MNFY|TX|1',
      paymentStatus: 'PAID',
      amountPaid: '12000.00',
      settlementAmount: '11950.00',
      currencyCode: 'NGN',
      product: { type: 'RESERVED_ACCOUNT', reference: account.providerReference },
    };
    const event = { eventType: 'SUCCESSFUL_TRANSACTION', eventData: { transactionReference: 'MNFY|TX|1', product: { type: 'RESERVED_ACCOUNT', reference: account.providerReference } } };
    assert.equal((await monnifyWebhook(event, 'not-the-secret')).status, 401);
    assert.equal((await monnifyWebhook(event)).status, 200);
    assert.equal((await monnifyWebhook(event)).status, 200);
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 1_200_000);
  });

  test('a transfer to an unknown account is acknowledged but credits no one', async () => {
    flw.state.charges['not-ours'] = { id: 9200, status: 'successful', amount: 100, currency: 'NGN', app_fee: 0 };
    const res = await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9200 } });
    assert.deepEqual([res.status, (await res.json()).reason], [200, 'unknown_account']);
  });
});
