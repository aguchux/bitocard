// Suppliers, catalogue sync, pricing and quotes: Reloadly and VTpass catalogues mapped onto BitoCard products,
// routing to the cheapest eligible supplier, BitoCard margins, reseller markups within the cap, the discount option,
// recipient checks, tax, and supplier identities never reaching resellers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly, fakeVtpass } from './fakes.mjs';

let server;
let reloadly;
let vtpass;
let admin;
let prisma;

before(async () => {
  reloadly = await fakeReloadly();
  vtpass = await fakeVtpass();
  server = await startApp({ env: { ...reloadly.env, ...vtpass.env } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  // Fresh rates: NGN 1500 and GHS 15 per USD from both sources (margin 1.5%: pay 1522.5 / 15.225, receive 1477.5 / 14.775).
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    for (const [currency, rate] of [['NGN', 1500], ['GHS', 15], ['KES', 130]]) {
      await prisma.exchangeRate.create({ data: { currency, source, unitsPerUsd: rate, fetchedAt: new Date(Date.now() + 3600_000) } });
    }
  }
  assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
  assert.equal((await admin.post('/v1/admin/suppliers/vtpass/sync')).status, 200);
});

after(async () => {
  await server?.close();
  await reloadly?.close();
  await vtpass?.close();
});

const sandbox = { 'bitocard-mode': 'test' };
const productId = async key => (await prisma.product.findUniqueOrThrow({ where: { key } })).id;
const byKey = async (browser, key, headers) => {
  const id = await productId(key);
  return (await browser.get(`/v1/catalogue/products/${id}`, headers)).json;
};

describe('supplier registry and sync', () => {
  test('all 30 suppliers are registered; only Reloadly and VTpass start enabled', async () => {
    const { data } = (await admin.get('/v1/admin/suppliers')).json;
    assert.equal(data.length, 30);
    assert.deepEqual(data.filter(s => s.enabled).map(s => s.code).sort(), ['reloadly', 'vtpass']);
    const reloadlyRecord = data.find(s => s.code === 'reloadly');
    assert.deepEqual([reloadlyRecord.configured, reloadlyRecord.status, Boolean(reloadlyRecord.last_synced_at)], [true, 'mvp_live', true]);
    assert.equal(data.find(s => s.code === 'didww').configured, false, 'stub until API access is confirmed');
  });

  test('syncing maps supplier catalogues onto BitoCard products', async () => {
    const keys = (await prisma.product.findMany({ select: { key: true } })).map(p => p.key).sort();
    for (const key of [
      'gift_cards:US:amazon-us',
      'gift_cards:US:steam-global',
      'airtime:NG:mtn:topup',
      'airtime:NG:airtel:topup',
      'data:NG:mtn:1gb-1-day',
      'data:NG:mtn:2-5gb-2-days',
      'pay_tv:NG:dstv:dstv-padi',
      'pay_tv:NG:gotv:gotv-smallie',
      'bills:NG:ikeja-electric:prepaid',
    ]) {
      assert.ok(keys.includes(key), key);
    }
    const amazon = await prisma.product.findUniqueOrThrow({ where: { key: 'gift_cards:US:amazon-us' }, include: { supplierProducts: true } });
    assert.deepEqual(amazon.fixedValues, [1000n, 2500n, 5000n]);
    assert.equal(amazon.supplierProducts[0].costRatio.toString(), '1.0094');
    assert.equal(amazon.supplierProducts[0].costFeeMinor, 50n);
    const token = reloadly.calls.find(c => c.url === '/oauth/token' && c.body.audience.endsWith('/giftcards'));
    assert.equal(token.body.grant_type, 'client_credentials');
  });

  test('syncing again changes nothing; withdrawn supplier offers become unavailable; agreed discounts are kept', async () => {
    const padi = await prisma.supplierProduct.findFirstOrThrow({ where: { supplierCode: 'vtpass', sku: 'dstv:dstv-padi' } });
    await admin.patch(`/v1/admin/supplier-products/${padi.id}`, { discount_bps: 150 });
    const again = (await admin.post('/v1/admin/suppliers/vtpass/sync')).json;
    assert.deepEqual([again.products_created, again.offers_withdrawn], [0, 0]);
    assert.equal((await prisma.supplierProduct.findUniqueOrThrow({ where: { id: padi.id } })).discountBps, 150);

    const removed = vtpass.state.variations.dstv.variations.pop();
    try {
      assert.equal((await admin.post('/v1/admin/suppliers/vtpass/sync')).json.offers_withdrawn, 1);
    } finally {
      vtpass.state.variations.dstv.variations.push(removed);
      await admin.post('/v1/admin/suppliers/vtpass/sync');
    }
  });

  test('a supplier without credentials cannot sync; a failed sync is recorded and withdraws nothing', async () => {
    assert.equal((await admin.post('/v1/admin/suppliers/didww/sync')).json.error.code, 'supplier_not_configured');
    const available = await prisma.supplierProduct.count({ where: { supplierCode: 'reloadly', available: true } });
    reloadly.state.fail = '/topups';
    try {
      const failed = await admin.post('/v1/admin/suppliers/reloadly/sync');
      assert.deepEqual([failed.status, failed.json.error.code], [502, 'supplier_sync_failed']);
      assert.ok(!JSON.stringify(failed.json).includes('Simulated outage'), 'supplier errors stay internal');
      assert.match((await admin.get('/v1/admin/suppliers/reloadly')).json.last_sync_error, /Simulated outage/);
      assert.equal(await prisma.supplierProduct.count({ where: { supplierCode: 'reloadly', available: true } }), available);
    } finally {
      reloadly.state.fail = undefined;
    }
    // A refused sign-in says which Reloadly API refused it, and what to check.
    const { ReloadlyAdapter } = await import('../dist/suppliers/reloadly.adapter.js');
    const urls = { auth: reloadly.env.RELOADLY_AUTH_URL, giftcards: reloadly.env.RELOADLY_GIFTCARDS_URL, topups: reloadly.env.RELOADLY_TOPUPS_URL };
    await assert.rejects(new ReloadlyAdapter({ clientId: 'wrong', clientSecret: 'wrong' }, urls).catalogue({ category: 'gift_cards' }), error => {
      assert.match(error.message, /^reloadly: sign-in to the gift cards API refused \(HTTP 401\): Invalid credentials\. Check the client ID and secret, that the sandbox setting matches them/);
      return true;
    });
    assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
    assert.equal((await admin.get('/v1/admin/suppliers/reloadly')).json.last_sync_error, null);
  });

  test('admins record the funding profile and switch markets; changes are audited', async () => {
    const updated = await admin.patch('/v1/admin/suppliers/esim_access', { billing_model: 'prepaid_wallet', funding_currency: 'usd', min_first_deposit_minor: 5000, resale_approved: false, notes: 'Awaiting sandbox' });
    assert.deepEqual([updated.json.funding.billing_model, updated.json.funding.currency, updated.json.funding.min_first_deposit_minor], ['prepaid_wallet', 'USD', 5000]);
    assert.equal((await admin.put('/v1/admin/suppliers/vtpass/markets/NG/gift_cards', { enabled: true })).json.error.param, 'category');
    const market = await admin.put('/v1/admin/suppliers/reloadly/markets/ke/gift_cards', { enabled: false });
    assert.equal(market.json.markets.find(m => m.country === 'KE' && m.category === 'gift_cards').enabled, false);
    await admin.put('/v1/admin/suppliers/reloadly/markets/KE/gift_cards', { enabled: true });
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'supplier.updated', targetId: 'esim_access' } }));

    const support = await adminClient(server, ['support']);
    assert.equal((await support.patch('/v1/admin/suppliers/reloadly', { enabled: false })).status, 403);
  });
});

