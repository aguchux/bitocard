// eSIM Access: signed requests (the documented signature), the package catalogue as eSIM products (fixed plans and day
// passes), orders placed with our reference as the transaction ID and delivered once the profiles are allocated (query or
// ORDER_STATUS webhook), eSIM activation codes kept secret, refusals that release the money, and eSIMs after their order:
// status and data use from notifications, top-ups (reseller and store customer), and cancelling unused eSIMs for a refund.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeEsimAccess } from './fakes.mjs';
import { responseChecker } from './openapi-docs.mjs';

const { EsimAccessAdapter, esimAccessSignature, dataAmount } = await import('../dist/suppliers/esim-access.adapter.js');

let server;
let esim;
let admin;
let prisma;
let wallets;
let check;

before(async () => {
  esim = await fakeEsimAccess();
  server = await startApp({ env: { ...esim.env, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  check = await responseChecker(server.app);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'NG', category: 'esim' } }, data: { enabled: true, customerVerification: false } });
  assert.equal((await admin.patch('/v1/admin/suppliers/esim_access', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/suppliers/esim_access/markets/NG/esim', { enabled: true })).status, 200);
  const sync = await admin.post('/v1/admin/suppliers/esim_access/sync');
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
});

after(async () => {
  await server?.close();
  await esim?.close();
});

const japan = 'esim:JP:japan:jp-1-7';

async function nigerianReseller() {
  const created = await resellerClient(server);
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: 500_000_000, reason: 'Test funding' });
  return created;
}

