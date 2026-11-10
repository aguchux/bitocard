// Udozo Connect, phase 5c (docs/UDOZO_CONNECT_PLAN.md, Return requests): a centre asks to return an item to its seller
// (not collected in time, or after Udozo decided a refusal for the buyer); the seller accepts it, Udozo approves it, or it
// is accepted by itself when nobody answers; the seller collects it with their return code, paying the return fee.
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
  const email = `connectreturn${(counter += 1)}-${Date.now()}@example.com`;
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

describe('Returns to the seller', () => {
  test('not collected: due 7 days after it was ready; the seller accepts; the money settles; the seller collects with their code', async () => {
    const hub = await centre(place.ikeja, 'Return Hub');
    const { seller, buyer, order } = await readyAtCentre(hub);
    const early = await hub.staff.post(counterPath(hub, order, 'return'), { reason: 'not_collected' });
    assert.equal(early.json.error.code, 'return_not_due');
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { readyAt: new Date(Date.now() - 8 * 86_400_000) } });
    const asked = await hub.staff.post(counterPath(hub, order, 'return'), { reason: 'not_collected', note: 'Buyer never came.' });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.match(asked.json.number, /^RT-\d{6}$/);
    assert.equal(asked.json.status, 'requested');
    assert.ok(Math.abs(new Date(asked.json.answer_by) - Date.now() - 48 * 3_600_000) < 10_000, '48 hours to answer');
    assert.equal((await hub.staff.post(counterPath(hub, order, 'return'), { reason: 'not_collected' })).json.error.code, 'return_exists');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: seller.id, type: 'customer.connect.return' } }), 'the seller is told');
    assert.equal((await buyer.post(`/v1/classifieds/orders/${order.id}/return/accept`)).json.error.code, 'resource_missing', 'only the seller accepts');

    const wallet = await balance('customer_wallet', buyer.id);
    const sellerMoney = await balance('customer_withdrawable', seller.id);
    const partner = await balance('connect_centre_earnings', hub.owner.id);
    const accepted = (await seller.post(`/v1/classifieds/orders/${order.id}/return/accept`)).json;
    assert.deepEqual([accepted.status, accepted.decided_by], ['accepted', 'seller']);
    assert.equal((await balance('customer_wallet', buyer.id)) - wallet, 25000000n, 'the buyer gets the price back');
    assert.equal((await balance('customer_withdrawable', seller.id)) - sellerMoney, 200000n, 'the seller keeps the shipping');
    assert.equal((await balance('connect_centre_earnings', hub.owner.id)) - partner, 14000n, "the centre's part of the Connect fee");
    const settled = (await buyer.get(`/v1/classifieds/orders/${order.id}`)).json;
    assert.deepEqual([settled.status, settled.end_reason, settled.connect.return.status], ['refunded', 'not_collected', 'accepted']);

    const code = (await seller.get(`/v1/classifieds/orders/${order.id}/return-code`)).json.code;
    assert.match(code, /^\d{6}$/);
    const list = (await hub.owner.get(`/v1/connect/centres/${hub.id}/returns`)).json.data;
    const row = list.find(item => item.order.id === order.id);
    assert.equal(row.status, 'accepted');
    assert.equal((await hub.staff.post(`/v1/connect/centres/${hub.id}/returns/${row.id}/hand-back`, { code: code === '111111' ? '222222' : '111111' })).json.error.code, 'return_code_wrong');
    const before = await balance('customer_withdrawable', seller.id);
    const back = (await hub.staff.post(`/v1/connect/centres/${hub.id}/returns/${row.id}/hand-back`, { code })).json;
    assert.deepEqual([back.status, back.return_fee], ['collected', 20000]);
    assert.equal(before - (await balance('customer_withdrawable', seller.id)), 20000n, "the return fee is the centre's Connect fee, from the seller's money");
    const events = (await seller.get(`/v1/classifieds/orders/${order.id}`)).json.shipment.events.map(event => event.status);
    assert.equal(events.at(-1), 'returned');
  });

  test('nobody answers in 48 hours: accepted by itself, and everyone is told', async () => {
    const hub = await centre(place.ikeja, 'Quiet Hub');
    const { seller, buyer, order } = await readyAtCentre(hub);
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { readyAt: new Date(Date.now() - 8 * 86_400_000) } });
    const asked = (await hub.staff.post(counterPath(hub, order, 'return'), { reason: 'not_collected' })).json;
    await prisma.connectReturnRequest.update({ where: { id: asked.id }, data: { answerBy: new Date(Date.now() - 1000) } });
    const run = await services.returns.runDue();
    assert.ok(run.accepted >= 1);
    const row = await prisma.connectReturnRequest.findUniqueOrThrow({ where: { id: asked.id } });
    assert.deepEqual([row.status, row.decidedBy], ['accepted', 'auto']);
    for (const who of [seller.id, buyer.id, hub.staff.id]) {
      assert.ok(await prisma.notification.findFirst({ where: { customerId: who, body: { contains: 'nobody answered within 48 hours' } } }), 'told it was accepted because nobody answered');
    }
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'refunded');
  });

  test('refused at check-in: Udozo decides for the buyer, approves the return; the return fee waits for the seller\'s money', async () => {
    const hub = await centre(place.ikeja, 'Check Hub');
    const { seller, order } = await paidAtCentre(hub);
    await hub.staff.post(counterPath(hub, order, 'refuse'), { reason: 'wrong_item' });
    assert.equal((await hub.staff.post(counterPath(hub, order, 'return'), { reason: 'refused_at_check_in' })).json.error.code, 'return_not_due', 'Udozo decides first');
    assert.equal((await admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'refund', note: 'Not the item listed.' })).status, 200);
    const asked = (await hub.staff.post(counterPath(hub, order, 'return'), { reason: 'refused_at_check_in' })).json;
    assert.equal(asked.status, 'requested', JSON.stringify(asked));
    const support = await adminClient(server, ['support']);
    assert.ok((await support.get('/v1/admin/connect/returns?country=NG')).json.data.some(item => item.id === asked.id));
    assert.equal((await support.post(`/v1/admin/connect/returns/${asked.id}/approve`)).status, 403, 'operations approve');
    const approved = (await admin.post(`/v1/admin/connect/returns/${asked.id}/approve`)).json;
    assert.deepEqual([approved.status, approved.decided_by], ['accepted', 'admin']);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'connect_return.approved', targetId: asked.id } }));
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/return/accept`)).json.error.code, 'return_decided', 'answered once');

    const code = (await seller.get(`/v1/classifieds/orders/${order.id}/return-code`)).json.code;
    const unpaid = await hub.staff.post(`/v1/connect/centres/${hub.id}/returns/${asked.id}/hand-back`, { code });
    assert.deepEqual([unpaid.status, unpaid.json.error.code], [402, 'return_fee_unpaid']);
    await fund(seller, 20000);
    const back = (await hub.staff.post(`/v1/connect/centres/${hub.id}/returns/${asked.id}/hand-back`, { code })).json;
    assert.equal(back.status, 'collected', JSON.stringify(back));
  });
});
