// B2B reselling, stage 4 (docs/BITOCARD_B2B_RESELLING_PLAN.md): buying on a Resale shop. The buyer's store wallet is
// locked, the supplier accepts (or it is accepted by itself), Safe pay holds it, and the release is split three ways
// (supplier, reseller's earnings lot, BitoCard's fees); declines, lapses and cancels unlock it; a part refund is split in
// proportion; shipping needs dispatch photos and a tracking number; the buyer's details are logged views; the order
// chat shows the store's side as the store; the trade thread is never the buyer's; the reseller's strikes pause their
// checkout; and `resale_order.*` events and the public API match their docs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let prisma;
let admin;
let house;
let ledger;
let safePay;
let check;
let bucket;
const objects = new Map();

before(async () => {
  bucket = await fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname);
    if (call.method === 'PUT') {
      objects.set(key, { body: call.raw });
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') return objects.has(key) ? { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: objects.get(key).body } : { status: 404, body: '' };
    return { status: 405, body: '' };
  });
  // Resale is Udozo's (docs/UDOZO_SPINOFF_PLAN.md): its responses are checked against Udozo's API document.
  server = await startApp({ env: { APP_PRODUCT: 'udozo', KYC_SPACES_KEY: 'kyc-key', KYC_SPACES_SECRET: 'kyc-secret', KYC_SPACES_BUCKET: 'kyc-private', KYC_SPACES_ENDPOINT: bucket.url, LOG_LEVEL: process.env.DEBUG_LOG ?? 'silent' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  house = server.app.get((await import('../dist/checkout/house.service.js')).HouseService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  safePay = server.app.get((await import('../dist/classifieds/safe-pay.service.js')).SafePayService);
  check = await responseChecker(server.app);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_resale', 'reseller_resale', 'classifieds_safe_pay']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
  assert.equal((await admin.put('/v1/admin/classifieds/resale-settings/NG', { reseller_fee_bps: 300, reseller_fee_cap: 500000 })).status, 200);
  const fees = await admin.put('/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150, buyer_fee_cap: 100000, seller_fee_bps: 200, seller_fee_cap: 500000, new_seller_order_limit: null, couriers: [{ name: 'GIG Logistics', tracking_url: 'https://giglogistics.com/track/{tracking}' }] });
  assert.equal(fees.status, 200, JSON.stringify(fees.json));
});

after(async () => {
  for (const key of ['classifieds_resale', 'reseller_resale', 'classifieds_safe_pay']) await admin?.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: null });
  await server?.close();
  await bucket?.close();
});

/** A store's server for one customer: `store` names the store (none: bitocard.com). */
function shopper(store) {
  let token = null;
  const request = async (method, path, { body, form } = {}) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(store ? { 'bitocard-store': store } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' || method === 'PUT' ? { 'idempotency-key': `resale4-${Date.now()}-${Math.random()}` } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    const json = await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, { body }),
    put: (path, body = {}) => request('PUT', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    upload: (path, form) => request('POST', path, { form }),
  };
}

let counter = 0;
const phone = () => `+23480${String(50000000 + (counter += 1)).padStart(8, '0')}`;

/** A BitoCard Shop supplier ready to sell through resellers. */
async function supplier(name) {
  const seller = shopper();
  const email = `rsup${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await seller.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal((await seller.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await seller.post('/v1/classifieds/terms/accept', { version: (await seller.get('/v1/classifieds/terms')).json.version });
  seller.id = signup.json.customer.id;
  seller.name = name;
  const market = await house.resellerFor('NG');
  await prisma.identityVerification.create({
    data: { subject: 'customer', resellerId: market.id, mode: 'live', customerReference: seller.id, method: 'document', provider: 'test', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: name },
  });
  await prisma.customerBankAccount.create({
    data: { customerId: seller.id, mode: 'live', country: 'NG', currency: 'NGN', bankCode: '044', bankName: 'Access Bank', accountNumberEncrypted: 'sealed', accountNumberLast4: '6789', accountName: name, payoutsFrom: new Date() },
  });
  await prisma.customer.update({ where: { id: seller.id }, data: { phone: phone(), phoneVerifiedAt: new Date() } });
  return seller;
}

/** A live resale listing: ₦250,000, 10% to resellers, up to 30% above, 3 in stock. */
async function listing(seller, title, extra = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const made = await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'new', category_id: cat.id, area_id: area.id, resale: true, resale_discount_bps: 1000, resale_markup_max_bps: 3000, stock: 3, ...extra });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/${made.json.id}-${position}.jpg` })) });
  const live = await seller.post(`/v1/classifieds/listings/${made.json.id}/submit`);
  assert.equal(live.json.status, 'active', JSON.stringify(live.json));
  return live.json;
}

