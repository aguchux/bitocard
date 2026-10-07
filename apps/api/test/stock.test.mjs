// BitoCard's own stock: admins add products (software licences, gift cards) with the codes BitoCard bought, and they
// sell like any supplier's offer: resellers through the API, and bitocard.com once listed. Each code is handed over
// once, codes are never shown to admins or logged, and running out takes the product off sale.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';

const { EmailService } = await import('../dist/notifications/email.service.js');

let server;
let admin;
let prisma;
let wallets;
let visitor;

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
  visitor = client(server.base);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  // Software is sold in Nigeria; no supplier market is switched on (BitoCard's own stock needs none).
  await prisma.countryCategory.upsert({
    where: { countryCode_category: { countryCode: 'NG', category: 'software' } },
    create: { countryCode: 'NG', category: 'software', enabled: true },
    update: { enabled: true },
  });
});

after(async () => {
  await server?.close();
});

const sandbox = { 'bitocard-mode': 'test' };
const noStockNamed = json => assert.ok(!/"stock"|bitocard stock|stock_/i.test(JSON.stringify(json)), 'the source is named in a reseller or public response');
const storeKeys = async () => (await visitor.get('/v1/store/products?limit=60')).json.data.map(product => product.key);

async function funded() {
  const reseller = await resellerClient(server);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  for (const mode of ['live', 'test']) await wallets.adjust(null, { resellerId: reseller.resellerId, mode, balance: 'funding', amount: 500_000_000, reason: 'Test funding' });
  return reseller;
}

const office = {
  category: 'software',
  brand: 'Microsoft',
  duration_months: 0,
  title: 'Microsoft Office 2021 Professional',
  description: 'One PC, lifetime licence.',
  redeem_instructions: 'Sign in at setup.office.com and enter the key.',
  currency: 'USD',
  face_value: 4999,
  cost: 3000,
  listed: true,
  codes: [{ code: 'OFFICE-AAAA-1111' }, { code: 'OFFICE-BBBB-2222' }, { code: 'OFFICE-CCCC-3333', pin: '42' }, { code: ' OFFICE-AAAA-1111 ' }],
};

let item;

describe('adding stock', () => {
  test('an admin adds a product with its codes; duplicates are skipped and codes are never shown or logged', async () => {
    const created = await admin.post('/v1/admin/stock', office);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    item = created.json;
    assert.deepEqual([item.added, item.duplicates, item.codes.available, item.on_sale], [3, 1, 3, true]);
    assert.deepEqual(
      [item.product.key, item.product.country, item.product.name, item.product.face_value, item.product.listed, item.cost, item.duration_months],
      ['software:WW:microsoft:office-2021-professional-lifetime', 'WW', `${office.title} (Lifetime)`, 4999, true, 3000, 0],
      'software is global, and its term is part of the product',
    );

    const codes = (await admin.get(`/v1/admin/stock/${item.id}/codes`)).json.data;
    assert.deepEqual(codes.map(code => code.hint).sort(), ['1111', '2222', '3333']);
    assert.ok(!JSON.stringify(codes).includes('OFFICE-'), 'admins see only the last four characters');
    const stored = await prisma.stockCode.findMany({ where: { offerId: item.id } });
    assert.ok(stored.every(code => !code.codeEncrypted.includes('OFFICE')), 'encrypted at rest');
    const audit = await prisma.auditLog.findMany({ where: { targetId: item.id } });
    assert.ok(audit.some(entry => entry.action === 'stock.created'));
    assert.ok(!JSON.stringify(audit).includes('OFFICE-'), 'codes never in the audit log');

    // The same codes under a new item are duplicates too.
    const again = await admin.post(`/v1/admin/stock/${item.id}/codes`, { codes: [{ code: 'OFFICE-AAAA-1111' }] });
    assert.deepEqual([again.status, again.json.added, again.json.duplicates], [200, 0, 1]);
    const twice = await admin.post('/v1/admin/stock', { ...office, codes: [] });
    assert.deepEqual([twice.status, twice.json.error.code], [409, 'stock_item_exists']);
  });

  test('it is listed on bitocard.com and kept out of the supplier registry; only operations add stock', async () => {
    assert.ok((await storeKeys()).includes(item.product.key));
    noStockNamed((await visitor.get(`/v1/store/products/${encodeURIComponent(item.product.key)}`)).json);
    assert.ok(!(await admin.get('/v1/admin/suppliers')).json.data.some(supplier => supplier.code === 'stock'));
    assert.equal((await admin.post('/v1/admin/suppliers/stock/sync')).json.error.code, 'supplier_not_synced');
    assert.ok((await admin.get('/v1/admin/products?supplier=stock')).json.data.some(product => product.key === item.product.key));

    const support = await adminClient(server, ['support']);
    assert.equal((await support.get('/v1/admin/stock')).status, 200);
    assert.equal((await support.post('/v1/admin/stock', { ...office, title: 'Other' })).status, 403);
    assert.equal((await support.post(`/v1/admin/stock/${item.id}/codes`, { codes: [{ code: 'NEW-CODE-1' }] })).status, 403);
  });
});

