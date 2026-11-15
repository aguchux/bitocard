// One bitocard.com (docs/BITOCARD_MULTI_WALLETS_PLAN.md): the country stores are retired, and the product decides who
// sells it. A product of one of BitoCard's markets is sold by that market's house account in its currency, whoever
// buys it (a GB customer buying Nigerian stock needs no GBP rate); anything else by the customer's home market.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, startApp } from './helpers.mjs';
import { fakeStripe } from './fakes.mjs';

let server;
let admin;
let prisma;
let stripe;

before(async () => {
  stripe = await fakeStripe();
  server = await startApp({ env: { ...stripe.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  await prisma.featureSwitch.create({ data: { key: 'customer_wallets', enabled: false } });
  // Great Britain: a BitoCard market customers can choose at sign-up, but never a pilot market for reseller
  // sign-up or FX — GBP deliberately has no CurrencySetting/ExchangeRate rows, exactly as in production today.
  await prisma.country.upsert({
    where: { code: 'GB' },
    create: { code: 'GB', name: 'United Kingdom', currency: 'GBP', minWithdrawalMinor: 1000n },
    update: {},
  });
  await prisma.countryCategory.upsert({
    where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } },
    create: { countryCode: 'NG', category: 'gift_cards', enabled: true },
    update: { enabled: true, customerVerification: false },
  });
  assert.equal((await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: false }, code: await adminCode(server, admin) })).status, 200);
  assert.equal((await admin.put('/v1/admin/countries/NG/payment-methods', { purpose: 'checkout', enabled: ['stripe'] })).status, 200);
});

after(async () => {
  await server?.close();
  await stripe?.close();
});

let counter = 0;
async function nairaGiftCard(title) {
  const created = await admin.post('/v1/admin/stock', {
    category: 'gift_cards',
    country: 'NG',
    brand: 'amazon',
    title,
    description: 'An Amazon gift card.',
    redeem_instructions: 'Redeem at amazon.com/redeem.',
    currency: 'NGN',
    face_value: 2_000_000,
    cost: 1_900_000,
    listed: true,
    codes: [{ code: `${title.replaceAll(' ', '-').toUpperCase()}-${(counter += 1)}` }],
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
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

async function customer(subdomain, country) {
  const shopper = storeServer(subdomain);
  const email = `buyer${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery', country });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

const checkoutRow = id => prisma.checkout.findUniqueOrThrow({ where: { id }, include: { payment: true } });

async function payOnStripe(shopper, checkoutId) {
  const row = await checkoutRow(checkoutId);
  Object.assign(stripe.state.sessions[row.payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
  return (await shopper.get(`/v1/store/checkouts/${checkoutId}`)).json;
}

describe('one store: the product decides the seller', () => {
  test('a GB customer on bitocard.com buys Nigerian stock in naira from BitoCard Nigeria: no GBP rate is needed', async () => {
    assert.equal(await prisma.currencySetting.findUnique({ where: { currency: 'GBP' } }), null);
    const product = await nairaGiftCard('Amazon GB Buyer Card');
    const shopper = await customer(null, 'GB');
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2_000_000, return_url: 'https://shop.example/checkout/return' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.equal(started.json.currency, 'NGN', "priced in the product's own market, not the buyer's");
    const done = await payOnStripe(shopper, started.json.id);
    assert.deepEqual([done.status, done.order.status], ['completed', 'completed']);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: done.order.id }, include: { reseller: true } });
    assert.deepEqual([order.reseller.country, order.reseller.house], ['NG', true]);
  });

  test('its delivery email names plain "BitoCard"', async () => {
    const { EmailService } = await import('../dist/notifications/email.service.js');
    const outbox = server.app.get(EmailService).outbox;
    const sent = outbox.length;
    const product = await nairaGiftCard('Amazon Delivery Card');
    const shopper = await customer(null, 'GB');
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2_000_000, return_url: 'https://shop.example/checkout/return', recipient: { email: 'recipient@example.com' } });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.equal((await payOnStripe(shopper, started.json.id)).status, 'completed');
    const [message] = outbox.slice(sent).filter(item => item.to === 'recipient@example.com');
    assert.ok(message, 'the delivery email was sent');
    assert.match(message.subject, /from BitoCard$/);
  });

  test("a product of no BitoCard market (a US card) is sold by the customer's home market, converted as before", async () => {
    for (const source of ['open_exchange_rates', 'flutterwave']) {
      await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
    }
    const usdProduct = await admin.post('/v1/admin/stock', {
      category: 'gift_cards',
      country: 'US',
      brand: 'amazon',
      title: 'Amazon USD Card (home market)',
      description: 'An Amazon gift card.',
      redeem_instructions: 'Redeem at amazon.com/redeem.',
      currency: 'USD',
      face_value: 2500,
      cost: 2000,
      listed: true,
      codes: [{ code: `USD-HOME-${(counter += 1)}` }],
    });
    assert.equal(usdProduct.status, 201, JSON.stringify(usdProduct.json));
    const shopper = await customer(null, 'NG');
    const started = await shopper.post('/v1/store/checkouts', { product_id: usdProduct.json.product.id, face_value: 2500, return_url: 'https://shop.example/checkout/return' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.equal(started.json.currency, 'NGN');
    assert.equal((await payOnStripe(shopper, started.json.id)).order.status, 'completed');
  });
});

describe('the country stores are retired', () => {
  test('ng.bitocard.com and the rest are no store: unpublished by migration, never offered, never made again', async () => {
    const stores = await prisma.store.findMany({ where: { reseller: { house: true }, id: { not: '00000000-0000-4000-8000-0000000000b2' }, platform: 'bitocard' } });
    assert.ok(stores.length > 0 && stores.every(store => store.status === 'draft'));
    assert.equal((await fetch(`${server.base}/v1/storefronts/ng`)).status, 404);
    assert.equal((await fetch(`${server.base}/v1/store/products?store=ng`)).status, 404);
    const navigation = await (await fetch(`${server.base}/v1/store/navigation`)).json();
    assert.ok(navigation.countries.length > 0 && navigation.countries.every(country => !('store_subdomain' in country)), 'the country picker names no store to go to');

    // A checkout in a market without a country store makes none.
    await prisma.store.deleteMany({ where: { subdomain: 'za' } });
    await prisma.country.upsert({ where: { code: 'ZA' }, create: { code: 'ZA', name: 'South Africa', currency: 'ZAR', minWithdrawalMinor: 1000n }, update: {} });
    const shopper = await customer(null, 'ZA');
    await shopper.post('/v1/store/checkouts', { product_id: (await nairaGiftCard('Amazon ZA Card')).id, face_value: 2_000_000, return_url: 'https://shop.example/checkout/return' });
    assert.equal(await prisma.store.findUnique({ where: { subdomain: 'za' } }), null);

    assert.equal((await admin.post('/v1/admin/countries/NG/store')).status, 404, 'no admin route makes one');
    assert.equal((await admin.put('/v1/admin/switches/country_stores', { country_code: 'NG', enabled: true })).status, 404, 'the switch is gone');
    assert.equal(await prisma.featureSwitch.count({ where: { key: 'country_stores' } }), 0);
  });

  test('a bitocard.com session works on bitocard.com only, never on the old ng.bitocard.com', async () => {
    const shopper = await customer(null, 'NG');
    assert.equal((await shopper.get('/v1/store/account')).status, 200);
    const asNg = storeServer('ng');
    const signin = await asNg.post('/v1/store/account/signin', { email: 'nobody@example.com', password: 'correct horse battery' });
    assert.equal(signin.status, 404, 'no store answers there');
  });
});
