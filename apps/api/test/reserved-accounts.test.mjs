// Static (reserved) bank account numbers on Flutterwave, live in Nigeria and Ghana: what the bank is asked for, a
// request written and claimed before each call (so a reply lost after the bank opened the account still has its owner
// on record and transfers into it are credited), finance told about money no wallet can take, the sweep that credits
// transfers whose notification never came, and the admin list.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { fakeFlutterwave, fakeMonnify } from './fakes.mjs';
import { adminClient, client, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let flw;
let monnify;
let prisma;
let finance;
let paystack;
const paystackKey = 'sk_live_dva_test';
const paystackCustomers = new Map();
const paystackAccounts = new Map();
const paystackTransfers = new Map();
let paystackReply = 'success';

before(async () => {
  flw = await fakeFlutterwave();
  monnify = await fakeMonnify();
  paystack = await fakeService(call => {
    if (call.headers.authorization !== `Bearer ${paystackKey}`) return { status: 401 };
    const url = new URL(call.url, 'http://fake');
    const data = value => ({ body: { status: true, data: value } });
    if (url.pathname === '/customer' && call.method === 'POST') {
      const id = paystackCustomers.size + 1;
      const customer = { id, customer_code: `CUS_customer${id}`, email: call.body.email };
      paystackCustomers.set(customer.email, customer);
      return data(customer);
    }
    if (url.pathname.startsWith('/customer/')) {
      const identifier = decodeURIComponent(url.pathname.slice('/customer/'.length));
      const customer = paystackCustomers.get(identifier) ?? [...paystackCustomers.values()].find(row => row.customer_code === identifier);
      return customer ? data(customer) : { status: 404, body: { status: false, message: 'Customer not found' } };
    }
    if (url.pathname === '/dedicated_account' && call.method === 'GET') {
      const account = paystackAccounts.get(Number(url.searchParams.get('customer')));
      return data(account ? [account] : []);
    }
    if (url.pathname === '/dedicated_account' && call.method === 'POST') {
      if (paystackReply === 'refused') return { status: 422, body: { status: false, message: 'Account not assigned' } };
      const customer = [...paystackCustomers.values()].find(row => row.customer_code === call.body.customer);
      const account = { id: customer.id, account_number: String(1000000000 + customer.id), bank: { name: 'Paystack Bank' }, account_name: 'Ada Obi', currency: 'NGN', active: true, assigned: true, customer };
      paystackAccounts.set(customer.id, account);
      return paystackReply === 'lost' ? { status: 503, body: { status: false, message: 'Try again later' } } : data(account);
    }
    if (url.pathname.startsWith('/transaction/verify/')) {
      const transfer = paystackTransfers.get(decodeURIComponent(url.pathname.split('/').at(-1)));
      return transfer ? data(transfer) : { status: 404 };
    }
    return { status: 404 };
  });
  server = await startApp({ env: { ...flw.env, ...monnify.env, CRON_SECRET: 'cron-secret', PAYSTACK_SECRET_KEY: paystackKey, PAYSTACK_API_URL: paystack.url } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  finance = await adminClient(server, ['finance']);
  await prisma.country.update({ where: { code: 'GH' }, data: { reservedAccounts: true } });
});

after(async () => {
  await server?.close();
  await flw?.close();
  await monnify?.close();
  await paystack?.close();
});

const flutterwaveWebhook = body =>
  fetch(`${server.base}/v1/webhooks/flutterwave`, { method: 'POST', headers: { 'content-type': 'application/json', 'verif-hash': 'flw-webhook-hash' }, body: JSON.stringify(body) });
const cron = job => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } }).then(async res => (await res.json()).result);
const lastAsk = () => flw.calls.findLast(call => call.url === '/virtual-account-numbers').body;
const referenceOf = resellerId => `bc_ra_live_${resellerId.replaceAll('-', '')}`;

