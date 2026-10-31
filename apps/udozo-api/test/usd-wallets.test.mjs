// Two wallets for everyone: a reseller's or customer's country currency and US dollars. Top-ups into either,
// conversions between them at BitoCard's rate, orders the country wallet cannot cover covered from the dollars, and
// store purchases paid from the US dollar wallet (refunded back to it exactly).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { fakeFlutterwave, fakeStripe } from './fakes.mjs';

let server;
let admin;
let prisma;
let fx;
let stripe;
let flw;
let product;

before(async () => {
  [stripe, flw] = await Promise.all([fakeStripe(), fakeFlutterwave()]);
  server = await startApp({ env: { ...stripe.env, ...flw.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  fx = server.app.get((await import('../dist/fx/fx.service.js')).FxService);
  admin = await adminClient(server);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await prisma.countryCategory.upsert({
    where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } },
    create: { countryCode: 'NG', category: 'gift_cards', enabled: true },
    update: { enabled: true, customerVerification: false },
  });
  const sandboxOff = await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: false }, code: await adminCode(server, admin) });
  assert.equal(sandboxOff.status, 200, JSON.stringify(sandboxOff.json));
  assert.equal((await admin.put('/v1/admin/countries/NG/payment-methods', { purpose: 'checkout', enabled: ['stripe', 'flutterwave'] })).status, 200);
  const created = await admin.post('/v1/admin/stock', {
    category: 'gift_cards',
    country: 'NG',
    brand: 'amazon',
    title: 'Amazon Dollar Card',
    description: 'An Amazon gift card.',
    redeem_instructions: 'Redeem at amazon.com/redeem.',
    currency: 'USD',
    face_value: 2500,
    cost: 2000,
    listed: true,
    codes: Array.from({ length: 6 }, (_, i) => ({ code: `DOLLAR-CODE-000${i}` })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  product = created.json.product;
});

after(async () => {
  await server?.close();
  await Promise.all([stripe?.close(), flw?.close()]);
});

const test_ = { 'bitocard-mode': 'test' };
const returnUrl = 'https://shop.example/account/wallet';
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

async function nigerianReseller() {
  const created = await resellerClient(server);
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
  return created;
}

/** A sandbox top-up of one of the reseller's wallets, paid. */
async function sandboxTopUp(browser, amount, currency) {
  const started = await browser.post('/v1/wallet/top-ups', { amount, ...(currency ? { currency } : {}) }, test_);
  assert.equal(started.status, 201, JSON.stringify(started.json));
  assert.equal(started.json.currency, currency ?? 'NGN');
  const paid = await browser.post(`/v1/wallet/top-ups/${started.json.id}/simulate`, { outcome: 'succeeded' }, test_);
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
}

describe('reseller wallets', () => {
  test('every reseller holds their country wallet and a US dollar wallet; either can be topped up', async () => {
    const { browser } = await nigerianReseller();
    const wallet = (await browser.get('/v1/wallet', test_)).json;
    assert.equal(wallet.currency, 'NGN');
    assert.deepEqual(wallet.wallets, [
      { currency: 'NGN', primary: true, available: 0, reserved: 0 },
      { currency: 'USD', primary: false, available: 0, reserved: 0 },
    ]);
    assert.equal((await browser.get('/v1/wallet?currency=GHS', test_)).json.error.code, 'currency_unsupported');

    await sandboxTopUp(browser, 5_000, 'USD');
    const dollars = (await browser.get('/v1/wallet?currency=usd', test_)).json;
    assert.deepEqual([dollars.currency, dollars.available, dollars.minimum_withdrawal], ['USD', 5_000, null], 'no withdrawals from the dollar wallet');
    assert.equal((await browser.get('/v1/wallet', test_)).json.available, 0, 'the country wallet is untouched');
    const listed = (await browser.get('/v1/wallet/transactions?currency=USD', test_)).json.data;
    assert.deepEqual(listed.map(item => [item.type, item.currency, item.amount]), [['top_up', 'USD', 5_000]]);
    assert.equal((await browser.get('/v1/wallet/transactions?currency=NGN', test_)).json.data.length, 0);
    assert.ok((await browser.get('/v1/wallet/payment-methods?currency=USD', test_)).status === 200);
    await ledgerOk();
  });

  test("conversions move money between the wallets at BitoCard's rate; a preview moves nothing", async () => {
    const { browser } = await nigerianReseller();
    await sandboxTopUp(browser, 4_000, 'USD');
    const expected = Number((await fx.exchange(2_000n, 'USD', 'NGN')).amount);
    const preview = await browser.post('/v1/wallet/conversions', { from: 'USD', to: 'NGN', amount: 2_000, preview: true }, test_);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.deepEqual([preview.json.id, preview.json.to], [null, { amount: expected, currency: 'NGN' }]);
    assert.equal((await browser.get('/v1/wallet?currency=USD', test_)).json.available, 4_000, 'a preview moves nothing');

    const made = await browser.post('/v1/wallet/conversions', { from: 'usd', to: 'ngn', amount: 2_000 }, test_);
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const wallets = (await browser.get('/v1/wallet', test_)).json.wallets;
    assert.deepEqual(wallets.map(item => item.available), [expected, 2_000]);
    const [inNaira] = (await browser.get('/v1/wallet/transactions?currency=NGN', test_)).json.data;
    assert.deepEqual([inNaira.type, inNaira.amount, inNaira.conversion.from], ['conversion', expected, { amount: 2_000, currency: 'USD' }]);
    const [inDollars] = (await browser.get('/v1/wallet/transactions?currency=USD', test_)).json.data;
    assert.deepEqual([inDollars.type, inDollars.amount], ['conversion', -2_000]);

    // Back to dollars at the other rate: never more than went in.
    const back = await browser.post('/v1/wallet/conversions', { from: 'NGN', to: 'USD', amount: expected }, test_);
    assert.equal(back.status, 200, JSON.stringify(back.json));
    assert.ok(back.json.to.amount <= 2_000);
    const tooMuch = await browser.post('/v1/wallet/conversions', { from: 'USD', to: 'NGN', amount: 1_000_000 }, test_);
    assert.deepEqual([tooMuch.status, tooMuch.json.error.code], [402, 'insufficient_funds']);
    const same = await browser.post('/v1/wallet/conversions', { from: 'USD', to: 'USD', amount: 100 }, test_);
    assert.equal(same.status, 400);
    await ledgerOk();
  });

  test('an order the country wallet cannot cover is covered from the US dollar wallet', async () => {
    const { browser } = await nigerianReseller();
    await sandboxTopUp(browser, 10_000, 'USD');
    const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: 2500 }, test_);
    assert.equal(quote.status, 201, JSON.stringify(quote.json));
    const order = await browser.post('/v1/orders', { quote_id: quote.json.id }, test_);
    assert.equal(order.status, 201, JSON.stringify(order.json));
    assert.equal(order.json.status, 'completed');
    const converted = await prisma.journalEntry.findFirst({ where: { reference: { startsWith: 'conversion:hold:' }, resellerId: (await prisma.order.findUniqueOrThrow({ where: { id: order.json.id } })).resellerId } });
    assert.ok(converted, 'the shortfall was converted');
    const wallets = (await browser.get('/v1/wallet', test_)).json.wallets;
    assert.ok(wallets[1].available < 10_000 && wallets[1].available >= 0);
    await ledgerOk();
  });
});

