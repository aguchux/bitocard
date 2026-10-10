// Checkout beyond bitocard.com's first sale: finance refunding delivered checkout orders to the customer, checkout on
// resellers' hosted stores (their listed products, their customers, sandbox until they go live), and payments into a
// reseller's own payment gateway (own integrations, phase 4: BitoCard's fee and the order's cost from their wallet,
// never the customer's money).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, resellerClient, startApp, listForTest } from './helpers.mjs';
import { fakeFlutterwave, fakeStripe } from './fakes.mjs';

let server;
let admin;
let prisma;
let wallets;
let stripe;
let flw;

before(async () => {
  [stripe, flw] = await Promise.all([fakeStripe(), fakeFlutterwave()]);
  server = await startApp({ env: { ...stripe.env, ...flw.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  // Paying at checkout (customer wallets, on by default, are tested in customer-wallets.test.mjs).
  await prisma.featureSwitch.create({ data: { key: 'customer_wallets', enabled: false } });
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  admin = await adminClient(server);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await prisma.countryCategory.upsert({
    where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } },
    create: { countryCode: 'NG', category: 'gift_cards', enabled: true },
    update: { enabled: true, customerVerification: false },
  });
  // bitocard.com sells live (its sandbox switch off); BitoCard's checkout methods in Nigeria: Stripe, then Flutterwave.
  const sandboxOff = await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: false }, code: await adminCode(server, admin) });
  assert.equal(sandboxOff.status, 200, JSON.stringify(sandboxOff.json));
  assert.equal((await admin.put('/v1/admin/countries/NG/payment-methods', { purpose: 'checkout', enabled: ['stripe', 'flutterwave'] })).status, 200);
});

after(async () => {
  await server?.close();
  await Promise.all([stripe?.close(), flw?.close()]);
});

const returnUrl = 'https://shop.example/checkout/return';
const balance = async (resellerId, mode, kind) => (await prisma.ledgerAccount.findFirst({ where: { resellerId, mode, kind } }))?.balanceMinor ?? 0n;
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const runJob = job => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } });

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

/** A store's server: its store named in `BitoCard-Store` (none: bitocard.com), the customer's session in a header. */
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

