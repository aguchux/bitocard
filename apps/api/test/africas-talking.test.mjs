// Africa's Talking airtime and data bundles: the catalogue (airtime per country and network at the agreed discount,
// data from the plans set up), sends carrying our reference as the Idempotency-Key, Sent/Queued orders waiting for the
// status callback (token in its address, body never trusted), clear refusals failing the order, and Test connection.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakeAfricasTalking } from './fakes.mjs';

const { AfricasTalkingAdapter, parseAirtimeMarkets, parseAirtimeDiscounts, parseDataPlans, africasTalkingNotice, atAmount } = await import('../dist/suppliers/africas-talking.adapter.js');

let server;
let at;
let admin;
let prisma;
let wallets;

before(async () => {
  at = await fakeAfricasTalking();
  server = await startApp({ env: { ...at.env, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  assert.equal((await admin.patch('/v1/admin/suppliers/africas_talking', { enabled: true })).status, 200);
  for (const category of ['airtime', 'data']) {
    assert.equal((await admin.put(`/v1/admin/suppliers/africas_talking/markets/KE/${category}`, { enabled: true })).status, 200);
    await prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'KE', category } }, data: { enabled: true } });
  }
  const sync = await admin.post('/v1/admin/suppliers/africas_talking/sync');
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
});

after(async () => {
  await server?.close();
  await at?.close();
});

async function kenyaReseller() {
  const created = await resellerClient(server, { country: 'KE' });
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: 5_000_000, reason: 'Test funding' });
  return created;
}

