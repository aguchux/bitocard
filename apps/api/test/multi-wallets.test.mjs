// Many wallets (docs/BITOCARD_MULTI_WALLETS_PLAN.md): every customer holds US dollars and their own country's
// currency, adds the currencies of markets an admin opened (customer_foreign_wallets), tops each up with its own
// market's methods, moves money between them at BitoCard's rate (one margin), pays from any of them, and removes an
// added one only while it is empty.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, startApp } from './helpers.mjs';
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
  const fresh = new Date(Date.now() + 3600_000);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: fresh } });
    await prisma.exchangeRate.create({ data: { currency: 'KES', source, unitsPerUsd: 129, fetchedAt: fresh } });
  }
  await prisma.countryCategory.upsert({
    where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } },
    create: { countryCode: 'NG', category: 'gift_cards', enabled: true },
    update: { enabled: true, customerVerification: false },
  });
  const sandboxOff = await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: false }, code: await adminCode(server, admin) });
  assert.equal(sandboxOff.status, 200, JSON.stringify(sandboxOff.json));
  for (const country of ['NG', 'KE']) {
    assert.equal((await admin.put(`/v1/admin/countries/${country}/payment-methods`, { purpose: 'checkout', enabled: ['stripe'] })).status, 200);
  }
  const created = await admin.post('/v1/admin/stock', {
    category: 'gift_cards',
    country: 'NG',
    brand: 'amazon',
    title: 'Amazon Wallets Card',
    description: 'An Amazon gift card.',
    redeem_instructions: 'Redeem at amazon.com/redeem.',
    currency: 'USD',
    face_value: 2500,
    cost: 2000,
    listed: true,
    codes: Array.from({ length: 6 }, (_, i) => ({ code: `WALLETS-CODE-000${i}` })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  product = created.json.product;
});

after(async () => {
  await server?.close();
  await Promise.all([stripe?.close(), flw?.close()]);
});

const returnUrl = 'https://shop.example/account/wallet';
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const openKenya = async enabled => assert.equal((await admin.put('/v1/admin/switches/customer_foreign_wallets', { country_code: 'KE', enabled })).status, 200);

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
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function customer() {
  const shopper = storeServer();
  const email = `wallets${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Obi', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function topUpDollars(shopper, amount) {
  const started = await shopper.post('/v1/store/wallet/top-ups', { amount, method: 'stripe', currency: 'USD', return_url: returnUrl });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: started.json.id } });
  Object.assign(stripe.state.sessions[payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
  assert.equal((await shopper.get(`/v1/store/wallet/top-ups/${started.json.id}`)).json.status, 'succeeded');
}

const balances = async shopper => Object.fromEntries((await shopper.get('/v1/store/wallet')).json.wallets.map(item => [item.currency, item.balance]));

describe('many wallets', () => {
  test('a currency can be added only once an admin opens its market', async () => {
    const shopper = await customer();
    assert.deepEqual((await shopper.get('/v1/store/wallet/currencies')).json.data, [], 'nothing is open by default');
    const closed = await shopper.post('/v1/store/wallet/wallets', { currency: 'KES' });
    assert.deepEqual([closed.status, closed.json.error.code], [400, 'currency_unavailable']);

    await openKenya(true);
    const options = (await shopper.get('/v1/store/wallet/currencies')).json.data;
    assert.deepEqual(options, [{ object: 'wallet_currency_option', currency: 'KES', country: 'KE', country_name: 'Kenya', available: true, reason: null }]);
    const added = await shopper.post('/v1/store/wallet/wallets', { currency: 'kes' });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual(
      added.json.wallets.map(item => [item.currency, item.primary, item.removable]),
      [
        ['NGN', true, false],
        ['USD', false, false],
        ['KES', false, true],
      ],
      'home first, then US dollars, then the added one',
    );
    assert.equal((await shopper.post('/v1/store/wallet/wallets', { currency: 'KES' })).json.error.code, 'wallet_exists');
    assert.equal((await shopper.post('/v1/store/wallet/wallets', { currency: 'NGN' })).json.error.code, 'wallet_exists');
    assert.deepEqual((await shopper.get('/v1/store/wallet/currencies')).json.data, [], 'a currency held is not offered again');

    // Its top-ups use Kenya's own methods (Stripe switched on there).
    const kes = (await shopper.get('/v1/store/wallet?currency=KES')).json;
    assert.deepEqual([kes.currency, kes.reserved_accounts_available], ['KES', false], 'bank account numbers stay on the home wallet');
    assert.ok(kes.top_up_methods.some(method => method.id === 'stripe'));
    const started = await shopper.post('/v1/store/wallet/top-ups', { amount: 50_000, method: 'stripe', currency: 'KES', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.deepEqual([started.json.currency, started.json.method.id], ['KES', 'stripe']);
  });

  test('money moves between wallets at the shown rate, once, never past the balance', async () => {
    await openKenya(true);
    const shopper = await customer();
    assert.equal((await shopper.post('/v1/store/wallet/wallets', { currency: 'KES' })).status, 201);
    await topUpDollars(shopper, 10_000);

    const expected = Number((await fx.convert(4_000n, 'USD', 'KES')).amount);
    const preview = await shopper.post('/v1/store/wallet/conversions', { from: 'USD', to: 'KES', amount: 4_000, preview: true });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.deepEqual([preview.json.id, preview.json.to], [null, { amount: expected, currency: 'KES' }]);
    assert.equal((await balances(shopper)).USD, 10_000, 'a preview moves nothing');

    const stale = await shopper.post('/v1/store/wallet/conversions', { from: 'USD', to: 'KES', amount: 4_000, expected_amount: expected + 1 });
    assert.deepEqual([stale.status, stale.json.error.code], [409, 'rate_changed']);
    const moved = await shopper.post('/v1/store/wallet/conversions', { from: 'usd', to: 'kes', amount: 4_000, expected_amount: expected });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.deepEqual(await balances(shopper), { NGN: 0, USD: 6_000, KES: expected });

    // KES to NGN crosses through dollars at one margin.
    const naira = Number((await fx.convert(BigInt(expected), 'KES', 'NGN')).amount);
    const crossed = await shopper.post('/v1/store/wallet/conversions', { from: 'KES', to: 'NGN', amount: expected });
    assert.equal(crossed.status, 200, JSON.stringify(crossed.json));
    assert.deepEqual(await balances(shopper), { NGN: naira, USD: 6_000, KES: 0 });
    // One entry, two lines: out of the shilling wallet, into the naira one.
    const lines = (await shopper.get('/v1/store/wallet/transactions')).json.data.slice(0, 2);
    assert.deepEqual(lines.map(line => [line.type, line.currency, line.amount]).sort(), [['conversion', 'KES', -expected], ['conversion', 'NGN', naira]]);

    const tooMuch = await shopper.post('/v1/store/wallet/conversions', { from: 'USD', to: 'KES', amount: 1_000_000 });
    assert.deepEqual([tooMuch.status, tooMuch.json.error.code], [402, 'wallet_balance_low']);
    assert.equal((await shopper.post('/v1/store/wallet/conversions', { from: 'USD', to: 'GHS', amount: 100 })).json.error.code, 'currency_unsupported');
    assert.equal((await shopper.post('/v1/store/wallet/conversions', { from: 'USD', to: 'USD', amount: 100 })).status, 400);
    await ledgerOk();
  });

  test('a purchase is paid from an added wallet at the shown rate and refunded back to it exactly', async () => {
    await openKenya(true);
    const shopper = await customer();
    assert.equal((await shopper.post('/v1/store/wallet/wallets', { currency: 'KES' })).status, 201);
    await topUpDollars(shopper, 20_000);
    assert.equal((await shopper.post('/v1/store/wallet/conversions', { from: 'USD', to: 'KES', amount: 20_000 })).status, 200);
    const funded = (await balances(shopper)).KES;

    const preview = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, return_url: returnUrl, preview: true });
    assert.equal(preview.status, 201, JSON.stringify(preview.json));
    assert.deepEqual(preview.json.wallet_options.map(option => option.currency), ['NGN', 'USD', 'KES']);
    const expected = Number((await fx.covering(BigInt(preview.json.amount), 'NGN', 'KES')).amount);
    assert.deepEqual(preview.json.wallet_options[2], { currency: 'KES', amount: expected, balance: funded, enough: true });

    const bought = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, return_url: returnUrl, quote_id: preview.json.quote_id, wallet_currency: 'KES' });
    assert.equal(bought.status, 201, JSON.stringify(bought.json));
    assert.equal(bought.json.status, 'completed');
    assert.deepEqual(bought.json.charged, { amount: expected, currency: 'KES' });
    assert.equal((await balances(shopper)).KES, funded - expected);
    await ledgerOk();

    const refunded = await admin.post(`/v1/admin/orders/${bought.json.order.id}/refund`, { reason: 'Customer could not redeem', supplier_refunded: false });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.equal((await balances(shopper)).KES, funded, 'every cent back in the shilling wallet');
    await ledgerOk();
  });

  test('an added wallet is removed only while empty; US dollars and home always stay; money is never hidden', async () => {
    await openKenya(true);
    const shopper = await customer();
    assert.equal((await shopper.post('/v1/store/wallet/wallets', { currency: 'KES' })).status, 201);
    await topUpDollars(shopper, 1_000);
    assert.equal((await shopper.post('/v1/store/wallet/conversions', { from: 'USD', to: 'KES', amount: 1_000 })).status, 200);

    assert.equal((await shopper.del('/v1/store/wallet/wallets/USD')).json.error.code, 'wallet_required');
    assert.equal((await shopper.del('/v1/store/wallet/wallets/NGN')).json.error.code, 'wallet_required');
    assert.equal((await shopper.del('/v1/store/wallet/wallets/KES')).json.error.code, 'wallet_not_empty');

    // Kenya closed again: the wallet with money stays theirs and can still be spent or moved out.
    await openKenya(false);
    const kes = (await balances(shopper)).KES;
    assert.ok(kes > 0);
    assert.equal((await shopper.post('/v1/store/wallet/conversions', { from: 'KES', to: 'USD', amount: kes })).status, 200);
    const removed = await shopper.del('/v1/store/wallet/wallets/KES');
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.deepEqual(removed.json.wallets.map(item => item.currency), ['NGN', 'USD']);
    assert.equal((await shopper.del('/v1/store/wallet/wallets/KES')).status, 404);
    await ledgerOk();
  });
});