describe('catalogue', () => {
  test('lists what a Nigerian reseller can sell, with wholesale cost and price, and no supplier details', async () => {
    const { browser } = await resellerClient(server);
    const { status, json } = await browser.get('/v1/catalogue/products?limit=100');
    assert.equal(status, 200);
    const names = json.data.map(p => p.name);
    assert.ok(names.includes('Amazon US') && names.includes('MTN Nigeria') && names.includes('DStv Padi N3,600'));
    const text = JSON.stringify(json);
    for (const secret of ['reloadly', 'vtpass', 'sku', 'cost', 'dstv:dstv-padi', 'supplier']) assert.ok(!text.toLowerCase().includes(secret), `leaked ${secret}`);

    const amazon = json.data.find(p => p.name === 'Amazon US');
    // US$25: (25.00 x 1.0094, rounded up, + 0.50 fee) = US$25.74, at 1522.5 = NGN 39,189.15; plus BitoCard's 3% = NGN 40,364.83.
    assert.deepEqual(amazon.pricing.denominations.find(d => d.face_value === 2500), { face_value: 2500, wholesale: 4_036_483, price: 4_036_483 });
    assert.equal(amazon.pricing.currency, 'NGN');
    assert.deepEqual(amazon.denomination, { type: 'fixed', values: [1000, 2500, 5000] });

    const mtn = json.data.find(p => p.name === 'MTN Nigeria');
    assert.deepEqual(mtn.denomination, { type: 'range', min: 5000, max: 5_000_000 });
    assert.deepEqual(mtn.pricing.denominations[0], { face_value: 5000, wholesale: 5000, price: 5000 }, 'face value, no markup yet');
    assert.equal(mtn.recipient_type, 'phone');
  });

  test('a product whose cost is above face value at BitoCard rates is never offered', async () => {
    // Airtel is bought in US dollars at the supplier's NGN 1,450 rate; at BitoCard's NGN 1,522.50 it costs more than face value.
    const { browser } = await resellerClient(server);
    const airtel = await byKey(browser, 'airtime:NG:airtel:topup');
    assert.equal(airtel.error.code, 'resource_missing');
    const names = (await browser.get('/v1/catalogue/products?category=airtime')).json.data.map(p => p.name);
    assert.deepEqual(names, ['MTN Nigeria']);
  });

  test('filters by category, country and search', async () => {
    const { browser } = await resellerClient(server);
    assert.deepEqual((await browser.get('/v1/catalogue/products?category=pay_tv')).json.data.map(p => p.brand).sort(), ['dstv', 'dstv', 'gotv']);
    assert.deepEqual((await browser.get('/v1/catalogue/products?q=steam')).json.data.map(p => p.name), ['Steam Global']);
    assert.equal((await browser.get('/v1/catalogue/products?category=esim')).json.data.length, 0);
  });

  test('a Ghanaian reseller sees gift cards in cedis, but not Nigerian airtime', async () => {
    const { browser } = await resellerClient(server, { country: 'GH' });
    const list = (await browser.get('/v1/catalogue/products?limit=100')).json.data;
    assert.ok(!list.some(p => p.country === 'NG'));
    const amazon = list.find(p => p.name === 'Amazon US');
    // US$25.74 at GHS 15.225 = GHS 391.90 (rounded up), plus 3% = GHS 403.66.
    assert.deepEqual(amazon.pricing.denominations.find(d => d.face_value === 2500), { face_value: 2500, wholesale: 40_366, price: 40_366 });
    assert.equal((await byKey(browser, 'airtime:NG:mtn:topup')).error.code, 'international_selling_required');
  });

  test('categories not open in a country, and products switched off, are unavailable', async () => {
    const kenya = await resellerClient(server, { country: 'KE' });
    assert.equal((await byKey(kenya.browser, 'pay_tv:NG:dstv:dstv-padi')).error.code, 'category_unavailable');

    const id = await productId('gift_cards:US:steam-global');
    await admin.patch(`/v1/admin/products/${id}`, { active: false });
    const { browser } = await resellerClient(server);
    assert.equal((await browser.get(`/v1/catalogue/products/${id}`)).json.error.code, 'product_unavailable');
    assert.equal((await browser.get('/v1/catalogue/products?q=steam')).json.data.length, 0);
    await admin.patch(`/v1/admin/products/${id}`, { active: true });
  });

  test('a supplier switched off takes its products out of the catalogue', async () => {
    await admin.patch('/v1/admin/suppliers/vtpass', { enabled: false });
    try {
      const { browser } = await resellerClient(server);
      assert.equal((await browser.get('/v1/catalogue/products?category=pay_tv')).json.data.length, 0);
    } finally {
      await admin.patch('/v1/admin/suppliers/vtpass', { enabled: true });
    }
  });

  test('API keys need catalogue:read', async () => {
    const { browser } = await resellerClient(server);
    const key = (await browser.post('/v1/api-keys', { name: 'Orders', mode: 'test', scopes: ['orders:read'] })).json.secret;
    assert.equal((await fetch(`${server.base}/v1/catalogue/products`, { headers: { authorization: `Bearer ${key}` } })).status, 403);
  });
});