/** An active, verified reseller with BitoCard's switch on; in Nigeria the owner's BVN checked with Flutterwave. */
async function liveReseller(options = {}) {
  const reseller = await resellerClient(server, options);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: options.verifiedName ?? 'Ada Obi' } });
  await prisma.featureSwitch.create({ data: { key: 'reserved_accounts', resellerId: reseller.resellerId, enabled: true } });
  if ((options.country ?? 'NG') === 'NG') {
    flw.state.bvns['22222222222'] = 'ADA OBI';
    assert.equal((await reseller.browser.post('/v1/account/bvn', { bvn: '22222222222', consent: true })).status, 201);
    const check = await prisma.identityVerification.findFirstOrThrow({ where: { resellerId: reseller.resellerId, method: 'bvn' }, orderBy: { createdAt: 'desc' } });
    flw.state.bvnChecks[check.providerReference].status = 'COMPLETED';
    assert.equal((await reseller.browser.get('/v1/account/bvn')).json.status, 'approved');
  }
  return reseller;
}

describe('opening static accounts live', () => {
  test('Nigeria: a permanent NGN account under our reference, with the BVN, a clean narration and the name the bank shows', async () => {
    const { browser, resellerId } = await liveReseller({ business: 'Adé & Sons Ltd — Lagos Branch Office International' });
    const created = await browser.post('/v1/wallet/reserved-accounts');
    assert.equal(created.status, 201, JSON.stringify(created.json));

    const ask = lastAsk();
    assert.deepEqual([ask.currency, ask.is_permanent, ask.tx_ref, ask.bvn], ['NGN', true, referenceOf(resellerId), '22222222222']);
    assert.equal(ask.narration, 'Ade & Sons Ltd Lagos Branch Office');
    assert.ok(ask.narration.length <= 35);

    const [account] = created.json.data;
    assert.deepEqual([account.bank_name, account.account_name], ['Wema Bank', 'Ade & Sons Ltd Lagos Branch Office FLW']);
    const stored = await prisma.reservedAccount.findFirstOrThrow({ where: { resellerId } });
    assert.equal(stored.providerAccountId, flw.state.virtualAccounts[stored.accountNumber].order_ref, "Flutterwave's order_ref is kept");
    const request = await prisma.reservedAccountRequest.findUniqueOrThrow({ where: { provider_reference: { provider: 'flutterwave', reference: referenceOf(resellerId) } } });
    assert.deepEqual([request.status, request.attempts, request.claimedAt, request.lastError], ['active', 1, null, null]);
    const bvn = await prisma.identityVerification.findFirstOrThrow({ where: { resellerId, method: 'bvn' } });
    assert.equal(bvn.secretEncrypted, null, 'the BVN is erased once the bank has it');
  });

  test("Ghana: a permanent GHS account in the verified owner's names and a Ghanaian phone, never a BVN", async () => {
    const { browser, resellerId } = await liveReseller({ country: 'GH', verifiedName: 'Kofi Ama Mensah' });
    const created = await browser.post('/v1/wallet/reserved-accounts', { phone: '024 123 4567' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const ask = lastAsk();
    assert.deepEqual(
      [ask.currency, ask.is_permanent, ask.firstname, ask.lastname, ask.phonenumber, ask.tx_ref, 'bvn' in ask],
      ['GHS', true, 'Kofi', 'Ama Mensah', '+233241234567', referenceOf(resellerId), false],
    );
    assert.deepEqual([created.json.data[0].bank_name, created.json.data[0].currency], ['First Bank Ghana', 'GHS']);
  });

  test('Ghana: without a Ghanaian phone the account is not asked for', async () => {
    const { browser } = await liveReseller({ country: 'GH', verifiedName: 'Esi Owusu' });
    const calls = flw.calls.length;
    const res = await browser.post('/v1/wallet/reserved-accounts', { phone: '+2348012345678' });
    assert.deepEqual([res.status, res.json.error.param], [400, 'phone']);
    assert.equal(flw.calls.length, calls, 'nothing is sent to the bank');
  });
});

describe('a reply lost after the bank opened the account', () => {
  test('transfers into it are still credited, and asking again opens it under the same reference', async () => {
    const { browser, resellerId } = await liveReseller();
    monnify.state.down = true;
    flw.state.loseReply = true;
    try {
      const failed = await browser.post('/v1/wallet/reserved-accounts');
      assert.deepEqual([failed.status, failed.json.error.code], [502, 'provider_error']);
    } finally {
      monnify.state.down = false;
    }
    assert.equal(await prisma.reservedAccount.count({ where: { resellerId } }), 0, 'no number reached us');
    const request = await prisma.reservedAccountRequest.findUniqueOrThrow({ where: { provider_reference: { provider: 'flutterwave', reference: referenceOf(resellerId) } } });
    assert.equal(request.status, 'pending', 'unclear is not refused');
    assert.match(request.lastError, /Bad gateway/);

    // The payer used the number the bank opened: the transfer carries our reference, so it reaches the wallet.
    flw.state.charges[referenceOf(resellerId)] = { id: 9301, status: 'successful', amount: 25000, currency: 'NGN', app_fee: 50 };
    const res = await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9301 } });
    assert.equal((await res.json()).credited, true);
    assert.equal((await browser.get('/v1/wallet')).json.available, 2_500_000);
    const [txn] = (await browser.get('/v1/wallet/transactions')).json.data;
    assert.equal(txn.type, 'deposit');

    const again = await browser.post('/v1/wallet/reserved-accounts');
    assert.equal(again.status, 201, JSON.stringify(again.json));
    assert.equal(lastAsk().tx_ref, referenceOf(resellerId), 'the same reference: every account it opened fills this wallet');
    const settled = await prisma.reservedAccountRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.deepEqual([settled.status, settled.attempts], ['active', 2]);
  });

  test('a request another call is asking for is never asked twice at once', async () => {
    const { browser, resellerId } = await liveReseller();
    await prisma.reservedAccountRequest.create({ data: { provider: 'flutterwave', reference: referenceOf(resellerId), mode: 'live', resellerId, currency: 'NGN', claimedAt: new Date() } });
    await prisma.reservedAccountRequest.create({ data: { provider: 'monnify', reference: referenceOf(resellerId), mode: 'live', resellerId, currency: 'NGN', claimedAt: new Date() } });
    const calls = flw.calls.length;
    const res = await browser.post('/v1/wallet/reserved-accounts');
    assert.deepEqual([res.status, res.json.error.code], [409, 'reserved_account_in_progress']);
    assert.equal(flw.calls.length, calls, 'Flutterwave is not asked again while the claim holds');
  });
});