describe('selling stock', () => {
  test('resellers sell it in the sandbox without using up stock', async () => {
    const { browser } = await funded();
    const product = (await browser.get('/v1/catalogue/products?category=software', sandbox)).json.data.find(row => row.id === item.product.id);
    assert.ok(product, 'in the catalogue with no supplier market switched on');
    noStockNamed(product);
    const quote = (await browser.post('/v1/quotes', { product_id: item.product.id, face_value: 4999, quantity: 5 }, sandbox)).json;
    const order = (await browser.post('/v1/orders', { quote_id: quote.id }, sandbox)).json;
    assert.deepEqual([order.status, order.deliveries.length, order.deliveries[0].kind], ['completed', 5, 'licence_key']);
    assert.match(order.deliveries[0].code, /^SANDBOX-/);
    assert.equal((await admin.get(`/v1/admin/stock/${item.id}`)).json.codes.available, 3);
  });

  test('a live order hands over the next codes once, and asking for more than is left is refused', async () => {
    const { browser } = await funded();
    const tooMany = await browser.post('/v1/quotes', { product_id: item.product.id, face_value: 4999, quantity: 4 });
    assert.deepEqual([tooMany.status, tooMany.json.error.code], [409, 'insufficient_stock']);

    const quote = await browser.post('/v1/quotes', { product_id: item.product.id, face_value: 4999, quantity: 2 });
    assert.equal(quote.status, 201, JSON.stringify(quote.json));
    const created = await browser.post('/v1/orders', { quote_id: quote.json.id });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const order = created.json;
    assert.equal(order.status, 'completed');
    assert.deepEqual(order.deliveries.map(d => [d.kind, d.code, d.details.duration]), [['licence_key', 'OFFICE-AAAA-1111', 'Lifetime'], ['licence_key', 'OFFICE-BBBB-2222', 'Lifetime']]);
    assert.equal(order.charged, quote.json.wholesale);
    noStockNamed(order);
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.deliveries[1].code, 'OFFICE-BBBB-2222');

    const stock = (await admin.get(`/v1/admin/stock/${item.id}`)).json;
    assert.deepEqual([stock.codes.available, stock.codes.sold], [1, 2]);
    const sold = (await admin.get(`/v1/admin/stock/${item.id}/codes?status=sold`)).json.data;
    assert.ok(sold.every(code => code.order_id === order.id && code.sold_at));
    const trace = (await admin.get(`/v1/admin/orders/${order.id}`)).json;
    assert.equal(trace.supplier.code, 'stock');
    assert.equal(trace.deliveries, undefined, 'admins never see delivered codes');
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });

  test('two orders for the last code: one gets it, the other fails and its money is released', async () => {
    const one = await funded();
    const two = await funded();
    const quotes = await Promise.all([one, two].map(r => r.browser.post('/v1/quotes', { product_id: item.product.id, face_value: 4999 })));
    const orders = await Promise.all([one, two].map((r, index) => r.browser.post('/v1/orders', { quote_id: quotes[index].json.id })));
    const statuses = orders.map(order => order.json.status).sort();
    assert.deepEqual(statuses, ['completed', 'failed']);
    const winner = orders.find(order => order.json.status === 'completed').json;
    assert.deepEqual([winner.deliveries[0].code, winner.deliveries[0].pin], ['OFFICE-CCCC-3333', '42']);
    const loser = orders.findIndex(order => order.json.status === 'failed');
    const wallet = (await [one, two][loser].browser.get('/v1/wallet')).json;
    assert.equal(wallet.reserved, 0, 'nothing left held');

    // Sold out: off sale everywhere until codes are added.
    assert.equal((await admin.get(`/v1/admin/stock/${item.id}`)).json.on_sale, false);
    assert.ok(!(await storeKeys()).includes(item.product.key));
    assert.equal((await one.browser.post('/v1/quotes', { product_id: item.product.id, face_value: 4999 })).json.error.code, 'product_unavailable');
    const restocked = (await admin.post(`/v1/admin/stock/${item.id}/codes`, { codes: [{ code: 'OFFICE-DDDD-4444' }, { code: 'OFFICE-CCCC-3333' }] })).json;
    assert.deepEqual([restocked.added, restocked.duplicates, restocked.on_sale], [1, 1, true], 'a sold code can never be stocked again');
    assert.ok((await storeKeys()).includes(item.product.key));
  });

  test('admins withdraw unsold codes, pause sales and set the margin', async () => {
    const [code] = (await admin.get(`/v1/admin/stock/${item.id}/codes?status=available`)).json.data;
    const withdrawn = await admin.post(`/v1/admin/stock/${item.id}/codes/${code.id}/withdraw`, { reason: 'Key reported as faulty' });
    assert.deepEqual([withdrawn.status, withdrawn.json.codes.available, withdrawn.json.codes.withdrawn, withdrawn.json.on_sale], [200, 0, 1, false]);
    const [sold] = (await admin.get(`/v1/admin/stock/${item.id}/codes?status=sold`)).json.data;
    assert.equal((await admin.post(`/v1/admin/stock/${item.id}/codes/${sold.id}/withdraw`, { reason: 'Mistake' })).json.error.code, 'stock_code_unavailable');

    await admin.post(`/v1/admin/stock/${item.id}/codes`, { codes: [{ code: 'OFFICE-EEEE-5555' }] });
    const { browser } = await funded();
    const before = (await browser.post('/v1/quotes', { product_id: item.product.id, face_value: 4999 })).json;
    const margined = await admin.patch(`/v1/admin/stock/${item.id}`, { margin_bps: 2000 });
    assert.equal(margined.json.margin_bps, 2000);
    const after = (await browser.post('/v1/quotes', { product_id: item.product.id, face_value: 4999 })).json;
    assert.ok(after.wholesale > before.wholesale, 'a higher margin raises the wholesale price');

    const paused = await admin.patch(`/v1/admin/stock/${item.id}`, { on_sale: false });
    assert.deepEqual([paused.json.on_sale, paused.json.paused, paused.json.codes.available], [false, true, 1]);
    assert.equal((await browser.post('/v1/quotes', { product_id: item.product.id, face_value: 4999 })).json.error.code, 'product_unavailable');
    assert.equal((await admin.patch(`/v1/admin/stock/${item.id}`, { on_sale: true })).json.on_sale, true);
  });
});