describe('pricing', () => {
  test('markups apply per category and per product, within the 50% cap', async () => {
    const { browser } = await resellerClient(server);
    const mtn = await productId('airtime:NG:mtn:topup');
    assert.equal((await browser.put('/v1/pricing/markups', { category: 'airtime', markup_bps: 5001 })).json.error.code, 'markup_above_cap');
    await browser.put('/v1/pricing/markups', { category: 'airtime', markup_bps: 1000 });
    let price = (await browser.get(`/v1/catalogue/products/${mtn}`)).json.pricing.denominations[0];
    assert.deepEqual(price, { face_value: 5000, wholesale: 5000, price: 5500 });

    await browser.put('/v1/pricing/markups', { category: 'airtime', product_id: mtn, markup_bps: 2500 });
    price = (await browser.get(`/v1/catalogue/products/${mtn}`)).json.pricing.denominations[0];
    assert.equal(price.price, 6250, 'the product markup overrides the category');

    const settings = (await browser.get('/v1/pricing')).json;
    assert.deepEqual([settings.earning, settings.markup_cap_percent, settings.markups.length], ['markup', 50, 2]);
    await browser.delete(`/v1/pricing/markups?category=airtime&product_id=${mtn}`);
    assert.equal((await browser.get(`/v1/catalogue/products/${mtn}`)).json.pricing.denominations[0].price, 5500);
    assert.equal((await browser.put('/v1/pricing/markups', { category: 'pay_tv', product_id: mtn, markup_bps: 100 })).json.error.param, 'product_id');
  });

  test('a lowered cap limits existing markups', async () => {
    const { browser } = await resellerClient(server, { country: 'KE' });
    await browser.put('/v1/pricing/markups', { category: 'gift_cards', markup_bps: 4000 });
    await admin.patch('/v1/admin/countries/KE', { markup_cap_percent: 10 });
    try {
      const steam = (await byKey(browser, 'gift_cards:US:steam-global')).pricing.denominations[0];
      assert.equal(steam.price, Math.ceil(steam.wholesale * 1.1));
    } finally {
      await admin.patch('/v1/admin/countries/KE', { markup_cap_percent: 50 });
    }
  });

  test('BitoCard margins come from the most specific rule', async () => {
    const { browser } = await resellerClient(server);
    const finance = await adminClient(server, ['finance']);
    const rule = (await finance.put('/v1/admin/pricing-rules', { category: 'gift_cards', country: 'NG', margin_bps: 500 })).json;
    try {
      const amazon = (await byKey(browser, 'gift_cards:US:amazon-us')).pricing.denominations.find(d => d.face_value === 2500);
      assert.equal(amazon.wholesale, Math.ceil(3_918_915 * 1.05));
    } finally {
      await finance.delete(`/v1/admin/pricing-rules/${rule.id}`);
    }
    const rules = (await finance.get('/v1/admin/pricing-rules')).json.data;
    const global = rules.find(r => !r.category && !r.country && !r.product_id);
    assert.equal((await finance.delete(`/v1/admin/pricing-rules/${global.id}`)).status, 400, 'the default cannot be removed');
  });

  test('the discount option: sell at face value and keep BitoCard’s discount, never below BitoCard’s cost', async () => {
    await admin.put('/v1/admin/countries/NG/options/fixed_price_earning', { allowed: ['markup', 'discount'], default: 'markup' });
    const finance = await adminClient(server, ['finance']);
    const rule = (await finance.put('/v1/admin/pricing-rules', { category: 'airtime', country: 'NG', margin_bps: 0, reseller_discount_bps: 200 })).json;
    try {
      const { browser } = await resellerClient(server);
      await browser.put('/v1/settings/options/fixed_price_earning', { value: 'discount' });
      await browser.put('/v1/pricing/markups', { category: 'airtime', markup_bps: 1000 });
      const mtn = (await byKey(browser, 'airtime:NG:mtn:topup')).pricing.denominations[1];
      assert.deepEqual(mtn, { face_value: 5_000_000, wholesale: 4_900_000, price: 5_000_000 }, 'markups do not apply; 2% discount kept');

      // A 4% discount would put wholesale (96%) below what the supplier charges BitoCard (97%): not offered.
      await finance.put('/v1/admin/pricing-rules', { category: 'airtime', country: 'NG', margin_bps: 0, reseller_discount_bps: 400 });
      assert.equal((await byKey(browser, 'airtime:NG:mtn:topup')).error.code, 'resource_missing');
    } finally {
      await finance.delete(`/v1/admin/pricing-rules/${rule.id}`);
      await admin.put('/v1/admin/countries/NG/options/fixed_price_earning', { allowed: ['markup'], default: 'markup' });
    }
  });

  test('routing picks the cheapest eligible supplier; unconfigured suppliers serve only the sandbox', async () => {
    // A second source for DStv Padi through Quickteller, cheaper than VTpass, but without live credentials.
    const padi = await productId('pay_tv:NG:dstv:dstv-padi');
    await prisma.supplier.update({ where: { code: 'quickteller' }, data: { enabled: true } });
    await prisma.supplierMarket.create({ data: { supplierCode: 'quickteller', countryCode: 'NG', category: 'pay_tv', enabled: true } });
    await prisma.supplierProduct.create({ data: { supplierCode: 'quickteller', productId: padi, sku: 'qt-dstv-padi', costCurrency: 'NGN', costRatio: 0.97, syncedAt: new Date() } });
    try {
      const { browser } = await resellerClient(server);
      const recipient = { account_number: '1212121212' };
      const live = (await browser.post('/v1/quotes', { product_id: padi, face_value: 360_000, recipient })).json;
      const test = (await browser.post('/v1/quotes', { product_id: padi, face_value: 360_000, recipient }, sandbox)).json;
      const [liveRow, testRow] = await Promise.all([prisma.quote.findUnique({ where: { id: live.id } }), prisma.quote.findUnique({ where: { id: test.id } })]);
      assert.deepEqual([liveRow.supplierCode, liveRow.supplierCostMinor], ['vtpass', 354_600n], 'VTpass with the agreed 1.5% commission');
      assert.deepEqual([testRow.supplierCode, testRow.supplierCostMinor], ['quickteller', 349_200n]);
      assert.equal(live.wholesale, test.wholesale, 'the reseller price does not depend on the route');
    } finally {
      await prisma.supplierProduct.deleteMany({ where: { supplierCode: 'quickteller' } });
      await prisma.supplierMarket.deleteMany({ where: { supplierCode: 'quickteller' } });
      await prisma.supplier.update({ where: { code: 'quickteller' }, data: { enabled: false } });
    }
  });
});