/** A verified reseller with a published Resale shop selling `item` at ₦300,000. */
async function shop(item, name = 'Gadget Hub') {
  const owner = await resellerClient(server, { business: name });
  await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
  await prisma.user.update({ where: { id: owner.userId }, data: { phone: `+23481${String(60000000 + (counter += 1)).padStart(8, '0')}`, phoneVerifiedAt: new Date() } });
  const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name, subdomain: `rorder${counter}x${Date.now() % 100000}`, status: 'published', template: 'resale_shop' } });
  if (item) assert.equal((await owner.browser.post('/v1/resale/listings', { store_id: store.id, listing_id: item.id, fixed_price: 30000000 })).status, 201);
  return { ...owner, api: owner.browser, store };
}

/** A customer of the store, email and phone confirmed, with money in their store wallet (the store is in sandbox). */
async function buyer(store, { funds = 0, email, confirmedPhone = true, country = 'NG' } = {}) {
  const person = shopper(store.subdomain);
  const address = email ?? `rbuyer${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name: 'Amaka Eze', email: address, password: 'correct horse battery', country });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, address) })).status, 200);
  person.id = signup.json.customer.id;
  if (confirmedPhone) await prisma.customer.update({ where: { id: person.id }, data: { phone: phone(), phoneVerifiedAt: new Date() } });
  if (funds) await fund(person, funds);
  return person;
}

async function fund(person, amount) {
  await ledger.post({
    mode: 'test',
    type: 'adjustment',
    reference: `test-fund:${randomUUID()}`,
    description: 'Test top-up',
    lines: [
      { account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) },
      { account: { kind: 'customer_wallet', currency: 'NGN', customerId: person.id }, credit: BigInt(amount) },
    ],
  });
}

const balance = async (kind, owner = {}) => (await prisma.ledgerAccount.findFirst({ where: { kind, mode: 'test', currency: 'NGN', ...(owner.customerId ? { customerId: owner.customerId } : owner.resellerId ? { resellerId: owner.resellerId } : { ownerKey: 'platform' }) } }))?.balanceMinor ?? 0n;

/** A minimal JPEG (a dispatch photo). */
function jpeg() {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}

describe('buying on a Resale shop', () => {
  test('locked, accepted, handed over with the release code, and paid three ways; the API and events match their docs', async () => {
    const seller = await supplier('Chinedu Okafor');
    const item = await listing(seller, 'Hisense 50 inch TV');
    const reseller = await shop(item);
    const person = await buyer(reseller.store, { funds: 40000000 });

    const quote = await person.post('/v1/store/resale/orders/quote', { ref: item.ref, fulfilment: 'meet_up' });
    assert.equal(quote.status, 200, JSON.stringify(quote.json));
    assert.deepEqual([quote.json.price, quote.json.buyer_fee, quote.json.total, quote.json.enough, quote.json.available], [30000000, 100000, 30100000, true, 3]);
    assert.equal((await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30000000 })).json.error.code, 'price_changed');

    const escrow = await balance('classified_escrow');
    const bought = await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 });
    assert.equal(bought.status, 201, JSON.stringify(bought.json));
    assert.deepEqual([bought.json.status, bought.json.with.name, bought.json.supplier.name, bought.json.resale], ['locked', 'Gadget Hub', 'Chinedu O.', null], 'the buyer sees the store, the supplier named, never the split');
    const id = bought.json.id;
    assert.equal(await balance('customer_wallet', { customerId: person.id }), 40000000n - 30100000n);
    assert.equal(await balance('customer_wallet_locked', { customerId: person.id }), 30100000n, 'locked in the buyer’s wallet');
    assert.equal(await balance('classified_escrow'), escrow, 'not yet held by BitoCard');

    // The reseller sees it at once, without the buyer's details before acceptance.
    const listed = await reseller.api.get('/v1/resale/orders');
    check('GET /v1/resale/orders', 200, listed.json);
    assert.deepEqual([listed.json.data[0].id, listed.json.data[0].margin, listed.json.data[0].supplier_net], [id, 7500000, 22500000]);
    const early = await reseller.api.get(`/v1/resale/orders/${id}`);
    check('GET /v1/resale/orders/{id}', 200, early.json);
    assert.equal(early.json.buyer, null, 'no details before the supplier accepts');

    // The supplier sees their price, discount and net, never the store's price.
    const supplierView = (await seller.get(`/v1/classifieds/orders/${id}`)).json;
    assert.deepEqual([supplierView.status, supplierView.price, supplierView.resale.supplier_net, supplierView.resale.margin, supplierView.total], ['locked', 25000000, 22500000, undefined, undefined]);
    assert.ok(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.order_requested' } }));

    const accepted = await seller.post(`/v1/classifieds/orders/${id}/accept`);
    assert.equal(accepted.json.status, 'paid', JSON.stringify(accepted.json));
    assert.deepEqual([accepted.json.buyer_details.name, accepted.json.buyer_details.phone !== null], ['Amaka Eze', true], 'the supplier has the buyer’s details to deliver');
    assert.equal(await balance('customer_wallet_locked', { customerId: person.id }), 0n);
    assert.equal((await balance('classified_escrow')) - escrow, 30100000n);

    const detailed = await reseller.api.get(`/v1/resale/orders/${id}`);
    check('GET /v1/resale/orders/{id}', 200, detailed.json);
    assert.equal(detailed.json.buyer.email, (await prisma.customer.findUniqueOrThrow({ where: { id: person.id } })).email);
    assert.deepEqual((await prisma.resaleBuyerDetailView.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } })).map(view => view.viewer), ['supplier', 'reseller'], 'each view logged (none before acceptance)');

    const code = (await person.get(`/v1/store/resale/orders/${id}/release-code`)).json.code;
    assert.match(code, /^\d{6}$/);
    const released = await seller.post(`/v1/classifieds/orders/${id}/release`, { code });
    assert.equal(released.json.status, 'released', JSON.stringify(released.json));
    assert.equal(released.json.payout, 22050000, 'the net less 2%');
    assert.equal(await balance('classified_escrow'), escrow);
    assert.equal(await balance('customer_withdrawable', { customerId: seller.id }), 22050000n);
    assert.equal(await balance('reseller_earnings_held', { resellerId: reseller.resellerId }), 7275000n, 'the margin less 3%');
    const lot = await prisma.earningsLot.findUniqueOrThrow({ where: { reference: `classified_order:${id}` } });
    assert.deepEqual([lot.amountMinor, lot.mode], [7275000n, 'test'], 'an earnings lot, released after the payout hold');
    const done = (await reseller.api.get(`/v1/resale/orders/${id}`)).json;
    assert.deepEqual([done.status, done.reseller_fee, done.earnings], ['released', 225000, 7275000]);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: item.id } })).stock, 2, 'one unit sold');

    const events = await prisma.event.findMany({ where: { resellerId: reseller.resellerId, type: { startsWith: 'resale_order.' } }, orderBy: { seq: 'asc' } });
    assert.deepEqual(events.map(event => event.type), ['resale_order.created', 'resale_order.updated', 'resale_order.updated']);
    const payload = JSON.parse(events.at(-1).payload);
    assert.deepEqual([payload.data.object.status, payload.data.object.earnings], ['released', 7275000]);
    const { eventObjectSchemas } = await import('../dist/webhooks/openapi.js');
    assert.deepEqual(Object.keys(payload.data.object).sort(), Object.keys(eventObjectSchemas.ResaleOrder.properties).sort(), 'the event carries exactly the documented fields');
    assert.ok(!JSON.stringify(events.map(event => event.payload)).includes('Amaka'), 'never the buyer’s details in an event');
  });

  test('declined, cancelled or not accepted in time: the money is unlocked; a lapse is a strike; auto-accept takes it straight away', async () => {
    const seller = await supplier('Bola Ade');
    const item = await listing(seller, 'Samsung 55 inch TV');
    const reseller = await shop(item);
    const person = await buyer(reseller.store, { funds: 100000000 });
    const buy = async () => (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json;

    const first = await buy();
    assert.equal((await seller.post(`/v1/classifieds/orders/${first.id}/decline`, { reason: 'Out of stock today' })).json.status, 'declined');
    const second = await buy();
    assert.equal((await person.post(`/v1/store/resale/orders/${second.id}/cancel`)).json.status, 'cancelled');
    const third = await buy();
    await prisma.classifiedOrder.update({ where: { id: third.id }, data: { acceptBy: new Date(Date.now() - 1000) } });
    assert.ok((await safePay.runDue()).lapsed >= 1);
    assert.equal((await person.get(`/v1/store/resale/orders/${third.id}`)).json.status, 'lapsed');
    assert.equal(await balance('customer_wallet', { customerId: person.id }), 100000000n, 'every lock undone');
    assert.equal(await balance('customer_wallet_locked', { customerId: person.id }), 0n);
    assert.equal((await safePay.sellerStanding(seller.id)).resale_not_accepted, 1, 'the lapse is a strike');

    // Threads go 12 months after the order ends, like Shop chats; an open order's never do.
    await prisma.classifiedOrder.update({ where: { id: first.id }, data: { closedAt: new Date(Date.now() - 400 * 86_400_000) } });
    const { ResaleOrdersService } = await import('../dist/resale/resale-orders.service.js');
    assert.ok((await server.app.get(ResaleOrdersService).purgeOldThreads()) >= 1);
    assert.equal(await prisma.resaleOrderMessage.count({ where: { orderId: first.id } }), 0);
    assert.ok(await prisma.resaleOrderMessage.count({ where: { orderId: second.id } }), 'a recent one keeps its thread');

    assert.deepEqual((await seller.put('/v1/classifieds/me/resale/auto-accept', { enabled: true })).json, { object: 'resale_auto_accept', enabled: true });
    const automatic = await buy();
    assert.equal(automatic.status, 'paid', 'accepted by itself');
    assert.ok(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.order_paid' } }));
  });

  test('delivery: the charge on top, dispatch photos and tracking before shipping, and a part refund split in proportion', async () => {
    const seller = await supplier('Musa Bello');
    const item = await listing(seller, 'LG 43 inch TV', { delivery: 'state', delivery_fee_state: 200000 });
    const reseller = await shop(item);
    const person = await buyer(reseller.store, { funds: 30300000 });
    const quote = (await person.post('/v1/store/resale/orders/quote', { ref: item.ref, fulfilment: 'delivery', delivery_address: '12 Admiralty Way, Wuse 2, Abuja' })).json;
    assert.deepEqual([quote.delivery_fee, quote.total], [200000, 30300000]);
    const order = (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'delivery', delivery_address: '12 Admiralty Way, Wuse 2, Abuja', expected_total: 30300000 })).json;
    assert.equal(order.status, 'locked', JSON.stringify(order));
    const accepted = (await seller.post(`/v1/classifieds/orders/${order.id}/accept`)).json;
    assert.match(accepted.buyer_details.address, /Wuse 2/);

    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/sent`, { courier: 'GIG Logistics', tracking_number: 'GIG123456789' })).json.error.code, 'dispatch_photos_required');
    for (let index = 0; index < 2; index += 1) {
      const form = new FormData();
      form.append('file', new Blob([jpeg()], { type: 'image/jpeg' }), 'parcel.jpg');
      const added = await seller.upload(`/v1/classifieds/orders/${order.id}/dispatch-photos`, form);
      assert.equal(added.status, 201, JSON.stringify(added.json));
    }
    const sent = (await seller.post(`/v1/classifieds/orders/${order.id}/sent`, { courier: 'gig logistics', tracking_number: 'GIG123456789' })).json;
    assert.deepEqual([sent.status, sent.shipment.courier, sent.shipment.tracking_url], ['sent', 'GIG Logistics', 'https://giglogistics.com/track/GIG123456789'], 'the country’s courier and its link');
    const photo = sent.shipment.dispatch_photos[0];
    const view = (await reseller.api.get(`/v1/resale/orders/${order.id}`)).json;
    assert.deepEqual([view.shipment.dispatch_photos.length, view.tracking_number], [2, 'GIG123456789']);
    assert.equal((await person.get(`/v1/store/resale/orders/${order.id}/dispatch-photos/${photo.id}`)).headers.get('content-type'), 'image/jpeg', 'the buyer sees what was sent');

    assert.equal((await person.post(`/v1/store/resale/orders/${order.id}/dispute`, { reason: 'damaged', details: 'The screen arrived cracked in one corner.' })).json.status, 'disputed');
    const escrow = await balance('classified_escrow');
    const decided = await admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'partial', refund: 6000000, note: 'Crack confirmed; part refund agreed.' });
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
    assert.equal(await balance('customer_wallet', { customerId: person.id }), 6000000n);
    assert.equal(await balance('customer_withdrawable', { customerId: seller.id }), 18000000n - 360000n + 200000n, 'the supplier’s share less 2%, and the delivery charge in full');
    assert.equal(await balance('reseller_earnings_held', { resellerId: reseller.resellerId }), 6000000n - 180000n, 'the reseller’s share less 3%');
    assert.equal(escrow - (await balance('classified_escrow')), 30300000n, 'all of it out of the hold');
  });
});