function storeServer() {
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
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

let counter = 0;
async function customer() {
  const shopper = storeServer();
  const email = `dollars${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function topUpDollars(shopper, amount) {
  const started = await shopper.post('/v1/store/wallet/top-ups', { amount, method: 'stripe', currency: 'USD', return_url: returnUrl });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  assert.equal(started.json.currency, 'USD');
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: started.json.id } });
  assert.equal(payment.chargeCurrency, null, 'charged in dollars as they are');
  Object.assign(stripe.state.sessions[payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
  return (await shopper.get(`/v1/store/wallet/top-ups/${started.json.id}`)).json;
}

describe('customer wallets', () => {
  test('a customer sees both wallets and tops up the US dollar one by card', async () => {
    const shopper = await customer();
    const wallet = (await shopper.get('/v1/store/wallet')).json;
    assert.deepEqual(wallet.wallets, [
      { currency: 'NGN', primary: true, balance: 0 },
      { currency: 'USD', primary: false, balance: 0 },
    ]);
    const dollars = (await shopper.get('/v1/store/wallet?currency=USD')).json;
    assert.deepEqual([dollars.currency, dollars.reserved_accounts_available], ['USD', false], 'bank account numbers are for the country wallet');
    assert.ok(dollars.top_up_methods.some(method => method.id === 'stripe'));
    assert.equal((await shopper.get('/v1/store/wallet?currency=EUR')).json.error.code, 'currency_unsupported');

    const topUp = await topUpDollars(shopper, 5_000);
    assert.deepEqual([topUp.status, topUp.amount, topUp.currency], ['succeeded', 5_000, 'USD']);
    assert.deepEqual((await shopper.get('/v1/store/wallet')).json.wallets.map(item => item.balance), [0, 5_000]);
    await ledgerOk();
  });

  test('a purchase paid from the US dollar wallet at the shown rate, refunded back to it exactly', async () => {
    const shopper = await customer();
    await topUpDollars(shopper, 10_000);
    const preview = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, return_url: returnUrl, preview: true });
    assert.equal(preview.status, 201, JSON.stringify(preview.json));
    const dollarOption = preview.json.wallet_options.find(option => option.currency === 'USD');
    const expected = Number((await fx.usdCovering(BigInt(preview.json.amount), 'NGN')).amount);
    assert.deepEqual(dollarOption, { currency: 'USD', amount: expected, balance: 10_000, enough: true });
    assert.deepEqual(preview.json.wallet_options[0], { currency: 'NGN', amount: preview.json.amount, balance: 0, enough: false });

    const bought = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, return_url: returnUrl, quote_id: preview.json.quote_id, wallet_currency: 'USD' });
    assert.equal(bought.status, 201, JSON.stringify(bought.json));
    assert.equal(bought.json.status, 'completed');
    assert.deepEqual(bought.json.charged, { amount: expected, currency: 'USD' }, 'the order says what left the dollar wallet');
    assert.deepEqual((await shopper.get('/v1/store/wallet')).json.wallets.map(item => item.balance), [0, 10_000 - expected]);
    await ledgerOk();

    const refunded = await admin.post(`/v1/admin/orders/${bought.json.order.id}/refund`, { reason: 'Customer could not redeem', supplier_refunded: false });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.deepEqual((await shopper.get('/v1/store/wallet')).json.wallets.map(item => item.balance), [0, 10_000], 'every cent back in the dollar wallet');
    await ledgerOk();
  });

  test('the US dollar wallet too low is refused, saying how many dollars to add', async () => {
    const shopper = await customer();
    await topUpDollars(shopper, 100);
    const refused = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, return_url: returnUrl, wallet_currency: 'USD' });
    assert.deepEqual([refused.status, refused.json.error.code], [402, 'wallet_balance_low']);
    assert.match(refused.json.error.message, /Your US dollar wallet has US\$1\.00|Your US dollar wallet has USD 1\.00/);
    const bad = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, return_url: returnUrl, wallet_currency: 'GHS' });
    assert.deepEqual([bad.status, bad.json.error.code], [400, 'currency_unsupported']);
  });
});