async function buy(browser, key, faceValue, phone = '0712345678') {
  const product = await prisma.product.findUniqueOrThrow({ where: { key } });
  const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: faceValue, recipient: { phone } });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const order = await browser.post('/v1/orders', { quote_id: quote.json.id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const row = await prisma.order.findUniqueOrThrow({ where: { id: order.json.id } });
  return { quote: quote.json, order: order.json, row, send: at.state.sends.at(-1) };
}

async function settled(browser, id) {
  let status = 'processing';
  for (let tries = 0; tries < 50 && status === 'processing'; tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    status = (await browser.get(`/v1/orders/${id}`)).json.status;
  }
  return status;
}

describe('Africa’s Talking catalogue', () => {
  test('airtime is one product per network at the agreed discount; data plans become fixed-price bundles', async () => {
    const products = await prisma.product.findMany({ where: { country: 'KE', category: { in: ['airtime', 'data'] }, supplierProducts: { some: { supplierCode: 'africas_talking' } } }, include: { supplierProducts: true }, orderBy: { key: 'asc' } });
    assert.deepEqual(
      products.map(p => [p.key, p.name, p.faceCurrency, p.denominationType, p.fixedValues.map(Number), Number(p.minValueMinor ?? 0), Number(p.maxValueMinor ?? 0)]),
      [
        ['airtime:KE:airtel:topup', 'Airtel airtime', 'KES', 'range', [], 1000, 1000000],
        ['airtime:KE:safaricom:topup', 'Safaricom airtime', 'KES', 'range', [], 1000, 1000000],
        ['airtime:KE:telkom:topup', 'Telkom airtime', 'KES', 'range', [], 1000, 1000000],
        ['data:KE:airtel:500mb-7-days', 'Airtel 500MB data, 7 days', 'KES', 'fixed', [9900], 0, 0],
        ['data:KE:safaricom:1gb-30-days', 'Safaricom 1GB data, 30 days', 'KES', 'fixed', [29900], 0, 0],
      ],
    );
    const airtime = products[1].supplierProducts[0];
    assert.deepEqual([airtime.costCurrency, airtime.costRatio.toString(), airtime.meta.network], ['KES', '0.96', 'safaricom'], 'cost is the amount less the agreed discount');
    const data = products[4].supplierProducts[0];
    assert.deepEqual([data.costRatio.toString(), data.meta], ['0.8361204014', { network: 'safaricom', quantity: 1, unit: 'GB', validity: 'Month' }], 'cost over price, rounded up');
    const adapter = new AfricasTalkingAdapter({ username: 'bitocard', apiKey: 'at-key', apiUrl: at.url, dataUrl: at.url, dataProduct: 'BitoCard Data', dataPlans: at.env.AFRICAS_TALKING_DATA_PLANS });
    assert.equal((await adapter.catalogue({ category: 'data', country: 'KE' })).length, 2);
    assert.match(adapter.syncReport(), /not understood: "KE nonsense"/, 'a plan it cannot read is reported, not guessed');
  });

  test('one market synced stocks airtime in every country Africa’s Talking serves, from its smallest amount', async () => {
    const offers = await prisma.supplierProduct.findMany({ where: { supplierCode: 'africas_talking', available: true, product: { category: 'airtime' } }, include: { product: true } });
    const byCountry = {};
    for (const offer of offers) (byCountry[offer.product.country] ??= []).push(offer.product.brand);
    assert.deepEqual(
      Object.fromEntries(Object.entries(byCountry).map(([country, brands]) => [country, brands.sort()]).sort()),
      { GH: ['airteltigo', 'mtn', 'telecel'], KE: ['airtel', 'safaricom', 'telkom'], NG: ['9mobile', 'airtel', 'glo', 'mtn'], TZ: ['airtel', 'halotel', 'tigo', 'vodacom'], UG: ['airtel', 'mtn'], ZA: ['cell-c', 'mtn', 'telkom', 'vodacom'] },
      'only Kenya’s market is switched on, yet every country is stocked',
    );
    const uganda = await prisma.product.findUniqueOrThrow({ where: { key: 'airtime:UG:mtn:topup' } });
    assert.deepEqual([uganda.faceCurrency, Number(uganda.minValueMinor), Number(uganda.maxValueMinor)], ['UGX', 5000, 20_000_000], 'its published limits, from the smallest amount');
    const southAfrica = await prisma.product.findUniqueOrThrow({ where: { key: 'airtime:ZA:cell-c:topup' } });
    assert.equal(southAfrica.name, 'Cell C airtime');
  });

  test('airtime refuses to sync until the discount is set; settings are read line by line', async () => {
    const adapter = new AfricasTalkingAdapter({ username: 'bitocard', apiKey: 'at-key', apiUrl: at.url, dataUrl: at.url });
    await assert.rejects(() => adapter.catalogue({ category: 'airtime', country: 'KE' }), /airtime discount/);
    assert.equal((await adapter.catalogue({ category: 'data', country: 'KE' })).length, 0, 'no data without the Mobile Data product');
    const markets = parseAirtimeMarkets('KE KES 5-5000 safaricom, airtel; UG UGX 500 to 9');
    assert.deepEqual(markets.markets, [{ country: 'KE', currency: 'KES', min: 5, max: 5000, networks: ['safaricom', 'airtel'] }]);
    assert.deepEqual(markets.problems, ['"UG UGX 500 to 9"']);
    assert.deepEqual(
      parseAirtimeMarkets('').markets.map(market => market.country),
      ['KE', 'UG', 'TZ', 'NG', 'GH', 'ZA'],
      'empty: the countries Africa’s Talking lists airtime as live in',
    );
    assert.deepEqual(parseDataPlans('ng mtn 2gb biweek 600 540').plans, [{ country: 'NG', network: 'mtn', quantity: 2, unit: 'GB', validity: 'BiWeek', price: '600', cost: '540' }]);
    assert.deepEqual(atAmount('KES 100.5000'), { currency: 'KES', minor: 10050n });
  });

  test('airtime discounts are set per network, per country or for everything, the most specific winning', async () => {
    const parsed = parseAirtimeDiscounts('NG mtn 1.8; NG airtel 2\nNG glo 3, NG t2 3; KE 4; 2.5; NG mtn 25; mtn 2');
    assert.deepEqual(
      [['NG', 'mtn'], ['NG', 'airtel'], ['NG', 'glo'], ['NG', '9mobile'], ['KE', 'safaricom'], ['UG', 'mtn']].map(([country, network]) => parsed.of(country, network)?.toString()),
      ['1.8', '2', '3', '3', '4', '2.5'],
      'T2 is 9mobile; a country’s rate, then the general one, cover the rest',
    );
    assert.deepEqual(parsed.problems, ['"NG mtn 25"', '"mtn 2"'], 'a discount of 20% or more, or a network without its country, is not guessed');
    assert.equal(parseAirtimeDiscounts('').discounts.size, 0);

    // Nigeria's schedule (Basic tier) and nothing else: only Nigeria's networks are synced, each at its own rate.
    const adapter = new AfricasTalkingAdapter({ username: 'bitocard', apiKey: 'at-key', apiUrl: at.url, dataUrl: at.url, airtimeDiscountPercent: 'NG airtel 2; NG glo 3; NG mtn 1.8; NG t2 3' });
    const items = await adapter.catalogue({ category: 'airtime', country: 'NG' });
    assert.deepEqual(
      items.map(item => [item.productKey, item.costRatio]),
      [
        ['airtime:NG:mtn:topup', '0.982'],
        ['airtime:NG:airtel:topup', '0.98'],
        ['airtime:NG:glo:topup', '0.97'],
        ['airtime:NG:9mobile:topup', '0.97'],
      ],
    );
    assert.match(adapter.syncReport(), /No airtime discount set for KE safaricom, .*: not synced/);
  });

  test('each country’s stock serves only its own resellers and their customers, whatever their plan', async () => {
    const { browser, resellerId } = await resellerClient(server, { country: 'NG' });
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'active', planCode: 'premium' } });
    assert.equal((await admin.put('/v1/admin/suppliers/africas_talking/markets/NG/airtime', { enabled: true })).status, 200);
    await prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'NG', category: 'airtime' } }, data: { enabled: true } });

    const product = key => prisma.product.findUniqueOrThrow({ where: { key } });
    const nigeria = await browser.post('/v1/quotes', { product_id: (await product('airtime:NG:mtn:topup')).id, face_value: 100000, recipient: { phone: '08031234567' } });
    assert.equal(nigeria.status, 201, JSON.stringify(nigeria.json));
    assert.equal(nigeria.json.currency, 'NGN');
    const kenya = await browser.post('/v1/quotes', { product_id: (await product('airtime:KE:safaricom:topup')).id, face_value: 10000, recipient: { phone: '+254712345678' } });
    assert.equal(kenya.json.error?.code, 'product_unavailable', 'the international plan does not open another country’s Africa’s Talking stock');
    const listed = (await browser.get('/v1/catalogue/products?category=airtime&limit=100')).json.data;
    assert.ok(listed.some(p => p.country === 'NG') && !listed.some(p => p.country !== 'NG'), 'only Nigeria’s airtime is listed');
  });

  test('callbacks name the transaction (airtime) or our reference (data), as JSON or a form', () => {
    assert.deepEqual(africasTalkingNotice(Buffer.from('phoneNumber=%2B254712345678&status=Success&requestId=ATQid_9')), { eventType: 'airtime:Success', reference: null, supplierTransactionId: 'ATQid_9' });
    assert.deepEqual(africasTalkingNotice(Buffer.from(JSON.stringify({ transactionId: 'ATPid_3', category: 'MobileData', status: 'Failed', requestMetadata: { reference: 'REF1' } }))), {
      eventType: 'MobileData:Failed',
      reference: 'REF1',
      supplierTransactionId: 'ATPid_3',
    });
  });
});