describe('money no wallet can take', () => {
  test('a transfer naming no BitoCard account is acknowledged, credits no one, and finance is told once', async () => {
    flw.state.charges['someone-elses-ref'] = { id: 9302, status: 'successful', amount: 4000, currency: 'NGN', app_fee: 0 };
    for (let i = 0; i < 2; i++) {
      const res = await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9302 } });
      assert.deepEqual([res.status, (await res.json()).reason], [200, 'unknown_account']);
    }
    const told = await prisma.notification.findMany({ where: { type: 'admin.reserved_account.unmatched_deposit', userId: finance.admin.id } });
    assert.equal(told.length, 1, 'once per transaction');
    assert.match(told[0].body, /9302/);
  });
});

describe('transfers whose notification never came', () => {
  test('the payments job finds them at Flutterwave and credits each once', async () => {
    const { browser, resellerId } = await liveReseller();
    assert.equal((await browser.post('/v1/wallet/reserved-accounts')).status, 201);
    flw.state.pageSize = 2;
    flw.state.charges[referenceOf(resellerId)] = { id: 9401, status: 'successful', amount: 12000, currency: 'NGN', app_fee: 0 };
    flw.state.charges['bc_ra_live_failed'] = { id: 9402, status: 'failed', amount: 1, currency: 'NGN', app_fee: 0 };

    const first = await cron('payments');
    assert.equal(first.reserved_deposits.credited, 1, JSON.stringify(first));
    assert.ok(first.reserved_deposits.pages > 1, 'every page is read');
    assert.equal((await browser.get('/v1/wallet')).json.available, 1_200_000);

    const second = await cron('payments');
    assert.deepEqual([second.reserved_deposits.credited, second.reserved_deposits.checked], [0, 0], 'already credited: not even re-read');
    // A late notification for it changes nothing either.
    await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9401 } });
    assert.equal((await browser.get('/v1/wallet')).json.available, 1_200_000);
  });
});

