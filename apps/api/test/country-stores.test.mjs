// Country-localised bitocard.com stores (docs/BITOCARD_COUNTRY_STORES_PLAN.md), Stage 3: the pricing/seller routing
// fix. A market's own country store (ng.bitocard.com) always sells through that market's house account, never the
// visiting customer's own country, so a same-country purchase never needs foreign-currency conversion.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, startApp } from './helpers.mjs';
import { fakeStripe } from './fakes.mjs';

let server;
let admin;
let prisma;
let house;
let stripe;

before(async () => {
  stripe = await fakeStripe();
  server = await startApp({ env: { ...stripe.env, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  house = server.app.get((await import('../dist/checkout/house.service.js')).HouseService);
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
  assert.equal((await admin.put('/v1/admin/switches/country_stores', { country_code: 'NG', enabled: true })).status, 200);
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

describe('country stores: pricing and seller routing (Stage 3)', () => {
  test('a GB customer buying NGN-priced stock on ng.bitocard.com is not forced through GBP: no conversion is needed or attempted', async () => {
    const ng = await house.storeFor('NG');
    assert.equal(ng.subdomain, 'ng');
    // GBP has no exchange rate at all: if this purchase needed to convert to or from GBP it would fail outright.
    assert.equal(await prisma.currencySetting.findUnique({ where: { currency: 'GBP' } }), null);
    assert.equal(await prisma.exchangeRate.count({ where: { currency: 'GBP' } }), 0);

    const product = await nairaGiftCard('Amazon GB Buyer Card');
    const shopper = await customer('ng', 'GB');

    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2_000_000, return_url: 'https://shop.example/checkout/return' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.equal(started.json.currency, 'NGN', 'priced in the country store’s own currency, not the buyer’s');

    const done = await payOnStripe(shopper, started.json.id);
    assert.deepEqual([done.status, done.order.status], ['completed', 'completed']);

    // The order's seller is NG's own house account, never a GB one (none should even exist).
    const order = await prisma.order.findUniqueOrThrow({ where: { id: done.order.id }, include: { reseller: true } });
    assert.equal(order.reseller.country, 'NG');
    assert.equal(order.reseller.house, true);
    assert.equal(await prisma.reseller.findFirst({ where: { house: true, country: 'GB' } }), null, 'no GB house account was ever needed');
  });

  test('a delivery email from a country store names plain "BitoCard", never "BitoCard NG"', async () => {
    const { EmailService } = await import('../dist/notifications/email.service.js');
    const outbox = server.app.get(EmailService).outbox;
    const sent = outbox.length;
    const product = await nairaGiftCard('Amazon Country Store Delivery Card');
    const shopper = await customer('ng', 'GB');
    const started = await shopper.post('/v1/store/checkouts', {
      product_id: product.id,
      face_value: 2_000_000,
      return_url: 'https://shop.example/checkout/return',
      recipient: { email: 'recipient@example.com' },
    });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    const done = await payOnStripe(shopper, started.json.id);
    assert.equal(done.status, 'completed', JSON.stringify(done));

    const [message] = outbox.slice(sent).filter(item => item.to === 'recipient@example.com');
    assert.ok(message, 'the delivery email was sent');
    assert.match(message.subject, /from BitoCard$/);
    assert.doesNotMatch(message.subject, /BitoCard NG/);
    assert.ok(message.text.includes('Thank you for your order from BitoCard.'));
  });

  test('root bitocard.com keeps today’s behaviour: the same GB customer buying the same NGN product there still prices it in GBP', async () => {
    // GB can take payment and lists gift cards, so the purchase reaches pricing (not an earlier, unrelated refusal)
    // and is forced to convert NGN to GBP there — exactly the bug this plan exists to route around with a country
    // store, not something Stage 3 changes about root itself.
    await prisma.countryCategory.upsert({
      where: { countryCode_category: { countryCode: 'GB', category: 'gift_cards' } },
      create: { countryCode: 'GB', category: 'gift_cards', enabled: true },
      update: { enabled: true, customerVerification: false },
    });
    assert.equal((await admin.put('/v1/admin/countries/GB/payment-methods', { purpose: 'checkout', enabled: ['stripe'] })).status, 200);
    const product = await nairaGiftCard('Amazon Root Buyer Card');
    const shopper = await customer(null, 'GB');
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2_000_000, return_url: 'https://shop.example/checkout/return' });
    assert.equal(started.json?.error?.code, 'conversion_unavailable', JSON.stringify(started.json));
  });

  test('a country store’s checkout is live by default, like root, not sandboxed like a fresh reseller store', async () => {
    const asStore = await (await fetch(`${server.base}/v1/store/payment-methods?country=NG`, { headers: { 'bitocard-store': 'ng' } })).json();
    assert.equal(asStore.mode, 'live');
    const root = await (await fetch(`${server.base}/v1/store/payment-methods?country=NG`)).json();
    assert.equal(root.mode, 'live');
  });

  test('cross-border purchases still convert, exactly as before: an NGN-wallet customer on ng.bitocard.com buying a USD-face product', async () => {
    for (const source of ['open_exchange_rates', 'flutterwave']) {
      await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
    }
    const usdProduct = await admin.post('/v1/admin/stock', {
      category: 'gift_cards',
      country: 'US',
      brand: 'amazon',
      title: 'Amazon USD Card (cross-border)',
      description: 'An Amazon gift card.',
      redeem_instructions: 'Redeem at amazon.com/redeem.',
      currency: 'USD',
      face_value: 2500,
      cost: 2000,
      listed: true,
      codes: [{ code: `USD-CROSSBORDER-${(counter += 1)}` }],
    });
    assert.equal(usdProduct.status, 201, JSON.stringify(usdProduct.json));
    const shopper = await customer('ng', 'NG');
    const started = await shopper.post('/v1/store/checkouts', { product_id: usdProduct.json.product.id, face_value: 2500, return_url: 'https://shop.example/checkout/return' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    assert.equal(started.json.currency, 'NGN', 'still priced in the store’s own (NGN) currency: the USD face value was converted, not bypassed');
    const done = await payOnStripe(shopper, started.json.id);
    assert.equal(done.order.status, 'completed');
  });
});

describe('country stores: storefront routing and the root redirect (Stage 4)', () => {
  test('ng.bitocard.com resolves as a real store (never the old blanket “every house store is 404” gate) and is marked house', async () => {
    const ng = await house.storeFor('NG');
    await prisma.store.update({ where: { id: ng.id }, data: { hostStatus: 'ready' } });

    const storefront = await (await fetch(`${server.base}/v1/storefronts/ng`)).json();
    assert.equal(storefront.house, true);
    assert.equal(storefront.checkout_mode, 'live');
    // Plain "BitoCard", never "BitoCard NG": a market's own country store is BitoCard's own retail arm there,
    // localised, never a distinct brand. The storefront app never shows the name for a house store anyway, but
    // transactional copy (delivery emails) reads it directly, so it must never carry the country code.
    assert.equal(storefront.name, 'BitoCard');

    // Was a 404 before Stage 4 (StorefrontService.inStore rejected every house store outright).
    const navigation = await (await fetch(`${server.base}/v1/store/navigation`, { headers: { 'bitocard-store': 'ng' } })).json();
    assert.equal(navigation.object, 'store_navigation');
  });

  test('a country store’s catalogue is the global admin-listed set, like root, never a reseller’s own `reseller_listings` (nobody can ever populate those for a house account)', async () => {
    const product = await nairaGiftCard('Amazon Country Store Catalogue Card');
    const home = await (await fetch(`${server.base}/v1/store/home`, { headers: { 'bitocard-store': 'ng' } })).json();
    const listed = await (await fetch(`${server.base}/v1/store/products?limit=60`, { headers: { 'bitocard-store': 'ng' } })).json();
    assert.ok(listed.data.some(item => item.key === product.key), 'the admin-listed product shows on the country store');
    assert.ok(home.countries.length > 0);
  });

  test('root offers a market’s live, ready country store; a market with no switch or no ready store stays null', async () => {
    const gh = await house.storeFor('GH');
    // GH's store exists (as NG's did before its switch and ready host were set) but is not yet switched on or ready.
    const beforeSwitch = await (await fetch(`${server.base}/v1/store/navigation`)).json();
    const ngRow = beforeSwitch.countries.find(country => country.code === 'NG');
    const ghRow = beforeSwitch.countries.find(country => country.code === 'GH');
    assert.equal(ngRow.store_subdomain, 'ng', 'NG: switched on and ready (set up in earlier tests)');
    assert.equal(ghRow.store_subdomain, null, 'GH: a store row exists, but the switch is still off');

    assert.equal((await admin.put('/v1/admin/switches/country_stores', { country_code: 'GH', enabled: true })).status, 200);
    const stillNotReady = await (await fetch(`${server.base}/v1/store/navigation`)).json();
    assert.equal(stillNotReady.countries.find(country => country.code === 'GH').store_subdomain, null, 'switched on, but its host is not ready yet');

    await prisma.store.update({ where: { id: gh.id }, data: { hostStatus: 'ready' } });
    const ready = await (await fetch(`${server.base}/v1/store/navigation`)).json();
    assert.equal(ready.countries.find(country => country.code === 'GH').store_subdomain, 'gh');
  });

  test('the single root bitocard.com store is never offered as a market’s own country store', async () => {
    const navigation = await (await fetch(`${server.base}/v1/store/navigation`)).json();
    // Root sells no particular country, so it can never appear as a "KE" (or any other) row's store_subdomain.
    assert.ok(navigation.countries.every(country => country.store_subdomain !== 'bitocard'));
  });
});

describe('country stores: general rollout, not just the pilots (Stage 5)', () => {
  test('any market’s first checkout through root provisions its own country store, not only NG/GH/KE', async () => {
    // South Africa: never touched by an earlier test, never one of the three original pilots, no store yet.
    await prisma.country.upsert({
      where: { code: 'ZA' },
      create: { code: 'ZA', name: 'South Africa', currency: 'USD', minWithdrawalMinor: 1000n },
      update: {},
    });
    assert.equal(await prisma.store.findUnique({ where: { subdomain: 'za' } }), null, 'no store exists yet');
    await prisma.countryCategory.upsert({
      where: { countryCode_category: { countryCode: 'ZA', category: 'gift_cards' } },
      create: { countryCode: 'ZA', category: 'gift_cards', enabled: true },
      update: { enabled: true, customerVerification: false },
    });
    assert.equal((await admin.put('/v1/admin/countries/ZA/payment-methods', { purpose: 'checkout', enabled: ['stripe'] })).status, 200);

    const product = await admin.post('/v1/admin/stock', {
      category: 'gift_cards',
      country: 'ZA',
      brand: 'amazon',
      title: 'Amazon South Africa Card',
      description: 'An Amazon gift card.',
      redeem_instructions: 'Redeem at amazon.com/redeem.',
      currency: 'USD',
      face_value: 2500,
      cost: 2000,
      listed: true,
      codes: [{ code: `ZA-CARD-${(counter += 1)}` }],
    });
    assert.equal(product.status, 201, JSON.stringify(product.json));

    const shopper = await customer(null, 'ZA');
    const started = await shopper.post('/v1/store/checkouts', { product_id: product.json.product.id, face_value: 2500, return_url: 'https://shop.example/checkout/return' });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    await payOnStripe(shopper, started.json.id);

    const za = await prisma.store.findUnique({ where: { subdomain: 'za' }, include: { reseller: true } });
    assert.ok(za, 'the checkout provisioned the store, with no admin step and no special-casing to ZA');
    assert.equal(za.reseller.house, true);
    assert.equal(za.reseller.country, 'ZA');
  });

  test('an admin brings a country store up ahead of its first sale, idempotently, audited', async () => {
    // Kenya: seeded, never bought from through root in this file, so no store yet — proving the admin action needs
    // no prior checkout either, for any market in the list.
    assert.equal(await prisma.store.findUnique({ where: { subdomain: 'ke' } }), null);
    const created = await admin.post('/v1/admin/countries/KE/store');
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.subdomain, 'ke');
    const again = await admin.post('/v1/admin/countries/KE/store');
    assert.equal(again.json.id, created.json.id, 'asking again returns the same store, not a second one');
    const audited = await prisma.auditLog.findFirst({ where: { action: 'country_store.provisioned', targetId: created.json.id } });
    assert.ok(audited);
  });
});
