// Udozo Connect, phase 5 (docs/UDOZO_CONNECT_PLAN.md): UdozoPay orders collected at a Connect Centre. The buyer chooses a
// centre the listing ships to and pays the shipping charge for its state plus a Connect fee; the seller sends it there;
// the centre receives it (or refuses it at check-in), shelves it (ready, the buyer told) and hands it over against the
// buyer's release code once they have inspected it, releasing the money: the seller's price and shipping less their fee,
// the centre's part of the Connect fee to its partner's earnings, Udozo's part to Connect revenue.
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
    house: server.app.get((await import('../dist/checkout/house.service.js')).HouseService),
  };
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_safe_pay', 'connect_shipping']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  assert.equal((await admin.put('/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150, buyer_fee_cap: 100000, seller_fee_bps: 200, seller_fee_cap: 500000 })).status, 200);
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
  const email = `connectorder${(counter += 1)}-${Date.now()}@example.com`;
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

describe('Orders collected at a Connect Centre', () => {
  test('the Connect fee is set per market by finance; until then Connect is not offered at checkout', async () => {
    const hub = await centre(place.ikeja, 'Fee Hub');
    const seller = await customer('Ada Eze');
    const buyer = await customer('Musa Bello');
    await ready(seller);
    const listing = await live(seller, 'LG 43 inch TV');
    await admin.put('/v1/admin/connect/settings/NG', { fee_kind: null });
    const closed = (await buyer.get(`/v1/classifieds/listings/${listing.id}/safe-pay`)).json;
    assert.deepEqual([closed.fulfilment.includes('connect'), closed.connect], [false, null]);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/connect/settings/NG', { fee_kind: 'percent', fee_bps: 1000 })).status, 403, 'finance sets the fee');
    const set = await admin.put('/v1/admin/connect/settings/NG', { fee_kind: 'percent', fee_bps: 1000, centre_share_bps: 7000 });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual([set.json.fee, set.json.centre_share_bps, set.json.buyer_free_hours], [{ kind: 'percent', bps: 1000 }, 7000, 72]);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'connect_settings.changed', targetId: 'NG' } }));

    const quote = (await buyer.get(`/v1/classifieds/listings/${listing.id}/safe-pay`)).json;
    assert.ok(quote.fulfilment.includes('connect'));
    const lagos = quote.connect.states.find(state => state.id === place.ikeja.parentId);
    assert.deepEqual([lagos.shipping, lagos.connect_fee], [200000, 20000], '10% of the ₦2,000 shipping');
    assert.ok(lagos.centres.some(item => item.id === hub.id));
    assert.equal(quote.connect.states.some(state => state.id === place.gwarinpa.parentId), false, 'no open centre in the FCT');
  });

  test('a centre receives it, shelves it and hands it over against the code; the money is split', async () => {
    await admin.put('/v1/admin/connect/settings/NG', { fee_kind: 'percent', fee_bps: 1000, centre_share_bps: 7000 });
    const hub = await centre(place.ikeja, 'Ikeja Parcel Hub');
    const { seller, buyer, order } = await paidAtCentre(hub);
    // ₦250,000 + ₦2,000 shipping + 1.5% UdozoPay fee capped at ₦1,000 + ₦200 Connect fee.
    assert.deepEqual([order.delivery_fee, order.buyer_fee, order.connect.connect_fee, order.total], [200000, 100000, 20000, 25000000 + 200000 + 100000 + 20000]);
    assert.equal(order.connect.centre.id, hub.id);
    assert.equal((await buyer.post(`/v1/classifieds/orders/${order.id}/received`)).json.error.code, 'connect_collect_at_centre', 'collected at the centre, not confirmed at home');

    // The seller drops it off; it shows as expected at the centre, to its people only.
    const sent = await seller.post(`/v1/classifieds/orders/${order.id}/sent`, {});
    assert.equal(sent.json.status, 'sent', JSON.stringify(sent.json));
    assert.equal(sent.json.deadlines.confirm_by, null, 'nothing released by the clock');
    const expected = (await hub.staff.get(`/v1/connect/centres/${hub.id}/orders?view=expected`)).json.data;
    assert.ok(expected.some(item => item.id === order.id));
    assert.equal(JSON.stringify(expected).includes('release_code'), false);
    assert.equal((await buyer.get(`/v1/connect/centres/${hub.id}/orders?view=expected`)).json.error.code, 'centre_unknown');
    assert.equal((await hub.staff.get(`/v1/connect/centres/${hub.id}/orders/lookup?number=${order.number.toLowerCase()}`)).json.id, order.id, 'found by its number, scanned or typed');

    assert.equal((await hub.staff.post(counterPath(hub, order, 'release'), { code: '000000' })).json.error.code, 'order_not_ready');
    assert.equal((await hub.staff.post(counterPath(hub, order, 'receive'), { note: 'Box in good shape.' })).json.status, 'at_centre');
    assert.equal((await hub.staff.post(counterPath(hub, order, 'release'), { code: '000000' })).json.error.code, 'order_not_ready', 'shelved first');
    const shelved = (await hub.staff.post(counterPath(hub, order, 'shelve'), { shelf_id: hub.shelf.id })).json;
    assert.equal(shelved.shelf.code, 'A-01');
    assert.ok(shelved.ready_at && shelved.collect_by);
    assert.ok(Math.abs(new Date(shelved.collect_by) - new Date(shelved.ready_at) - 72 * 3_600_000) < 5000, '72 free hours');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: buyer.id, title: { contains: 'ready to collect' } } }));

    // The buyer inspects it, then gives their code; a wrong one counts a try.
    const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
    const wrong = await hub.staff.post(counterPath(hub, order, 'release'), { code: code === '111111' ? '222222' : '111111' });
    assert.equal(wrong.json.error.code, 'release_code_wrong');
    const before = { seller: await balance('customer_withdrawable', seller.id), partner: await balance('connect_centre_earnings', hub.owner.id), connect: await balance('connect_revenue'), fees: await balance('classifieds_revenue') };
    const done = (await hub.staff.post(counterPath(hub, order, 'release'), { code })).json;
    assert.equal(done.status, 'released', JSON.stringify(done));
    assert.equal(done.events.at(-1).status, 'collected');
    assert.equal((await balance('customer_withdrawable', seller.id)) - before.seller, 25000000n - 500000n + 200000n, 'price less the 2% fee (capped at ₦5,000) plus shipping');
    assert.equal((await balance('connect_centre_earnings', hub.owner.id)) - before.partner, 14000n, "70% of the ₦200 Connect fee is the centre's");
    assert.equal((await balance('connect_revenue')) - before.connect, 6000n, "30% is Udozo's");
    assert.equal((await balance('classifieds_revenue')) - before.fees, 100000n + 500000n, "UdozoPay's own fees stay apart");
    const timeline = (await buyer.get(`/v1/classifieds/orders/${order.id}`)).json;
    assert.deepEqual(timeline.shipment.events.map(event => [event.status, event.reported_by]), [['shipped', 'seller'], ['received', 'centre'], ['ready', 'centre'], ['collected', 'centre']]);
  });

  test('a centre refuses an item at check-in, and a buyer at the counter: both are disputes for Udozo', async () => {
    await admin.put('/v1/admin/connect/settings/NG', { fee_kind: 'fixed', fee: 50000 });
    const hub = await centre(place.ikeja, 'Careful Hub');
    const first = await paidAtCentre(hub);
    assert.equal(first.order.connect.connect_fee, 50000, 'a fixed fee');
    const refused = (await hub.staff.post(counterPath(hub, first.order, 'refuse'), { reason: 'damaged', note: 'Screen cracked.' })).json;
    assert.equal(refused.status, 'disputed');
    const dispute = await prisma.classifiedDispute.findFirstOrThrow({ where: { orderId: first.order.id }, include: { messages: true } });
    assert.equal(dispute.reason, 'damaged');
    assert.match(dispute.messages[0].body, /refused it at check-in: it arrived damaged\. Screen cracked\./);

    const second = await paidAtCentre(hub);
    await hub.owner.post(counterPath(hub, second.order, 'receive'), {});
    await hub.owner.post(counterPath(hub, second.order, 'shelve'), { shelf_id: hub.shelf.id });
    const atCounter = (await hub.owner.post(counterPath(hub, second.order, 'refuse-collection'), { reason: 'Not the colour in the photos.' })).json;
    assert.equal(atCounter.status, 'disputed');
    assert.equal(atCounter.events.at(-1).status, 'collection_refused');

    // Udozo decides for the buyer: they get everything back, the Connect fee too.
    const wallet = await balance('customer_wallet', second.buyer.id);
    const decided = await admin.post(`/v1/admin/classifieds/orders/${second.order.id}/dispute/decide`, { decision: 'refund', note: 'The item was not as described.' });
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
    assert.equal((await balance('customer_wallet', second.buyer.id)) - wallet, BigInt(second.order.total));
  });

  test('only a centre the listing ships to, open, can be chosen; unpaid or closed it cannot be received', async () => {
    await admin.put('/v1/admin/connect/settings/NG', { fee_kind: 'percent', fee_bps: 1000 });
    const hub = await centre(place.ikeja, 'Open Hub');
    const shut = await centre(place.ikeja, 'Shut Hub');
    await prisma.connectCentre.update({ where: { id: shut.id }, data: { status: 'paused', pausedBy: 'udozo' } });
    const elsewhere = await centre(place.ikeja, 'Not Chosen Hub');
    const seller = await customer('Ada Eze');
    const buyer = await customer('Musa Bello');
    await ready(seller);
    const listing = await live(seller, 'Sony TV');
    await prisma.classifiedListing.update({ where: { id: listing.id }, data: { connectAllCentres: false } });
    await prisma.classifiedListingConnectCentre.create({ data: { listingId: listing.id, centreId: hub.id } });
    const ask = centreId => buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'connect', ...(centreId ? { connect_centre_id: centreId } : {}) });
    assert.equal((await ask(null)).json.error.code, 'centre_required');
    assert.equal((await ask(shut.id)).json.error.code, 'centre_unavailable');
    assert.equal((await ask(elsewhere.id)).json.error.code, 'centre_unavailable', 'not one the seller chose');
    const order = (await ask(hub.id)).json;
    assert.equal(order.status, 'requested');
    assert.equal((await hub.staff.post(counterPath(hub, order, 'receive'), {})).json.error.code, 'order_not_expected', 'not paid yet');
    assert.equal((await elsewhere.staff.get(counterPath(elsewhere, order))).json.error.code, 'resource_missing', "another centre's order");
  });
});