describe('admins', () => {
  test('list every request with its owner and numbers, and sweep on demand (audited)', async () => {
    const { browser, business } = await liveReseller({ business: 'Listed Wallet Ltd' });
    const [account] = (await browser.post('/v1/wallet/reserved-accounts')).json.data;

    const found = await finance.get(`/v1/admin/reserved-accounts?q=${account.account_number}`);
    assert.equal(found.status, 200, JSON.stringify(found.json));
    assert.equal(found.json.data.length, 1);
    const [row] = found.json.data;
    assert.deepEqual([row.status, row.owner.type, row.owner.name, row.accounts[0].account_number], ['active', 'reseller', business ?? 'Listed Wallet Ltd', account.account_number]);

    const pending = await finance.get('/v1/admin/reserved-accounts?status=pending&mode=live');
    assert.ok(pending.json.data.every(item => item.status === 'pending') && pending.json.data.length >= 1, 'the claimed request above is pending');

    const support = await adminClient(server, ['support']);
    assert.equal((await support.get('/v1/admin/reserved-accounts')).status, 200);
    assert.equal((await support.post('/v1/admin/reserved-accounts/sweep')).status, 403);
    const swept = await finance.post('/v1/admin/reserved-accounts/sweep');
    assert.equal(swept.status, 200, JSON.stringify(swept.json));
    assert.equal(swept.json.object, 'reserved_deposit_sweep');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'reserved_accounts.swept' } }));
  });
});