async function customer(subdomain = null) {
  const shopper = storeServer(subdomain);
  const email = `buyer${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.email = email;
  shopper.id = signup.json.customer.id;
  return shopper;
}

const checkoutRow = id => prisma.checkout.findUniqueOrThrow({ where: { id }, include: { payment: true } });

/** Marks a Stripe Checkout session paid, then the customer opens their order (which checks the payment). */
async function payOnStripe(shopper, checkoutId) {
  const row = await checkoutRow(checkoutId);
  Object.assign(stripe.state.sessions[row.payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
  return (await shopper.get(`/v1/store/checkouts/${checkoutId}`)).json;
}

describe('refunding delivered checkout orders', () => {
  test('finance refunds a delivered bitocard.com order: the sale is reversed and the customer refunded once through Stripe', async () => {
    const product = await giftCard('Amazon Refund Card', ['REFUND-CODE-0001']);
    const shopper = await customer();
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const done = await payOnStripe(shopper, started.json.id);
    assert.deepEqual([done.status, done.order.status], ['completed', 'completed']);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: done.order.id } });
    const seller = order.resellerId;

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Customer could not redeem', supplier_refunded: false })).status, 403);
    const refunded = await admin.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Customer could not redeem', supplier_refunded: false });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.equal(refunded.json.status, 'refunded');
    assert.deepEqual([refunded.json.checkout.id, refunded.json.checkout.own_gateway, refunded.json.checkout.gateway], [started.json.id, false, 'stripe'], 'admins see the store checkout');

    const after = await shopper.get(`/v1/store/checkouts/${started.json.id}`);
    assert.deepEqual([after.json.status, Boolean(after.json.refunded_at)], ['refunded', true]);
    const row = await checkoutRow(started.json.id);
    assert.equal(row.refundKind, 'admin');
    const refunds = Object.values(stripe.state.refunds).filter(item => item['metadata[reference]'] === `bc_rf_${started.json.id.replaceAll('-', '')}`);
    assert.deepEqual(refunds.map(item => [item.amount, item.key]), [[String(row.amountMinor), 'sk_live_fake']], 'in full, once, from BitoCard’s Stripe');
    assert.equal(await balance(seller, 'live', 'customer_payments'), 0n);
    const reversal = await prisma.journalEntry.findUniqueOrThrow({ where: { reference: `order_refund:${order.id}` } });
    assert.equal(reversal.type, 'order_refund');
    const types = (await prisma.notification.findMany({ where: { customerId: shopper.id }, orderBy: { createdAt: 'asc' } })).map(item => item.type);
    assert.deepEqual(types, ['customer.order.completed', 'customer.order.refunded']);
    assert.equal((await admin.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Again', supplier_refunded: false })).json.error.code, 'order_not_refundable');
    assert.equal((await runJob('checkout')).status, 200);
    assert.equal(Object.values(stripe.state.refunds).filter(item => item['metadata[reference]'] === `bc_rf_${started.json.id.replaceAll('-', '')}`).length, 1, 'still once');
    await ledgerOk();
  });

  test('the store’s margin is taken back: from held earnings, and once released from withdrawable earnings', async () => {
    const product = await giftCard('Amazon Released Card', ['RELEASED-CODE-0001', 'RELEASED-CODE-0002']);
    // BitoCard's stock costs less than face value: a discount product. BitoCard passes 10% of face value to the store.
    await prisma.pricingRule.create({ data: { productId: product.id, kind: 'discount', marginBps: 0, resellerDiscountBps: 1000 } });
    const store = await resellerStore([product], { live: true });
    const held = await customer(store.subdomain);
    const first = await held.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    const delivered = await payOnStripe(held, first.json.id);
    const sale = await prisma.order.findUniqueOrThrow({ where: { id: delivered.order.id } });
    assert.ok(sale.resellerProfitMinor > 0n, 'the store earned its share of the discount');
    assert.equal(await balance(store.resellerId, 'live', 'reseller_earnings_held'), sale.resellerProfitMinor);
    assert.equal((await admin.post(`/v1/admin/orders/${sale.id}/refund`, { reason: 'Customer complaint', supplier_refunded: false })).status, 200);
    assert.equal(await balance(store.resellerId, 'live', 'reseller_earnings_held'), 0n, 'the margin is taken back');
    const lot = await prisma.earningsLot.findUniqueOrThrow({ where: { reference: `order:${sale.id}` } });
    assert.ok(lot.reversedAt && lot.releasedAt, 'and never released');
    assert.equal(await balance(store.resellerId, 'live', 'customer_payments'), 0n);

    const shopper = await customer(store.subdomain);
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    const done = await payOnStripe(shopper, started.json.id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: done.order.id } });
    await prisma.earningsLot.update({ where: { reference: `order:${order.id}` }, data: { releaseAt: new Date(Date.now() - 1000) } });
    await wallets.releaseDueEarnings();
    const before = await balance(order.resellerId, 'live', 'reseller_earnings');
    const refunded = await admin.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Duplicate purchase', supplier_refunded: true });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.equal(await balance(order.resellerId, 'live', 'reseller_earnings'), before - order.resellerProfitMinor);
    assert.ok(order.resellerProfitMinor > 0n);
    assert.equal((await checkoutRow(started.json.id)).status, 'refunded');

    // Withdrawn already: refused, so finance refunds by hand instead of the wallet going negative.
    const third = await customer(store.subdomain);
    const product2 = await giftCard('Amazon Withdrawn Card', ['WITHDRAWN-CODE-0001']);
    await prisma.pricingRule.create({ data: { productId: product2.id, kind: 'discount', marginBps: 0, resellerDiscountBps: 1000 } });
    await listForTest(server, { resellerId: store.resellerId, productIds: [product2.id] });
    const last = await third.post('/v1/store/checkouts', { product_id: product2.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    const sold = await prisma.order.findUniqueOrThrow({ where: { id: (await payOnStripe(third, last.json.id)).order.id } });
    await prisma.earningsLot.update({ where: { reference: `order:${sold.id}` }, data: { releaseAt: new Date(Date.now() - 1000) } });
    await wallets.releaseDueEarnings();
    const earned = await balance(store.resellerId, 'live', 'reseller_earnings');
    await wallets.adjust(null, { resellerId: store.resellerId, mode: 'live', balance: 'earnings', amount: -Number(earned), reason: 'Withdrawn' });
    const refused = await admin.post(`/v1/admin/orders/${sold.id}/refund`, { reason: 'Too late', supplier_refunded: false });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'earnings_withdrawn']);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: sold.id } })).status, 'completed', 'nothing changed');
    assert.equal((await checkoutRow(last.json.id)).status, 'completed');
    await ledgerOk();
  });
});

/** A verified reseller (confirmed email, active) with a published store on <subdomain>.bitocard.com listing `products`. */
async function resellerStore(products, { live = false, premium = false, markup = 0 } = {}) {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', ...(premium ? { planCode: 'premium' } : {}) } });
  if (markup) await prisma.resellerMarkup.create({ data: { resellerId: reseller.resellerId, category: 'gift_cards', markupBps: markup } });
  const subdomain = `shop${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);
  const created = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.checkout_mode, 'test', 'checkout starts in the sandbox');
  assert.equal((await reseller.browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
  if (products.length) {
    await listForTest(server, { resellerId: reseller.resellerId, productIds: products.map(item => item.id) });
  }
  if (live) {
    const updated = await reseller.browser.patch(`/v1/stores/${created.json.id}`, { checkout_mode: 'live' });
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
  }
  return { ...reseller, subdomain, storeId: created.json.id };
}

describe('checkout on resellers’ hosted stores', () => {
  let listed;
  let unlisted;

  before(async () => {
    listed = await giftCard('Amazon Store Card', ['STORE-CODE-0001', 'STORE-CODE-0002']);
    unlisted = await giftCard('Amazon Unlisted Card', ['UNLISTED-CODE-0001']);
  });

  test('the store shows only what the reseller listed, in their country; bitocard.com is unchanged', async () => {
    const { subdomain } = await resellerStore([listed]);
    const products = await fetch(`${server.base}/v1/store/products?store=${subdomain}`).then(res => res.json());
    assert.deepEqual(products.data.map(item => item.key), [listed.key]);
    const page = await fetch(`${server.base}/v1/store/products/${encodeURIComponent(unlisted.key)}?store=${subdomain}`);
    assert.equal(page.status, 404, 'unlisted products are not on the store');
    const home = await fetch(`${server.base}/v1/store/home?store=${subdomain}&market=GH`).then(res => res.json());
    assert.deepEqual(home.countries.map(item => item.code), ['NG'], 'a store sells in its own country');
    assert.ok(!JSON.stringify(home).includes('/resellers'), 'nothing about selling on BitoCard');
    const bitocard = await fetch(`${server.base}/v1/store/products?market=NG`).then(res => res.json());
    assert.ok(bitocard.data.some(item => item.key === unlisted.key), 'bitocard.com still shows what admins listed');
    assert.equal((await fetch(`${server.base}/v1/store/products?store=nosuchstore1`)).status, 404);
  });

  test('accounts belong to one store: a session from one store is refused at another', async () => {
    const { subdomain } = await resellerStore([listed]);
    const shopper = await customer(subdomain);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id }, include: { store: true } });
    assert.equal(row.store.subdomain, subdomain);
    const elsewhere = storeServer();
    elsewhere.token = shopper.token;
    assert.equal((await elsewhere.get('/v1/store/account')).status, 401, 'not a bitocard.com session');
    assert.equal((await storeServer().post('/v1/store/account/signin', { email: shopper.email, password: 'correct horse battery' })).status, 401, 'no account at bitocard.com');
    assert.equal((await storeServer('nosuchstore1').post('/v1/store/account/signup', { name: 'Ada', email: 'a@example.com', password: 'correct horse battery' })).json.error.code, 'store_unavailable');
  });

  test('in the sandbox, the reseller sells: the customer pays, the order is delivered, and the margin is the reseller’s', async () => {
    const { subdomain, resellerId } = await resellerStore([listed]);
    const shopper = await customer(subdomain);
    const methods = await shopper.get('/v1/store/payment-methods?country=GH');
    assert.deepEqual([methods.json.mode, methods.json.data.map(item => item.id)], ['test', ['stripe', 'flutterwave']]);
    const refused = await shopper.post('/v1/store/checkouts', { product_id: unlisted.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.equal(refused.json.error.code, 'resource_missing', 'only listed products');
    const started = await shopper.post('/v1/store/checkouts', { product_id: listed.id, face_value: 2500, country: 'GH', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.deepEqual([started.json.mode, started.json.currency], ['test', 'NGN'], 'the reseller’s country and currency');
    const paid = await shopper.post(`/v1/store/checkouts/${started.json.id}/simulate`, { outcome: 'succeeded' });
    assert.deepEqual([paid.json.status, paid.json.order.status], ['completed', 'completed']);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: paid.json.order.id } });
    assert.deepEqual([order.resellerId, order.customerId, order.mode], [resellerId, shopper.id, 'test']);
    assert.equal(await balance(resellerId, 'test', 'reseller_earnings_held'), order.resellerProfitMinor);
    assert.equal(await balance(resellerId, 'test', 'customer_payments'), 0n);
  });

  test('live checkout needs a verified business; customers then pay through BitoCard’s gateway', async () => {
    const store = await resellerStore([listed]);
    await prisma.reseller.update({ where: { id: store.resellerId }, data: { status: 'pending' } });
    const refused = await store.browser.patch(`/v1/stores/${store.storeId}`, { checkout_mode: 'live' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'reseller_not_verified']);
    await prisma.reseller.update({ where: { id: store.resellerId }, data: { status: 'active' } });
    assert.equal((await store.browser.patch(`/v1/stores/${store.storeId}`, { checkout_mode: 'live' })).json.checkout_mode, 'live');
    const lookup = await fetch(`${server.base}/v1/storefronts/${store.subdomain}`).then(res => res.json());
    assert.equal(lookup.checkout_mode, 'live');

    const shopper = await customer(store.subdomain);
    const started = await shopper.post('/v1/store/checkouts', { product_id: listed.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.match(started.json.checkout_url, /^https:\/\/checkout\.stripe\.com\//);
    const done = await payOnStripe(shopper, started.json.id);
    assert.deepEqual([done.status, done.order.deliveries.length], ['completed', 1]);
    const payment = (await checkoutRow(started.json.id)).payment;
    assert.deepEqual([payment.resellerId, payment.connectionId], [store.resellerId, null]);
    assert.ok(await prisma.journalEntry.findUnique({ where: { reference: `payment:${payment.id}` } }), 'the payment came through BitoCard’s ledger');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: done.order.id } });
    assert.equal(await balance(store.resellerId, 'live', 'reseller_earnings_held'), order.resellerProfitMinor);
    await ledgerOk();
  });
});

