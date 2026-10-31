// Remita Vending Bills: the catalogue (electricity sharing VTpass's product keys, fixed TV packages, any-amount airtime,
// mobile data to a phone and internet subscriptions to an account, other countries left out, paged), meter and account
// checks before a quote, vends under our reference with the token delivered, pending vends requeried, a lost reply
// recovered by the requery and never sent twice, clear refusals failing the order, and Test connection.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeRemita } from './fakes.mjs';

const { RemitaAdapter } = await import('../dist/suppliers/remita.adapter.js');

let server;
let remita;
let admin;
let prisma;
let wallets;
let orders;

before(async () => {
  remita = await fakeRemita();
  server = await startApp({ env: { ...remita.env, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  orders = server.app.get((await import('../dist/orders/orders.service.js')).OrdersService);
  assert.equal((await admin.patch('/v1/admin/suppliers/remita', { enabled: true })).status, 200);
  for (const category of ['bills', 'pay_tv', 'airtime', 'data']) {
    assert.equal((await admin.put(`/v1/admin/suppliers/remita/markets/NG/${category}`, { enabled: true })).status, 200);
    await prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'NG', category } }, data: { enabled: true, taxable: false } });
  }
  const sync = await admin.post('/v1/admin/suppliers/remita/sync');
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
});

after(async () => {
  await server?.close();
  await remita?.close();
});

async function nigerianReseller() {
  const created = await resellerClient(server, { country: 'NG' });
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
  return created;
}

async function quote(browser, key, faceValue, recipient) {
  const product = await prisma.product.findUniqueOrThrow({ where: { key } });
  return browser.post('/v1/quotes', { product_id: product.id, face_value: faceValue, recipient });
}