describe('software licences', () => {
  let software;
  const acme = {
    category: 'software',
    brand: 'acme-security',
    title: 'Acme Antivirus Plus',
    description: 'Protects three devices.',
    redeem_instructions: 'Download Acme from acme.example and enter the key.',
    currency: 'USD',
    face_value: 2999,
    cost: 1500,
    listed: true,
    codes: [{ code: 'ACME-1111-AAAA' }, { code: 'ACME-2222-BBBB' }, { code: 'ACME-4444-DDDD' }],
  };
  const outbox = () => server.app.get(EmailService).outbox;

  test('a brand is added under Catalog > Brands first; software needs a term, is global, and each term is its own product', async () => {
    const unknown = await admin.post('/v1/admin/stock', { ...acme, duration_months: 12 });
    assert.deepEqual([unknown.status, unknown.json.error.code, unknown.json.error.param], [400, 'brand_unknown', 'brand']);
    const badSlug = await admin.put('/v1/admin/storefront/brands/Acme%20Security', { name: 'Acme Security' });
    assert.deepEqual([badSlug.status, badSlug.json.error.param], [400, 'slug']);
    const brand = await admin.put('/v1/admin/storefront/brands/acme-security', { name: 'Acme Security', logo_url: 'https://cdn.example.com/acme.png' });
    assert.equal(brand.status, 200, JSON.stringify(brand.json));
    assert.ok((await admin.get('/v1/admin/storefront/brands')).json.data.some(row => row.slug === 'acme-security' && row.products === 0), 'listed before it has products');

    const noTerm = await admin.post('/v1/admin/stock', acme);
    assert.deepEqual([noTerm.status, noTerm.json.error.param], [400, 'duration_months']);
    const yearly = await admin.post('/v1/admin/stock', { ...acme, country: 'GB', duration_months: 12 });
    assert.equal(yearly.status, 201, JSON.stringify(yearly.json));
    software = yearly.json;
    assert.deepEqual(
      [software.product.key, software.product.country, software.product.name, software.duration_months],
      ['software:WW:acme-security:acme-antivirus-plus-12m', 'WW', 'Acme Antivirus Plus (1 year)', 12],
      'a region sent for software is ignored',
    );
    const lifetime = await admin.post('/v1/admin/stock', { ...acme, duration_months: 0, face_value: 5999, codes: [{ code: 'ACME-3333-CCCC' }] });
    assert.deepEqual([lifetime.status, lifetime.json.product.name], [201, 'Acme Antivirus Plus (Lifetime)']);

    assert.equal((await admin.post('/v1/admin/stock', { ...acme, category: 'gift_cards', country: 'US', duration_months: 12 })).json.error.param, 'duration_months');
    assert.equal((await admin.post('/v1/admin/stock', { ...acme, category: 'gift_cards' })).json.error.param, 'country');

    const storefront = server.app.get((await import('../dist/storefront/storefront.service.js')).StorefrontService);
    assert.ok(!(await storefront.countries()).some(country => country.code === 'WW'), 'worldwide is not a country to pick');
    assert.ok((await storeKeys()).includes(software.product.key));
  });

  test('software is on in every market, so any reseller can sell it through the API', async () => {
    const markets = await prisma.countryCategory.findMany({ where: { category: 'software' } });
    assert.ok(markets.length > 0 && markets.every(row => row.enabled));
    const { browser } = await funded();
    const product = (await browser.get(`/v1/catalogue/products/${software.product.id}`)).json;
    assert.deepEqual([product.country, product.category], ['WW', 'software']);
    noStockNamed(product);
  });

  test('the licence is emailed to the customer named on the quote, with its term and how to redeem', async () => {
    const { browser } = await funded();
    const sent = outbox().length;
    const quote = await browser.post('/v1/quotes', { product_id: software.product.id, face_value: 2999, recipient: { email: 'Ada@Example.com' } });
    assert.equal(quote.status, 201, JSON.stringify(quote.json));
    assert.equal(quote.json.recipient.email, 'ada@example.com');
    const order = (await browser.post('/v1/orders', { quote_id: quote.json.id })).json;
    assert.deepEqual([order.status, order.deliveries[0].details.duration], ['completed', '1 year']);

    const emails = outbox().slice(sent).filter(message => message.to === 'ada@example.com');
    assert.equal(emails.length, 1);
    const [message] = emails;
    assert.match(message.subject, /^Your Acme Antivirus Plus \(1 year\) licence key from /);
    assert.ok(message.text.includes(order.deliveries[0].code) && message.html.includes(order.deliveries[0].code));
    assert.ok(message.text.includes('Licence term: 1 year') && message.text.includes('How to redeem: Download Acme'));
    assert.ok(!/stock|supplier/i.test(message.text), 'never the source');
    assert.ok((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).deliveryEmailedAt);
    assert.ok(!JSON.stringify(await prisma.auditLog.findMany({ where: { targetId: order.id } })).includes(order.deliveries[0].code));
  });

  test('a delivery email that could not be sent is retried by the orders job, once', async () => {
    const { browser } = await funded();
    const email = server.app.get(EmailService);
    const send = email.send.bind(email);
    email.send = async () => {
      throw new Error('provider down');
    };
    let order;
    try {
      const quote = (await browser.post('/v1/quotes', { product_id: software.product.id, face_value: 2999, recipient: { email: 'bola@example.com' } })).json;
      order = (await browser.post('/v1/orders', { quote_id: quote.id })).json;
    } finally {
      email.send = send;
    }
    assert.equal(order.status, 'completed', 'a failed email never fails the order');
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).deliveryEmailedAt, null);
    const orders = server.app.get((await import('../dist/orders/orders.service.js')).OrdersService);
    assert.equal((await orders.checkDue()).emailed, 1);
    assert.equal(outbox().filter(message => message.to === 'bola@example.com').length, 1);
    assert.equal((await orders.checkDue()).emailed, 0, 'sent once');
  });

  test('sandbox orders email sandbox codes, marked as a test', async () => {
    const { browser } = await funded();
    const quote = (await browser.post('/v1/quotes', { product_id: software.product.id, face_value: 2999, recipient: { email: 'test@example.com' } }, sandbox)).json;
    const order = (await browser.post('/v1/orders', { quote_id: quote.id }, sandbox)).json;
    assert.equal(order.status, 'completed', JSON.stringify({ quote, order }));
    const [message] = outbox().filter(item => item.to === 'test@example.com');
    assert.match(message.subject, /^\[Sandbox\] Your Acme Antivirus Plus/);
    assert.ok(message.text.includes(order.deliveries[0].code) && /^SANDBOX-/.test(order.deliveries[0].code));
  });
});
