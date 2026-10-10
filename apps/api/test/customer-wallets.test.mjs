// Store customers' wallets (on unless an admin switches them off): topped up through BitoCard's checkout methods or the
// customer's own Flutterwave account number, the only way to buy while on, refunded to, spent only, never withdrawn.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { fakeFlutterwave, fakeStripe } from './fakes.mjs';

let server;
let admin;
let prisma;
let stripe;
let flw;

before(async () => {
  [stripe, flw] = await Promise.all([fakeStripe(), fakeFlutterwave()]);
  server = await startApp({ env: { ...stripe.env, ...flw.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
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
});

after(async () => {
  await server?.close();
  await Promise.all([stripe?.close(), flw?.close()]);
});

const returnUrl = 'https://shop.example/account/wallet';
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const flutterwaveWebhook = body =>
  fetch(`${server.base}/v1/webhooks/flutterwave`, { method: 'POST', headers: { 'content-type': 'application/json', 'verif-hash': 'flw-webhook-hash' }, body: JSON.stringify(body) });

let counter = 0;
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

function storeServer(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
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

async function customer(subdomain = null) {
  const shopper = storeServer(subdomain);
  const email = `wallet${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** Tops a bitocard.com customer's Nigerian wallet up through Stripe, paid and confirmed. */
async function topUpWithStripe(shopper, amount) {
  const started = await shopper.post('/v1/store/wallet/top-ups', { amount, country: 'NG', method: 'stripe', return_url: returnUrl });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: started.json.id } });
  Object.assign(stripe.state.sessions[payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
  return (await shopper.get(`/v1/store/wallet/top-ups/${started.json.id}`)).json;
}

const houseSeller = async () => (await prisma.reseller.findFirstOrThrow({ where: { house: true, country: 'NG' } })).id;

describe('customer wallets on bitocard.com', () => {
  test('on by default: the only way to pay; an empty wallet is refused, saying how much to add', async () => {
    const product = await giftCard('Amazon Wallet Card', ['WALLET-CODE-0001']);
    const methods = await fetch(`${server.base}/v1/store/payment-methods?country=NG`).then(res => res.json());
    assert.deepEqual([methods.wallet_required, methods.data.map(item => item.id)], [true, ['wallet']]);
    const switches = await admin.get('/v1/admin/switches');
    assert.equal(switches.json.definitions.customer_wallets.default, true, 'admins see it is on unless switched off');

    const shopper = await customer();
    const card = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', method: 'stripe', return_url: returnUrl });
    assert.deepEqual([card.status, card.json.error.code], [400, 'payment_method_unavailable']);
    const empty = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.deepEqual([empty.status, empty.json.error.code], [402, 'wallet_balance_low']);
    assert.match(empty.json.error.message, /Your wallet has NGN 0\.00\. Add NGN [\d,.]+ to buy this\./);
    assert.equal(await prisma.checkout.count({ where: { customerId: shopper.id } }), 0, 'nothing kept');
  });

  test('a Stripe top-up is credited once, then spent: the order is delivered and the wallet charged the price', async () => {
    const product = await giftCard('Amazon Spend Card', ['SPEND-CODE-0001']);
    const shopper = await customer();
    const wallet = await shopper.get('/v1/store/wallet?country=NG');
    assert.deepEqual([wallet.json.enabled, wallet.json.currency, wallet.json.balance], [true, 'NGN', 0]);
    assert.deepEqual(wallet.json.top_up_methods.map(item => item.id), ['stripe', 'flutterwave'], "the market's checkout methods");

    const topUp = await topUpWithStripe(shopper, 10_000_000);
    assert.deepEqual([topUp.status, topUp.amount, topUp.currency], ['succeeded', 10_000_000, 'NGN']);
    assert.equal((await shopper.get(`/v1/store/wallet/top-ups/${topUp.id}`)).json.status, 'succeeded');
    assert.equal((await shopper.get('/v1/store/wallet?country=NG')).json.balance, 10_000_000);
    const notice = await prisma.notification.findFirst({ where: { customerId: shopper.id, type: 'customer.wallet.credited' } });
    assert.ok(notice, 'the customer is told');
    const seller = await houseSeller();
    assert.equal(await prisma.payment.count({ where: { resellerId: seller, customerId: null, id: topUp.id } }), 0, "never in the seller's own top-ups");

    const bought = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.equal(bought.status, 201, JSON.stringify(bought.json));
    assert.deepEqual([bought.json.status, bought.json.method.id, bought.json.checkout_url], ['completed', 'wallet', null]);
    const balance = (await shopper.get('/v1/store/wallet?country=NG')).json.balance;
    assert.equal(balance, 10_000_000 - bought.json.amount);
    const activity = (await shopper.get('/v1/store/wallet/transactions')).json.data;
    assert.deepEqual(activity.map(item => [item.type, item.amount]), [['wallet_purchase', -bought.json.amount], ['customer_top_up', 10_000_000]]);
    assert.equal(activity[0].checkout_id, bought.json.id);
    await ledgerOk();
  });

  test('the customer sees the price first: a preview pays nothing, and paying that quote charges exactly it, once', async () => {
    const product = await giftCard('Amazon Preview Card', ['PREVIEW-CODE-0001', 'PREVIEW-CODE-0002']);
    const shopper = await customer();
    await topUpWithStripe(shopper, 10_000_000);
    const preview = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl, preview: true });
    assert.equal(preview.status, 201, JSON.stringify(preview.json));
    assert.equal(preview.json.object, 'checkout_preview');
    assert.equal(preview.json.wallet_balance, 10_000_000);
    assert.equal((await shopper.get('/v1/store/wallet?country=NG')).json.balance, 10_000_000, 'nothing paid');
    assert.equal(await prisma.checkout.count({ where: { customerId: shopper.id } }), 0);

    const paid = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl, quote_id: preview.json.quote_id });
    assert.equal(paid.status, 201, JSON.stringify(paid.json));
    assert.deepEqual([paid.json.status, paid.json.amount], ['completed', preview.json.amount], 'exactly the price shown');
    const again = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl, quote_id: preview.json.quote_id });
    assert.deepEqual([again.status, again.json.error.code], [409, 'quote_expired'], 'a quote is paid once');
    const stranger = await customer();
    const theirs = await stranger.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl, preview: true });
    const stolen = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl, quote_id: theirs.json.quote_id });
    assert.deepEqual([stolen.status, stolen.json.error.code], [409, 'quote_expired'], "never another customer's quote");
    assert.equal((await shopper.get('/v1/store/wallet?country=NG')).json.balance, 10_000_000 - paid.json.amount);
    await ledgerOk();
  });

  test('a refunded wallet purchase goes back to the wallet, never to a card', async () => {
    const product = await giftCard('Amazon Return Card', ['RETURN-CODE-0001']);
    const shopper = await customer();
    await topUpWithStripe(shopper, 5_000_000);
    const bought = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.equal(bought.json.status, 'completed');
    const refundsBefore = Object.keys(stripe.state.refunds).length;
    const refunded = await admin.post(`/v1/admin/orders/${bought.json.order.id}/refund`, { reason: 'Customer could not redeem', supplier_refunded: false });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.equal((await shopper.get(`/v1/store/checkouts/${bought.json.id}`)).json.status, 'refunded');
    assert.equal((await shopper.get('/v1/store/wallet?country=NG')).json.balance, 5_000_000, 'all of it back in the wallet');
    assert.equal(Object.keys(stripe.state.refunds).length, refundsBefore, 'no card refund');
    await ledgerOk();
  });

  test('purchases at the same moment cannot overspend the wallet', async () => {
    const product = await giftCard('Amazon Race Card', ['RACE-CODE-0001', 'RACE-CODE-0002', 'RACE-CODE-0003', 'RACE-CODE-0004']);
    const first = await customer();
    await topUpWithStripe(first, 10_000_000);
    const price = (await first.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl })).json.amount;
    // Enough for one more purchase, not two.
    const racer = await customer();
    await topUpWithStripe(racer, price + Math.floor(price / 2));
    const results = await Promise.all([1, 2, 3].map(() => racer.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl })));
    assert.deepEqual(results.map(item => item.status).sort(), [201, 402, 402], JSON.stringify(results.map(item => item.json?.error?.code ?? item.json.status)));
    assert.ok(results.filter(item => item.status === 402).every(item => item.json.error.code === 'wallet_balance_low'));
    assert.equal((await racer.get('/v1/store/wallet?country=NG')).json.balance, Math.floor(price / 2));
    await ledgerOk();
  });

  test("a bank account number of the customer's own: Flutterwave transfers top the wallet up once (BVN in Nigeria, never kept)", async () => {
    const shopper = await customer();
    const noBvn = await shopper.post('/v1/store/wallet/reserved-accounts', { country: 'NG' });
    assert.deepEqual([noBvn.status, noBvn.json.error.code], [400, 'parameter_missing']);
    const opened = await shopper.post('/v1/store/wallet/reserved-accounts', { country: 'NG', bvn: '22222222222' });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    assert.equal(opened.json.data.length, 1);
    assert.equal(flw.calls.findLast(call => call.url === '/virtual-account-numbers').body.bvn, '22222222222');
    const account = await prisma.reservedAccount.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.equal(account.provider, 'flutterwave');
    assert.equal(JSON.stringify(account).includes('22222222222'), false, 'the BVN is not kept');
    assert.equal((await shopper.post('/v1/store/wallet/reserved-accounts', { country: 'NG' })).json.data[0].account_number, account.accountNumber, 'asked again: the same account');

    flw.state.charges[account.providerReference] = { id: 9700, status: 'successful', amount: 20000, currency: 'NGN', app_fee: 50 };
    await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9700 } });
    await flutterwaveWebhook({ event: 'charge.completed', data: { id: 9700 } });
    const wallet = (await shopper.get('/v1/store/wallet?country=NG')).json;
    assert.equal(wallet.balance, 2_000_000, 'credited once');
    assert.equal(wallet.reserved_accounts[0].account_number, account.accountNumber);
    const seller = await houseSeller();
    const sellerWallet = await prisma.ledgerAccount.findFirst({ where: { resellerId: seller, kind: 'reseller_funding', mode: 'live' } });
    assert.ok(!sellerWallet || sellerWallet.balanceMinor === 0n, "never the seller's money");
    await ledgerOk();
  });

  test('switched off for the market: customers pay at checkout again, and can still spend what is left', async () => {
    const product = await giftCard('Amazon Leftover Card', ['LEFT-CODE-0001']);
    const shopper = await customer();
    await topUpWithStripe(shopper, 5_000_000);
    const off = await admin.put('/v1/admin/switches/customer_wallets', { country_code: 'NG', enabled: false });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    try {
      const methods = await fetch(`${server.base}/v1/store/payment-methods?country=NG`).then(res => res.json());
      assert.deepEqual([methods.wallet_required, methods.data.map(item => item.id)], [false, ['stripe', 'flutterwave']]);
      const refused = await shopper.post('/v1/store/wallet/top-ups', { amount: 100_000, country: 'NG', return_url: returnUrl });
      assert.deepEqual([refused.status, refused.json.error.code], [409, 'wallets_not_enabled']);
      const card = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
      assert.equal(card.status, 201, JSON.stringify(card.json));
      assert.equal(card.json.method.id, 'stripe');
      const leftover = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', method: 'wallet', return_url: returnUrl });
      assert.equal(leftover.status, 201, JSON.stringify(leftover.json));
      assert.equal(leftover.json.method.id, 'wallet');
    } finally {
      await admin.put('/v1/admin/switches/customer_wallets', { country_code: 'NG', enabled: null });
    }
  });
});

describe("customer wallets on a reseller's store", () => {
  test('sandbox store: top-ups and transfers simulated; the owner sees the balance; an admin switches the reseller off', async () => {
    const reseller = await resellerClient(server);
    await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
    const created = await reseller.browser.post('/v1/stores', { name: 'Ada Gifts', subdomain: `ada${Date.now().toString(36)}` });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal((await reseller.browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
    const store = { id: created.json.id, subdomain: created.json.subdomain };
    const shopper = await customer(store.subdomain);

    const wallet = (await shopper.get('/v1/store/wallet')).json;
    assert.deepEqual([wallet.mode, wallet.currency, wallet.enabled], ['test', 'NGN', true]);
    const topUp = await shopper.post('/v1/store/wallet/top-ups', { amount: 300_000, return_url: returnUrl });
    assert.equal(topUp.status, 201, JSON.stringify(topUp.json));
    assert.equal(topUp.json.method.id, 'sandbox');
    assert.equal((await shopper.post(`/v1/store/wallet/top-ups/${topUp.json.id}/simulate`, { outcome: 'succeeded' })).json.status, 'succeeded');
    const accounts = await shopper.post('/v1/store/wallet/reserved-accounts', {});
    assert.equal(accounts.status, 200, JSON.stringify(accounts.json));
    const deposit = await shopper.post(`/v1/store/wallet/reserved-accounts/${accounts.json.data[0].id}/simulate-deposit`, { amount: 200_000 });
    assert.equal(deposit.json.credited, true);
    assert.equal((await shopper.get('/v1/store/wallet')).json.balance, 500_000);

    const detail = await reseller.browser.get(`/v1/stores/${store.id}/customers/${shopper.id}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.deepEqual(detail.json.wallet, [{ mode: 'test', currency: 'NGN', balance: 500_000 }]);
    assert.equal((await reseller.browser.get('/v1/wallet/reserved-accounts', { 'bitocard-mode': 'test' })).json.data.length, 0, "the customer's account is not the reseller's");

    assert.equal((await admin.put('/v1/admin/switches/customer_wallets', { reseller_id: reseller.resellerId, enabled: false })).status, 200);
    const methods = await fetch(`${server.base}/v1/store/payment-methods?country=NG&store=${store.subdomain}`).then(res => res.json()); // as the store's server asks (cacheable)
    assert.equal(methods.wallet_required, false, 'switched off for this reseller only');
    assert.equal((await fetch(`${server.base}/v1/store/payment-methods?country=NG`).then(res => res.json())).wallet_required, true, 'bitocard.com unchanged');
    await ledgerOk();
  });
});