async function buy(browser, key, faceValue, recipient) {
  const quoted = await quote(browser, key, faceValue, recipient);
  assert.equal(quoted.status, 201, JSON.stringify(quoted.json));
  const order = await browser.post('/v1/orders', { quote_id: quoted.json.id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  return { quote: quoted.json, order: order.json, row: await prisma.order.findUniqueOrThrow({ where: { id: order.json.id } }) };
}

describe('Remita catalogue', () => {
  test('electricity shares VTpass’s keys; TV packages are fixed; airtime is any amount; internet splits into data and bills', async () => {
    const offers = await prisma.supplierProduct.findMany({ where: { supplierCode: 'remita' }, include: { product: true } });
    const byKey = Object.fromEntries(offers.map(offer => [offer.product.key, offer]));
    assert.deepEqual(Object.keys(byKey).sort(), [
      'airtime:NG:mtn:topup',
      'bills:NG:eko-electric:postpaid',
      'bills:NG:eko-electric:prepaid',
      'bills:NG:ikeja-electric:prepaid',
      'bills:NG:smile:5gb',
      'data:NG:mtn:1gb-30-days',
      'pay_tv:NG:dstv:dstv-padi',
      'pay_tv:NG:gotv:gotv-smallie',
    ]);
    const eko = byKey['bills:NG:eko-electric:prepaid'];
    assert.deepEqual([eko.sku, eko.product.recipientType, eko.product.denominationType, Number(eko.product.minValueMinor), Number(eko.product.maxValueMinor)], ['101', 'meter', 'range', 50_000, 50_000_000]);
    assert.deepEqual([eko.meta.productCode, Number(eko.costRatio)], ['101', 1]);
    const padi = byKey['pay_tv:NG:dstv:dstv-padi'].product;
    assert.deepEqual([padi.recipientType, padi.denominationType, padi.fixedValues.map(Number)], ['smartcard', 'fixed', [440_000]]);
    assert.deepEqual([byKey['airtime:NG:mtn:topup'].product.recipientType, byKey['data:NG:mtn:1gb-30-days'].product.recipientType, byKey['bills:NG:smile:5gb'].product.recipientType], ['phone', 'phone', 'account']);
    assert.ok(!remita.calls.some(call => call.url.includes('countryCode=GHA')), 'only the market asked for');
    assert.ok(remita.calls.some(call => call.url.includes('page=1')), 'pages are followed');
  });

  test('a market Remita has nothing for syncs nothing and says why', async () => {
    const adapter = new RemitaAdapter({ secretKey: 'remita-secret', baseUrl: remita.url });
    assert.deepEqual(await adapter.catalogue({ category: 'airtime', country: 'FR' }), []);
    assert.match(adapter.syncReport(), /no products for FR/);
  });
});

describe('Remita orders', () => {
  test('a meter is checked with Remita and its name and address come back on the quote; an unknown one is refused', async () => {
    const { browser } = await nigerianReseller();
    const bad = await quote(browser, 'bills:NG:eko-electric:prepaid', 310_000, { account_number: '0000000001' });
    assert.deepEqual([bad.status, bad.json.error.code], [400, 'recipient_invalid']);
    const good = await quote(browser, 'bills:NG:eko-electric:prepaid', 310_000, { account_number: '12345678910' });
    assert.equal(good.status, 201, JSON.stringify(good.json));
    assert.deepEqual([good.json.recipient.account_name, good.json.recipient.address, good.json.recipient.min_amount], ['Adene Jonah', '34 Tokai, Abuja', '500']);
    const check = remita.calls.findLast(call => call.url.endsWith('/validate'));
    assert.deepEqual([check.body, check.headers.secretkey], [{ productCode: '101', accountNumber: '12345678910' }, 'remita-secret']);
  });

  test('electricity is vended under our reference and delivers the token and units; the supplier is never named', async () => {
    const { browser } = await nigerianReseller();
    const { order, row, quote: quoted } = await buy(browser, 'bills:NG:eko-electric:prepaid', 310_000, { account_number: '12345678910', phone: '08031234567' });
    const sent = remita.state.sent.at(-1);
    assert.deepEqual(sent, { productCode: '101', clientReference: row.supplierReference, amount: 3100, data: { accountNumber: '12345678910', phoneNumber: '08031234567' } });
    assert.equal(order.status, 'completed');
    const delivered = (await browser.get(`/v1/orders/${order.id}`)).json;
    assert.deepEqual(delivered.deliveries.map(item => [item.kind, item.code, item.details.units]), [['token', '1123-4567-8567-8597-6545', '333.300']]);
    assert.ok(!/remita/i.test(JSON.stringify(delivered)) && !/remita/i.test(JSON.stringify(quoted)), 'the supplier is never named');
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).supplierTransactionId, '1729988839525188');
  });

  test('airtime goes to the phone in Remita’s national format; a TV package is a confirmation', async () => {
    const { browser } = await nigerianReseller();
    const airtime = await buy(browser, 'airtime:NG:mtn:topup', 50_000, { phone: '+2348031234567' });
    assert.deepEqual(remita.state.sent.at(-1).data, { accountNumber: '08031234567', phoneNumber: '08031234567' });
    assert.equal(airtime.order.status, 'completed');
    const tv = await buy(browser, 'pay_tv:NG:dstv:dstv-padi', 440_000, { account_number: '2022075342' });
    assert.deepEqual(remita.state.sent.at(-1).data, { accountNumber: '2022075342', phoneNumber: '08011111111' }, 'the contact phone when the customer gave none');
    const delivered = (await browser.get(`/v1/orders/${tv.order.id}`)).json;
    assert.deepEqual(delivered.deliveries.map(item => [item.kind, item.details.reference]), [['confirmation', '1729988839525188']]);
  });

  test('an internet subscription is paid to its account number after an account check', async () => {
    const { browser } = await nigerianReseller();
    assert.equal((await quote(browser, 'bills:NG:smile:5gb', 500_000, {})).json.error.param, 'recipient.account_number');
    const { order } = await buy(browser, 'bills:NG:smile:5gb', 500_000, { account_number: '1402000001' });
    assert.equal(order.status, 'completed');
    assert.equal(remita.state.sent.at(-1).data.accountNumber, '1402000001');
  });

  test('a pending vend waits and completes when the requery says so', async () => {
    const { browser } = await nigerianReseller();
    remita.state.reply = 'pending';
    try {
      const { order, row } = await buy(browser, 'bills:NG:ikeja-electric:prepaid', 500_000, { account_number: '12345678910' });
      assert.equal(order.status, 'processing');
      await orders.attempt(order.id, 'check', { scheduled: false });
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'processing', 'still pending at Remita');
      remita.state.vends[row.supplierReference].status = 'completed';
      await orders.attempt(order.id, 'check', { scheduled: false });
      assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.status, 'completed');
      assert.equal(remita.calls.filter(call => call.url.includes(`/query-transaction/${row.supplierReference}`)).length, 2);
    } finally {
      remita.state.reply = 'ok';
    }
  });

  test('a lost reply is never sent again: the requery finds the vend', async () => {
    const { browser } = await nigerianReseller();
    remita.state.reply = 'lost';
    try {
      const before = remita.state.sent.length;
      const { order } = await buy(browser, 'bills:NG:eko-electric:postpaid', 400_000, { account_number: '12345678910' });
      assert.equal(order.status, 'processing', 'unclear is not failed');
      await orders.attempt(order.id, 'check', { scheduled: false });
      const done = (await browser.get(`/v1/orders/${order.id}`)).json;
      assert.deepEqual([done.status, done.deliveries[0].kind], ['completed', 'token']);
      assert.equal(remita.state.sent.length, before + 1, 'vended once');
    } finally {
      remita.state.reply = 'ok';
    }
  });

  test('a clear refusal fails the order and releases the money', async () => {
    const { browser } = await nigerianReseller();
    const before = (await browser.get('/v1/wallet')).json.available;
    remita.state.reply = 'refuse';
    try {
      const { order } = await buy(browser, 'bills:NG:eko-electric:prepaid', 310_000, { account_number: '12345678910' });
      assert.equal(order.status, 'failed');
      assert.equal((await browser.get('/v1/wallet')).json.available, before);
      assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
    } finally {
      remita.state.reply = 'ok';
    }
  });

  test('the adapter reads Remita’s own codes', async () => {
    const adapter = new RemitaAdapter({ secretKey: 'remita-secret', baseUrl: remita.url });
    const request = { reference: 'unknown-ref', sku: '101', meta: { productCode: '101' }, category: 'bills', country: 'NG', faceValue: 100_000n, faceCurrency: 'NGN', quantity: 1, recipient: {} };
    assert.equal((await adapter.orderStatus(request)).status, 'pending', 'not found is not failed');
    remita.state.vends['failed-ref'] = { status: 'failed' };
    assert.equal((await adapter.orderStatus({ ...request, reference: 'failed-ref' })).status, 'failed');
  });
});

describe('Remita connection', () => {
  test('Test connection reads the categories; a wrong key is refused with what to check', async () => {
    const tested = await admin.post('/v1/admin/integrations/remita/test');
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual([tested.json.environment, tested.json.ok], ['live', true]);
    const group = (await admin.get('/v1/admin/integrations')).json.data.find(item => item.id === 'remita');
    assert.equal(group.section, 'suppliers');
    await assert.rejects(new RemitaAdapter({ secretKey: 'wrong', baseUrl: remita.url }).check(), error => error.definite === true && /secret key/.test(error.message));
  });
});
