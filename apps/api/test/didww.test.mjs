// DIDWW virtual numbers: the catalogue (only unregulated, unmetered numbers with voice or SMS), ordering one number for
// one billing cycle, delivering it, unclear replies (found again by the reference in the callback address, never
// ordered twice), cancellations, and DIDWW's signed order callbacks.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeDidww } from './fakes.mjs';

const callbackBase = 'https://api.test.example';
let server;
let didww;
let admin;
let prisma;
let wallets;

before(async () => {
  didww = await fakeDidww();
  server = await startApp({ env: { ...didww.env, DIDWW_CALLBACK_URL: callbackBase, CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  assert.equal((await admin.patch('/v1/admin/suppliers/didww', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/suppliers/didww/markets/NG/virtual_numbers', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/countries/NG/categories/virtual_numbers', { enabled: true })).status, 200);
  const sync = await admin.post('/v1/admin/suppliers/didww/sync');
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
});

after(async () => {
  await server?.close();
  await didww?.close();
});

const londonKey = 'virtual_numbers:GB:local:london-voice-sms-0ch';

async function reseller() {
  const client = await resellerClient(server);
  await prisma.reseller.update({ where: { id: client.resellerId }, data: { status: 'active' } });
  await wallets.adjust(null, { resellerId: client.resellerId, mode: 'live', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
  return client;
}

async function order(client, key = londonKey) {
  const product = await prisma.product.findUniqueOrThrow({ where: { key } });
  const quote = await client.browser.post('/v1/quotes', { product_id: product.id, face_value: Number(product.fixedValues[0]) });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const created = await client.browser.post('/v1/orders', { quote_id: quote.json.id });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json;
}

const placed = () => Object.values(didww.state.orders).at(-1);

/** Signed like DIDWW: hex HMAC-SHA1 (API key) of the full address with explicit port, then sorted name+value pairs. */
async function callback(reference, fields, { key = 'didww-key' } = {}) {
  const path = `/v1/webhooks/didww?reference=${encodeURIComponent(reference)}`;
  const signed = `https://api.test.example:443${path}${Object.keys(fields).sort().map(name => `${name}${fields[name]}`).join('')}`;
  const res = await fetch(`${server.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-didww-signature': createHmac('sha1', key).update(signed).digest('hex') },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, json: await res.json() };
}

const until = async (check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};

describe('DIDWW catalogue', () => {
  test('numbers are products per country, type, area, capabilities and plan; regulated, metered and fax-only ones are left out', async () => {
    const products = await prisma.product.findMany({ where: { category: 'virtual_numbers' }, include: { supplierProducts: true }, orderBy: { key: 'asc' } });
    assert.deepEqual(
      products.map(p => [p.key, p.country, p.faceCurrency, p.fixedValues.map(Number), p.recipientType]),
      [
        [londonKey, 'GB', 'USD', [150], 'none'],
        ['virtual_numbers:GB:local:london-voice-sms-2ch', 'GB', 'USD', [350], 'none'],
      ],
    );
    assert.equal(products[0].name, 'United Kingdom local number, London');
    assert.match(products[0].description, /with incoming calls, incoming SMS, SMS from people, SMS codes from apps and services\./);
    assert.deepEqual(products[0].features, ['calls_in', 'sms_in', 'sms_people', 'app_codes'], 'what the number can do, in BitoCard names');
    assert.deepEqual(products[0].supplierProducts[0].meta, {
      didGroupId: 'grp-london',
      skuId: 'sku-london-0',
      numberType: 'local',
      areaName: 'London',
      capabilities: ['voice', 'sms'],
      channels: 0,
      setupMinor: 0,
      monthlyMinor: 150,
    });
    const groupsCall = didww.calls.find(call => call.url.startsWith('/did_groups'));
    assert.match(decodeURIComponent(groupsCall.url), /filter\[needs_registration\]=false/);
    assert.equal(groupsCall.headers['x-didww-api-version'], '2026-04-16');
  });

  test('older feature names (voice, sms) are read too; a fetch says what it found and left out', async () => {
    const { DidwwAdapter } = await import('../dist/suppliers/didww.adapter.js');
    const adapter = new DidwwAdapter({ apiKey: 'didww-key', baseUrl: didww.url, countries: ['GB', 'ZZ'], callbackBase });
    const original = didww.state.groups;
    didww.state.groups = original.map(group => ({ ...group, attributes: { ...group.attributes, features: group.attributes.features.map(feature => ({ voice_in: 'voice', sms_in: 'sms' })[feature] ?? feature) } }));
    try {
      const items = await adapter.catalogue({ category: 'virtual_numbers', country: null });
      assert.deepEqual(items.map(item => item.productKey).sort(), [londonKey, 'virtual_numbers:GB:local:london-voice-sms-2ch']);
      assert.deepEqual(items[0].meta.capabilities, ['voice', 'sms']);
      assert.equal(
        adapter.syncReport(),
        'GB: 2 number groups in stock without documents or per-minute billing, 2 products; 1 have neither calls nor SMS (features: t38). ZZ: not a DIDWW country.',
      );
    } finally {
      didww.state.groups = original;
    }
  });

  test('a sync that brings back nothing says why', async () => {
    const original = didww.state.groups;
    didww.state.groups = original.filter(group => group.id !== 'grp-london');
    try {
      const sync = await admin.post('/v1/admin/suppliers/didww/sync');
      assert.deepEqual([sync.status, sync.json.products_created + sync.json.offers_updated], [200, 0]);
      assert.equal(sync.json.note, 'GB: 1 number groups in stock without documents or per-minute billing, 0 products; 1 have neither calls nor SMS (features: t38).');
    } finally {
      didww.state.groups = original;
      assert.equal((await admin.post('/v1/admin/suppliers/didww/sync')).json.note, null);
    }
  });

  test('a large catalogue syncs in batches: thousands of numbers, and a second sync writes only what changed', async () => {
    const original = didww.state.groups;
    const london = original.find(group => group.id === 'grp-london');
    const many = Array.from({ length: 1500 }, (_, i) => ({
      ...london,
      id: `grp-bulk-${i}`,
      attributes: { ...london.attributes, area_name: `Area ${i}` },
      skus: london.skus.map(sku => ({ ...sku, id: `${sku.id}-${i}` })),
    }));
    didww.state.groups = [...original, ...many];
    try {
      const started = Date.now();
      const first = await admin.post('/v1/admin/suppliers/didww/sync');
      assert.equal(first.status, 200, JSON.stringify(first.json));
      assert.equal(first.json.products_created, 3000, 'two plans per area');
      const offer = await prisma.supplierProduct.findFirstOrThrow({ where: { supplierCode: 'didww', sku: 'grp-bulk-7:sku-london-0-7' } });
      await prisma.supplierProduct.update({ where: { id: offer.id }, data: { discountBps: 250, priority: 5 } });
      const second = await admin.post('/v1/admin/suppliers/didww/sync');
      assert.deepEqual([second.json.products_created, second.json.offers_updated, second.json.offers_withdrawn], [0, 3002, 0]);
      const kept = await prisma.supplierProduct.findUniqueOrThrow({ where: { id: offer.id } });
      assert.deepEqual([kept.discountBps, kept.priority, kept.available], [250, 5, true], 'admin settings are kept');
      assert.ok(kept.syncedAt > offer.syncedAt, 'seen again');
      assert.ok(Date.now() - started < 60_000, `two syncs of 3,000 numbers took ${Date.now() - started} ms`);
    } finally {
      didww.state.groups = original;
      await admin.post('/v1/admin/suppliers/didww/sync');
    }
    assert.equal(await prisma.supplierProduct.count({ where: { supplierCode: 'didww', available: true } }), 2, 'numbers DIDWW no longer lists are withdrawn');
  });

  test('the store shows what each number can do and filters by it', async () => {
    const visitor = (await import('./helpers.mjs')).client(server.base);
    const all = await visitor.get('/v1/store/products?category=virtual_numbers&limit=60');
    assert.equal(all.status, 200, JSON.stringify(all.json));
    const london = all.json.data.find(product => product.key === londonKey);
    assert.deepEqual(london.features, ['calls_in', 'sms_in', 'sms_people', 'app_codes']);
    const codes = await visitor.get('/v1/store/products?category=virtual_numbers&features=sms_in,app_codes');
    assert.ok(codes.json.data.length > 0 && codes.json.data.every(product => product.features.includes('app_codes') && product.features.includes('sms_in')));
    assert.equal((await visitor.get('/v1/store/products?category=virtual_numbers&features=caller_name')).json.data.length, 0, 'none shows the caller name');
    const wrong = await visitor.get('/v1/store/products?features=whatsapp');
    assert.deepEqual([wrong.status, wrong.json.error.param], [400, 'features']);
    assert.ok(!JSON.stringify(all.json).match(/didww|a2p|p2p/i), 'never the supplier or its names for features');
  });

  test('numbers are sold in every market: a Nigerian reseller sees UK numbers, priced in naira, without the supplier', async () => {
    const client = await reseller();
    const product = await prisma.product.findUniqueOrThrow({ where: { key: londonKey } });
    const seen = (await client.browser.get(`/v1/catalogue/products/${product.id}`)).json;
    assert.equal(seen.category, 'virtual_numbers');
    assert.equal(JSON.stringify(seen).toLowerCase().includes('didww'), false);
  });
});

describe('DIDWW orders', () => {
  test('a completed order delivers the number; one billing cycle is ordered, with our reference in the callback address', async () => {
    const client = await reseller();
    didww.state.orderReply = 'Completed';
    const created = await order(client);
    assert.equal(created.status, 'completed', JSON.stringify(created));
    const sent = placed().request.data.attributes;
    const row = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    assert.deepEqual(sent.items, [{ type: 'did_order_items', attributes: { sku_id: 'sku-london-0', qty: 1, billing_cycles_count: 1 } }]);
    assert.equal(sent.allow_back_ordering, false);
    assert.equal(sent.callback_url, `${callbackBase}/v1/webhooks/didww?reference=${encodeURIComponent(row.supplierReference)}`);
    const delivery = created.deliveries[0];
    assert.equal(delivery.kind, 'virtual_number');
    assert.match(delivery.details.number, /^\+44207\d+$/);
    assert.equal(delivery.serial, delivery.details.number);
    assert.equal(delivery.details.capabilities, 'voice,sms');
  });

  test('a cancelled order fails and releases the money', async () => {
    const client = await reseller();
    didww.state.orderReply = 'Canceled';
    const created = await order(client);
    assert.equal(created.status, 'failed');
    didww.state.orderReply = 'Completed';
  });

  test('a refused order (DIDWW rejects it) fails without being checked again', async () => {
    const client = await reseller();
    const product = await prisma.product.findUniqueOrThrow({ where: { key: londonKey }, include: { supplierProducts: true } });
    const offer = product.supplierProducts[0];
    await prisma.supplierProduct.update({ where: { id: offer.id }, data: { meta: { ...offer.meta, skuId: 'sku-gone' } } });
    try {
      assert.equal((await order(client)).status, 'failed');
    } finally {
      await prisma.supplierProduct.update({ where: { id: offer.id }, data: { meta: offer.meta } });
    }
  });

  test('an unclear reply is not a failure: the order is found again by its reference and never placed twice', async () => {
    const client = await reseller();
    didww.state.orderReply = { http: 500, recorded: 'Pending' };
    const created = await order(client);
    assert.equal(created.status, 'processing');
    const before = Object.keys(didww.state.orders).length;
    didww.state.orderReply = 'Completed';
    didww.complete(placed().id);
    const { OrdersService } = await import('../dist/orders/orders.service.js');
    await server.app.get(OrdersService).attempt(created.id, 'check');
    const after = (await client.browser.get(`/v1/orders/${created.id}`)).json;
    assert.equal(after.status, 'completed');
    assert.match(after.deliveries[0].details.number, /^\+44/);
    assert.equal(Object.keys(didww.state.orders).length, before, 'no second order');
  });

  test('an order DIDWW never recorded stays pending (not proof of failure) until the exception queue', async () => {
    const client = await reseller();
    didww.state.orderReply = { http: 500 };
    const created = await order(client);
    assert.equal(created.status, 'processing');
    const { OrdersService } = await import('../dist/orders/orders.service.js');
    await server.app.get(OrdersService).attempt(created.id, 'check');
    assert.equal((await client.browser.get(`/v1/orders/${created.id}`)).json.status, 'processing');
    const attempt = await prisma.orderAttempt.findFirst({ where: { orderId: created.id, action: 'check' } });
    assert.equal(attempt.detail, 'No DIDWW order with this reference yet');
    didww.state.orderReply = 'Completed';
  });
});

describe('DIDWW callbacks', () => {
  test('a signed callback is stored and makes BitoCard check the order with DIDWW', async () => {
    const client = await reseller();
    didww.state.orderReply = 'Pending';
    const created = await order(client);
    assert.equal(created.status, 'processing');
    const row = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.supplierTransactionId, placed().id);
    didww.complete(placed().id);
    const res = await callback(row.supplierReference, { id: placed().id, type: 'orders', status: 'completed' });
    assert.deepEqual([res.status, res.json], [200, { received: true }]);
    await until(async () => (await client.browser.get(`/v1/orders/${created.id}`)).json.status === 'completed', 'the order to complete');
    await until(async () => (await prisma.supplierWebhook.findFirst({ where: { reference: row.supplierReference } }))?.status === 'processed', 'the callback to be processed');
    const stored = await prisma.supplierWebhook.findFirst({ where: { reference: row.supplierReference } });
    assert.deepEqual([stored.supplierCode, stored.eventType, stored.supplierTransactionId, stored.orderId], ['didww', 'orders.completed', placed().id, created.id]);
    // DIDWW retrying the same callback is stored once.
    assert.deepEqual((await callback(row.supplierReference, { id: placed().id, type: 'orders', status: 'completed' })).json, { received: true, duplicate: true });
    didww.state.orderReply = 'Completed';
  });

  test('the body is never trusted: "completed" with DIDWW still pending changes nothing', async () => {
    const client = await reseller();
    didww.state.orderReply = 'Pending';
    const created = await order(client);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: created.id } });
    await callback(row.supplierReference, { id: row.supplierTransactionId, type: 'orders', status: 'completed' });
    await until(async () => (await prisma.supplierWebhook.findFirst({ where: { reference: row.supplierReference } }))?.lastError === 'Order still pending at the supplier', 'the first try');
    assert.equal((await client.browser.get(`/v1/orders/${created.id}`)).json.status, 'processing');
    didww.state.orderReply = 'Completed';
  });

  test('wrongly signed or unsigned callbacks are refused and not stored', async () => {
    const count = await prisma.supplierWebhook.count({ where: { supplierCode: 'didww' } });
    assert.equal((await callback('x', { id: 'order-1', type: 'orders', status: 'completed' }, { key: 'wrong' })).status, 401);
    const unsigned = await fetch(`${server.base}/v1/webhooks/didww?reference=x`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'id=1&type=orders&status=completed' });
    assert.equal(unsigned.status, 401);
    assert.equal(await prisma.supplierWebhook.count({ where: { supplierCode: 'didww' } }), count);
  });

  test('signature rules match DIDWW: explicit port, sorted fields, query included', async () => {
    const { didwwSignatureValid } = await import('../dist/suppliers/didww.webhooks.js');
    const fields = { type: 'orders', status: 'completed', id: 'bf2cee72-6caa-4ae2-917e-bea01945691e' };
    // DIDWW's documented example string.
    const data = 'https://mycompany.com:443/didww_callbacks?opaque=123idbf2cee72-6caa-4ae2-917e-bea01945691estatuscompletedtypeorders';
    const signature = createHmac('sha1', 'key').update(data).digest('hex');
    assert.equal(didwwSignatureValid('key', 'https://mycompany.com/didww_callbacks?opaque=123', fields, signature), true);
    assert.equal(didwwSignatureValid('key', 'https://mycompany.com/didww_callbacks?opaque=124', fields, signature), false);
    assert.equal(didwwSignatureValid('key', 'https://mycompany.com/didww_callbacks?opaque=123', { ...fields, status: 'canceled' }, signature), false);
    assert.equal(didwwSignatureValid(undefined, 'https://mycompany.com/didww_callbacks?opaque=123', fields, signature), false);
  });
});