describe('payments into a reseller’s own gateway', () => {
  let product;

  before(async () => {
    product = await giftCard('Amazon Own Gateway Card', ['OWN-CODE-0001', 'OWN-CODE-0002', 'OWN-CODE-0003', 'OWN-CODE-0004']);
    assert.equal((await admin.put('/v1/admin/integrations/stripe/reseller-access', { enabled: true })).status, 200);
    assert.equal((await admin.put('/v1/admin/integrations/stripe/reseller-availability', { global: true, countries: [], approval: 'automatic' })).status, 200);
    // 1% of each payment through a reseller's own gateway in Nigeria.
    assert.equal((await admin.put('/v1/admin/fee-rules', { kind: 'gateway_payment', country_code: 'NG', rate_ppb: 10_000_000 })).status, 200);
  });

  /** A live reseller store with their own Stripe account connected and money in their wallet. */
  async function ownGatewayStore({ funding = 5_000_000 } = {}) {
    const store = await resellerStore([product], { live: true, premium: true });
    await admin.put('/v1/admin/switches/own_integrations', { reseller_id: store.resellerId, enabled: true });
    if (funding) await wallets.adjust(null, { resellerId: store.resellerId, mode: 'live', balance: 'funding', amount: funding, reason: 'Test funding' });
    const connected = await store.browser.put('/v1/integrations/stripe/connection', { values: { secret_key: 'sk_live_reseller_own' } });
    assert.equal(connected.status, 200, JSON.stringify(connected.json));
    assert.equal(connected.json.connection.status, 'active');
    return store;
  }

  test('the customer pays into the reseller’s Stripe; BitoCard charges its fee and the order’s cost from their wallet', async () => {
    const store = await ownGatewayStore();
    const shopper = await customer(store.subdomain);
    const methods = await shopper.get('/v1/store/payment-methods?country=NG');
    assert.deepEqual(methods.json.data.map(item => item.id), ['stripe', 'flutterwave'], 'their own Stripe replaces BitoCard’s');

    const fundingBefore = await balance(store.resellerId, 'live', 'reseller_funding');
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', method: 'stripe', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const row = await checkoutRow(started.json.id);
    assert.ok(row.connectionId && row.payment.connectionId === row.connectionId);
    assert.equal(stripe.state.sessions[row.payment.providerTransactionId].key, 'sk_live_reseller_own', 'the payment page is on the reseller’s account');
    const fee = await prisma.feeCharge.findUniqueOrThrow({ where: { id: row.feeChargeId } });
    assert.deepEqual([fee.kind, fee.status, fee.baseMinor], ['gateway_payment', 'held', row.amountMinor]);

    const done = await payOnStripe(shopper, started.json.id);
    assert.deepEqual([done.status, done.order.status], ['completed', 'completed']);
    assert.equal(await prisma.journalEntry.findUnique({ where: { reference: `payment:${row.paymentId}` } }), null, 'the customer’s money never enters BitoCard’s ledger');
    const charged = await prisma.feeCharge.findUniqueOrThrow({ where: { id: row.feeChargeId } });
    assert.equal(charged.status, 'charged');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: done.order.id } });
    assert.equal(
      await balance(store.resellerId, 'live', 'reseller_funding'),
      fundingBefore - order.wholesaleMinor - order.taxMinor - charged.chargedMinor,
      'the wholesale and BitoCard’s fee come from the wallet',
    );
    assert.equal(await balance(store.resellerId, 'live', 'reseller_earnings_held'), 0n, 'the margin is already in their own account');
    assert.equal(await balance(store.resellerId, 'live', 'customer_payments'), 0n);

    // Finance refunds it: the wholesale goes back to the wallet and the customer is refunded from the reseller's Stripe.
    const refunded = await admin.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Customer complaint', supplier_refunded: false });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.equal(refunded.json.checkout.own_gateway, true);
    const refund = Object.values(stripe.state.refunds).find(item => item['metadata[reference]'] === `bc_rf_${started.json.id.replaceAll('-', '')}`);
    assert.equal(refund.key, 'sk_live_reseller_own');
    assert.equal((await checkoutRow(started.json.id)).status, 'refunded');
    assert.equal(await prisma.journalEntry.findUnique({ where: { reference: `checkout_refund:${started.json.id}` } }), null);
    assert.equal(await balance(store.resellerId, 'live', 'reseller_funding'), fundingBefore - charged.chargedMinor, 'the wholesale is back; BitoCard keeps its fee on a delivered sale');
    await ledgerOk();
  });

  test('a failed order is refunded through the reseller’s Stripe and BitoCard’s fee returned', async () => {
    const store = await ownGatewayStore();
    const shopper = await customer(store.subdomain);
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    // The stock runs out before payment: the order is refused once paid.
    await prisma.stockCode.updateMany({ where: { status: 'available', offer: { productId: product.id } }, data: { status: 'withdrawn' } });
    const done = await payOnStripe(shopper, started.json.id);
    assert.equal(done.status, 'refunded', JSON.stringify(done));
    const row = await checkoutRow(started.json.id);
    assert.equal(row.refundKind, 'undelivered');
    assert.equal((await prisma.feeCharge.findUniqueOrThrow({ where: { id: row.feeChargeId } })).status, 'refunded');
    assert.equal(await balance(store.resellerId, 'live', 'reseller_funding'), 5_000_000n, 'nothing kept');
    await prisma.stockCode.updateMany({ where: { status: 'withdrawn', offer: { productId: product.id } }, data: { status: 'available' } });
    await ledgerOk();
  });

  test('a wallet that cannot cover the order turns the customer away before they pay, and tells the reseller', async () => {
    const store = await ownGatewayStore({ funding: 0 });
    const shopper = await customer(store.subdomain);
    const refused = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.deepEqual([refused.status, refused.json.error.code], [503, 'store_checkout_unavailable']);
    assert.ok(!/wallet|fee/i.test(refused.json.error.message), 'customers are not told why');
    assert.equal(await prisma.checkout.count({ where: { customerId: shopper.id } }), 0);
    assert.equal(await prisma.feeCharge.count({ where: { resellerId: store.resellerId, status: 'held' } }), 0, 'no fee left held');
    const note = await prisma.notification.findFirst({ where: { type: 'store.checkout_refused' }, orderBy: { createdAt: 'desc' } });
    assert.ok(note);
  });

  test('switched to fallback, BitoCard’s gateway is used where it offers the same method; switched off, never', async () => {
    const store = await ownGatewayStore();
    assert.equal((await store.browser.put('/v1/integrations/stripe/connection/routing', { routing: 'fallback' })).status, 204);
    const shopper = await customer(store.subdomain);
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', method: 'stripe', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.equal((await checkoutRow(started.json.id)).connectionId, null, 'BitoCard’s Stripe');
    assert.equal((await admin.put('/v1/admin/integrations/stripe/reseller-access', { enabled: false })).status, 200);
    try {
      assert.equal((await store.browser.put('/v1/integrations/stripe/connection/routing', { routing: 'preferred' })).status, 204);
      const again = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', method: 'stripe', return_url: returnUrl });
      assert.equal((await checkoutRow(again.json.id)).connectionId, null, 'access switched off: never their account');
    } finally {
      assert.equal((await admin.put('/v1/admin/integrations/stripe/reseller-access', { enabled: true })).status, 200);
    }
  });

  test('an unpaid payment on a gateway that can no longer be checked is closed, and BitoCard’s fee hold returned', async () => {
    const store = await ownGatewayStore();
    const shopper = await customer(store.subdomain);
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const row = await checkoutRow(started.json.id);
    assert.equal((await prisma.feeCharge.findUniqueOrThrow({ where: { id: row.feeChargeId } })).status, 'held');
    assert.equal((await admin.put('/v1/admin/integrations/stripe/reseller-access', { enabled: false })).status, 200);
    try {
      const cron = () => fetch(`${server.base}/v1/cron/payments`, { headers: { authorization: 'Bearer cron-secret' } });
      await prisma.payment.update({ where: { id: row.paymentId }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
      assert.equal((await cron()).status, 200);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: row.paymentId } })).status, 'pending', 'still inside its lifetime');
      await prisma.payment.update({ where: { id: row.paymentId }, data: { createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) } });
      assert.equal((await cron()).status, 200);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: row.paymentId } })).status, 'failed');
      assert.equal((await checkoutRow(started.json.id)).status, 'failed');
      assert.equal((await prisma.feeCharge.findUniqueOrThrow({ where: { id: row.feeChargeId } })).status, 'released');
      assert.equal(await balance(store.resellerId, 'live', 'reseller_funding'), 5_000_000n, 'nothing kept');
    } finally {
      assert.equal((await admin.put('/v1/admin/integrations/stripe/reseller-access', { enabled: true })).status, 200);
    }
  });
});


