// Udozo Connect, phase 5e (docs/UDOZO_CONNECT_PLAN.md, Holding times, demurrage and Loss of care): each full day an item
// stays past its free time is charged once, 2.1% of the shipping charge: the buyer's after their free hours, paid before
// the centre takes their code (or out of their refund when they never come); the seller's after their free days to
// collect a return, when it goes into Loss of care with a daily penalty capped at ₦500; shared 70:30 with the centre.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let services;
let place;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  services = {
    ledger: server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService),
    returns: server.app.get((await import('../dist/classifieds/connect-returns.service.js')).ConnectReturnsService),
    charges: server.app.get((await import('../dist/classifieds/connect-charges.service.js')).ConnectChargesService),
    house: server.app.get((await import('../dist/checkout/house.service.js')).HouseService),
  };
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_safe_pay', 'connect_shipping']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  assert.equal((await admin.put('/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150, buyer_fee_cap: 100000, seller_fee_bps: 200, seller_fee_cap: 500000 })).status, 200);
  assert.equal((await admin.put('/v1/admin/connect/settings/NG', { fee_kind: 'percent', fee_bps: 1000, centre_share_bps: 7000 })).status, 200);
  const [tvs, ikeja, gwarinpa] = await Promise.all([
    prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }),
    prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } }),
    prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'gwarinpa' } }),
  ]);
  place = { tvs: tvs.id, ikeja, gwarinpa };
});

