// Udozo Connect, phase 7b (docs/UDOZO_CONNECT_PLAN.md, Udozo auctions): an abandoned item at Udozo's warehouse, months
// into Loss of care, listed by operations a day ahead, bid on in steps with late bids extending the end, offered to the
// top bidder then the next, paid from the wallet (the storage owed first, the rest held for the seller) and collected.
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
    warehouses: server.app.get((await import('../dist/classifieds/connect-warehouses.service.js')).ConnectWarehousesService),
    auctions: server.app.get((await import('../dist/classifieds/connect-auctions.service.js')).ConnectAuctionsService),
    claims: server.app.get((await import('../dist/classifieds/connect-auction-claims.service.js')).ConnectAuctionClaimsService),
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
  const email = `connectauction${(counter += 1)}-${Date.now()}@example.com`;
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

/** An item refused for damage, refunded, its return accepted and never collected: 100 days into Loss of care. */
async function inLossOfCare(hub) {
  const made = await paidAtCentre(hub);
  await hub.staff.post(counterPath(hub, made.order, 'refuse'), { reason: 'damaged' });
  await admin.post(`/v1/admin/classifieds/orders/${made.order.id}/dispute/decide`, { decision: 'refund', note: 'Damaged on arrival.' });
  const asked = (await hub.staff.post(counterPath(hub, made.order, 'return'), { reason: 'damaged' })).json;
  await made.seller.post(`/v1/classifieds/orders/${made.order.id}/return/accept`);
  await prisma.connectReturnRequest.update({ where: { id: asked.id }, data: { collectBy: days(100) } });
  await services.charges.accrue();
  return { ...made, returnId: asked.id };
}

/** That item abandoned, picked up and checked in at a Udozo warehouse. */
async function atWarehouse(hub) {
  const warehouse = (await admin.post('/v1/admin/connect/warehouses', { country: 'NG', state_id: place.ikeja.parentId, name: `Udozo Lagos ${counter}`, address: '4 Industrial Avenue', hours: '9 to 5', phone: '08030000000' })).json;
  await admin.put(`/v1/admin/connect/centres/${hub.id}/final-return-address`, { warehouse_id: warehouse.id });
  const item = await inLossOfCare(hub);
  await services.warehouses.abandon();
  const pickup = (await admin.post('/v1/admin/connect/pickups', { centre_id: hub.id, day: today(), collector: 'Tunde' })).json;
  await hub.staff.post(`/v1/connect/centres/${hub.id}/pickups/${pickup.id}/hand-over`, { code: pickup.code, order_ids: [item.order.id] });
  await admin.post(`/v1/admin/connect/pickups/${pickup.id}/receive`, { order_ids: [item.order.id] });
  return { ...item, warehouse };
}

const lotPath = lot => `/v1/classifieds/auctions/${lot.ref}`;
const soon = hours => new Date(Date.now() + hours * 3_600_000).toISOString();