describe('who talks, who buys', () => {
  test('the order chat shows the store’s side as the store; the trade thread is never the buyer’s; payment details are refused', async () => {
    const seller = await supplier('Ngozi Ike');
    const item = await listing(seller, 'TCL 32 inch TV');
    const reseller = await shop(item, 'Ngozi Electronics Store');
    const person = await buyer(reseller.store, { funds: 30100000 });
    const order = (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json;

    assert.equal((await person.post(`/v1/store/resale/orders/${order.id}/messages`, { body: 'Can I collect on Friday?' })).status, 201);
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/messages`, { thread: 'order', body: 'Yes, Friday at noon works.' })).status, 201);
    const trade = await seller.post(`/v1/classifieds/orders/${order.id}/messages`, { thread: 'trade', body: 'I will bring the receipt.' });
    assert.equal(trade.status, 201);
    const sent = await reseller.api.post(`/v1/resale/orders/${order.id}/messages`, { body: 'Thank you for shopping with us.' });
    check('POST /v1/resale/orders/{id}/messages', 201, sent.json);
    for (const body of ['Pay me directly to save the fee', 'Send it to account 0123456789', 'See https://pay.example.com']) {
      assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/messages`, { thread: 'order', body })).json.error?.code, 'message_refused', body);
    }

    const seen = (await person.get(`/v1/store/resale/orders/${order.id}/messages`)).json.data;
    assert.deepEqual(seen.map(message => [message.from, message.name]), [['bitocard', 'BitoCard'], ['me', 'Amaka E.'], ['store', 'Ngozi Electronics Store'], ['store', 'Ngozi Electronics Store']], 'every store message as the store’s');
    assert.ok(!seen.some(message => message.body.includes('receipt')), 'never the trade thread');
    const resellerView = await reseller.api.get(`/v1/resale/orders/${order.id}/messages?thread=trade`);
    check('GET /v1/resale/orders/{id}/messages', 200, resellerView.json);
    assert.deepEqual(resellerView.json.data.map(message => message.from), ['supplier']);
    assert.ok(await prisma.notification.count({ where: { customerId: person.id, type: 'customer.purchase.message' } }));
  });

  test('guards: a confirmed phone, enough money, three different people, the stock', async () => {
    const seller = await supplier('Tunde Bakare');
    const item = await listing(seller, 'Philips 24 inch TV', { stock: 1 });
    const reseller = await shop(item);
    const body = { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 };

    const noPhone = await buyer(reseller.store, { funds: 40000000, confirmedPhone: false });
    assert.equal((await noPhone.post('/v1/store/resale/orders', body)).json.error.code, 'phone_required');
    const poor = await buyer(reseller.store, { funds: 1000 });
    const low = await poor.post('/v1/store/resale/orders', body);
    assert.deepEqual([low.status, low.json.error.code], [402, 'wallet_balance_low']);
    const insider = await buyer(reseller.store, { funds: 40000000, email: reseller.email });
    assert.equal((await insider.post('/v1/store/resale/orders', body)).json.error.code, 'same_person', 'the reseller cannot buy from their own store');

    const first = await buyer(reseller.store, { funds: 40000000 });
    assert.equal((await first.post('/v1/store/resale/orders', body)).json.status, 'locked');
    const second = await buyer(reseller.store, { funds: 40000000 });
    assert.equal((await second.post('/v1/store/resale/orders', body)).json.error.code, 'listing_unavailable', 'the locked unit is held: sold out here');
  });

  test('the store cancels: refunded, a strike, and the limit pauses its checkout until BitoCard lifts it', async () => {
    const seller = await supplier('Kelechi Obi');
    const item = await listing(seller, 'Sony 65 inch TV');
    const reseller = await shop(item);
    const person = await buyer(reseller.store, { funds: 100000000 });
    assert.equal((await admin.put('/v1/admin/classifieds/resale-settings/NG', { reseller_strike_limit: 1 })).status, 200);
    try {
      const order = (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json;
      await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
      const cancelled = await reseller.api.post(`/v1/resale/orders/${order.id}/cancel`, { reason: 'The customer asked to cancel.' });
      check('POST /v1/resale/orders/{id}/cancel', 200, cancelled.json);
      assert.deepEqual([cancelled.json.status, cancelled.json.ended_by, cancelled.json.refund], ['refunded', 'reseller', 30100000]);
      assert.equal(await balance('customer_wallet', { customerId: person.id }), 100000000n);
      assert.equal((await safePay.sellerStanding(seller.id)).strikes, 0, 'not the supplier’s strike');

      const paused = await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 });
      assert.equal(paused.json.error.code, 'resale_checkout_unavailable');
      const standing = await admin.get(`/v1/admin/classifieds/resellers/${reseller.resellerId}/resale-standing`);
      assert.deepEqual([standing.json.strikes, standing.json.limited], [1, true]);
      assert.equal((await admin.post(`/v1/admin/classifieds/resellers/${reseller.resellerId}/resale-standing/clear`, { reason: 'Customer asked; fair.' })).json.limited, false);
      assert.equal((await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json.status, 'locked');
    } finally {
      await admin.put('/v1/admin/classifieds/resale-settings/NG', { reseller_strike_limit: 3 });
    }
  });

  test('another reseller, or another store’s customer, never reaches an order', async () => {
    const seller = await supplier('Ifeoma Nwosu');
    const item = await listing(seller, 'Haier 40 inch TV');
    const reseller = await shop(item);
    const other = await shop(null, 'Elsewhere');
    const person = await buyer(reseller.store, { funds: 40000000 });
    const order = (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json;
    assert.equal((await other.api.get(`/v1/resale/orders/${order.id}`)).status, 404);
    assert.equal((await other.api.post(`/v1/resale/orders/${order.id}/cancel`, {})).status, 404);
    const stranger = await buyer(other.store);
    assert.equal((await stranger.get(`/v1/store/resale/orders/${order.id}`)).status, 404);
    const shopBuyer = await supplier('Not Involved');
    assert.equal((await shopBuyer.get(`/v1/classifieds/orders/${order.id}`)).status, 404);
  });
});

