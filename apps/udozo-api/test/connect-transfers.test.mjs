// Udozo Connect (docs/UDOZO_CONNECT_PLAN.md, Return requests): a seller has their accepted return sent on to a Connect
// Centre near them. They pay the shipping up front (held until the centre holding it sends it, when it is that centre's),
// their days to collect stop while it travels, and they collect it at the new centre with their return code.
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
  server = await startApp({ env: { APP_PRODUCT: 'udozo', LOG_LEVEL: process.env.DEBUG_LOG ?? 'silent' } });
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
  const email = `connecttransfer${(counter += 1)}-${Date.now()}@example.com`;
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

const day = 86_400_000;

/** Ready at the first centre, not collected, and its return accepted by the seller. */
async function acceptedReturn(hub) {
  const made = await readyAtCentre(hub);
  await prisma.classifiedOrder.update({ where: { id: made.order.id }, data: { readyAt: new Date(Date.now() - 8 * day) } });
  assert.equal((await hub.staff.post(counterPath(hub, made.order, 'return'), { reason: 'not_collected' })).status, 201);
  assert.equal((await made.seller.post(`/v1/classifieds/orders/${made.order.id}/return/accept`)).json.status, 'accepted');
  return made;
}

describe('Sending a return on to a centre near the seller', () => {
  test('the seller chooses a centre and pays; the first centre sends it; the second checks it in; the seller collects it there', async () => {
    const lagos = await centre(place.ikeja, 'Ikeja Hub');
    const abuja = await centre(place.gwarinpa, 'Gwarinpa Hub');
    const { seller, buyer, order } = await acceptedReturn(lagos);
    // A centre in a third state, which the listing does not ship to.
    const elsewhere = await prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', parentId: { notIn: [place.ikeja.parentId, place.gwarinpa.parentId] } } });
    const far = await centre(elsewhere, 'Kano Hub');

    // The listing ships to the FCT for ₦3,000; a state it does not ship to waits for the market's transfer rate.
    let options = (await seller.get(`/v1/classifieds/orders/${order.id}/return/ship-options`)).json;
    assert.deepEqual(options.data.map(option => [option.centre.name, option.shipping]), [['Gwarinpa Hub', 300000]], JSON.stringify(options));
    if (far) {
      assert.equal((await admin.put('/v1/admin/connect/settings/NG', { transfer_ship: 150000 })).json.transfer_ship, 150000);
      options = (await seller.get(`/v1/classifieds/orders/${order.id}/return/ship-options`)).json;
      assert.ok(options.data.some(option => option.centre.name === 'Kano Hub' && option.shipping === 150000), 'the market’s rate where the listing does not ship');
      await admin.put('/v1/admin/connect/settings/NG', { transfer_ship: null });
    }
    assert.equal((await buyer.get(`/v1/classifieds/orders/${order.id}/return/ship-options`)).json.error.code, 'resource_missing', 'the seller’s alone');

    // ₦2,000 of their Udozo money (the shipping they kept) does not cover ₦3,000: their wallet does.
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/return/ship`, { centre_id: abuja.id, expected_shipping: 300000 })).json.error.code, 'return_shipping_unpaid');
    await fund(seller, 500000);
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/return/ship`, { centre_id: abuja.id, expected_shipping: 250000 })).json.error.code, 'price_changed');
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/return/ship`, { centre_id: lagos.id })).json.error.code, 'parameter_invalid', 'it is there already');
    const shipped = await seller.post(`/v1/classifieds/orders/${order.id}/return/ship`, { centre_id: abuja.id, expected_shipping: 300000 });
    assert.equal(shipped.status, 201, JSON.stringify(shipped.json));
    assert.match(shipped.json.number, /^TF-\d{6}$/);
    assert.deepEqual([shipped.json.status, shipped.json.kind, shipped.json.from.name, shipped.json.to.name], ['paid', 'return', 'Ikeja Hub', 'Gwarinpa Hub']);
    assert.equal(await balance('customer_wallet_locked', seller.id), 300000n, 'held until it is sent');
    assert.equal((await balance('customer_wallet', seller.id)), 200000n);
    assert.equal((await prisma.connectReturnRequest.findUniqueOrThrow({ where: { orderId: order.id } })).collectBy, null, 'its days to collect stop while it travels');
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/return/ship`, { centre_id: abuja.id })).json.error.code, 'transfer_exists');
    const view = (await seller.get(`/v1/classifieds/orders/${order.id}`)).json.connect.return.transfer;
    assert.deepEqual([view.status, view.to.name, view.shipping], ['paid', 'Gwarinpa Hub', 300000]);
    assert.equal('transfer' in (await buyer.get(`/v1/classifieds/orders/${order.id}`)).json.connect.return, false, 'never the buyer’s to see');

    // Not handed back where it is any more, and not checked in before it is sent.
    const code = (await seller.get(`/v1/classifieds/orders/${order.id}/return-code`)).json.code;
    const ret = (await lagos.staff.get(`/v1/connect/centres/${lagos.id}/returns`)).json.data.find(item => item.order.id === order.id);
    assert.equal((await lagos.staff.post(`/v1/connect/centres/${lagos.id}/returns/${ret.id}/hand-back`, { code })).json.error.code, 'return_moving');
    const coming = (await abuja.staff.get(`/v1/connect/centres/${abuja.id}/transfers`)).json.data[0];
    assert.equal(coming.id, shipped.json.id);
    assert.equal((await abuja.staff.post(`/v1/connect/centres/${abuja.id}/transfers/${coming.id}/receive`, {})).json.error.code, 'transfer_not_sent');
    assert.equal((await abuja.staff.post(`/v1/connect/centres/${abuja.id}/transfers/${coming.id}/send`, { courier: 'GIG' })).json.error.code, 'resource_missing', 'only the centre holding it sends it');
    assert.equal((await lagos.staff.get(`/v1/connect/centres/${lagos.id}/stock`)).json.total, 1, 'still on the first centre’s shelf');

    // Sent: the shipping is the first centre's (it pays the courier), and it leaves that centre's stock.
    const earned = await balance('connect_centre_earnings', lagos.owner.id);
    const sent = (await lagos.staff.post(`/v1/connect/centres/${lagos.id}/transfers/${coming.id}/send`, { courier: 'GIG Logistics', tracking_number: 'GIG123' })).json;
    assert.deepEqual([sent.status, sent.courier, sent.tracking_number], ['sent', 'GIG Logistics', 'GIG123']);
    assert.equal((await balance('connect_centre_earnings', lagos.owner.id)) - earned, 300000n);
    assert.equal(await balance('customer_wallet_locked', seller.id), 0n);
    assert.equal((await lagos.staff.get(`/v1/connect/centres/${lagos.id}/stock`)).json.total, 0, 'off its shelves');
    assert.equal((await lagos.staff.post(`/v1/connect/centres/${lagos.id}/transfers/${coming.id}/send`, { courier: 'GIG' })).json.error.code, 'transfer_not_waiting');

    // Checked in at the second centre: it holds it now, and the seller's days to collect start again.
    const shelf = await prisma.connectShelf.create({ data: { centreId: abuja.id, code: 'B-02' } });
    const arrived = (await abuja.staff.post(`/v1/connect/centres/${abuja.id}/transfers/${coming.id}/receive`, { shelf_id: shelf.id })).json;
    assert.deepEqual([arrived.status, arrived.shelf], ['arrived', 'B-02']);
    const moved = await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.deepEqual([moved.connectCentreId, moved.connectShelfId], [abuja.id, shelf.id]);
    const returned = await prisma.connectReturnRequest.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.equal(returned.centreId, abuja.id);
    assert.ok(Math.abs(returned.collectBy - Date.now() - 7 * day) < 60_000, '7 days from its arrival');
    assert.equal((await abuja.staff.get(`/v1/connect/centres/${abuja.id}/stock`)).json.total, 1, 'in the second centre’s stock');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: seller.id, title: { contains: 'from Gwarinpa Hub' } } }), 'the seller is told where to collect it');

    // Collected there with the same return code; that centre's part of the return fee is its own.
    const partner = await balance('connect_centre_earnings', abuja.owner.id);
    const back = (await abuja.staff.post(`/v1/connect/centres/${abuja.id}/returns/${ret.id}/hand-back`, { code })).json;
    assert.deepEqual([back.status, back.return_fee], ['collected', 20000], JSON.stringify(back));
    assert.equal((await balance('connect_centre_earnings', abuja.owner.id)) - partner, 14000n);
    assert.equal((await prisma.connectTransfer.findUniqueOrThrow({ where: { id: coming.id } })).status, 'collected');
    assert.equal((await abuja.staff.get(`/v1/connect/centres/${abuja.id}/stock`)).json.total, 0);
  });

  test('cancelled before it is sent: the money back where it came from and the days to collect again; never once the free days ran out', async () => {
    const lagos = await centre(place.ikeja, 'Allen Hub');
    const abuja = await centre(place.gwarinpa, 'Life Camp Hub');
    const { seller, order } = await acceptedReturn(lagos);
    await fund(seller, 500000);
    const shipped = (await seller.post(`/v1/classifieds/orders/${order.id}/return/ship`, { centre_id: abuja.id })).json;
    assert.equal(shipped.status, 'paid', JSON.stringify(shipped));
    const wallet = await balance('customer_wallet', seller.id);
    const cancelled = (await seller.post(`/v1/classifieds/orders/${order.id}/return/ship/cancel`)).json;
    assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled));
    assert.equal((await balance('customer_wallet', seller.id)) - wallet, 300000n, 'back to the wallet it came from');
    assert.equal(await balance('customer_wallet_locked', seller.id), 0n);
    assert.ok((await prisma.connectReturnRequest.findUniqueOrThrow({ where: { orderId: order.id } })).collectBy > new Date(), 'its days to collect run again');
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/return/ship/cancel`)).json.error.code, 'transfer_not_waiting');

    // Admins cancel one too (audited), and the seller is told.
    const again = (await seller.post(`/v1/classifieds/orders/${order.id}/return/ship`, { centre_id: abuja.id })).json;
    assert.equal(again.status, 'paid', JSON.stringify(again));
    const byAdmin = (await admin.post(`/v1/admin/connect/transfers/${again.id}/cancel`, { reason: 'The courier cannot reach that centre.' })).json;
    assert.equal(byAdmin.status, 'cancelled', JSON.stringify(byAdmin));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'connect_transfer.cancelled', targetId: again.id } }));
    assert.ok((await admin.get('/v1/admin/connect/transfers?kind=return')).json.data.some(row => row.id === again.id));

    // Past its free days (Loss of care is near), it is collected where it is.
    await prisma.connectReturnRequest.update({ where: { orderId: order.id }, data: { collectBy: new Date(Date.now() - 1000) } });
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/return/ship`, { centre_id: abuja.id })).json.error.code, 'ship_too_late');
  });
});
