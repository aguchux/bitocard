// Payment methods per market (wallet top-ups and customer checkout), the Stripe, pawaPay and Monnify payment pages,
// store customer accounts, and checkout on bitocard.com: a customer pays first, the order is placed only once the
// payment is confirmed, its cost is held from what they paid, and a failed order refunds them to how they paid.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { fakeFlutterwave, fakeMonnify, fakePawapay, fakeStripe } from './fakes.mjs';

const { EmailService } = await import('../dist/notifications/email.service.js');

let server;
let admin;
let prisma;
let stripe;
let pawapay;
let monnify;
let flw;

before(async () => {
  [stripe, pawapay, monnify, flw] = await Promise.all([fakeStripe(), fakePawapay(), fakeMonnify(), fakeFlutterwave()]);
  server = await startApp({ env: { ...stripe.env, ...pawapay.env, ...monnify.env, ...flw.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  // Paying at checkout (customer wallets, on by default, are tested in customer-wallets.test.mjs).
  await prisma.featureSwitch.create({ data: { key: 'customer_wallets', enabled: false } });
  admin = await adminClient(server);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await prisma.countryCategory.upsert({
    where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } },
    create: { countryCode: 'NG', category: 'gift_cards', enabled: true },
    update: { enabled: true, customerVerification: false },
  });
});

after(async () => {
  await server?.close();
  await Promise.all([stripe?.close(), pawapay?.close(), monnify?.close(), flw?.close()]);
});

async function verifiedReseller(options) {
  const reseller = await resellerClient(server, options);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  return reseller;
}

const setMethods = (country, purpose, enabled) => admin.put(`/v1/admin/countries/${country}/payment-methods`, { purpose, enabled });

const balance = async (resellerId, mode, kind) => (await prisma.ledgerAccount.findFirst({ where: { resellerId, mode, kind } }))?.balanceMinor ?? 0n;

function stripeWebhook(body, secret = 'whsec_fake', at = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(`${at}.${raw}`).digest('hex');
  return fetch(`${server.base}/v1/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${signature}` }, body: raw });
}

const sessionPaid = id => ({ type: 'checkout.session.completed', data: { object: { id, object: 'checkout.session' } } });

describe('payment methods per market', () => {
  test('admins choose and order each market’s methods; resellers see only those switched on and set up', async () => {
    const listed = await admin.get('/v1/admin/countries/NG/payment-methods');
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    const top = listed.json.wallet_top_up;
    assert.deepEqual(top.filter(row => row.enabled).map(row => row.gateway), ['flutterwave'], 'Flutterwave top-ups as before');
    assert.ok(top.every(row => row.configured), 'every fake gateway is set up');
    assert.deepEqual(listed.json.checkout.filter(row => row.enabled), [], 'checkout methods start switched off');

    const reseller = await verifiedReseller();
    assert.deepEqual((await reseller.browser.get('/v1/wallet/payment-methods')).json.data.map(method => method.id), ['flutterwave']);

    const set = await setMethods('NG', 'wallet_top_up', ['stripe', 'flutterwave', 'monnify']);
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual(set.json.wallet_top_up.filter(row => row.enabled).map(row => row.gateway), ['stripe', 'flutterwave', 'monnify']);
    const methods = (await reseller.browser.get('/v1/wallet/payment-methods')).json.data;
    assert.deepEqual(methods.map(method => [method.id, method.label]), [['stripe', 'Card'], ['flutterwave', 'Card, bank or mobile money'], ['monnify', 'Bank transfer or card']]);
    assert.ok(!JSON.stringify(methods).includes('Stripe'), 'payers see what they pay with, not the provider');

    const refused = await reseller.browser.post('/v1/wallet/top-ups', { amount: 500000, method: 'pawapay' });
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [400, 'payment_method_unavailable', 'method']);
    const unknown = await setMethods('NG', 'wallet_top_up', ['paypal']);
    assert.equal(unknown.status, 400);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'country.payment_methods_changed', targetId: 'NG' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual(audit.after, { purpose: 'wallet_top_up', enabled: ['stripe', 'flutterwave', 'monnify'] });

    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/countries/NG/payment-methods', { purpose: 'checkout', enabled: ['stripe'] })).status, 403);
  });

  test('a gateway switched to its sandbox is not offered for live payments', async () => {
    const code = await adminCode(server, admin);
    assert.equal((await admin.put('/v1/admin/integrations/monnify', { values: { MONNIFY_SANDBOX: true }, code })).status, 200);
    const reseller = await verifiedReseller();
    assert.deepEqual((await reseller.browser.get('/v1/wallet/payment-methods')).json.data.map(method => method.id), ['stripe', 'flutterwave']);
    const sandbox = await reseller.browser.get('/v1/wallet/payment-methods', { 'bitocard-mode': 'test' });
    assert.deepEqual(sandbox.json.data.map(method => method.id), ['stripe', 'flutterwave', 'monnify'], 'the sandbox stands in for every method switched on');
    assert.equal((await admin.put('/v1/admin/integrations/monnify', { values: { MONNIFY_SANDBOX: false }, code: await adminCode(server, admin) })).status, 200);
  });
});