describe('stage 5: disputes with both parties, reports of stores, strikes and reports', () => {
  test('the reseller takes part in the dispute; a dispute lost because of the store is the reseller’s strike, not the supplier’s', async () => {
    const seller = await supplier('Uche Nnamdi');
    const item = await listing(seller, 'Sharp 43 inch TV');
    const reseller = await shop(item, 'Uche Deals');
    const person = await buyer(reseller.store, { funds: 30100000 });
    const order = (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json;
    await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
    assert.equal((await person.post(`/v1/store/resale/orders/${order.id}/dispute`, { reason: 'not_as_described', details: 'The store said it came with a wall bracket; it did not.' })).json.status, 'disputed');

    const note = await reseller.api.post(`/v1/resale/orders/${order.id}/dispute/messages`, { body: 'We will send a bracket at our cost if the buyer keeps it.' });
    assert.equal(note.status, 201, JSON.stringify(note.json));
    check('POST /v1/resale/orders/{id}/dispute/messages', 201, note.json);
    await seller.post(`/v1/classifieds/orders/${order.id}/dispute/messages`, { body: 'The bracket was never in my listing.' });
    const thread = await reseller.api.get(`/v1/resale/orders/${order.id}/dispute`);
    check('GET /v1/resale/orders/{id}/dispute', 200, thread.json);
    assert.deepEqual(thread.json.messages.map(message => [message.from, message.name]), [['them', 'Amaka E.'], ['me', 'Uche Deals'], ['them', 'Uche N. (supplier)']]);
    const buyerView = (await person.get(`/v1/store/resale/orders/${order.id}/dispute`)).json;
    assert.deepEqual(buyerView.messages.map(message => message.name), ['Amaka E.', 'Uche Deals', 'Uche Deals'], 'the buyer reads the store’s side as the store’s');
    assert.ok(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.dispute_message' } }), 'the supplier hears of the reseller’s message');

    const decided = await admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'partial', refund: 3000000, note: 'The store promised a bracket.', fault: 'reseller' });
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
    assert.equal(decided.json.dispute.fault, 'reseller');
    assert.equal((await safePay.sellerStanding(seller.id)).disputes_lost, 0, 'not the supplier’s strike');
    assert.equal((await admin.get(`/v1/admin/classifieds/resellers/${reseller.resellerId}/resale-standing`)).json.disputes_lost, 1);
  });

  test('buyers and suppliers report a store; an upheld report is a strike; one open report each', async () => {
    const seller = await supplier('Halima Musa');
    const item = await listing(seller, 'Nexus 32 inch TV');
    const reseller = await shop(item, 'Halima Store');
    const person = await buyer(reseller.store);
    const report = await person.post('/v1/store/resale/reports', { reason: 'claims_ownership', details: 'The home page says they make these TVs themselves.' });
    assert.equal(report.status, 201, JSON.stringify(report.json));
    assert.match(report.json.number, /^RR-\d{6}$/);
    assert.equal((await person.post('/v1/store/resale/reports', { reason: 'other', details: 'And another thing about the store.' })).json.error.code, 'report_open');

    const relationship = (await seller.get('/v1/classifieds/me/resellers')).json.data[0];
    assert.equal((await seller.post(`/v1/classifieds/me/resellers/${relationship.id}/report`, { store_id: reseller.store.id, reason: 'pay_outside', details: 'Their staff asked my buyer to pay them by transfer.' })).status, 201);

    const support = await adminClient(server, ['support']);
    const open = (await support.get(`/v1/admin/classifieds/resale-reports?status=open&reseller_id=${reseller.resellerId}`)).json;
    assert.equal(open.total, 2);
    assert.equal((await support.post(`/v1/admin/classifieds/resale-reports/${report.json.id}/decide`, { decision: 'upheld', note: 'x x x' })).status, 403, 'operations decide');
    const upheld = await admin.post(`/v1/admin/classifieds/resale-reports/${report.json.id}/decide`, { decision: 'upheld', note: 'The home page claimed the items as theirs.' });
    assert.equal(upheld.json.status, 'upheld');
    assert.equal((await admin.post(`/v1/admin/classifieds/resale-reports/${report.json.id}/decide`, { decision: 'dismissed', note: 'again' })).json.error.code, 'report_decided');
    const standing = (await admin.get(`/v1/admin/classifieds/resellers/${reseller.resellerId}/resale-standing`)).json;
    assert.deepEqual([standing.reports_upheld, standing.strikes], [1, 1]);
    assert.ok(await prisma.notification.count({ where: { resellerId: reseller.resellerId, type: 'resale.order_updated', title: { contains: 'was upheld' } } }));
    assert.ok(await prisma.auditLog.count({ where: { action: 'resale.store_report_upheld', targetId: reseller.resellerId } }));
  });

  test('reports: the reseller’s resale earnings in their P&L and resale report, the supplier’s sales by reseller, BitoCard’s fees', async () => {
    const seller = await supplier('Femi Ade');
    const item = await listing(seller, 'Toshiba 50 inch TV');
    const reseller = await shop(item, 'Femi Gadgets');
    const person = await buyer(reseller.store, { funds: 30100000 });
    const order = (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json;
    await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
    const code = (await person.get(`/v1/store/resale/orders/${order.id}/release-code`)).json.code;
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/release`, { code })).json.status, 'released');

    const range = `from=${new Date(Date.now() - 86_400_000).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`;
    const sandbox = { 'bitocard-mode': 'test' };
    const mine = (await reseller.api.get(`/v1/reports/resale?${range}`, sandbox)).json;
    assert.deepEqual([mine.orders.completed, mine.totals[0].sales, mine.totals[0].margin, mine.totals[0].reseller_fees, mine.totals[0].earnings], [1, 30000000, 7500000, 225000, 7275000], JSON.stringify(mine));
    assert.equal(mine.by_store[0].store.name, 'Femi Gadgets');
    assert.equal(mine.top_listings[0].listing.title, 'Toshiba 50 inch TV');
    const pnl = (await reseller.api.get(`/v1/reports/pnl?${range}&currency=NGN`, sandbox)).json;
    assert.equal(pnl.breakdown.find(row => row.kind === 'resale')?.amount, 7275000, JSON.stringify(pnl));
    const statement = (await reseller.api.get(`/v1/reports/statement?${range}&currency=NGN`, sandbox)).json;
    assert.ok(statement.data.some(row => row.type === 'classified_release' && row.amount === 7275000), JSON.stringify(statement));

    const row = (await seller.get('/v1/classifieds/me/resellers')).json.data.find(item => item.reseller.name === 'Femi Gadgets');
    assert.deepEqual(row.sales, { open: 0, completed: 1, refunded: 0, paid_to_you: { currency: 'NGN', amount: 22050000 } });

    const fees = (await admin.get(`/v1/admin/reports/resale?mode=test&${range}&country=NG`)).json;
    const resale = fees.markets.find(market => market.kind === 'resale');
    assert.ok(resale.reseller_fees >= 225000 && resale.fees === resale.buyer_fees + resale.seller_fees + resale.reseller_fees, JSON.stringify(fees));
    assert.ok(fees.top_resellers.some(item => item.reseller.name === 'Femi Gadgets'));
  });
});

describe('stage 6: Safe pay, resale and BitoCard Shop notices are emailed, with deadline reminders', () => {
  let emailService;
  const outbox = () => server.app.get(emailService).outbox;
  before(async () => {
    emailService = (await import('../dist/notifications/email.service.js')).EmailService;
  });
  const mail = async (to, match, count = 1) => {
    for (let tries = 0; tries < 100; tries += 1) {
      const found = outbox().filter(item => item.to === to && match.test(item.subject));
      if (found.length >= count) return found;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail(`No email to ${to} matching ${match}: ${JSON.stringify(outbox().filter(item => item.to === to).map(item => item.subject))}`);
  };

  test('each step reaches every side by email, under the store name for the buyer, with links and nothing secret', async () => {
    const seller = await supplier('Bola Ade');
    const item = await listing(seller, 'Samsung 55 inch TV');
    const reseller = await shop(item, 'Bola Electronics');
    const person = await buyer(reseller.store, { funds: 30100000 });
    const [buyerEmail, supplierEmail, ownerEmail] = await Promise.all([
      prisma.customer.findUniqueOrThrow({ where: { id: person.id } }).then(row => row.email),
      prisma.customer.findUniqueOrThrow({ where: { id: seller.id } }).then(row => row.email),
      prisma.user.findUniqueOrThrow({ where: { id: reseller.userId } }).then(row => row.email),
    ]);
    const order = (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json;

    const [placed] = await mail(buyerEmail, /is placed$/);
    assert.match(placed.subject, /^\[Sandbox\] Your order SP-\d+ is placed$/);
    assert.ok(placed.text.includes(`https://${reseller.store.subdomain}.`) && placed.text.includes(`/account/purchases/${order.id}`), placed.text);
    assert.ok(placed.text.includes('Sent for Bola Electronics'));
    const [toSupplier] = await mail(supplierEmail, /New order through Bola Electronics/);
    assert.ok(toSupplier.text.includes(`/shop/orders/${order.id}`));
    const [toReseller] = await mail(ownerEmail, /New order SP-/);
    assert.ok(toReseller.text.includes(`/resale/orders/${order.id}`));

    await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
    await mail(buyerEmail, /is confirmed/);
    await mail(ownerEmail, /was accepted/);
    const buyerPhone = (await prisma.customer.findUniqueOrThrow({ where: { id: person.id } })).phone;
    const code = (await person.get(`/v1/store/resale/orders/${order.id}/release-code`)).json.code;
    for (const message of outbox().filter(item => [supplierEmail, ownerEmail, buyerEmail].includes(item.to))) {
      assert.ok(!message.text.includes(buyerPhone) && !message.text.includes(code), `no phone or release code in "${message.subject}"`);
    }

    // Messages: emailed without their text, once per 10 minutes per order and person.
    assert.equal((await person.post(`/v1/store/resale/orders/${order.id}/messages`, { body: 'Can I collect on Saturday morning?' })).status, 201);
    assert.equal((await person.post(`/v1/store/resale/orders/${order.id}/messages`, { body: 'Or Sunday works too.' })).status, 201);
    const [first] = await mail(supplierEmail, /New message on SP-/);
    await mail(ownerEmail, /New message on SP-/);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(outbox().filter(item => item.to === supplierEmail && /New message on SP-/.test(item.subject)).length, 1, 'the second message within 10 minutes sends no email');
    assert.ok(!first.text.includes('Saturday'), 'the message text is never emailed');
    assert.ok((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: order.id } })).supplierEmailedAt);

    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/release`, { code })).json.status, 'released');
    await mail(ownerEmail, /was completed/);
    await mail(buyerEmail, /Your order SP-\d+ is complete/);
  });

  test('deadline reminders: once each, by inbox and email, in the market time', async () => {
    const seller = await supplier('Kemi Ojo');
    const item = await listing(seller, 'LG 43 inch TV');
    const reseller = await shop(item, 'Kemi Gadgets');
    const person = await buyer(reseller.store, { funds: 30100000 });
    const supplierEmail = (await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } })).email;
    const order = (await person.post('/v1/store/resale/orders', { ref: item.ref, fulfilment: 'meet_up', expected_total: 30100000 })).json;
    // An hour of a 24-hour window left: remind the supplier to accept.
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - 23 * 3_600_000), acceptBy: new Date(Date.now() + 3_600_000) } });
    assert.ok((await safePay.runDue()).reminded >= 1);
    const [reminder] = await mail(supplierEmail, /Accept SP-\d+ soon/);
    assert.ok(reminder.text.includes('counts as a strike'));
    assert.ok(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.order_reminder' } }));
    await safePay.runDue();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(outbox().filter(item => item.to === supplierEmail && /Accept SP-/.test(item.subject)).length, 1, 'reminded once');

    // A window that has only just opened is not reminded yet.
    await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { paidAt: new Date(), handoverBy: new Date(Date.now() + 20 * 3_600_000) } });
    await safePay.runDue();
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: order.id } })).handoverRemindedAt, null, 'not at the start of a short window');
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { paidAt: new Date(Date.now() - 5 * 86_400_000) } });
    await safePay.runDue();
    await mail(supplierEmail, /Hand over SP-\d+ soon/);
  });

  test('suppliers and resellers working together, listing outcomes and direct Safe pay orders are emailed too', async () => {
    const seller = await supplier('Tunde Bello');
    const item = await listing(seller, 'Hisense 50 inch TV');
    const reseller = await shop(item, 'Tunde Hub');
    const supplierEmail = (await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } })).email;
    const ownerEmail = (await prisma.user.findUniqueOrThrow({ where: { id: reseller.userId } })).email;
    await mail(supplierEmail, /Tunde Hub is reselling your listings/);

    const relationship = (await seller.get('/v1/classifieds/me/resellers')).json.data[0];
    for (const body of ['Can you give 12% on the 50 inch?', 'Also the 43 inch.']) assert.equal((await reseller.api.post(`/v1/resale/suppliers/${relationship.id}/messages`, { body })).status, 201);
    const [toSupplier] = await mail(supplierEmail, /New message from Tunde Hub/);
    assert.ok(!toSupplier.text.includes('12%') && toSupplier.text.includes(`/shop/resellers/${relationship.id}`));
    assert.equal((await seller.post(`/v1/classifieds/me/resellers/${relationship.id}/messages`, { body: 'Yes, from Monday.' })).status, 201);
    const [toReseller] = await mail(ownerEmail, /New message from Tunde B\./);
    assert.ok(!toReseller.text.includes('Monday'));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(outbox().filter(item => item.to === supplierEmail && /New message from/.test(item.subject)).length, 1, 'one email for messages within 10 minutes');

    // A listing BitoCard removes is emailed to its seller.
    assert.equal((await admin.post(`/v1/admin/classifieds/listings/${item.id}/remove`, { reason: 'Photos of another seller.' })).status, 200);
    const [removed] = await mail(supplierEmail, /Your ad was removed/);
    assert.ok(removed.text.includes('BitoCard Shop, a Golojan Ltd venture.'));

    // A direct Safe pay order's seller and buyer (bitocard.com accounts) hear from BitoCard Shop.
    const emails = server.app.get((await import('../dist/classifieds/shop-emails.service.js')).ShopEmails);
    const id = randomUUID();
    emails.order({ id, kind: 'direct', mode: 'live', storeId: null, resellerId: null, buyerId: seller.id, sellerId: seller.id }, 'supplier', { title: 'Direct order step', body: 'Hand it over.' });
    const [direct] = await mail(supplierEmail, /^Direct order step$/);
    assert.ok(direct.text.includes(`/shop/orders/${id}`) && direct.text.includes('BitoCard Shop, a Golojan Ltd venture.'));
    emails.order({ id, kind: 'direct', mode: 'live', storeId: null, resellerId: null, buyerId: seller.id, sellerId: seller.id }, 'reseller', { title: 'Never sent', body: '' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(outbox().filter(item => item.subject === 'Never sent').length, 0, 'no reseller on a direct order');
  });
});

describe('one Udozo account, a store by country', () => {
  test("a shopper from another country may browse a store but not buy there; the store's own country buys", async () => {
    const seller = await supplier('Country Supplier');
    const item = await listing(seller, 'Country check television');
    const { store } = await shop(item, 'Lagos Gadgets');
    const visitor = await buyer(store, { funds: 50_000_000, country: 'GH' });
    const refused = await visitor.post('/v1/store/resale/orders/quote', { ref: item.ref, fulfilment: 'meet_up' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'market_unavailable']);
    assert.equal((await visitor.get(`/v1/store/resale/listings?store=${store.subdomain}`)).status, 200, 'browsing is open to everyone');
    const local = await buyer(store, { funds: 50_000_000 });
    const quoted = await local.post('/v1/store/resale/orders/quote', { ref: item.ref, fulfilment: 'meet_up' });
    assert.equal(quoted.status, 200, JSON.stringify(quoted.json));
  });
});
