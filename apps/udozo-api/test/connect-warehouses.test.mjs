// Udozo Connect, phase 7a (docs/UDOZO_CONNECT_PLAN.md, Abandoned and auctioned; Udozo warehouses and Final Return
// Addresses): an item a month into Loss of care is abandoned, Udozo picks it up from the centre against a pickup code
// to the centre's Final Return Address, checks it in at the warehouse, and its seller can still collect it there.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, fakeService, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let services;
let place;

let bucket;
const objects = new Map();

before(async () => {
  // The private bucket check-out photos are sealed in.
  bucket = await fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname);
    if (call.method === 'PUT') {
      objects.set(key, call.raw);
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') return objects.has(key) ? { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: objects.get(key) } : { status: 404, body: '' };
    if (call.method === 'DELETE') {
      objects.delete(key);
      return { status: 204, body: '' };
    }
    return { status: 405, body: '' };
  });
  server = await startApp({ env: { APP_PRODUCT: 'udozo', KYC_SPACES_KEY: 'kyc-key', KYC_SPACES_SECRET: 'kyc-secret', KYC_SPACES_BUCKET: 'kyc-private', KYC_SPACES_ENDPOINT: bucket.url } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  services = {
    ledger: server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService),
    returns: server.app.get((await import('../dist/classifieds/connect-returns.service.js')).ConnectReturnsService),
    charges: server.app.get((await import('../dist/classifieds/connect-charges.service.js')).ConnectChargesService),
    warehouses: server.app.get((await import('../dist/classifieds/connect-warehouses.service.js')).ConnectWarehousesService),
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

after(async () => {
  await server?.close();
  await bucket?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body, form) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `connect-${Date.now()}-${Math.random()}` } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status, type, bytes: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    delete: path => request('DELETE', path),
    upload: (path, bytes, type = 'image/jpeg') => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type }), 'photo.jpg');
      return request('POST', path, undefined, form);
    },
  };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `connectwarehouse${(counter += 1)}-${Date.now()}@example.com`;
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

const days = n => new Date(Date.now() - n * 86_400_000);
const today = () => new Date().toISOString().slice(0, 10);

/** An item refused for damage, refunded, its return accepted and never collected: 40 days into Loss of care. */
async function inLossOfCare(hub) {
  const made = await paidAtCentre(hub);
  await hub.staff.post(counterPath(hub, made.order, 'refuse'), { reason: 'damaged' });
  await admin.post(`/v1/admin/classifieds/orders/${made.order.id}/dispute/decide`, { decision: 'refund', note: 'Damaged on arrival.' });
  const asked = (await hub.staff.post(counterPath(hub, made.order, 'return'), { reason: 'damaged' })).json;
  await made.seller.post(`/v1/classifieds/orders/${made.order.id}/return/accept`);
  await prisma.connectReturnRequest.update({ where: { id: asked.id }, data: { collectBy: days(40) } });
  await services.charges.accrue();
  return { ...made, returnId: asked.id };
}