async function buy(browser, key = japan, quantity = 1) {
  const product = await prisma.product.findUniqueOrThrow({ where: { key } });
  const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: Number(product.fixedValues[0]), quantity });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const order = await browser.post('/v1/orders', { quote_id: quote.json.id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const reference = (await prisma.order.findUniqueOrThrow({ where: { id: order.json.id } })).supplierReference;
  return { quote: quote.json, order: order.json, reference };
}

const webhook = (body, token = esim.env.ESIM_ACCESS_WEBHOOK_TOKEN) =>
  fetch(`${server.base}/v1/webhooks/esim-access?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('eSIM Access requests', () => {
  test('the signature is the documented one: lower-case HMAC-SHA256 of timestamp, request ID, access code and body', () => {
    // The example in eSIM Access's API documentation.
    const signature = esimAccessSignature({ timestamp: '1628670421', requestId: '4ce9d9cdac9e4e17b3a2c66c358c1ce2', accessCode: '11111', body: '{"imsi":"326543826"}', secretKey: '1111' });
    assert.equal(signature, '7eb765e27df5373dea2dbc8c41a7d9557743e46c8054750f3d851b3fd01d0835');
  });

  test('a wrong secret key is a definite refusal that says what to check; data amounts read as people write them', async () => {
    const wrong = new EsimAccessAdapter({ accessCode: 'esim-access-code', secretKey: 'not-the-key', baseUrl: esim.url });
    await assert.rejects(() => wrong.catalogue(), error => error.definite === true && /101003.*access code and secret key/.test(error.message) && !error.message.includes('not-the-key'));
    assert.deepEqual([dataAmount(1024 ** 3), dataAmount(5.5 * 1024 ** 3), dataAmount(500 * 1024 ** 2), dataAmount(0)], ['1GB', '5.5GB', '500MB', 'Unlimited']);
  });

  test('admins test the saved credentials against the balance', async () => {
    const tested = await admin.post('/v1/admin/integrations/esim_access/test');
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual([tested.json.ok, tested.json.environment], [true, 'live']);
  });
});

describe('eSIM Access catalogue', () => {
  test('each fixed package is an eSIM product: one country under it, regional ones under WW, priced from eSIM Access in cents', async () => {
    const products = await prisma.product.findMany({ where: { category: 'esim', NOT: { key: { contains: '-d-' } } }, include: { supplierProducts: true }, orderBy: { key: 'asc' } });
    assert.deepEqual(
      products.map(p => [p.key, p.country, p.brand, p.faceCurrency, p.fixedValues.map(Number), p.recipientType]),
      [
        ['esim:JP:japan:jp-1-7', 'JP', 'japan', 'USD', [151], 'none'],
        ['esim:WW:regional:eu-42-5-30', 'WW', 'regional', 'USD', [890], 'none'],
      ],
      'a package without a price is left out',
    );
    const offer = products[0].supplierProducts[0];
    assert.equal(offer.sku, 'JP_1_7');
    assert.ok(Number(offer.costRatio) * 151 >= 150.5 && Number(offer.costRatio) * 151 < 150.5001, 'the cost, fractions of a cent included, never under-counted');
    assert.deepEqual([offer.meta.price, offer.meta.countries, offer.meta.duration], [15050, ['JP'], 7]);
    assert.match(products[0].description, /^1GB of data for 7 days in Japan\. Validity starts when it is installed\./);
    assert.ok(!/esim ?access/i.test(JSON.stringify(products.map(p => [p.name, p.description, p.redeemInstructions]))), 'never names the supplier');
  });
});

describe('eSIM Access orders', () => {
  test('an order is placed with our reference and delivered as an eSIM: the activation code only on the order, never its QR address', async () => {
    const { browser, resellerId } = await nigerianReseller();
    const { order, reference } = await buy(browser);
    assert.equal(order.status, 'completed', JSON.stringify(order));
    const placed = esim.state.orders[reference];
    assert.deepEqual([placed.body.transactionId, placed.body.amount, placed.body.packageInfoList], [reference, 15050, [{ packageCode: 'JP_1_7', count: 1, price: 15050 }]]);
    const [delivery] = order.deliveries;
    assert.equal(delivery.kind, 'esim');
    assert.match(delivery.code, /^LPA:1\$rsp-eu\.example\.com\$MATCH/);
    assert.deepEqual([delivery.serial, delivery.details.iccid, delivery.details.apn, delivery.details.data, delivery.details.validity], [delivery.serial, delivery.serial, 'drei.at', '1GB', '7 days']);
    assert.ok(!JSON.stringify(order).includes('qrsim'), 'the QR image address is never kept or shown');
    assert.ok(!/esim ?access/i.test(JSON.stringify(order)));

    const stored = await prisma.orderDelivery.findFirstOrThrow({ where: { orderId: order.id } });
    assert.ok(stored.codeEncrypted && !stored.codeEncrypted.includes('LPA'), 'encrypted at rest');
    const listed = await browser.get('/v1/orders');
    assert.ok(!JSON.stringify(listed.json).includes('MATCH'), 'never in lists');
    const events = await prisma.event.findMany({ where: { resellerId } });
    assert.ok(!JSON.stringify(events.map(event => event.payload)).includes('MATCH'), 'never in webhook payloads');
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });

  test('two eSIMs in one order: both delivered, each with its own ICCID', async () => {
    const { browser } = await nigerianReseller();
    const { order, reference } = await buy(browser, japan, 2);
    assert.equal(order.status, 'completed');
    assert.equal(esim.state.orders[reference].count, 2);
    assert.equal(new Set(order.deliveries.map(item => item.serial)).size, 2);
  });

  test('profiles still being allocated wait; the ORDER_STATUS webhook (with the token) delivers them', async () => {
    const { browser } = await nigerianReseller();
    esim.state.allocating = true;
    let pending;
    try {
      pending = await buy(browser);
      assert.equal(pending.order.status, 'processing', 'unclear is not failed');
    } finally {
      esim.state.allocating = false;
    }
    const orderNo = esim.state.orders[pending.reference].orderNo;
    assert.equal((await webhook({ notifyType: 'ORDER_STATUS', notifyId: 'n1', content: { orderNo, orderStatus: 'GOT_RESOURCE', transactionId: pending.reference } }, 'wrong-token-0000000000')).status, 401);
    const accepted = await webhook({ notifyType: 'ORDER_STATUS', notifyId: 'n1', eventGenerateTime: '2026-10-11T10:00:00Z', content: { orderNo, orderStatus: 'GOT_RESOURCE', transactionId: pending.reference } });
    assert.equal(accepted.status, 200);
    let status = 'processing';
    for (let i = 0; i < 50 && status === 'processing'; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
      status = (await browser.get(`/v1/orders/${pending.order.id}`)).json.status;
    }
    assert.equal(status, 'completed');
    assert.equal((await browser.get(`/v1/orders/${pending.order.id}`)).json.deliveries[0].kind, 'esim');
  });

  test('other notification kinds are acknowledged and not stored', async () => {
    const before = await prisma.supplierWebhook.count({ where: { supplierCode: 'esim_access' } });
    for (const notifyType of ['SMDP_EVENT', 'ESIM_STATUS', 'DATA_USAGE', 'CHECK_HEALTH']) {
      assert.equal((await webhook({ notifyType, notifyId: `x-${notifyType}`, content: { transactionId: 'whatever' } })).status, 200);
    }
    assert.equal(await prisma.supplierWebhook.count({ where: { supplierCode: 'esim_access' } }), before);
  });

  test('too little eSIM Access balance is a clear refusal: the order fails and the money is released', async () => {
    const { browser } = await nigerianReseller();
    const before = (await browser.get('/v1/wallet')).json;
    const balance = esim.state.balance;
    esim.state.balance = 100;
    try {
      const { order } = await buy(browser);
      assert.equal(order.status, 'failed');
    } finally {
      esim.state.balance = balance;
    }
    const after = (await browser.get('/v1/wallet')).json;
    assert.deepEqual([after.available, after.reserved], [before.available, 0]);
  });

  test('the sandbox never calls eSIM Access: a test order gets an LPA code that installs nothing', async () => {
    const { browser, resellerId } = await nigerianReseller();
    await wallets.adjust(null, { resellerId, mode: 'test', balance: 'funding', amount: 500_000_000, reason: 'Test funding' });
    const count = esim.state.count;
    const product = await prisma.product.findUniqueOrThrow({ where: { key: japan } });
    const test = { 'bitocard-mode': 'test' };
    const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: 151 }, test);
    assert.equal(quote.status, 201, JSON.stringify(quote.json));
    const order = await browser.post('/v1/orders', { quote_id: quote.json.id }, test);
    assert.equal(order.status, 201, JSON.stringify(order.json));
    assert.equal(order.json.deliveries[0].kind, 'esim');
    assert.match(order.json.deliveries[0].code, /^LPA:1\$smdp\.sandbox\.invalid\$SANDBOX-/);
    assert.equal(esim.state.count, count);
  });
});

/** Calls the API and checks the status and the documented schema. */
async function expect(browser, method, path, key, status, body) {
  const res = method === 'GET' ? await browser.get(path) : await browser.post(path, body);
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(res.json)}`);
  check(key, status, res.json);
  return res.json;
}