describe('wallet top-ups through each gateway', () => {
  test('Stripe cannot take the currency: charged in US dollars, credited in the local amount, and remembered', async () => {
    const { forgetStripeCurrencies } = await import('../dist/payments/stripe.provider.js');
    forgetStripeCurrencies();
    for (const source of ['open_exchange_rates', 'flutterwave']) {
      await prisma.exchangeRate.create({ data: { currency: 'GHS', source, unitsPerUsd: 15, fetchedAt: new Date(Date.now() + 3600_000) } });
    }
    await setMethods('GH', 'wallet_top_up', ['stripe']);
    stripe.state.refuseCurrencies.add('ghs');
    try {
      const reseller = await verifiedReseller({ country: 'GH' });
      const created = await reseller.browser.post('/v1/wallet/top-ups', { amount: 25000, method: 'stripe' });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      assert.deepEqual([created.json.amount, created.json.currency], [25000, 'GHS'], 'the top-up is still GH₵250');
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: created.json.id } });
      // GH₵250 at the receive rate (15 less the 1.5% margin = 14.775 per dollar), rounded up: $16.93.
      assert.deepEqual([payment.amountMinor, payment.currency, payment.chargeAmountMinor, payment.chargeCurrency], [25000n, 'GHS', 1693n, 'USD']);
      const session = stripe.state.sessions[payment.providerTransactionId];
      assert.deepEqual([session.fields['line_items[0][price_data][currency]'], session.fields['line_items[0][price_data][unit_amount]']], ['usd', '1693']);
      assert.deepEqual(stripe.state.attempts.slice(-2), ['ghs', 'usd'], 'tried cedis first, then dollars');

      Object.assign(session, { status: 'complete', payment_status: 'paid' });
      stripe.state.fee = 50;
      assert.equal((await stripeWebhook(sessionPaid(payment.providerTransactionId))).status, 200);
      const done = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      assert.deepEqual([done.status, done.feeMinor], ['succeeded', 738n], 'Stripe’s 50¢ fee booked as GH₵7.38 (proportionally)');
      assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 25000, 'credited the GH₵250 owed');

      const second = await reseller.browser.post('/v1/wallet/top-ups', { amount: 10000, method: 'stripe' });
      assert.equal(second.status, 201);
      assert.equal(stripe.state.attempts.at(-1), 'usd');
      assert.notEqual(stripe.state.attempts.at(-2), 'ghs', 'remembered: straight to dollars');
    } finally {
      stripe.state.refuseCurrencies.delete('ghs');
      stripe.state.fee = 0;
      forgetStripeCurrencies();
      await setMethods('GH', 'wallet_top_up', []);
    }
  });

  test('Stripe: a Checkout page, credited once when the signed notification is confirmed with Stripe', async () => {
    const reseller = await verifiedReseller();
    const created = await reseller.browser.post('/v1/wallet/top-ups', { amount: 500000, method: 'stripe' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.deepEqual([created.json.method, created.json.status], ['stripe', 'pending']);
    assert.match(created.json.checkout_url, /^https:\/\/checkout\.stripe\.com\//);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: created.json.id } });
    const session = stripe.state.sessions[payment.providerTransactionId];
    assert.deepEqual([session.fields['line_items[0][price_data][unit_amount]'], session.fields['line_items[0][price_data][currency]'], session.fields.client_reference_id], ['500000', 'ngn', payment.reference]);

    assert.equal((await stripeWebhook(sessionPaid(payment.providerTransactionId), 'whsec_wrong')).status, 401);
    assert.equal((await stripeWebhook(sessionPaid(payment.providerTransactionId), 'whsec_fake', Math.floor(Date.now() / 1000) - 3600)).status, 401, 'an old signature is refused');
    // Notified before it is paid: re-read, still waiting.
    assert.equal((await stripeWebhook(sessionPaid(payment.providerTransactionId))).status, 200);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, 'pending');

    Object.assign(session, { status: 'complete', payment_status: 'paid' });
    stripe.state.fee = 7500;
    for (let i = 0; i < 2; i += 1) assert.equal((await stripeWebhook(sessionPaid(payment.providerTransactionId))).status, 200);
    const done = (await reseller.browser.get(`/v1/wallet/top-ups/${payment.id}`)).json;
    assert.deepEqual([done.status, done.method, done.amount], ['succeeded', 'stripe', 500000]);
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 500000, 'credited once, in full');
    const fee = await prisma.ledgerAccount.findFirst({ where: { kind: 'processing_fees', ownerKey: 'provider:stripe', mode: 'live', currency: 'NGN' } });
    assert.equal(fee.balanceMinor, 7500n, 'Stripe’s fee is BitoCard’s cost');
  });

  test('pawaPay: mobile money through its payment page, credited when the deposit completes', async () => {
    await setMethods('GH', 'wallet_top_up', ['pawapay']);
    const reseller = await verifiedReseller({ country: 'GH' });
    const created = await reseller.browser.post('/v1/wallet/top-ups', { amount: 25000 });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.method, 'pawapay');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: created.json.id } });
    const deposit = pawapay.state.deposits[payment.providerTransactionId];
    assert.deepEqual([deposit.body.amountDetails, deposit.body.country], [{ amount: '250', currency: 'GHS' }, 'GHA']);

    const callback = token => fetch(`${server.base}/v1/webhooks/pawapay-deposits?token=${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ depositId: payment.providerTransactionId, status: 'COMPLETED' }) });
    assert.equal((await callback('wrong')).status, 401);
    deposit.status = 'COMPLETED';
    assert.equal((await callback('pawapay-callback')).status, 200);
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 25000);

    const second = await reseller.browser.post('/v1/wallet/top-ups', { amount: 10000 });
    const declined = await prisma.payment.findUniqueOrThrow({ where: { id: second.json.id } });
    pawapay.state.deposits[declined.providerTransactionId].status = 'FAILED';
    await callback('pawapay-callback');
    const failed = await prisma.payment.findUniqueOrThrow({ where: { id: declined.id } });
    assert.equal(failed.status, 'pending', 'the callback names only the first deposit');
    const checked = (await reseller.browser.get(`/v1/wallet/top-ups/${declined.id}`)).json;
    assert.deepEqual([checked.status, checked.failure_reason], ['failed', 'The payer declined']);
  });

  test('pawaPay is offered only where its account takes deposits, read from pawaPay', async () => {
    const { forgetDepositConfigs } = await import('../dist/payments/pawapay.provider.js');
    await setMethods('GH', 'wallet_top_up', ['pawapay']);
    await setMethods('NG', 'checkout', ['pawapay']);
    forgetDepositConfigs();
    const supported = async code => (await admin.get(`/v1/admin/countries/${code}/payment-methods`)).json.checkout.find(item => item.gateway === 'pawapay').supported;
    assert.deepEqual([await supported('GH'), await supported('NG')], [true, false], 'Ghana takes deposits on the account; Nigeria is not in its configuration');
    const reseller = await verifiedReseller({ country: 'GH' });
    const [method] = (await reseller.browser.get('/v1/wallet/payment-methods')).json.data;
    assert.deepEqual([method.id, method.networks], ['pawapay', ['MTN']], 'the networks open for deposits there (Telecel is closed)');
    await setMethods('GH', 'checkout', ['stripe', 'pawapay']);
    const store = (await fetch(`${server.base}/v1/store/payment-methods?country=GH`).then(res => res.json())).data;
    assert.deepEqual(store.map(item => [item.id, item.networks]), [['stripe', []], ['pawapay', ['MTN']]], 'bitocard.com customers see card and mobile money, with its networks');
    await setMethods('GH', 'checkout', []);

    pawapay.state.noDeposits.add('GHA');
    forgetDepositConfigs();
    try {
      assert.equal(await supported('GH'), false, 'switched off in pawaPay: no longer offered');
      assert.deepEqual((await reseller.browser.get('/v1/wallet/payment-methods')).json.data, []);
    } finally {
      pawapay.state.noDeposits.delete('GHA');
      forgetDepositConfigs();
      await setMethods('NG', 'checkout', []);
    }
  });

  test('a gateway that refuses to open a payment says why in the logs and tells admins once a day', async () => {
    await setMethods('GH', 'wallet_top_up', ['pawapay']);
    const reseller = await verifiedReseller({ country: 'GH' });
    pawapay.state.refusePaymentPage = true;
    try {
      const refused = await reseller.browser.post('/v1/wallet/top-ups', { amount: 25000 });
      assert.deepEqual([refused.status, refused.json.error.code], [502, 'provider_error']);
      assert.doesNotMatch(refused.json.error.message, /pawapay|403|enabled/i, 'the payer is told only to try again or pay another way');
      await reseller.browser.post('/v1/wallet/top-ups', { amount: 25000 });
      const notices = await prisma.notification.findMany({ where: { type: 'admin.payment.gateway_refused' } });
      assert.ok(notices.length > 0, 'admins are told');
      assert.equal(new Set(notices.map(row => row.userId)).size, notices.length, 'once per admin a day');
      assert.match(notices[0].body, /AUTHORISATION_ERROR: Payment page is not enabled for this account\. pawaPay refused the request \(HTTP 403\) at .*deposits and the Payment Page are enabled/);
      assert.equal(notices[0].title, 'pawaPay refused to open a payment');
    } finally {
      pawapay.state.refusePaymentPage = false;
    }
  });

  test('pawaPay rejecting the payment page (a 200 with REJECTED): its reason is logged and admins are told', async () => {
    await prisma.notification.deleteMany({ where: { type: 'admin.payment.gateway_refused' } });
    await setMethods('GH', 'wallet_top_up', ['pawapay']);
    const reseller = await verifiedReseller({ country: 'GH' });
    pawapay.state.rejectPaymentPage = true;
    try {
      const refused = await reseller.browser.post('/v1/wallet/top-ups', { amount: 25000 });
      assert.deepEqual([refused.status, refused.json.error.code], [502, 'provider_error']);
      assert.doesNotMatch(refused.json.error.message, /pawapay|REJECTED|enabled/i);
      const payment = await prisma.payment.findFirstOrThrow({ where: { resellerId: reseller.id }, orderBy: { createdAt: 'desc' } });
      assert.equal(payment.status, 'failed', 'a clear refusal fails the payment');
      const [notice] = await prisma.notification.findMany({ where: { type: 'admin.payment.gateway_refused' } });
      assert.match(notice.body, /PAYMENT_NOT_APPROVED: Deposits are not enabled for this country\. pawaPay rejected the payment page for GH in GHS/);
    } finally {
      pawapay.state.rejectPaymentPage = false;
    }
  });

  test('Monnify: its payment page, settled from a notification or by the scheduled check', async () => {
    const reseller = await verifiedReseller();
    const created = await reseller.browser.post('/v1/wallet/top-ups', { amount: 1_000_000, method: 'monnify' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: created.json.id } });
    assert.match(payment.providerTransactionId, /^MNFY\|/);
    monnify.state.checkouts[payment.reference].status = 'PAID';
    const raw = JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentReference: payment.reference, product: { type: 'WEB_SDK' } } });
    const notified = await fetch(`${server.base}/v1/webhooks/monnify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'monnify-signature': createHmac('sha512', 'monnify-secret').update(raw).digest('hex') },
      body: raw,
    });
    assert.equal(notified.status, 200);
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 1_000_000);
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).feeMinor, 5000n, 'Monnify’s fee, from what it settles');

    const later = await reseller.browser.post('/v1/wallet/top-ups', { amount: 200000, method: 'monnify' });
    const unnotified = await prisma.payment.update({ where: { id: later.json.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    monnify.state.checkouts[unnotified.reference].status = 'PAID';
    const cron = await fetch(`${server.base}/v1/cron/payments`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal(cron.status, 200);
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 1_200_000);
  });

  test('money paid for another amount, or after the payment closed, is never credited: finance is told and it is refunded', async () => {
    const reseller = await verifiedReseller();
    const notify = reference => {
      const raw = JSON.stringify({ eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentReference: reference, product: { type: 'WEB_SDK' } } });
      return fetch(`${server.base}/v1/webhooks/monnify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'monnify-signature': createHmac('sha512', 'monnify-secret').update(raw).digest('hex') },
        body: raw,
      });
    };
    const refundOf = id => monnify.state.refunds[`bc_rf_pay_${id.replaceAll('-', '')}`];

    // Paid half the amount.
    const short = await reseller.browser.post('/v1/wallet/top-ups', { amount: 500000, method: 'monnify' });
    const shortPayment = await prisma.payment.findUniqueOrThrow({ where: { id: short.json.id } });
    Object.assign(monnify.state.checkouts[shortPayment.reference], { status: 'PAID', amount: monnify.state.checkouts[shortPayment.reference].amount / 2 });
    assert.equal((await notify(shortPayment.reference)).status, 200);
    const mismatched = await prisma.payment.findUniqueOrThrow({ where: { id: short.json.id } });
    assert.deepEqual([mismatched.status, mismatched.unmatchedReason, mismatched.unmatchedAmountMinor], ['failed', 'mismatch', 250000n]);
    assert.ok(mismatched.unmatchedRefundedAt, 'refunded through Monnify');
    assert.equal(refundOf(short.json.id).refundAmount, 2500, 'what was paid, not what was asked');
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 0, 'never credited');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.payment.unmatched' } }), 'finance is told');

    // Paid after the payment was closed.
    const late = await reseller.browser.post('/v1/wallet/top-ups', { amount: 300000, method: 'monnify' });
    const latePayment = await prisma.payment.update({ where: { id: late.json.id }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000) } });
    await fetch(`${server.base}/v1/cron/payments`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: late.json.id } })).status, 'failed', 'closed after its lifetime');
    monnify.state.checkouts[latePayment.reference].status = 'PAID';
    assert.equal((await notify(latePayment.reference)).status, 200);
    const paidLate = await prisma.payment.findUniqueOrThrow({ where: { id: late.json.id } });
    assert.deepEqual([paidLate.status, paidLate.unmatchedReason, paidLate.unmatchedAmountMinor], ['failed', 'late', 300000n]);
    assert.ok(paidLate.unmatchedRefundedAt);
    assert.equal((await notify(latePayment.reference)).status, 200, 'a repeated notification is harmless');
    assert.equal(Object.keys(monnify.state.refunds).filter(key => key.includes(late.json.id.replaceAll('-', ''))).length, 1, 'refunded once');
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 0);
  });
});

/** The store's server: sends the customer's session token in a header, never a cookie. */
function store() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `store-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get token() {
      return token;
    },
    set token(value) {
      token = value;
    },
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
  };
}

let counter = 0;
async function customer({ verified = true } = {}) {
  const shopper = store();
  const email = `shopper${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  if (verified) {
    const code = await lastEmailCode(server.app, email);
    assert.equal((await shopper.post('/v1/store/account/email/verify', { code })).status, 200);
  }
  shopper.email = email;
  shopper.id = signup.json.customer.id;
  return shopper;
}

describe('store customer accounts', () => {
  test('sign up confirms the email by code; the store keeps the session token, the API only its hash', async () => {
    const shopper = store();
    const email = `ada-${Date.now()}@example.com`;
    const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada', email: email.toUpperCase(), password: 'correct horse battery' });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    assert.deepEqual([signup.json.customer.email, signup.json.customer.email_verified], [email, false]);
    assert.match(signup.json.session.token, /^bcc_/);
    const stored = await prisma.customerSession.findFirstOrThrow({ where: { customerId: signup.json.customer.id } });
    assert.notEqual(stored.tokenHash, signup.json.session.token);
    const message = server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1);
    assert.match(message.subject, /is your BitoCard verification code/);

    assert.deepEqual([(await store().post('/v1/store/account/signup', { name: 'Ada', email, password: 'correct horse battery' })).json.error.code], ['email_taken']);
    assert.equal((await store().get('/v1/store/account')).status, 401);
    assert.equal((await shopper.post('/v1/store/account/email/verify', { code: '000000' })).json.error.code, 'code_invalid');
    const verified = await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
    assert.equal(verified.json.email_verified, true);
    assert.equal((await shopper.get('/v1/store/account')).json.email, email);

    assert.equal((await shopper.post('/v1/store/account/signout')).status, 200);
    assert.equal((await shopper.get('/v1/store/account')).status, 401, 'signed out on the server');
  });

  test('five wrong passwords lock the account; a reset code sets a new password and ends other sessions', async () => {
    const shopper = await customer();
    const old = shopper.token;
    const other = store();
    for (let i = 0; i < 5; i += 1) assert.equal((await other.post('/v1/store/account/signin', { email: shopper.email, password: 'wrong password!!' })).status, 401);
    const locked = await other.post('/v1/store/account/signin', { email: shopper.email, password: 'correct horse battery' });
    assert.deepEqual([locked.status, locked.json.error.code], [429, 'account_locked']);
    const guessing = await other.post('/v1/store/account/signin', { email: shopper.email, password: 'wrong password!!' });
    const nobody = await other.post('/v1/store/account/signin', { email: 'nobody-here@example.com', password: 'wrong password!!' });
    assert.deepEqual([guessing.status, guessing.json.error], [nobody.status, { ...nobody.json.error, request_id: guessing.json.error.request_id }], 'a wrong password never reveals the lock, or that the account exists');

    const forgot = await other.post('/v1/store/account/password/forgot', { email: shopper.email });
    assert.deepEqual([forgot.status, forgot.json.sent], [200, true]);
    assert.deepEqual((await store().post('/v1/store/account/password/forgot', { email: 'nobody@example.com' })).json, forgot.json, 'never reveals whether an account exists');
    const code = await lastEmailCode(server.app, shopper.email);
    const reset = await other.post('/v1/store/account/password/reset', { email: shopper.email, code, password: 'a brand new passphrase' });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    shopper.token = old;
    assert.equal((await shopper.get('/v1/store/account')).status, 401, 'old sessions end');
    assert.equal((await store().post('/v1/store/account/signin', { email: shopper.email, password: 'a brand new passphrase' })).status, 200);
  });

  test('parallel guesses cannot get past the code or password limits', async () => {
    const shopper = await customer();
    await shopper.post('/v1/store/account/password/forgot', { email: shopper.email });
    const code = await lastEmailCode(server.app, shopper.email);
    const wrong = code === '000000' ? '111111' : '000000';
    const guesses = await Promise.all(
      Array.from({ length: 12 }, () => store().post('/v1/store/account/password/reset', { email: shopper.email, code: wrong, password: 'a brand new passphrase' })),
    );
    assert.equal(guesses.filter(g => g.json.error.code === 'code_invalid').length, 5, 'only five guesses are ever compared');
    const record = await prisma.customerCode.findFirstOrThrow({ where: { customerId: shopper.id, purpose: 'password_reset', consumedAt: null } });
    assert.equal(record.attempts, 5);
    assert.equal((await store().post('/v1/store/account/password/reset', { email: shopper.email, code, password: 'a brand new passphrase' })).json.error.code, 'code_attempts_exceeded');

    const target = await customer();
    await Promise.all(Array.from({ length: 8 }, () => store().post('/v1/store/account/signin', { email: target.email, password: 'wrong password!!' })));
    const locked = await store().post('/v1/store/account/signin', { email: target.email, password: 'correct horse battery' });
    assert.equal(locked.json.error.code, 'account_locked', 'parallel wrong passwords all count');
  });

  test('wrong current passwords count towards the sign-in lockout', async () => {
    const shopper = await customer();
    for (let i = 0; i < 5; i += 1) {
      const res = await shopper.post('/v1/store/account/password/change', { current_password: 'wrong password!!', password: 'another good passphrase' });
      assert.equal(res.json.error.code, 'password_incorrect');
    }
    assert.equal((await store().post('/v1/store/account/signin', { email: shopper.email, password: 'correct horse battery' })).json.error.code, 'account_locked');
  });
});

/** Turns bitocard.com's checkout sandbox on or off (Settings > Integrations > Customer checkout). */
async function checkoutSandbox(on) {
  const res = await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: on }, code: await adminCode(server, admin) });
  assert.equal(res.status, 200, JSON.stringify(res.json));
}

async function giftCard(title, codes) {
  const created = await admin.post('/v1/admin/stock', {
    category: 'gift_cards',
    country: 'NG',
    brand: 'amazon',
    title,
    description: 'An Amazon gift card.',
    redeem_instructions: 'Redeem at amazon.com/redeem.',
    currency: 'USD',
    face_value: 2500,
    cost: 2000,
    listed: true,
    codes: codes.map(code => ({ code })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.product;
}

const returnUrl = 'https://bitocard.com/checkout/return';

describe('checkout on bitocard.com (sandbox)', () => {
  let product;

  before(async () => {
    await checkoutSandbox(true);
    product = await giftCard('Amazon Sandbox Card', ['SBX-NOT-USED-1']);
    await setMethods('NG', 'checkout', ['stripe']);
  });

  test('customers see how they can pay; buying needs a confirmed email', async () => {
    const methods = await store().get('/v1/store/payment-methods?country=NG');
    assert.deepEqual([methods.json.mode, methods.json.data.map(method => method.id)], ['test', ['stripe']]);
    const shopper = await customer({ verified: false });
    const refused = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'email_not_verified']);
    assert.equal((await store().post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl })).status, 401);
  });

  test('paid: the order is placed, delivered, emailed and shown to the customer; nothing stays held', async () => {
    const shopper = await customer();
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, quantity: 2, country: 'NG', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const checkout = started.json;
    assert.deepEqual([checkout.status, checkout.mode, checkout.currency, checkout.quantity, checkout.order], ['awaiting_payment', 'test', 'NGN', 2, null]);
    assert.match(checkout.checkout_url, /\/sandbox\/checkout\//);
    assert.ok(checkout.amount >= 2 * 2000 * 1500, 'never below cost');
    assert.ok(!/wholesale|supplier|profit|stock/i.test(JSON.stringify(checkout)), 'never shows costs or sources');

    const paid = await shopper.post(`/v1/store/checkouts/${checkout.id}/simulate`, { outcome: 'succeeded' });
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.deepEqual([paid.json.status, paid.json.order.status], ['completed', 'completed']);
    assert.equal(paid.json.order.deliveries.length, 2);
    assert.ok(paid.json.order.deliveries.every(delivery => delivery.code.startsWith('SANDBOX-')));
    const emailed = server.app.get(EmailService).outbox.filter(item => item.to === shopper.email).at(-1);
    assert.match(emailed.subject, /^\[Sandbox\] Your Amazon Sandbox Card gift card codes from BitoCard/);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: paid.json.order.id } });
    assert.deepEqual([order.customerId, order.priceMinor], [shopper.id, BigInt(checkout.amount)], 'the customer paid the quoted price');
    const seller = await prisma.reseller.findUniqueOrThrow({ where: { id: order.resellerId } });
    assert.deepEqual([seller.house, seller.country, seller.status], [true, 'NG', 'active']);
    assert.equal(await balance(seller.id, 'test', 'customer_payments'), 0n, 'the order took all the customer paid');
    assert.equal(await balance(seller.id, 'test', 'reseller_reserved'), 0n);

    const list = (await shopper.get('/v1/store/checkouts')).json.data;
    assert.deepEqual(list.map(item => item.id), [checkout.id]);
    assert.equal(list[0].order.deliveries, undefined, 'codes only on the single order');
    const stranger = await customer();
    assert.equal((await stranger.get(`/v1/store/checkouts/${checkout.id}`)).status, 404);
    const inbox = await prisma.notification.findMany({ where: { customerId: shopper.id } });
    assert.deepEqual(inbox.map(row => row.type), ['customer.order.completed']);
  });

  test('an order that fails after payment refunds the customer in full; an unpaid checkout just closes', async () => {
    const shopper = await customer();
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    const refunded = await shopper.post(`/v1/store/checkouts/${started.json.id}/simulate`, { outcome: 'succeeded', order: 'failed' });
    assert.deepEqual([refunded.json.status, refunded.json.order.status], ['refunded', 'failed']);
    assert.ok(refunded.json.refunded_at);
    const seller = await prisma.reseller.findFirstOrThrow({ where: { house: true, country: 'NG' } });
    assert.equal(await balance(seller.id, 'test', 'customer_payments'), 0n);
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { reference: `checkout_refund:${started.json.id}` } });
    assert.equal(entry.type, 'checkout_refund');
    const types = (await prisma.notification.findMany({ where: { customerId: shopper.id }, orderBy: { createdAt: 'asc' } })).map(row => row.type);
    assert.deepEqual(types, ['customer.order.failed', 'customer.order.refunded']);

    const unpaid = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    const closed = await shopper.post(`/v1/store/checkouts/${unpaid.json.id}/simulate`, { outcome: 'failed' });
    assert.deepEqual([closed.json.status, closed.json.order], ['failed', null]);
    assert.ok(!(await shopper.get('/v1/store/checkouts')).json.data.some(item => item.id === unpaid.json.id), 'unpaid checkouts are not orders');
  });

  test('where the market requires it, customers pass the identity check before buying', async () => {
    await prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } }, data: { customerVerification: true } });
    try {
      const shopper = await customer();
      const refused = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
      assert.deepEqual([refused.status, refused.json.error.code], [403, 'customer_verification_required']);
      const status = await shopper.get('/v1/store/account/verification?country=NG');
      assert.deepEqual([status.json.verified, status.json.latest], [false, null]);
    } finally {
      await prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } }, data: { customerVerification: false } });
    }
  });
});

describe('checkout on bitocard.com (live)', () => {
  let product;

  before(async () => {
    await checkoutSandbox(false);
    product = await giftCard('Amazon Live Card', ['LIVE-CODE-0001', 'LIVE-CODE-0002']);
    await setMethods('NG', 'checkout', ['stripe']);
  });

  async function pay(checkout) {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: (await prisma.checkout.findUniqueOrThrow({ where: { id: checkout.id } })).paymentId } });
    Object.assign(stripe.state.sessions[payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
    assert.equal((await stripeWebhook(sessionPaid(payment.providerTransactionId))).status, 200);
    return payment;
  }

  test('the customer pays on Stripe; once confirmed, BitoCard’s own stock is delivered to them', async () => {
    const shopper = await customer();
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.match(started.json.checkout_url, /^https:\/\/checkout\.stripe\.com\//);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: (await prisma.checkout.findUniqueOrThrow({ where: { id: started.json.id } })).paymentId } });
    assert.match(stripe.state.sessions[payment.providerTransactionId].fields.success_url, new RegExp(`checkout=${started.json.id}`), 'the payment page returns to the store with the checkout');
    assert.equal(payment.purpose, 'checkout');

    await pay(started.json);
    const done = (await shopper.get(`/v1/store/checkouts/${started.json.id}`)).json;
    assert.deepEqual([done.status, done.order.status, done.order.deliveries.map(item => item.code)], ['completed', 'completed', ['LIVE-CODE-0001']]);
    assert.match(done.order.receipt_number, /^BC-\d{6}$/);
    const seller = await prisma.reseller.findFirstOrThrow({ where: { house: true, country: 'NG' } });
    assert.equal(await balance(seller.id, 'live', 'customer_payments'), 0n);
    assert.ok(!(await prisma.event.findMany({ where: { resellerId: seller.id } })).some(event => event.type.startsWith('top_up.')), 'checkout payments are not top-ups');
  });

  test('if the order cannot be supplied after payment, the customer is refunded through Stripe', async () => {
    const [first, second] = [await customer(), await customer()];
    const a = (await first.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl })).json;
    const b = (await second.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl })).json;
    assert.ok(a.id && b.id, 'both quoted while one card is left');
    await pay(a);
    assert.equal((await first.get(`/v1/store/checkouts/${a.id}`)).json.status, 'completed');
    const payment = await pay(b);
    const refunded = (await second.get(`/v1/store/checkouts/${b.id}`)).json;
    assert.deepEqual([refunded.status, refunded.order?.status ?? null], ['refunded', 'failed']);
    const refund = Object.values(stripe.state.refunds).find(item => item['metadata[reference]'] === `bc_rf_${b.id.replaceAll('-', '')}`);
    assert.equal(refund.amount, String(payment.amountMinor), 'refunded in full');
    const seller = await prisma.reseller.findFirstOrThrow({ where: { house: true, country: 'NG' } });
    assert.equal(await balance(seller.id, 'live', 'customer_payments'), 0n);
    const job = await fetch(`${server.base}/v1/cron/checkout`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal(job.status, 200, 'the job is safe to run again');
    assert.equal(Object.values(stripe.state.refunds).filter(item => item['metadata[reference]'] === `bc_rf_${b.id.replaceAll('-', '')}`).length, 1, 'refunded once');
  });

  test('house accounts never appear as resellers', async () => {
    const list = await admin.get('/v1/admin/resellers');
    assert.ok(!list.json.data.some(row => row.name === 'BitoCard'));
  });
});