describe('Abandoned items, pickups and warehouses', () => {
  test('abandoned a month into Loss of care, picked up against the code to the Final Return Address, collected there', async () => {
    const hub = await centre(place.ikeja, 'Abandon Hub');
    const item = await inLossOfCare(hub);
    assert.deepEqual(await services.warehouses.abandon(), { abandoned: 1 });
    assert.deepEqual(await services.warehouses.abandon(), { abandoned: 0 }, 'once');
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: item.order.id } })).connectPlace, 'awaiting_pickup');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: item.seller.id, title: { contains: 'is abandoned' } } }), 'the seller told');
    assert.equal((await item.seller.get(`/v1/classifieds/orders/${item.order.id}`)).json.connect.return.place, 'awaiting_pickup');

    // No pickup without a Final Return Address.
    assert.equal((await admin.post('/v1/admin/connect/pickups', { centre_id: hub.id, day: today(), collector: 'Tunde (Udozo)' })).json.error.code, 'fra_missing');
    const warehouse = (await admin.post('/v1/admin/connect/warehouses', { country: 'NG', state_id: place.ikeja.parentId, name: 'Udozo Lagos warehouse', address: '4 Industrial Avenue, Ilupeju', hours: 'Mon to Sat, 9am to 5pm', phone: '08030000000' })).json;
    assert.equal(warehouse.object, 'connect_warehouse', JSON.stringify(warehouse));
    assert.equal((await admin.put(`/v1/admin/connect/centres/${hub.id}/final-return-address`, { warehouse_id: warehouse.id })).json.warehouse.id, warehouse.id);
    const awaiting = (await admin.get('/v1/admin/connect/pickups/awaiting?country=NG')).json.data.find(row => row.centre.id === hub.id);
    assert.deepEqual([awaiting.awaiting, awaiting.scheduled], [1, 0]);

    const pickup = (await admin.post('/v1/admin/connect/pickups', { centre_id: hub.id, day: today(), collector: 'Tunde (Udozo)' })).json;
    assert.equal(pickup.items.length, 1, JSON.stringify(pickup));
    assert.match(pickup.code, /^\d{6}$/);
    assert.equal((await admin.post('/v1/admin/connect/pickups', { centre_id: hub.id, day: today(), collector: 'Again' })).json.error.code, 'nothing_to_pick_up');

    // The centre sees it, never the code, and hands it over only against it.
    const seen = (await hub.staff.get(`/v1/connect/centres/${hub.id}/pickups`)).json;
    assert.equal(seen.data[0].id, pickup.id);
    assert.equal('code' in seen.data[0], false);
    assert.equal(seen.final_return_address.warehouse.name, 'Udozo Lagos warehouse');
    // Check-out photos first: with none, the hand-over is refused before any code is tried.
    const bare = await hub.staff.post(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/hand-over`, { code: pickup.code, order_ids: [item.order.id] });
    assert.equal(bare.json.error.code, 'checkout_photos_required');
    assert.equal((await prisma.connectPickup.findUniqueOrThrow({ where: { id: pickup.id } })).codeAttempts, 0, 'no try used');
    const photographed = await hub.staff.upload(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/photos`, jpeg());
    assert.equal(photographed.status, 201, JSON.stringify(photographed.json));
    assert.equal(photographed.json.photos.length, 1);
    const blurred = (await hub.staff.upload(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/photos`, jpeg())).json.photos[1];
    assert.equal((await hub.staff.delete(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/photos/${blurred.id}`)).json.photos.length, 1, 'taken back before the hand-over');
    assert.equal((await hub.staff.upload(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/photos`, Buffer.from('not a photo'))).json.error.code, 'file_invalid');
    const shot = photographed.json.photos[0];
    const seenPhoto = await hub.staff.get(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/photos/${shot.id}`);
    assert.deepEqual([seenPhoto.status, seenPhoto.type], [200, 'image/jpeg']);
    assert.ok(!seenPhoto.bytes.includes(Buffer.from('GPSDATA')), 'its metadata stripped');
    const stranger = await customer('Not Staff');
    assert.equal((await stranger.get(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/photos/${shot.id}`)).status, 404);
    const wrong = await hub.staff.post(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/hand-over`, { code: pickup.code === '000000' ? '111111' : '000000', order_ids: [item.order.id] });
    assert.equal(wrong.json.error.code, 'pickup_code_wrong');
    const handed = (await hub.staff.post(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/hand-over`, { code: pickup.code, order_ids: [item.order.id] })).json;
    assert.equal(handed.status, 'collected', JSON.stringify(handed));
    assert.equal((await hub.staff.delete(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/photos/${shot.id}`)).json.error.code, 'pickup_not_scheduled', 'the record stays');
    assert.equal((await admin.get(`/v1/admin/connect/pickups/${pickup.id}`)).json.photos.length, 1, 'Udozo sees the photos');
    const adminFile = await services.warehouses.adminPhoto(null, pickup.id, shot.id);
    assert.equal(adminFile.contentType, 'image/jpeg');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'connect_pickup.photo_viewed', targetId: pickup.id } }), 'viewing it is audited');
    const moving = await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: item.order.id } });
    assert.equal(moving.connectPlace, 'in_transit');
    assert.ok(moving.connectWithUdozoAt);
    assert.equal((await hub.staff.get(`/v1/connect/centres/${hub.id}/stock`)).json.total, 0, 'no longer the centre’s');
    const code = (await item.seller.get(`/v1/classifieds/orders/${item.order.id}/return-code`)).json.code;
    assert.equal((await hub.staff.post(`/v1/connect/centres/${hub.id}/returns/${item.returnId}/hand-back`, { code })).json.error.code, 'with_udozo');

    // Checked in at the warehouse.
    const received = (await admin.post(`/v1/admin/connect/pickups/${pickup.id}/receive`, { order_ids: [item.order.id] })).json;
    assert.equal(received.status, 'delivered', JSON.stringify(received));
    assert.ok((await admin.get('/v1/admin/connect/warehouse-items')).json.data.some(row => row.order_id === item.order.id));
    const view = (await item.seller.get(`/v1/classifieds/orders/${item.order.id}`)).json.connect.return;
    assert.equal(view.place, 'udozo_warehouse');
    assert.equal(view.warehouse.name, 'Udozo Lagos warehouse');

    // Storage from the hand-over on is Udozo's alone; earlier days are shared with the centre.
    await prisma.classifiedOrder.update({ where: { id: item.order.id }, data: { connectWithUdozoAt: days(5) } });
    const owed = await prisma.connectCharge.findMany({ where: { orderId: item.order.id, payer: 'seller', status: 'owed' } });
    const from = new Date(`${days(5).toISOString().slice(0, 10)}T00:00:00.000Z`);
    const centreShare = owed.filter(row => row.day < from).reduce((total, row) => total + (row.amountMinor * 7000n) / 10000n, 0n);
    const total = owed.reduce((sum, row) => sum + row.amountMinor, 0n);
    await fund(item.seller, Number(total) + 50000);
    const before = await balance('connect_centre_earnings', hub.owner.id);
    const back = (await admin.post(`/v1/admin/connect/returns/${item.returnId}/hand-back`, { code })).json;
    assert.equal(back.status, 'collected', JSON.stringify(back));
    assert.equal((await balance('connect_centre_earnings', hub.owner.id)) - before, centreShare, 'the centre’s share only for the days it held it, and no return fee share');
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: item.order.id } })).connectPlace, null);
  });

  test('a seller collecting before the pickup takes it off the pickup; only operations schedule', async () => {
    const hub = await centre(place.ikeja, 'Early Hub');
    const warehouse = (await admin.post('/v1/admin/connect/warehouses', { country: 'NG', state_id: place.ikeja.parentId, name: 'Udozo Lagos 2', address: '9 Road', hours: '9 to 5', phone: '08030000001' })).json;
    await admin.put(`/v1/admin/connect/centres/${hub.id}/final-return-address`, { warehouse_id: warehouse.id });
    const item = await inLossOfCare(hub);
    await services.warehouses.abandon();
    const pickup = (await admin.post('/v1/admin/connect/pickups', { centre_id: hub.id, day: today(), collector: 'Tunde' })).json;
    const owed = await prisma.connectCharge.findMany({ where: { orderId: item.order.id, payer: 'seller', status: 'owed' } });
    await fund(item.seller, Number(owed.reduce((sum, row) => sum + row.amountMinor, 0n)) + 50000);
    const code = (await item.seller.get(`/v1/classifieds/orders/${item.order.id}/return-code`)).json.code;
    assert.equal((await hub.staff.post(`/v1/connect/centres/${hub.id}/returns/${item.returnId}/hand-back`, { code })).json.status, 'collected');
    const after = (await admin.get(`/v1/admin/connect/pickups/${pickup.id}`)).json;
    assert.equal(after.items[0].status, 'removed');
    assert.equal((await admin.post(`/v1/admin/connect/pickups/${pickup.id}/cancel`, { reason: 'Nothing left' })).json.status, 'cancelled');
    assert.equal((await admin.post(`/v1/admin/connect/pickups/${pickup.id}/cancel`, { reason: 'Again' })).json.error.code, 'pickup_not_scheduled');
  });
});

/** A small JPEG with an EXIF block that must not survive. */
function jpeg() {
  const u16 = value => Buffer.from([value >> 8, value & 0xff]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPSDATA-LAGOS')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x30, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}