const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const esimOf = async orderId => prisma.esim.findFirstOrThrow({ where: { orderId } });

describe('eSIM Access day passes', () => {
  test('each day pass is a product per number of days; ordering one sends the days and their total', async () => {
    const passes = await prisma.product.findMany({ where: { key: { startsWith: 'esim:JP:japan:jp-d-1-' } }, orderBy: { key: 'asc' } });
    assert.deepEqual(passes.map(p => p.key).sort(), ['1', '3', '5', '7', '10', '15', '30'].map(days => `esim:JP:japan:jp-d-1-${days}d`).sort());
    const week = passes.find(p => p.key.endsWith('-7d'));
    assert.deepEqual([week.fixedValues.map(Number), week.name], [[140], 'Japan day pass: 1GB a day, then slower, 7 days']);
    const { browser } = await nigerianReseller();
    const { order, reference } = await buy(browser, week.key);
    assert.equal(order.status, 'completed', JSON.stringify(order));
    const placed = esim.state.orders[reference].body;
    assert.deepEqual([placed.amount, placed.packageInfoList], [14_000, [{ packageCode: 'JP-D_1', count: 1, price: 2000, periodNum: 7 }]]);
    assert.equal((await esimOf(order.id)).topUps, 'days');
  });
});

describe('eSIMs after their order', () => {
  test('each delivered eSIM is kept: listed with its status, never its code or the supplier’s IDs', async () => {
    const { browser } = await nigerianReseller();
    const { order } = await buy(browser);
    const list = await expect(browser, 'GET', `/v1/esims?order_id=${order.id}`, 'GET /v1/esims', 200);
    assert.equal(list.data.length, 1);
    const [item] = list.data;
    assert.deepEqual([item.status, item.iccid, item.cancellable, item.top_ups, item.data.total], ['ready', order.deliveries[0].serial, true, 'data', 1024 ** 3]);
    const text = JSON.stringify(list);
    assert.ok(!text.includes('MATCH') && !text.includes((await esimOf(order.id)).supplierEsimId), 'no activation code, no supplier ID');
    await expect(browser, 'GET', `/v1/esims/${item.id}`, 'GET /v1/esims/{id}', 200);
  });

  test('status, data use and expiry notifications update it, tell the reseller (esim.updated) and warn the customer once', async () => {
    const { browser, resellerId } = await nigerianReseller();
    const { order } = await buy(browser);
    const row = await esimOf(order.id);
    const content = { iccid: row.iccid, orderNo: 'B1', esimTranNo: row.supplierEsimId, transactionId: 'x' };
    assert.equal((await webhook({ notifyType: 'SMDP_EVENT', notifyId: 's1', content: { ...content, esimStatus: 'GOT_RESOURCE', smdpStatus: 'INSTALLATION', eid: '89', timestamp: '2026-10-11T10:00:00Z', seqNumber: 1 } })).status, 200);
    assert.equal((await esimOf(order.id)).status, 'installed');
    await webhook({ notifyType: 'ESIM_STATUS', notifyId: 's2', content: { ...content, esimStatus: 'IN_USE', smdpStatus: 'ENABLED' } });
    await webhook({ notifyType: 'DATA_USAGE', notifyId: 's3', content: { ...content, totalVolume: 1024 ** 3, orderUsage: 0.9 * 1024 ** 3, remain: 0.1 * 1024 ** 3, remainThreshold: 0.1, lastUpdateTime: '2026-10-11T10:00:00Z' } });
    await webhook({ notifyType: 'DATA_USAGE', notifyId: 's3', content: { ...content, totalVolume: 1024 ** 3, orderUsage: 0.9 * 1024 ** 3, remain: 0.1 * 1024 ** 3, remainThreshold: 0.1, lastUpdateTime: '2026-10-11T10:00:00Z' } });
    await webhook({ notifyType: 'VALIDITY_USAGE', notifyId: 's4', content: { ...content, remain: 1, totalDuration: 7, durationUnit: 'DAY', expiredTime: '2026-10-18T10:00:00Z' } });
    const after = await esimOf(order.id);
    assert.deepEqual([after.status, Number(after.dataUsedBytes), after.expiresAt.toISOString(), after.lowDataNotified], ['active', Math.round(0.9 * 1024 ** 3), '2026-10-18T10:00:00.000Z', 10]);
    const events = await prisma.event.findMany({ where: { resellerId, type: 'esim.updated' } });
    assert.ok(events.length >= 3, 'the reseller hears of each change');
    assert.ok(!JSON.stringify(events.map(event => event.payload)).includes('MATCH'));
    const unknown = await webhook({ notifyType: 'ESIM_STATUS', notifyId: 's5', content: { ...content, esimTranNo: 'not-ours', esimStatus: 'IN_USE', smdpStatus: 'ENABLED' } });
    assert.equal(unknown.status, 200, 'an eSIM that is not ours is ignored');
  });

  test('a reseller tops an eSIM up from their wallet at BitoCard’s price; the supplier adds the data once', async () => {
    const { browser } = await nigerianReseller();
    const { order } = await buy(browser);
    const row = await esimOf(order.id);
    const options = await expect(browser, 'GET', `/v1/esims/${row.id}/top-up-options`, 'GET /v1/esims/{id}/top-up-options', 200);
    assert.equal(options.data.length, 1);
    const [option] = options.data;
    assert.ok(option.id.startsWith('opt_') && !JSON.stringify(options).includes('TOPUP_JP'), 'the supplier’s package is never shown');
    assert.equal(option.currency, 'NGN');
    const before = (await browser.get('/v1/wallet')).json.available;
    const balance = esim.state.balance;
    const topUp = await expect(browser, 'POST', `/v1/esims/${row.id}/top-ups`, 'POST /v1/esims/{id}/top-ups', 201, { option_id: option.id });
    assert.deepEqual([topUp.status, topUp.amount, topUp.paid_by], ['completed', option.amount, 'reseller']);
    assert.equal((await browser.get('/v1/wallet')).json.available, before - option.amount);
    assert.equal(esim.state.balance, balance - 12_000);
    assert.equal(Object.values(esim.state.topUps).filter(item => item.esimTranNo === row.supplierEsimId).length, 1);
    assert.equal(Number((await esimOf(order.id)).dataTotalBytes), 2 * 1024 ** 3, 'its data total grew');
    await expect(browser, 'GET', `/v1/esims/${row.id}/top-ups`, 'GET /v1/esims/{id}/top-ups', 200);
    await ledgerOk();

    const bad = await browser.post(`/v1/esims/${row.id}/top-ups`, { option_id: 'opt_nothing' });
    assert.deepEqual([bad.status, bad.json.error.code], [400, 'option_unavailable']);
    esim.state.balance = 100;
    try {
      const refused = await browser.post(`/v1/esims/${row.id}/top-ups`, { option_id: option.id });
      assert.equal(refused.json.status, 'failed');
    } finally {
      esim.state.balance = balance;
    }
    assert.equal((await browser.get('/v1/wallet')).json.available, before - option.amount, 'a refused top-up costs nothing');
    await ledgerOk();
  });

  test('a store customer tops up from their own wallet (US dollars too); the store keeps its margin; a refusal refunds them', async () => {
    const { browser, resellerId } = await nigerianReseller();
    const { order } = await buy(browser);
    const row = await esimOf(order.id);
    const customer = await prisma.customer.create({ data: { storeId: (await prisma.store.findFirstOrThrow()).id, email: `esim-${Date.now()}@example.com`, name: 'Ada', country: 'NG', passwordHash: 'not-a-hash' } });
    await prisma.order.update({ where: { id: order.id }, data: { customerId: customer.id } });
    const ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
    await ledger.post({
      mode: 'live',
      type: 'adjustment',
      reference: `test-dollars:${customer.id}`,
      description: 'Test dollars',
      lines: [{ account: { kind: 'adjustments', currency: 'USD' }, debit: 100_000n }, { account: { kind: 'customer_wallet', currency: 'USD', customerId: customer.id }, credit: 100_000n }],
    });
    const service = server.app.get((await import('../dist/esims/esims.service.js')).EsimsService);
    const proven = { id: order.id, customerId: customer.id };
    const options = await service.customerOptions(proven, row.id);
    const reseller = await service.resellerOptions(resellerId, 'live', row.id);
    assert.ok(options.data[0].amount >= reseller.data[0].amount, 'the customer pays the store’s price');
    assert.deepEqual(options.wallets.map(item => item.currency), ['NGN', 'USD']);
    const lowNaira = await service.customerTopUp(proven, row.id, { option_id: options.data[0].id }).catch(error => error);
    assert.equal(lowNaira.code, 'wallet_balance_low');
    const paid = await service.customerTopUp(proven, row.id, { option_id: options.data[0].id, wallet_currency: 'USD' });
    assert.deepEqual([paid.status, paid.paid_by, paid.amount], ['completed', 'customer', options.data[0].amount]);
    const dollars = await prisma.ledgerAccount.findFirstOrThrow({ where: { kind: 'customer_wallet', customerId: customer.id, currency: 'USD' } });
    assert.ok(dollars.balanceMinor < 100_000n);
    await ledgerOk();

    const balance = esim.state.balance;
    esim.state.balance = 100;
    try {
      const refused = await service.customerTopUp(proven, row.id, { option_id: options.data[0].id, wallet_currency: 'USD' });
      assert.equal(refused.status, 'failed');
    } finally {
      esim.state.balance = balance;
    }
    const after = await prisma.ledgerAccount.findFirstOrThrow({ where: { kind: 'customer_wallet', customerId: customer.id, currency: 'USD' } });
    assert.equal(after.balanceMinor, dollars.balanceMinor, 'refunded to the dollar wallet exactly');
    await ledgerOk();
  });

  test('an order whose eSIMs were never installed is cancelled and refunded; an installed one cannot be', async () => {
    const { browser } = await nigerianReseller();
    const before = (await browser.get('/v1/wallet')).json.available;
    const { order } = await buy(browser, japan, 2);
    const rows = await prisma.esim.findMany({ where: { orderId: order.id } });
    const balance = esim.state.balance;
    const cancelled = await expect(browser, 'POST', `/v1/esims/${rows[0].id}/cancel`, 'POST /v1/esims/{id}/cancel', 200);
    assert.deepEqual([cancelled.refunded, cancelled.data.map(item => item.status)], [true, ['cancelled', 'cancelled']]);
    assert.equal(esim.state.balance, balance + 2 * 15_050, 'both cancelled with the supplier, which refunds BitoCard');
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'refunded');
    assert.equal((await browser.get('/v1/wallet')).json.available, before, 'the reseller has every kobo back');
    await ledgerOk();

    const second = await buy(browser);
    const row = await esimOf(second.order.id);
    esim.state.profiles[row.supplierEsimId].smdpStatus = 'ENABLED';
    esim.state.profiles[row.supplierEsimId].esimStatus = 'IN_USE';
    const refused = await browser.post(`/v1/esims/${row.id}/cancel`);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'esim_in_use']);
  });

  test('sandbox eSIMs can be topped up and cancelled without calling the supplier', async () => {
    const { browser, resellerId } = await nigerianReseller();
    await wallets.adjust(null, { resellerId, mode: 'test', balance: 'funding', amount: 500_000_000, reason: 'Test funding' });
    const test = { 'bitocard-mode': 'test' };
    const product = await prisma.product.findUniqueOrThrow({ where: { key: japan } });
    const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: 151 }, test);
    const order = await browser.post('/v1/orders', { quote_id: quote.json.id }, test);
    const row = await esimOf(order.json.id);
    assert.ok(row.supplierEsimId.startsWith('sandbox_'));
    const count = esim.state.count;
    const options = await browser.get(`/v1/esims/${row.id}/top-up-options`, test);
    assert.equal(options.json.data.length, 2);
    const topUp = await browser.post(`/v1/esims/${row.id}/top-ups`, { option_id: options.json.data[0].id }, test);
    assert.equal(topUp.json.status, 'completed');
    const cancelled = await browser.post(`/v1/esims/${row.id}/cancel`, undefined, test);
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
    assert.equal(esim.state.count, count, 'the supplier was never called');
  });
});