describe('dedicated account provider priority', () => {
  let operations;
  const paystackFirst = ['paystack', 'flutterwave'];
  const reserve = browser => browser.post('/v1/wallet/reserved-accounts', { phone: '+2348031234567' });
  const saves = () => paystack.calls.filter(call => call.method === 'POST' && call.url === '/dedicated_account');
  const notify = async (reference, valid = true) => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference, amount: 1, authorization: { channel: 'dedicated_nuban' } } });
    const signature = createHmac('sha512', valid ? paystackKey : 'bad-key').update(body).digest('hex');
    const response = await fetch(`${server.base}/v1/webhooks/paystack`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': signature }, body });
    return { status: response.status, data: await response.json() };
  };
  before(async () => {
    operations = await adminClient(server, ['operations']);
    const path = '/v1/admin/countries/NG';
    assert.equal((await finance.patch(path, { dva_gateway_priority: paystackFirst })).status, 403);
    assert.equal((await operations.patch(path, { dva_gateway_priority: ['paystack', 'paystack'] })).status, 400);
    const saved = await operations.patch(path, { dva_gateway_priority: paystackFirst });
    assert.deepEqual([saved.status, saved.json.dva_gateway_priority], [200, paystackFirst]);
  });

  test('Paystack issues once and its verified deposit credits the correct wallet once', async () => {
    const { browser, resellerId } = await liveReseller();
    const created = await reserve(browser);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const account = await prisma.reservedAccount.findFirstOrThrow({ where: { resellerId } });
    assert.equal(account.provider, 'paystack');
    const request = await prisma.reservedAccountRequest.findFirstOrThrow({ where: { resellerId, provider: 'paystack' } });
    assert.match(request.providerCustomerId, /^CUS_/);
    assert.equal(saves().at(-1).body.phone, '+2348031234567');
    assert.equal(saves().at(-1).body.preferred_bank, 'wema-bank', 'live Nigerian accounts explicitly prefer Wema Bank');
    assert.equal(saves().at(-1).body.bvn, undefined);
    const calls = saves().length;
    const again = await reserve(browser);
    assert.equal(again.json.data[0].account_number, account.accountNumber);
    assert.equal(saves().length, calls);

    const ref = 'dva.transfer.1';
    const transfer = {
      id: 99128, reference: ref, status: 'success', amount: 180000, fees: 100, currency: 'NGN', domain: 'live',
      authorization: { channel: 'dedicated_nuban', receiver_bank_account_number: account.accountNumber },
      customer: { customer_code: request.providerCustomerId },
    };
    paystackTransfers.set(ref, { ...transfer, authorization: { ...transfer.authorization, receiver_bank_account_number: '9999999999' } });
    assert.equal((await notify(ref, false)).status, 401);
    assert.equal((await notify(ref)).data.reason, 'unknown_account');
    assert.equal((await browser.get('/v1/wallet')).json.available, 0);
    paystackTransfers.set(ref, transfer);
    assert.equal((await notify(ref)).data.credited, true);
    assert.equal((await notify(ref)).data.reason, 'duplicate');
    assert.equal((await browser.get('/v1/wallet')).json.available, transfer.amount);
    const funding = (await finance.get(`/v1/admin/fundings?reseller_id=${resellerId}&source=static_account`)).json.data.find(item => item.reference === ref);
    assert.deepEqual([funding.source, funding.status, funding.static_account.account_number, funding.amount], ['static_account', 'succeeded', account.accountNumber, transfer.amount]);
  });

  test('falls back on a definite refusal, and uses the new order the next time', async () => {
    const { browser, resellerId } = await liveReseller();
    paystackReply = 'refused';
    try {
      assert.equal((await reserve(browser)).status, 201);
      assert.equal((await prisma.reservedAccount.findFirstOrThrow({ where: { resellerId } })).provider, 'flutterwave');
    } finally {
      paystackReply = 'success';
    }
    const path = '/v1/admin/countries/NG';
    assert.equal((await operations.patch(path, { dva_gateway_priority: ['flutterwave', 'paystack'] })).status, 200);
    try {
      const next = await liveReseller();
      const calls = saves().length;
      assert.equal((await reserve(next.browser)).status, 201);
      assert.equal(saves().length, calls);
    } finally {
      await operations.patch(path, { dva_gateway_priority: paystackFirst });
    }
  });

  test('a confirmed storefront customer gets a Paystack account for their own wallet', async () => {
    const shopper = client(server.base, { autoIdempotency: true });
    const email = 'paystack-dva-shopper@example.com';
    const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery', country: 'NG' });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    const session = { 'bitocard-customer-session': signup.json.session.token };
    const accountPath = '/v1/store/wallet/reserved-accounts';
    const payload = { bvn: '22222222222', phone: '+2348031234567' };
    assert.equal((await shopper.post(accountPath, payload, session)).status, 403);
    assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) }, session)).status, 200);
    const opened = await shopper.post(accountPath, payload, session);
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    const id = signup.json.customer.id;
    const account = await prisma.reservedAccount.findFirstOrThrow({ where: { customerId: id } });
    assert.equal(account.provider, 'paystack');
    const request = await prisma.reservedAccountRequest.findFirstOrThrow({ where: { customerId: id, provider: 'paystack' } });
    const ref = 'dva.customer.transfer.1';
    paystackTransfers.set(ref, { id: 99129, reference: ref, status: 'success', amount: 24600, currency: 'NGN', domain: 'live',
      authorization: { channel: 'dedicated_nuban', receiver_bank_account_number: account.accountNumber },
      customer: { customer_code: request.providerCustomerId } });
    assert.equal((await notify(ref)).data.credited, true);
    assert.equal((await shopper.get('/v1/store/wallet', session)).json.balance, 24600);
  });

  test('looks up a lost Paystack assignment before trying another provider', async () => {
    const { browser, resellerId } = await liveReseller();
    const path = '/v1/admin/countries/NG';
    paystackReply = 'lost';
    try {
      const pending = await reserve(browser);
      assert.deepEqual([pending.status, pending.json.error.code], [409, 'reserved_account_in_progress']);
      assert.equal(await prisma.reservedAccountRequest.count({ where: { resellerId, provider: 'flutterwave' } }), 0);
      assert.equal((await operations.patch(path, { dva_gateway_priority: ['flutterwave', 'paystack'] })).status, 200);
      const calls = saves().length;
      assert.equal((await reserve(browser)).status, 201);
      assert.equal(saves().length, calls);
      assert.equal((await prisma.reservedAccount.findFirstOrThrow({ where: { resellerId } })).provider, 'paystack');
    } finally {
      paystackReply = 'success';
      await operations.patch(path, { dva_gateway_priority: paystackFirst });
    }
  });
});