describe('Africa’s Talking orders', () => {
  test('airtime is sent with our reference, waits while Sent, and completes after the callback is re-checked', async () => {
    const { browser } = await kenyaReseller();
    const { order, row, send, quote } = await buy(browser, 'airtime:KE:safaricom:topup', 5000);
    assert.equal(order.status, 'processing');
    assert.deepEqual([send.form.username, send.recipient, send.idempotencyKey], ['bitocard', { phoneNumber: '+254712345678', amount: 'KES 50' }, row.supplierReference]);
    assert.equal(Number(row.supplierReportedCostMinor), 4750, 'the discount the send reported is kept for reconciliation');
    assert.ok(!/africa|ATQid/i.test(JSON.stringify(order)) && !/africa/i.test(JSON.stringify(quote)), 'the supplier is never named');

    at.state.transactions[row.supplierTransactionId] = 'Success';
    const body = `phoneNumber=%2B254712345678&status=Success&requestId=${row.supplierTransactionId}`;
    // Airtime callbacks may come as a form.
    const form = query => fetch(`${server.base}/v1/webhooks/africas-talking${query}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }).then(res => res.status);
    assert.equal(await form(''), 401);
    assert.equal(await form('?token=wrong'), 401);
    assert.equal(await form('?token=at-callback'), 200);
    assert.equal(await settled(browser, order.id), 'completed');
    const delivered = (await browser.get(`/v1/orders/${order.id}`)).json;
    assert.deepEqual(delivered.deliveries.map(item => [item.kind, item.details]), [['confirmation', { transaction_id: 'SFC123456' }]]);
    const completed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.deepEqual([Number(completed.supplierReportedCostMinor), completed.costMismatch], [4750, true], 'a bigger discount than agreed is flagged for finance');
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });

  test('a refused airtime send fails the order and releases the money', async () => {
    const { browser } = await kenyaReseller();
    const before = (await browser.get('/v1/wallet')).json;
    at.state.airtime = 'Failed';
    try {
      const { order } = await buy(browser, 'airtime:KE:airtel:topup', 2000);
      assert.equal(order.status, 'failed');
    } finally {
      at.state.airtime = 'Sent';
    }
    const after = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([after.available, after.reserved], [before.available, 0]);
  });

  test('a data bundle goes to the Mobile Data product with our reference in its metadata; a failed bundle fails the order', async () => {
    const { browser } = await kenyaReseller();
    const { order, row, send } = await buy(browser, 'data:KE:safaricom:1gb-30-days', 29900);
    assert.equal(order.status, 'processing');
    assert.deepEqual(send.body, {
      username: 'bitocard',
      productName: 'BitoCard Data',
      recipients: [{ phoneNumber: '+254712345678', quantity: 1, unit: 'GB', validity: 'Month', metadata: { reference: row.supplierReference } }],
    });
    assert.equal(send.idempotencyKey, row.supplierReference);

    // The callback names our reference; BitoCard asks Africa's Talking itself and believes only that.
    at.state.transactions[row.supplierTransactionId] = 'Failed';
    const hook = client(server.base);
    const notice = { transactionId: row.supplierTransactionId, category: 'MobileData', status: 'Success', requestMetadata: { reference: row.supplierReference } };
    assert.equal((await hook.post('/v1/webhooks/africas-talking?token=at-callback', notice)).status, 200);
    assert.equal(await settled(browser, order.id), 'failed', 'the lookup said failed, whatever the callback claimed');
    const wallet = (await browser.get('/v1/wallet')).json;
    assert.equal(wallet.reserved, 0);
  });

  test('a bundle Africa’s Talking does not accept is a clear refusal', async () => {
    const { browser } = await kenyaReseller();
    at.state.data = 'InvalidRequest';
    try {
      const { order } = await buy(browser, 'data:KE:airtel:500mb-7-days', 9900);
      assert.equal(order.status, 'failed');
    } finally {
      at.state.data = 'Queued';
    }
  });
});

describe('Africa’s Talking connection', () => {
  test('Test connection checks the username and API key against the account balance', async () => {
    const tested = await admin.post('/v1/admin/integrations/africas_talking/test');
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual([tested.json.environment, tested.json.ok, tested.json.message], ['live', true, null]);
    const group = (await admin.get('/v1/admin/integrations')).json.data.find(item => item.id === 'africas_talking');
    assert.deepEqual([group.section, group.adapter_ready ?? group.adapterReady ?? true], ['suppliers', true]);
  });
});