describe('quotes', () => {
  test('an airtime quote needs a valid local phone number and locks the price for 10 minutes', async () => {
    const { browser } = await resellerClient(server);
    await browser.put('/v1/pricing/markups', { category: 'airtime', markup_bps: 500 });
    const product_id = await productId('airtime:NG:mtn:topup');
    assert.equal((await browser.post('/v1/quotes', { product_id, face_value: 100_000 })).json.error.param, 'recipient.phone');
    assert.equal((await browser.post('/v1/quotes', { product_id, face_value: 100_000, recipient: { phone: '+233241234567' } })).json.error.param, 'recipient.phone');
    assert.equal((await browser.post('/v1/quotes', { product_id, face_value: 4999, recipient: { phone: '08031234567' } })).json.error.param, 'face_value');

    assert.equal((await browser.post('/v1/quotes', { product_id, face_value: 100_000, quantity: 2, recipient: { phone: '08031234567' } })).json.error.param, 'quantity', 'one top-up per quote');
    const created = await browser.post('/v1/quotes', { product_id, face_value: 100_000, recipient: { phone: '0803 123 4567' }, customer_reference: 'cust-42' });
    assert.equal(created.status, 201);
    const quote = created.json;
    assert.deepEqual(
      [quote.status, quote.currency, quote.quantity, quote.unit_wholesale, quote.wholesale, quote.price, quote.tax, quote.reseller_profit, quote.recipient.phone, quote.customer_reference],
      ['open', 'NGN', 1, 100_000, 100_000, 105_000, null, 5000, '+2348031234567', 'cust-42'],
    );
    const minutes = (new Date(quote.expires_at) - Date.now()) / 60_000;
    assert.ok(minutes > 9.9 && minutes <= 10);
    assert.ok(!JSON.stringify(quote).includes('reloadly'));
    assert.equal((await browser.get(`/v1/quotes/${quote.id}`)).json.id, quote.id);

    await prisma.quote.update({ where: { id: quote.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await browser.get(`/v1/quotes/${quote.id}`)).json.status, 'expired');

    const stranger = await resellerClient(server);
    assert.equal((await stranger.browser.get(`/v1/quotes/${quote.id}`)).status, 404);
  });

  test('gift cards: fixed values only, priced in the reseller currency', async () => {
    const { browser } = await resellerClient(server);
    const product_id = await productId('gift_cards:US:amazon-us');
    assert.equal((await browser.post('/v1/quotes', { product_id, face_value: 2000 })).json.error.param, 'face_value');
    const pair = (await browser.post('/v1/quotes', { product_id, face_value: 1000, quantity: 2 })).json;
    assert.deepEqual([pair.quantity, pair.unit_wholesale, pair.wholesale], [2, 1_662_266, 3_324_532]);
    const quote = (await browser.post('/v1/quotes', { product_id, face_value: 1000 })).json;
    // US$10: (10.00 x 1.0094 = 10.094, rounded up to 10.10) + 0.50 = US$10.60, at 1522.5 = NGN 16,138.50; plus 3%.
    assert.deepEqual([quote.face_currency, quote.wholesale, quote.price], ['USD', 1_662_266, 1_662_266]);
    const row = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    assert.deepEqual([row.supplierCostMinor, row.supplierCurrency, row.fxRate.toString()], [1060n, 'USD', '1522.5']);
  });

  test('pay-TV checks the smartcard with the supplier and returns the account for the customer to confirm', async () => {
    const { browser } = await resellerClient(server);
    const product_id = await productId('pay_tv:NG:dstv:dstv-padi');
    assert.equal((await browser.post('/v1/quotes', { product_id, face_value: 360_000 })).json.error.param, 'recipient.account_number');
    const bad = await browser.post('/v1/quotes', { product_id, face_value: 360_000, recipient: { account_number: '9999999999' } });
    assert.deepEqual([bad.status, bad.json.error.code], [400, 'recipient_invalid']);

    const quote = (await browser.post('/v1/quotes', { product_id, face_value: 360_000, recipient: { account_number: '1212121212' } })).json;
    assert.deepEqual(quote.recipient, {
      account_number: '1212121212',
      transaction_type: 'change',
      account_name: 'TEST DSTV CUSTOMER',
      current_package: 'DStv Compact',
      due_date: '2026-10-30',
      renewal_amount: '15700',
    });
    const renewal = (await browser.post('/v1/quotes', { product_id, face_value: 360_000, recipient: { account_number: '1212121212', transaction_type: 'renew' } })).json;
    assert.equal(renewal.recipient.transaction_type, 'renew');
    const verify = vtpass.calls.findLast(c => c.url === '/merchant-verify');
    assert.deepEqual([verify.body.serviceID, verify.headers['secret-key']], ['dstv', 'vt-secret']);
  });

  test('the sandbox simulates account checks and never calls the supplier', async () => {
    const { browser } = await resellerClient(server);
    const product_id = await productId('bills:NG:ikeja-electric:prepaid');
    const before = vtpass.calls.length;
    const unknown = await browser.post('/v1/quotes', { product_id, face_value: 500_000, recipient: { account_number: '0000000000' } }, sandbox);
    assert.equal(unknown.json.error.code, 'recipient_invalid');
    const quote = (await browser.post('/v1/quotes', { product_id, face_value: 500_000, recipient: { account_number: '45012345678' } }, sandbox)).json;
    assert.deepEqual([quote.mode, quote.recipient.account_name], ['test', 'SANDBOX CUSTOMER']);
    assert.equal(vtpass.calls.length, before);
    assert.equal((await browser.post('/v1/quotes', { product_id, face_value: 99_999, recipient: { account_number: '45012345678' } }, sandbox)).json.error.param, 'face_value');
  });

  test('paused conversions stop quotes priced in another currency', async () => {
    const { browser } = await resellerClient(server);
    const product_id = await productId('gift_cards:US:amazon-us');
    await prisma.currencySetting.update({ where: { currency: 'NGN' }, data: { paused: true } });
    try {
      assert.equal((await browser.post('/v1/quotes', { product_id, face_value: 1000 })).json.error.code, 'conversion_unavailable');
    } finally {
      await prisma.currencySetting.update({ where: { currency: 'NGN' }, data: { paused: false } });
    }
  });

  test('quotes need the quotes:write scope', async () => {
    const { browser } = await resellerClient(server);
    const readOnly = (await browser.post('/v1/api-keys', { name: 'Read', mode: 'test', scopes: ['catalogue:read'] })).json.secret;
    const res = await fetch(`${server.base}/v1/quotes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${readOnly}`, 'content-type': 'application/json', 'idempotency-key': 'q-1' },
      body: JSON.stringify({ product_id: await productId('gift_cards:US:amazon-us'), face_value: 1000 }),
    });
    assert.equal(res.status, 403);
  });

  test('taxable categories: tax is shown and must be covered; live sales need a confirmed rate', async () => {
    await admin.put('/v1/admin/countries/NG/categories/airtime', { taxable: true });
    try {
      const { browser } = await resellerClient(server);
      const product_id = await productId('airtime:NG:mtn:topup');
      const body = { product_id, face_value: 100_000, recipient: { phone: '08031234567' } };
      assert.equal((await browser.post('/v1/quotes', body, sandbox)).json.error.code, 'price_below_cost', 'face value alone cannot cover tax');

      await browser.put('/v1/pricing/markups', { category: 'airtime', markup_bps: 1000 });
      const quote = (await browser.post('/v1/quotes', body, sandbox)).json;
      // NGN 1,100 including 7.5% VAT: VAT NGN 76.74; profit NGN 1,100 - 76.74 - 1,000.
      assert.deepEqual([quote.price, quote.tax, quote.reseller_profit], [110_000, { name: 'VAT', rate_percent: 7.5, amount: 7674 }, 2326]);
      assert.equal((await browser.post('/v1/quotes', body)).json.error.code, 'tax_not_configured', 'Nigeria VAT is not confirmed yet');
    } finally {
      await admin.put('/v1/admin/countries/NG/categories/airtime', { taxable: false });
    }
  });
});