describe('Udozo auctions', () => {
  test('listed a day ahead at what is owed, bid in steps, offered to the next bidder when one lapses, paid and collected', async () => {
    const hub = await centre(place.ikeja, 'Auction Hub');
    const item = await atWarehouse(hub);
    const eligible = (await admin.get('/v1/admin/connect/auctions/eligible?country=NG')).json.data.find(row => row.order_id === item.order.id);
    assert.ok(eligible?.due, JSON.stringify(eligible));
    const owed = eligible.owed;
    assert.ok(owed > 0);

    assert.equal((await admin.post('/v1/admin/connect/auctions', { order_id: item.order.id, start_price: owed - 1, ends_at: soon(48) })).json.error.code, 'start_below_owed');
    assert.equal((await admin.post('/v1/admin/connect/auctions', { order_id: item.order.id, start_price: owed, starts_at: soon(1), ends_at: soon(48) })).json.error.code, 'auction_too_soon');
    const start = owed + 100_000;
    const lot = (await admin.post('/v1/admin/connect/auctions', { order_id: item.order.id, start_price: start, ends_at: soon(48), costs: 20_000 })).json;
    assert.equal(lot.status, 'scheduled', JSON.stringify(lot));
    // Sold through an ordinary auction listing of Udozo's seller account in the market.
    const row = await prisma.connectAuction.findUniqueOrThrow({ where: { id: lot.id }, include: { listing: { include: { customer: true, media: true } } } });
    assert.deepEqual([row.listing.saleMethod, row.listing.status, row.listing.customer.email, row.listing.stock], ['auction', 'active', 'auctions-ng@udozo.com', 1]);
    assert.ok(row.listing.media.length > 0, "its photos are the abandoned listing's");
    assert.ok(await prisma.notification.findFirst({ where: { customerId: item.seller.id, title: { contains: 'will be auctioned' } } }), 'its seller told first');
    assert.equal((await admin.post('/v1/admin/connect/auctions', { order_id: item.order.id, start_price: start, ends_at: soon(48) })).json.error.code, 'auction_exists');

    const alice = await customer('Alice Bidder');
    const bola = await customer('Bola Bidder');
    assert.equal((await alice.post(`${lotPath(lot)}/bids`, { amount: start })).json.error.code, 'auction_not_live');
    await prisma.connectAuction.update({ where: { id: lot.id }, data: { startsAt: new Date(Date.now() - 1000) } });
    await services.auctions.runDue();
    const open = (await alice.get(lotPath(lot))).json;
    assert.deepEqual([open.status, open.next_bid], ['live', start]);
    const found = await fetch(`${server.base}/v1/classifieds/listings?country=NG&sale=auction`).then(res => res.json());
    assert.ok(found.data.some(card => card.id === row.listingId), 'among the listings at auction');
    assert.equal((await item.seller.post(`/v1/classifieds/listings/${row.listingId}/bids`, { amount: start })).json.error.code, 'own_item', 'its original seller never bids');
    assert.ok((await alice.get('/v1/classifieds/auctions?country=NG')).json.data.some(row => row.id === lot.id), 'listed publicly');

    assert.equal((await item.seller.post(`${lotPath(lot)}/bids`, { amount: start })).json.error.code, 'own_item');
    assert.equal((await alice.post(`${lotPath(lot)}/bids`, { amount: start })).json.viewer.leading, true);
    const least = start + Math.max(Math.ceil(start * 0.05), 50_000);
    const low = await bola.post(`${lotPath(lot)}/bids`, { amount: least - 1 });
    assert.deepEqual([low.status, low.json.error.code], [400, 'bid_too_low']);
    // A late bid pushes the end to five minutes after it.
    await prisma.connectAuction.update({ where: { id: lot.id }, data: { endsAt: new Date(Date.now() + 60_000) } });
    const bid = (await bola.post(`${lotPath(lot)}/bids`, { amount: least })).json;
    assert.ok(new Date(bid.ends_at).getTime() > Date.now() + 4 * 60_000, bid.ends_at);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: alice.id, title: { contains: 'outbid' } } }), 'Alice told she was outbid');
    assert.equal(bid.recent_bids[0].name, 'Bola B.', 'bidders by first name and initial');

    // Its seller can no longer collect it once it has bids.
    const code = (await item.seller.get(`/v1/classifieds/orders/${item.order.id}/return-code`)).json.code;
    assert.equal((await admin.post(`/v1/admin/connect/returns/${item.returnId}/hand-back`, { code })).json.error.code, 'auction_has_bids');

    // It ends: offered to Bola, who lets it lapse; then to Alice at her bid.
    await prisma.connectAuction.update({ where: { id: lot.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    await services.auctions.runDue();
    assert.equal((await bola.get(lotPath(lot))).json.viewer.to_pay.amount, least);
    await prisma.connectAuction.update({ where: { id: lot.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await services.auctions.runDue();
    assert.equal((await bola.post(`${lotPath(lot)}/pay`)).json.error.code, 'not_yours_to_pay');
    const offer = (await alice.get(lotPath(lot))).json.viewer.to_pay;
    assert.equal(offer.amount, start);

    assert.equal((await alice.post(`${lotPath(lot)}/pay`)).json.error.code, 'wallet_balance_low');
    await fund(alice, start);
    const held = await balance('connect_auction_held');
    const owedNow = await prisma.connectCharge.findMany({ where: { orderId: item.order.id, payer: 'seller', status: 'owed' } });
    const paid = (await alice.post(`${lotPath(lot)}/pay`)).json;
    assert.equal(paid.viewer.won, true, JSON.stringify(paid));
    const owedTotal = owedNow.reduce((sum, row) => sum + row.amountMinor, 0n);
    assert.equal((await balance('connect_auction_held')) - held, BigInt(start) - owedTotal - 20_000n, 'what is left after storage and costs, held for the seller');
    assert.equal(await prisma.connectCharge.count({ where: { orderId: item.order.id, payer: 'seller', status: 'owed' } }), 0, 'the storage owed paid off');
    assert.equal((await prisma.connectReturnRequest.findUniqueOrThrow({ where: { id: item.returnId } })).status, 'cancelled');
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: item.order.id } })).connectPlace, 'auctioned');
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: row.listingId } })).status, 'sold', 'its listing is sold');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: item.seller.id, title: { contains: 'was sold at auction' } } }));

    // Collected at the warehouse with the buyer's code.
    const collection = (await alice.get(`${lotPath(lot)}/collection-code`)).json;
    assert.match(collection.code, /^\d{6}$/);
    assert.equal((await bola.get(`${lotPath(lot)}/collection-code`)).json.error.code, 'not_yours_to_collect');
    assert.equal((await admin.post(`/v1/admin/connect/auctions/${lot.id}/hand-over`, { code: collection.code === '000000' ? '111111' : '000000' })).json.error.code, 'collection_code_wrong');
    assert.ok((await admin.post(`/v1/admin/connect/auctions/${lot.id}/hand-over`, { code: collection.code })).json.collected_at);
    const record = (await admin.get(`/v1/admin/connect/auctions/${lot.id}`)).json;
    assert.deepEqual([record.sale, record.left_over], [start, Number(BigInt(start) - owedTotal - 20_000n)]);
  });

  test('nobody bids: unsold; its seller collecting before any bid cancels the lot', async () => {
    const hub = await centre(place.ikeja, 'Quiet Hub');
    const item = await atWarehouse(hub);
    const owed = (await admin.get('/v1/admin/connect/auctions/eligible?country=NG')).json.data.find(row => row.order_id === item.order.id).owed;
    const lot = (await admin.post('/v1/admin/connect/auctions', { order_id: item.order.id, start_price: owed + 1000, ends_at: soon(48) })).json;
    await fund(item.seller, owed + 200_000);
    const code = (await item.seller.get(`/v1/classifieds/orders/${item.order.id}/return-code`)).json.code;
    assert.equal((await admin.post(`/v1/admin/connect/returns/${item.returnId}/hand-back`, { code })).json.status, 'collected');
    assert.equal((await admin.get(`/v1/admin/connect/auctions/${lot.id}`)).json.status, 'cancelled');

    const other = await atWarehouse(await centre(place.ikeja, 'Quiet Hub 2'));
    const owedOther = (await admin.get('/v1/admin/connect/auctions/eligible?country=NG')).json.data.find(row => row.order_id === other.order.id).owed;
    const unsold = (await admin.post('/v1/admin/connect/auctions', { order_id: other.order.id, start_price: owedOther + 1000, ends_at: soon(48) })).json;
    await prisma.connectAuction.update({ where: { id: unsold.id }, data: { startsAt: new Date(Date.now() - 2000), endsAt: new Date(Date.now() - 1000) } });
    await services.auctions.runDue();
    await services.auctions.runDue();
    assert.equal((await admin.get(`/v1/admin/connect/auctions/${unsold.id}`)).json.status, 'unsold');
    assert.equal((await admin.post(`/v1/admin/connect/auctions/${unsold.id}/cancel`, { reason: 'Again' })).json.error.code, 'auction_has_bids');
  });
});