after(() => server?.close());

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `connect-${Date.now()}-${Math.random()}` } : {}),
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

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `connectstorage${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  shopper.name = name;
  return shopper;
}

async function ready(seller) {
  const house = await services.house.resellerFor('NG');
  await prisma.identityVerification.create({
    data: { subject: 'customer', resellerId: house.id, mode: 'live', customerReference: seller.id, method: 'document', provider: 'test', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: seller.name },
  });
  await prisma.customerBankAccount.create({
    data: { customerId: seller.id, mode: 'live', country: 'NG', currency: 'NGN', bankCode: '044', bankName: 'Access Bank', accountNumberEncrypted: 'sealed', accountNumberLast4: '6789', accountName: seller.name, payoutsFrom: new Date() },
  });
}

async function fund(buyer, amount) {
  await services.ledger.post({
    mode: 'live',
    type: 'adjustment',
    reference: `test-fund:${randomUUID()}`,
    description: 'Test top-up',
    lines: [
      { account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) },
      { account: { kind: 'customer_wallet', currency: 'NGN', customerId: buyer.id }, credit: BigInt(amount) },
    ],
  });
}

const balance = async (kind, customerId) => (await prisma.ledgerAccount.findFirst({ where: { kind, mode: 'live', currency: 'NGN', ...(customerId ? { customerId } : { ownerKey: 'platform' }) } }))?.balanceMinor ?? 0n;

/** An approved centre with its partner as owner, a staff member and a storage place. */
async function centre(area, name) {
  const owner = await customer('Ngozi Eze');
  const staff = await customer('Bola Ade');
  const made = await prisma.connectCentre.create({
    data: { partnerId: owner.id, country: 'NG', stateId: area.parentId, areaId: area.id, name, address: '12 Allen Avenue, Ikeja', hours: 'Mon to Sat, 8am to 6pm', phone: '08031234567', capacity: 40, depositMinor: 5_000_000n, currency: 'NGN', photos: [] },
  });
  await prisma.connectCentreMember.createMany({ data: [{ centreId: made.id, customerId: owner.id, role: 'owner' }, { centreId: made.id, customerId: staff.id, role: 'staff' }] });
  const shelf = await prisma.connectShelf.create({ data: { centreId: made.id, code: 'A-01' } });
  return { ...made, owner, staff, shelf };
}

/** A live listing shipping through Connect to Lagos (₦2,000) and the FCT (₦3,000). */
async function live(seller, title) {
  const draft = (
    await seller.post('/v1/classifieds/listings', {
      title,
      price: 25000000,
      condition: 'used',
      category_id: place.tvs,
      area_id: place.gwarinpa.id,
      stock: 1,
      connect: true,
      connect_states: [
        { state_id: place.ikeja.parentId, shipping: 200000 },
        { state_id: place.gwarinpa.parentId, shipping: 300000 },
      ],
    })
  ).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

async function paidAtCentre(hub) {
  const seller = await customer('Chinedu Okafor');
  const buyer = await customer('Kemi Adeyemi');
  await ready(seller);
  const listing = await live(seller, `Samsung TV ${counter}`);
  const order = await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'connect', connect_centre_id: hub.id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  assert.equal((await seller.post(`/v1/classifieds/orders/${order.json.id}/accept`)).json.status, 'awaiting_payment');
  await fund(buyer, order.json.total);
  assert.equal((await buyer.post(`/v1/classifieds/orders/${order.json.id}/pay`)).json.status, 'paid');
  await prisma.classifiedDispatchPhoto.createMany({ data: [0, 1].map(index => ({ orderId: order.json.id, objectKey: `test/dispatch/${order.json.id}/${index}`, contentType: 'image/jpeg', size: 1000 })) });
  return { seller, buyer, listing, order: order.json };
}

const counterPath = (hub, order, step = '') => `/v1/connect/centres/${hub.id}/orders/${order.id}${step ? `/${step}` : ''}`;

/** Paid, dropped off, received and shelved: ready at the centre. */
async function readyAtCentre(hub) {
  const made = await paidAtCentre(hub);
  await made.seller.post(`/v1/classifieds/orders/${made.order.id}/sent`, {});
  await hub.staff.post(counterPath(hub, made.order, 'receive'), {});
  await hub.staff.post(counterPath(hub, made.order, 'shelve'), { shelf_id: hub.shelf.id });
  return made;
}

const days = n => new Date(Date.now() - n * 86_400_000);

describe('Storage at Connect Centres', () => {
  test("the buyer's demurrage: a day at a time past the free hours, paid before the code is taken, shared 70:30", async () => {
    const hub = await centre(place.ikeja, 'Storage Hub');
    const { buyer, order } = await readyAtCentre(hub);
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { collectBy: days(2.5) } });
    await services.charges.accrue();
    await services.charges.accrue();
    const rows = await prisma.connectCharge.findMany({ where: { orderId: order.id } });
    assert.deepEqual(rows.map(row => [row.payer, row.kind, row.amountMinor]), [['buyer', 'demurrage', 4200n], ['buyer', 'demurrage', 4200n]], '2.1% of the ₦2,000 shipping, each full day once');
    const seen = (await buyer.get(`/v1/classifieds/orders/${order.id}`)).json.connect.storage_owed;
    assert.equal(seen, 8400);
    assert.equal((await hub.staff.get(counterPath(hub, order))).json.buyer_owed, 8400);

    const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
    const refused = await hub.staff.post(counterPath(hub, order, 'release'), { code });
    assert.deepEqual([refused.status, refused.json.error.code], [402, 'storage_unpaid']);
    const partner = await balance('connect_centre_earnings', hub.owner.id);
    const connect = await balance('connect_revenue');
    const paid = await buyer.post(`/v1/classifieds/orders/${order.id}/storage/pay`);
    assert.equal(paid.status, 402, 'the wallet must cover it');
    await fund(buyer, 8400);
    assert.deepEqual((await buyer.post(`/v1/classifieds/orders/${order.id}/storage/pay`)).json, { object: 'connect_charges', order_id: order.id, owed: 0, paid: 8400 });
    assert.equal((await balance('connect_centre_earnings', hub.owner.id)) - partner, 5880n, "70% is the centre's");
    assert.equal((await balance('connect_revenue')) - connect, 2520n);
    assert.equal((await hub.staff.post(counterPath(hub, order, 'release'), { code })).json.status, 'released');
  });

  test('never collected: the demurrage comes out of the refund', async () => {
    const hub = await centre(place.ikeja, 'Refund Hub');
    const { seller, buyer, order } = await readyAtCentre(hub);
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { readyAt: days(8), collectBy: days(5.5) } });
    await services.charges.accrue();
    assert.equal((await services.charges.owed(order.id, 'buyer')).total, 5n * 4200n);
    const wallet = await balance('customer_wallet', buyer.id);
    await hub.staff.post(counterPath(hub, order, 'return'), { reason: 'not_collected' });
    await seller.post(`/v1/classifieds/orders/${order.id}/return/accept`);
    assert.equal((await balance('customer_wallet', buyer.id)) - wallet, 25000000n - 21000n, 'the price less five days of storage');
    assert.equal((await services.charges.owed(order.id, 'buyer')).total, 0n, 'settled out of the refund');
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: order.id } })).refundMinor, 25000000n - 21000n);
  });

  test("the seller's: Loss of care after their free days, a capped daily penalty, Connect closed to them until paid", async () => {
    const hub = await centre(place.ikeja, 'Care Hub');
    const { seller, buyer, order } = await paidAtCentre(hub);
    await hub.staff.post(counterPath(hub, order, 'refuse'), { reason: 'damaged' });
    await admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'refund', note: 'Damaged on arrival.' });
    const asked = (await hub.staff.post(counterPath(hub, order, 'return'), { reason: 'damaged' })).json;
    await seller.post(`/v1/classifieds/orders/${order.id}/return/accept`);
    await prisma.connectReturnRequest.update({ where: { id: asked.id }, data: { collectBy: days(2.5) } });
    await services.charges.accrue();
    const rows = await prisma.connectCharge.findMany({ where: { orderId: order.id, payer: 'seller' }, orderBy: [{ kind: 'asc' }, { day: 'asc' }] });
    assert.deepEqual(rows.map(row => [row.kind, row.amountMinor, row.status]), [['demurrage', 4200n, 'owed'], ['demurrage', 4200n, 'owed'], ['loc_penalty', 4200n, 'owed'], ['loc_penalty', 4200n, 'owed']]);
    assert.ok((await prisma.connectReturnRequest.findUniqueOrThrow({ where: { id: asked.id } })).lossOfCareAt, 'in Loss of care');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: seller.id, title: { contains: 'Loss of care' } } }));
    const view = (await seller.get(`/v1/classifieds/orders/${order.id}`)).json.connect;
    assert.ok(view.loss_of_care_at);
    assert.equal(view.storage_owed, 16800);

    // Connect is not offered on their listings until they pay.
    const other = await live(seller, 'Another TV');
    assert.equal((await buyer.get(`/v1/classifieds/listings/${other.id}/safe-pay`)).json.connect, null);

    const code = (await seller.get(`/v1/classifieds/orders/${order.id}/return-code`)).json.code;
    assert.equal((await hub.staff.post(`/v1/connect/centres/${hub.id}/returns/${asked.id}/hand-back`, { code })).json.error.code, 'return_fee_unpaid');
    await fund(seller, 16800 + 20000);
    const back = (await hub.staff.post(`/v1/connect/centres/${hub.id}/returns/${asked.id}/hand-back`, { code })).json;
    assert.equal(back.status, 'collected', JSON.stringify(back));
    assert.equal((await services.charges.owed(order.id, 'seller')).total, 0n);
    assert.ok((await buyer.get(`/v1/classifieds/listings/${other.id}/safe-pay`)).json.connect, 'Connect open to them again');
  });

  test('the penalty is capped a day', async () => {
    const { penaltyOf, demurrageOf } = await import('../dist/classifieds/connect-charges.service.js');
    assert.equal(demurrageOf(200000n, 210), 4200n);
    assert.equal(penaltyOf(200000n, 210, 50000n), 4200n);
    assert.equal(penaltyOf(10_000_000n, 210, 50000n), 50000n, '₦500 at most a day');
  });
});
