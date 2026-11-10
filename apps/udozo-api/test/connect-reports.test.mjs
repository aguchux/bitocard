// Udozo Connect, phase 6 (docs/UDOZO_CONNECT_PLAN.md, Reports and alerts): what every centre holds and how it did, the
// money Connect made, the sellers and buyers behind problems, what one centre holds, and the alerts the classifieds job
// sends to a centre's people and Udozo's team, each once a day, a week or an item.
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
    reports: server.app.get((await import('../dist/classifieds/connect-reports.service.js')).ConnectReportsService),
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
  const email = `connectreport${(counter += 1)}-${Date.now()}@example.com`;
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

async function handedOver(hub) {
  const made = await readyAtCentre(hub);
  const code = (await made.buyer.get(`/v1/classifieds/orders/${made.order.id}/release-code`)).json.code;
  assert.equal((await hub.staff.post(counterPath(hub, made.order, 'release'), { code })).json.status, 'released');
  return made;
}

const days = n => new Date(Date.now() - n * 86_400_000);

describe('Connect reports and alerts', () => {
  test("every centre's load and record, the money, and the sellers behind refusals", async () => {
    const hub = await centre(place.ikeja, 'Report Hub');
    await handedOver(hub);
    const missing = await readyAtCentre(hub);
    const overdue = await readyAtCentre(hub);
    const lapsed = await readyAtCentre(hub);
    const refused = await paidAtCentre(hub);

    await hub.staff.post(`/v1/connect/centres/${hub.id}/stock-checks`, { shelf_id: hub.shelf.id, found: [overdue.order.id, lapsed.order.id] });
    await prisma.classifiedOrder.update({ where: { id: overdue.order.id }, data: { collectBy: days(1) } });
    await prisma.classifiedOrder.update({ where: { id: lapsed.order.id }, data: { readyAt: days(8), collectBy: days(5) } });
    assert.equal((await hub.staff.post(counterPath(hub, lapsed.order, 'return'), { reason: 'not_collected' })).status, 201);
    assert.equal((await lapsed.seller.post(`/v1/classifieds/orders/${lapsed.order.id}/return/accept`)).status, 200);
    assert.equal((await hub.staff.post(counterPath(hub, refused.order, 'refuse'), { reason: 'damaged' })).status, 200);
    await prisma.connectCentre.update({ where: { id: hub.id }, data: { capacity: 4 } });

    const report = (await admin.get('/v1/admin/connect/report?country=NG&days=30')).json;
    const row = report.centres.find(item => item.id === hub.id);
    assert.ok(row, JSON.stringify(report));
    assert.deepEqual(row.now, { holding: 4, overdue: 1, missing: 1, loss_of_care: 0, late_arrivals: 0 }, JSON.stringify(row));
    assert.equal(row.period.handed_over, 1);
    assert.equal(row.period.not_collected, 1);
    assert.equal(row.period.refused_at_check_in, 1);
    assert.equal(row.period.uncollected_pct, 50);
    assert.deepEqual(row.flags, ['missing_items', 'over_capacity', 'overdue_items']);
    assert.equal(report.centres[0].flags.length >= row.flags.length, true, 'the centres needing attention first');
    const naira = report.money.find(item => item.currency === 'NGN');
    assert.ok(naira.connect_fees >= 20000 && naira.centres >= 14000 && naira.udozo === naira.connect_fees - naira.centres, JSON.stringify(naira));
    assert.ok(report.sellers.some(seller => seller.id === refused.seller.id && seller.refused === 1), JSON.stringify(report.sellers));
    assert.equal((await admin.get('/v1/admin/connect/report?days=12')).json.error.code, 'parameter_invalid');
    assert.equal((await refused.buyer.get('/v1/admin/connect/report')).status, 401, 'admins only');

    const items = (await admin.get(`/v1/admin/connect/centres/${hub.id}/items`)).json.data;
    assert.equal(items.length, 4);
    assert.equal(items.find(item => item.order_id === overdue.order.id).overdue, true);
    assert.ok(items.find(item => item.order_id === missing.order.id).missing_since);
    assert.equal(items.find(item => item.order_id === lapsed.order.id).return.status, 'accepted');
    assert.equal(items.find(item => item.order_id === missing.order.id).shelf, 'A-01');
  });

  test("alerts: a full centre, what is due and past its time, and items arriving late, each once", async () => {
    const hub = await centre(place.ikeja, 'Alert Hub');
    const due = await readyAtCentre(hub);
    const past = await readyAtCentre(hub);
    const late = await paidAtCentre(hub);
    await late.seller.post(`/v1/classifieds/orders/${late.order.id}/sent`, {});
    await prisma.classifiedOrder.update({ where: { id: late.order.id }, data: { sentAt: days(8) } });
    await prisma.classifiedOrder.update({ where: { id: due.order.id }, data: { collectBy: new Date(Date.now() + 3_600_000) } });
    await prisma.classifiedOrder.update({ where: { id: past.order.id }, data: { collectBy: days(1) } });
    await prisma.connectCentre.update({ where: { id: hub.id }, data: { capacity: 2 } });

    const first = await services.reports.alerts();
    assert.ok(first.full >= 1 && first.overdue >= 1 && first.due_today >= 1 && first.late >= 1, JSON.stringify(first));
    const owner = { customerId: hub.owner.id };
    const titles = async where => (await prisma.notification.findMany({ where, select: { title: true } })).map(row => row.title);
    const told = await titles(owner);
    assert.ok(told.includes('Alert Hub is full'), JSON.stringify(told));
    assert.ok(told.includes('1 item is past their free time'));
    assert.ok(told.includes('1 item is due to be collected today'));
    assert.ok(told.includes(`${late.order.number} has not arrived`), JSON.stringify(told));
    const staffTold = await titles({ customerId: hub.staff.id });
    assert.ok(!staffTold.some(title => title.endsWith('is full') || title.includes('past their free time') || title.includes('due to be collected today')), 'staff are not paged; the owner and managers are');
    assert.ok((await titles({ customerId: null, title: 'Alert Hub is full' })).length >= 1, "Udozo's team told");

    const before = await prisma.notification.count({ where: { customerId: hub.owner.id } });
    await services.reports.alerts();
    assert.equal(await prisma.notification.count({ where: { customerId: hub.owner.id } }), before, 'nothing twice the same day');
  });
});