describe('the customer account app', () => {
  test('the summary shows what the customer spent, their orders and this month’s deliveries, and only theirs', async () => {
    const product = await giftCard('Amazon Summary Card', ['SUMMARY-CODE-0001']);
    const { subdomain } = await resellerStore([product]);
    const shopper = await customer(subdomain);
    const empty = await shopper.get('/v1/store/account/summary');
    assert.deepEqual(empty.json, { object: 'customer_summary', orders_total: [], orders: { total: 0, in_progress: 0 }, delivered_this_month: 0 });

    const start = () => shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    const delivered = (await start()).json;
    await shopper.post(`/v1/store/checkouts/${delivered.id}/simulate`, { outcome: 'succeeded' });
    const refunded = (await start()).json;
    await shopper.post(`/v1/store/checkouts/${refunded.id}/simulate`, { outcome: 'succeeded', order: 'failed' });
    await start(); // waiting for payment
    const unpaid = (await start()).json;
    await shopper.post(`/v1/store/checkouts/${unpaid.id}/simulate`, { outcome: 'failed' });

    const summary = (await shopper.get('/v1/store/account/summary')).json;
    assert.deepEqual(summary.orders_total, [{ amount: delivered.amount, currency: 'NGN' }], 'delivered orders only');
    assert.deepEqual(summary.orders, { total: 3, in_progress: 1 }, 'unpaid checkouts are not orders');
    assert.equal(summary.delivered_this_month, 1);

    // The orders list filters on the server, so each page of a filter is full.
    const shown = async show => (await shopper.get(`/v1/store/checkouts?limit=1${show ? `&show=${show}` : ''}`)).json;
    assert.deepEqual((await shown('delivered')).data.map(item => item.id), [delivered.id]);
    assert.deepEqual((await shown('refunded')).data.map(item => item.id), [refunded.id]);
    assert.equal((await shown('progress')).data[0].status, 'awaiting_payment');
    assert.equal((await shown()).has_more, true);
    assert.equal((await shopper.get('/v1/store/checkouts?show=everything')).status, 400);

    assert.equal((await storeServer(subdomain).get('/v1/store/account/summary')).status, 401);
    assert.equal((await customer(subdomain).then(other => other.get('/v1/store/account/summary'))).json.orders.total, 0);
  });

  test('the desktop menu: BitoCard’s switch sets the default, a reseller’s choice for their store wins', async () => {
    const appFor = async store => (await fetch(`${server.base}/v1/store/app${store ? `?store=${store}` : ''}`).then(res => res.json())).desktop_nav;
    const { subdomain, storeId, browser, resellerId } = await resellerStore([]);
    assert.deepEqual([await appFor(null), await appFor(subdomain)], ['rail', 'rail'], 'the side rail by default');
    try {
      assert.equal((await admin.put('/v1/admin/switches/customer_app_bottom_bar_desktop', { enabled: true })).status, 200);
      assert.deepEqual([await appFor(null), await appFor(subdomain)], ['bottom', 'bottom']);
      const chosen = await browser.patch(`/v1/stores/${storeId}`, { desktop_nav: 'rail' });
      assert.deepEqual([chosen.status, chosen.json.desktop_nav], [200, 'rail']);
      assert.equal(await appFor(subdomain), 'rail', 'the reseller overrides BitoCard');
      const lookup = await fetch(`${server.base}/v1/storefronts/${subdomain}`).then(res => res.json());
      assert.deepEqual(lookup.app, { desktop_nav: 'rail' });
      assert.equal((await browser.patch(`/v1/stores/${storeId}`, { desktop_nav: null })).json.desktop_nav, null);
      assert.equal(await appFor(subdomain), 'bottom', 'null follows BitoCard again');
      assert.equal((await admin.put('/v1/admin/switches/customer_app_bottom_bar_desktop', { reseller_id: resellerId, enabled: false })).status, 200);
      assert.equal(await appFor(subdomain), 'rail', 'an admin switch for the reseller');
      assert.equal((await browser.patch(`/v1/stores/${storeId}`, { desktop_nav: 'sideways' })).status, 400);
    } finally {
      await admin.put('/v1/admin/switches/customer_app_bottom_bar_desktop', { enabled: null });
    }
  });
});