/** An abandoned item sold at auction for more than its seller owed: what is left over waits for their claim. */
async function soldLot(name) {
  const item = await atWarehouse(await centre(place.ikeja, name));
  const owed = (await admin.get('/v1/admin/connect/auctions/eligible?country=NG')).json.data.find(row => row.order_id === item.order.id).owed;
  const lot = (await admin.post('/v1/admin/connect/auctions', { order_id: item.order.id, start_price: owed + 300_000, ends_at: soon(48) })).json;
  await prisma.connectAuction.update({ where: { id: lot.id }, data: { startsAt: new Date(Date.now() - 1000) } });
  await services.auctions.runDue();
  const buyer = await customer('Claim Bidder');
  await buyer.post(`${lotPath(lot)}/bids`, { amount: owed + 300_000 });
  await prisma.connectAuction.update({ where: { id: lot.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  await services.auctions.runDue();
  await fund(buyer, owed + 300_000);
  const paid = (await buyer.post(`${lotPath(lot)}/pay`)).json;
  assert.equal(paid.viewer.won, true, JSON.stringify(paid));
  const row = await prisma.connectAuction.findUniqueOrThrow({ where: { id: lot.id } });
  assert.ok(row.claimBy > new Date(Date.now() + 89 * 86_400_000), "the market's 90 days to claim");
  return { item, lot, buyer, leftOver: row.leftOverMinor };
}

describe('Claims on what an auction left over', () => {
  test('the seller claims from their order; finance rejects, then pays it into their Udozo money; a claim waiting is never swept', async () => {
    const { item, lot, buyer, leftOver } = await soldLot('Claim Hub');
    assert.ok(leftOver > 0n);
    const order = (await item.seller.get(`/v1/classifieds/orders/${item.order.id}`)).json;
    assert.deepEqual([order.connect.auction.number, order.connect.auction.left_over, order.connect.auction.claim], [lot.number, Number(leftOver), null]);
    const claimPath = `/v1/classifieds/orders/${item.order.id}/auction-claim`;
    assert.equal((await buyer.post(claimPath, {})).status, 404, 'only its seller claims');

    const filed = (await item.seller.post(claimPath, { note: 'My TV' })).json;
    assert.deepEqual([filed.status, filed.amount, filed.number.slice(0, 3)], ['requested', Number(leftOver), 'CL-']);
    assert.equal((await item.seller.post(claimPath, {})).json.error.code, 'claim_exists');
    const listed = (await admin.get('/v1/admin/connect/claims?status=requested')).json.data.find(row => row.id === filed.id);
    assert.equal(listed.seller.id, item.seller.id);

    const rejected = (await admin.post(`/v1/admin/connect/claims/${filed.id}/reject`, { reason: 'Send a photo of your ID first.' })).json;
    assert.equal(rejected.status, 'rejected');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: item.seller.id, title: { contains: 'claim was not paid' } } }));
    assert.equal((await admin.post(`/v1/admin/connect/claims/${filed.id}/pay`, {})).json.error.code, 'claim_decided');

    const again = (await item.seller.post(claimPath, {})).json;
    assert.equal(again.status, 'requested', 'claimed again within the days');
    // The days end while it waits for finance: never swept.
    await prisma.connectAuction.update({ where: { id: lot.id }, data: { claimBy: new Date(Date.now() - 1000) } });
    assert.equal((await services.claims.runDue()).unclaimed, 0);

    const held = await balance('connect_auction_held');
    const money = await balance('customer_withdrawable', item.seller.id);
    const paid = (await admin.post(`/v1/admin/connect/claims/${again.id}/pay`, { note: 'ID checked' })).json;
    assert.equal(paid.status, 'paid', JSON.stringify(paid));
    assert.equal(held - (await balance('connect_auction_held')), leftOver);
    assert.equal((await balance('customer_withdrawable', item.seller.id)) - money, leftOver, "into the seller's Udozo money");
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'connect_auction_claim.paid', targetId: again.id } }));
    assert.equal((await item.seller.get(`/v1/classifieds/orders/${item.order.id}`)).json.connect.auction.claim.status, 'paid');
    assert.equal((await services.claims.runDue()).unclaimed, 0, 'a paid claim is never swept');
  });

  test("reminded once a week before the days end, then unclaimed money becomes Udozo's", async () => {
    const { item, lot, leftOver } = await soldLot('Unclaimed Hub');
    await prisma.connectAuction.update({ where: { id: lot.id }, data: { claimBy: new Date(Date.now() + 3 * 86_400_000) } });
    assert.ok((await services.claims.runDue()).reminded >= 1);
    assert.equal(await prisma.notification.count({ where: { customerId: item.seller.id, title: { contains: 'Claim what' } } }), 1);
    await services.claims.runDue();
    assert.equal(await prisma.notification.count({ where: { customerId: item.seller.id, title: { contains: 'Claim what' } } }), 1, 'reminded once');

    await prisma.connectAuction.update({ where: { id: lot.id }, data: { claimBy: new Date(Date.now() - 1000) } });
    const held = await balance('connect_auction_held');
    const revenue = await balance('connect_revenue');
    assert.ok((await services.claims.runDue()).unclaimed >= 1);
    assert.equal(held - (await balance('connect_auction_held')), leftOver);
    assert.equal((await balance('connect_revenue')) - revenue, leftOver, "Udozo's");
    assert.ok((await prisma.connectAuction.findUniqueOrThrow({ where: { id: lot.id } })).unclaimedAt);
    assert.equal((await services.claims.runDue()).unclaimed, 0, 'once');
    assert.equal((await item.seller.post(`/v1/classifieds/orders/${item.order.id}/auction-claim`, {})).json.error.code, 'claim_window_closed');
    assert.ok((await item.seller.get(`/v1/classifieds/orders/${item.order.id}`)).json.connect.auction.unclaimed_at);
  });
});
