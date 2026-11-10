// Udozo Connect, phase 5f (docs/UDOZO_CONNECT_PLAN.md, Stock check and Earnings): a centre's people list what should be
// on each storage place and mark what is there, anything missing flagged to Udozo at once; its owner sees the centre's
// earnings, what is held, and moves the rest into their payouts.
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
  const email = `connectstock${(counter += 1)}-${Date.now()}@example.com`;
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

async function handedOver(hub) {
  const made = await readyAtCentre(hub);
  const code = (await made.buyer.get(`/v1/classifieds/orders/${made.order.id}/release-code`)).json.code;
  assert.equal((await hub.staff.post(counterPath(hub, made.order, 'release'), { code })).json.status, 'released');
  return made;
}

describe('Stock checks at Connect Centres', () => {
  test('lists what should be on each storage place, flags what is missing to Udozo, and clears it once found', async () => {
    const hub = await centre(place.ikeja, 'Stock Hub');
    const empty = await prisma.connectShelf.create({ data: { centreId: hub.id, code: 'B-01' } });
    const first = await readyAtCentre(hub);
    const second = await readyAtCentre(hub);
    const stock = (await hub.staff.get(`/v1/connect/centres/${hub.id}/stock`)).json;
    const shelf = stock.groups.find(group => group.shelf?.code === 'A-01');
    assert.deepEqual(shelf.items.map(item => item.order_id).sort(), [first.order.id, second.order.id].sort());
    assert.equal(stock.groups.find(group => group.shelf?.code === 'B-01').items.length, 0);

    const stranger = await customer('Somebody Else');
    assert.equal((await stranger.get(`/v1/connect/centres/${hub.id}/stock`)).json.error.code, 'centre_unknown');
    assert.equal((await hub.staff.post(`/v1/connect/centres/${hub.id}/stock-checks`, { shelf_id: empty.id, found: [] })).json.error.code, 'nothing_to_check');
    assert.equal((await hub.staff.post(`/v1/connect/centres/${hub.id}/stock-checks`, { shelf_id: hub.shelf.id, found: [randomUUID()] })).json.error.code, 'parameter_invalid');

    const check = (await hub.staff.post(`/v1/connect/centres/${hub.id}/stock-checks`, { shelf_id: hub.shelf.id, found: [first.order.id], note: 'Second box not here' })).json;
    assert.deepEqual([check.expected, check.found, check.missing, check.flagged, check.checked_by], [2, 1, 1, 1, 'Bola Ade']);
    const flagged = await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: second.order.id } });
    assert.ok(flagged.connectMissingAt, 'flagged missing');
    assert.ok((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: first.order.id } })).connectSeenAt, 'seen');
    assert.ok(await prisma.notification.findFirst({ where: { title: { contains: 'missing at Stock Hub' } } }), 'Udozo told at once');
    const missing = (await admin.get('/v1/admin/connect/missing?country=NG')).json.data;
    assert.ok(missing.some(item => item.order_id === second.order.id && item.centre.name === 'Stock Hub' && item.shelf === 'A-01'));

    // Checked again the next day and found: no longer missing, and no second notice for the same item.
    await hub.staff.post(`/v1/connect/centres/${hub.id}/stock-checks`, { found: [first.order.id, second.order.id] });
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: second.order.id } })).connectMissingAt, null);
    assert.ok(!(await admin.get('/v1/admin/connect/missing?country=NG')).json.data.some(item => item.order_id === second.order.id));
    const history = (await hub.owner.get(`/v1/connect/centres/${hub.id}/stock-checks`)).json.data;
    assert.deepEqual(history.map(row => [row.shelf?.code ?? null, row.missing]), [[null, 0], ['A-01', 1]]);

    // Handed over, it is no longer expected (and a flag on it is cleared).
    await prisma.classifiedOrder.update({ where: { id: first.order.id }, data: { connectMissingAt: new Date() } });
    const code = (await first.buyer.get(`/v1/classifieds/orders/${first.order.id}/release-code`)).json.code;
    await hub.staff.post(counterPath(hub, first.order, 'release'), { code });
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: first.order.id } })).connectMissingAt, null);
    assert.equal((await hub.staff.get(`/v1/connect/centres/${hub.id}/stock`)).json.total, 1);
  });
});

describe("A centre's earnings", () => {
  test('the owner sees the 70% earned, held for the payout hold, then moves it into their payouts', async () => {
    const hub = await centre(place.ikeja, 'Earnings Hub');
    await handedOver(hub);
    const share = 14000; // 70% of the ₦200 Connect fee (10% of the ₦2,000 shipping).
    assert.equal((await hub.staff.get(`/v1/connect/centres/${hub.id}/earnings`)).json.error.code, 'centre_role_required', 'the owner only');

    const { payoutHoldDays } = await prisma.country.findUniqueOrThrow({ where: { code: 'NG' } });
    assert.ok(payoutHoldDays > 0);
    const earnings = (await hub.owner.get(`/v1/connect/centres/${hub.id}/earnings`)).json;
    assert.deepEqual(earnings.accounts, [{ mode: 'live', currency: 'NGN', balance: share, held: share, available: 0 }]);
    assert.equal(earnings.lines[0].kind, 'earned');
    assert.deepEqual(earnings.centre, { handed_over: 1, connect_fees: share });
    const held = await hub.owner.post(`/v1/connect/centres/${hub.id}/earnings/move`, { mode: 'live', currency: 'NGN', amount: share });
    assert.deepEqual([held.status, held.json.error.code], [402, 'insufficient_funds']);

    await prisma.country.update({ where: { code: 'NG' }, data: { payoutHoldDays: 0 } });
    try {
      const payouts = await balance('customer_withdrawable', hub.owner.id);
      const moved = (await hub.owner.post(`/v1/connect/centres/${hub.id}/earnings/move`, { mode: 'live', currency: 'NGN', amount: 10000 })).json;
      assert.deepEqual(moved.accounts, [{ mode: 'live', currency: 'NGN', balance: share - 10000, held: 0, available: share - 10000 }]);
      assert.equal(moved.lines[0].kind, 'moved');
      assert.equal((await balance('customer_withdrawable', hub.owner.id)) - payouts, 10000n, 'in their payouts, paid to their bank from udozo.com');
      const over = await hub.owner.post(`/v1/connect/centres/${hub.id}/earnings/move`, { mode: 'live', currency: 'NGN', amount: share });
      assert.equal(over.json.error.code, 'insufficient_funds');
      assert.equal((await hub.owner.post(`/v1/connect/centres/${hub.id}/earnings/move`, { mode: 'live', currency: 'USD', amount: 1 })).json.error.code, 'parameter_invalid');
    } finally {
      await prisma.country.update({ where: { code: 'NG' }, data: { payoutHoldDays } });
    }
  });
});