describe('who is asked for the identity check', () => {
  let product;
  const giftCardsCheck = on => prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } }, data: { customerVerification: on } });
  const start = shopper => shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
  const refused = async shopper => {
    const res = await start(shopper);
    return res.status === 403 && res.json.error.code === 'customer_verification_required';
  };

  before(async () => {
    product = await giftCard('Amazon Checked Card', ['CHECKED-CODE-0001', 'CHECKED-CODE-0002', 'CHECKED-CODE-0003', 'CHECKED-CODE-0004']);
    await giftCardsCheck(true);
  });
  after(async () => {
    await giftCardsCheck(false);
    await prisma.store.update({ where: { id: '00000000-0000-4000-8000-0000000000b2' }, data: { customerVerification: true, verificationGraceDays: null } });
    await prisma.supplier.update({ where: { code: 'stock' }, data: { customerVerification: true } });
  });

  test('bitocard.com: BitoCard turns it off for one customer, for a supplier, for every customer, or until days after a first purchase', async () => {
    const shopper = await customer();
    assert.ok(await refused(shopper), 'the market requires it for gift cards');

    // One customer, by an operations admin (audited); support can look but not change.
    const support = await adminClient(server, ['support']);
    const listed = (await support.get(`/v1/admin/storefront/customers?q=${encodeURIComponent(shopper.email)}`)).json.data;
    assert.deepEqual(listed.map(item => [item.id, item.identity_check, item.identity_checked]), [[shopper.id, true, false]]);
    assert.equal((await support.patch(`/v1/admin/storefront/customers/${shopper.id}`, { identity_check: false })).status, 403);
    const off = await admin.patch(`/v1/admin/storefront/customers/${shopper.id}`, { identity_check: false });
    assert.deepEqual([off.status, off.json.identity_check, off.json.identity_checked], [200, false, false], 'off is never checked');
    assert.equal((await admin.patch(`/v1/admin/storefront/customers/${shopper.id}`, { identity_checked: true })).status, 400, 'nobody can mark a customer checked');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'customer.identity_check_off', targetId: shopper.id } }));
    assert.equal((await start(shopper)).status, 201);

    // A supplier: BitoCard's stock needs no check.
    const other = await customer();
    assert.equal((await admin.patch('/v1/admin/suppliers/stock', { customer_verification: false })).status, 200);
    assert.equal((await start(other)).status, 201);
    await admin.patch('/v1/admin/suppliers/stock', { customer_verification: true });
    assert.ok(await refused(other));

    // Every bitocard.com customer.
    const settings = await admin.put('/v1/admin/storefront/settings', { customer_verification: false });
    assert.deepEqual([settings.json.customer_verification, settings.json.grace_days], [false, null]);
    assert.equal((await start(other)).status, 201);

    // Only after 7 days from their first paid purchase: buy first, asked once the days have passed.
    assert.equal((await admin.put('/v1/admin/storefront/settings', { customer_verification: true, grace_days: 7 })).json.grace_days, 7);
    const tester = await customer();
    const first = await start(tester);
    assert.equal(first.status, 201, 'no purchase yet: they can try products first');
    await prisma.checkout.update({ where: { id: first.json.id }, data: { status: 'completed', createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    assert.equal((await start(tester)).status, 201, 'within 7 days of their first purchase');
    await prisma.checkout.update({ where: { id: first.json.id }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    assert.ok(await refused(tester), 'asked once 7 days have passed');
    assert.equal((await admin.put('/v1/admin/storefront/settings', { grace_days: 0 })).status, 400);
    await admin.put('/v1/admin/storefront/settings', { grace_days: null });
  });

  test('a reseller’s store: the reseller turns it off for one customer or all; BitoCard’s bitocard.com settings never apply', async () => {
    const store = await resellerStore([product]);
    const shopper = await customer(store.subdomain);
    assert.ok(await refused(shopper), 'the market requires it at their store too');

    // BitoCard's bitocard.com settings do not reach resellers' customers, and admins cannot change them.
    await admin.put('/v1/admin/storefront/settings', { customer_verification: false });
    await admin.patch('/v1/admin/suppliers/stock', { customer_verification: false });
    assert.ok(await refused(shopper));
    await admin.put('/v1/admin/storefront/settings', { customer_verification: true });
    await admin.patch('/v1/admin/suppliers/stock', { customer_verification: true });
    assert.equal((await admin.patch(`/v1/admin/storefront/customers/${shopper.id}`, { identity_check: false })).status, 404);

    // One customer.
    const list = (await store.browser.get(`/v1/stores/${store.storeId}/customers`)).json;
    assert.deepEqual(list.data.map(item => [item.id, item.identity_check]), [[shopper.id, true]]);
    const off = await store.browser.patch(`/v1/stores/${store.storeId}/customers/${shopper.id}`, { identity_check: false });
    assert.deepEqual([off.status, off.json.identity_check, off.json.identity_checked], [200, false, false]);
    assert.equal((await start(shopper)).status, 201);
    const other = await resellerStore([]);
    assert.equal((await other.browser.get(`/v1/stores/${store.storeId}/customers`)).status, 404, 'only their own store');

    // Everyone at their store.
    const second = await customer(store.subdomain);
    assert.ok(await refused(second));
    const updated = await store.browser.patch(`/v1/stores/${store.storeId}`, { customer_verification: false });
    assert.deepEqual([updated.status, updated.json.customer_verification], [200, false]);
    assert.equal((await start(second)).status, 201);
  });
});

describe('store owners manage their customers', () => {
  let product;
  before(async () => {
    product = await giftCard('Amazon Managed Card', ['MANAGED-CODE-0001', 'MANAGED-CODE-0002']);
  });

  test('bitocard.com: admins open a customer with their purchases, disable, re-enable, unlock and sign them out; audited', async () => {
    const shopper = await customer();
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
    await payOnStripe(shopper, started.json.id);
    const support = await adminClient(server, ['support']);

    const detail = (await support.get(`/v1/admin/storefront/customers/${shopper.id}`)).json;
    assert.deepEqual([detail.object, detail.email, detail.status, detail.purchases, detail.signed_in_sessions], ['store_customer_detail', shopper.email, 'active', 1, 1]);
    assert.deepEqual(detail.purchases_list.map(item => [item.id, item.status, item.product, item.currency]), [[started.json.id, 'completed', 'Amazon Managed Card', 'NGN']]);
    assert.ok(detail.purchases_list[0].order_id);
    assert.equal(JSON.stringify(detail).includes('MANAGED-CODE'), false, 'never the codes');

    await prisma.customer.update({ where: { id: shopper.id }, data: { failedSignIns: 5, lockedUntil: new Date(Date.now() + 600_000) } });
    assert.ok((await support.get(`/v1/admin/storefront/customers/${shopper.id}`)).json.locked_until);
    assert.equal((await support.post(`/v1/admin/storefront/customers/${shopper.id}/unlock`)).json.locked_until, null, 'support can unlock');

    assert.equal((await support.patch(`/v1/admin/storefront/customers/${shopper.id}`, { status: 'disabled' })).status, 403, 'only operations disable');
    const disabled = await admin.patch(`/v1/admin/storefront/customers/${shopper.id}`, { status: 'disabled' });
    assert.deepEqual([disabled.json.status, disabled.json.signed_in_sessions], ['disabled', 0], 'signed out everywhere');
    assert.equal((await shopper.get('/v1/store/checkouts')).status, 401, 'a disabled customer cannot use the store');
    assert.equal((await admin.patch(`/v1/admin/storefront/customers/${shopper.id}`, { status: 'active' })).json.status, 'active');

    const again = storeServer(null);
    assert.equal((await again.post('/v1/store/account/signin', { email: shopper.email, password: 'correct horse battery' })).status, 200);
    assert.equal((await support.post(`/v1/admin/storefront/customers/${shopper.id}/sign-out`)).json.signed_in_sessions, 0);
    assert.equal((await again.get('/v1/store/checkouts')).status, 401);
    const actions = (await prisma.auditLog.findMany({ where: { targetId: shopper.id }, orderBy: { createdAt: 'asc' } })).map(row => row.action);
    assert.deepEqual(actions, ['customer.unlocked', 'customer.disabled', 'customer.enabled', 'customer.signed_out']);
  });

  test('bitocard.com settings: identity checks and the desktop menu; the checkout mode is shown', async () => {
    const settings = (await admin.get('/v1/admin/storefront/settings')).json;
    assert.deepEqual([settings.object, settings.customer_verification, settings.desktop_nav, settings.checkout_mode], ['storefront_settings', true, null, 'live']);
    const saved = (await admin.put('/v1/admin/storefront/settings', { desktop_nav: 'bottom' })).json;
    assert.deepEqual([saved.desktop_nav, saved.desktop_nav_effective], ['bottom', 'bottom']);
    assert.equal((await fetch(`${server.base}/v1/store/app`).then(res => res.json())).desktop_nav, 'bottom', 'the account app follows it');
    await admin.put('/v1/admin/storefront/settings', { desktop_nav: null });
    assert.equal((await (await adminClient(server, ['support'])).put('/v1/admin/storefront/settings', { desktop_nav: 'rail' })).status, 403);
  });

  test('a reseller manages only their own store’s customers, the same way; admins never reach them', async () => {
    const store = await resellerStore([product]);
    const shopper = await customer(store.subdomain);
    const detail = await store.browser.get(`/v1/stores/${store.storeId}/customers/${shopper.id}`);
    assert.deepEqual([detail.status, detail.json.email], [200, shopper.email]);
    assert.equal((await store.browser.patch(`/v1/stores/${store.storeId}/customers/${shopper.id}`, { status: 'disabled' })).json.status, 'disabled');
    assert.equal((await shopper.get('/v1/store/checkouts')).status, 401);
    assert.equal((await store.browser.post(`/v1/stores/${store.storeId}/customers/${shopper.id}/unlock`)).status, 200);
    assert.equal((await store.browser.post(`/v1/stores/${store.storeId}/customers/${shopper.id}/sign-out`)).status, 200);
    assert.equal((await admin.get(`/v1/admin/storefront/customers/${shopper.id}`)).status, 404, 'not a bitocard.com customer');
    const other = await resellerStore([]);
    assert.equal((await other.browser.get(`/v1/stores/${store.storeId}/customers/${shopper.id}`)).status, 404);
    const house = await customer();
    assert.equal((await store.browser.get(`/v1/stores/${store.storeId}/customers/${house.id}`)).status, 404, 'nor bitocard.com’s');
  });
});