describe('eSIMs on a signed-in customer’s order', () => {
  test('bought at bitocard.com, then topped up from the customer’s wallet and cancelled for a refund, from their order', async () => {
    const { adminCode, lastEmailCode } = await import('./helpers.mjs');
    const on = await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: true }, code: await adminCode(server, admin) });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    const product = await prisma.product.update({ where: { key: japan }, data: { listed: true } });
    let token = null;
    const call = async (method, path, body) => {
      const res = await fetch(`${server.base}${path}`, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'bitocard-customer-session': token } : {}), ...(method === 'POST' ? { 'idempotency-key': `k-${Math.random()}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      if (json?.session?.token) token = json.session.token;
      return { status: res.status, json };
    };
    const email = `traveller-${Date.now()}@example.com`;
    assert.equal((await call('POST', '/v1/store/account/signup', { name: 'Ngozi', email, password: 'correct horse battery', country: 'NG' })).status, 201);
    assert.equal((await call('POST', '/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
    const topUp = await call('POST', '/v1/store/wallet/top-ups', { amount: 50_000_000, return_url: 'https://bitocard.com/account/wallet' });
    assert.equal(topUp.status, 201, JSON.stringify(topUp.json));
    assert.equal((await call('POST', `/v1/store/wallet/top-ups/${topUp.json.id}/simulate`, { outcome: 'succeeded' })).status, 200);
    const preview = await call('POST', '/v1/store/checkouts', { product_id: product.id, face_value: 151, return_url: 'https://bitocard.com/checkout/return', preview: true });
    assert.equal(preview.status, 201, JSON.stringify(preview.json));
    const bought = await call('POST', '/v1/store/checkouts', { product_id: product.id, face_value: 151, return_url: 'https://bitocard.com/checkout/return', quote_id: preview.json.quote_id });
    assert.equal(bought.json.status, 'completed', JSON.stringify(bought.json));

    const list = await call('GET', `/v1/store/checkouts/${bought.json.id}/esims`);
    assert.deepEqual([list.status, list.json.data.length, list.json.data[0].status], [200, 1, 'ready']);
    const esimId = list.json.data[0].id;
    const options = await call('GET', `/v1/store/checkouts/${bought.json.id}/esims/${esimId}/top-up-options`);
    assert.deepEqual([options.json.available, options.json.data.length, options.json.wallets.map(item => item.currency)], [true, 2, ['NGN', 'USD']]);
    assert.deepEqual(options.json.data[0].prices.map(price => [price.currency, price.amount > 0]), [['NGN', true], ['USD', true]], 'its price from each wallet');
    const balance = (await call('GET', '/v1/store/wallet')).json.balance;
    const paid = await call('POST', `/v1/store/checkouts/${bought.json.id}/esims/${esimId}/top-ups`, { option_id: options.json.data[0].id });
    assert.deepEqual([paid.status, paid.json.status, paid.json.amount], [200, 'completed', options.json.data[0].amount]);
    assert.equal((await call('GET', '/v1/store/wallet')).json.balance, balance - options.json.data[0].amount);

    const cancelled = await call('POST', `/v1/store/checkouts/${bought.json.id}/esims/${esimId}/cancel`);
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
    assert.equal((await call('GET', `/v1/store/checkouts/${bought.json.id}`)).json.status, 'refunded');
    assert.equal((await call('GET', '/v1/store/wallet')).json.balance, balance - options.json.data[0].amount + bought.json.amount, 'the eSIM’s price is back in the wallet');
    const stranger = await call('GET', `/v1/store/checkouts/${crypto.randomUUID()}/esims`);
    assert.equal(stranger.status, 404);
    await ledgerOk();
  });
});
