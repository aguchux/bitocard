// Udozo auctions as a way to sell (docs/UDOZO_AUCTIONS_PLAN.md, slice 1): a seller posts a listing sold by auction (a
// starting price, an optional hidden reserve, a length), its lot opens as it goes live, people bid on its page, the
// highest bid at or above the reserve is offered it and pays with UdozoPay as an ordinary order already accepted, an
// unpaid offer passes to the next bidder at or above the reserve, and an unsold listing expires until it is renewed.
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
    auctions: server.app.get((await import('../dist/classifieds/listing-auctions.service.js')).ListingAuctionsService),
  };
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_safe_pay']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  assert.equal((await admin.put('/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150, buyer_fee_cap: 100000, seller_fee_bps: 200, seller_fee_cap: 500000 })).status, 200);
  const [tvs, gwarinpa] = await Promise.all([
    prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }),
    prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'gwarinpa' } }),
  ]);
  place = { tvs: tvs.id, gwarinpa };
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
        ...(method === 'POST' ? { 'idempotency-key': `auction-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), delete: path => request('DELETE', path) };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `listingauction${(counter += 1)}-${Date.now()}@example.com`;
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

/** A draft TV for auction at ₦100,000, its photos in place. */
async function draft(seller, extra = {}) {
  const made = (await seller.post('/v1/classifieds/listings', { title: `Sony TV ${counter}`, price: 10_000_000, condition: 'used', category_id: place.tvs, area_id: place.gwarinpa.id, sale_method: 'auction', auction_days: 3, ...extra })).json;
  assert.ok(made.id, JSON.stringify(made));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: made.id, kind: 'photo', position, url: `https://media.test/${made.id}-${position}.jpg` })) });
  return made;
}

const switchAuctions = enabled => admin.put('/v1/admin/switches/classifieds_auctions', { country_code: 'NG', enabled });
const page = listing => fetch(`${server.base}/v1/classifieds/listings/${listing.ref}?country=NG`).then(res => res.json());
const lotOf = listing => prisma.connectAuction.findFirstOrThrow({ where: { listingId: listing.id }, orderBy: { createdAt: 'desc' } });

describe('Selling by auction', () => {
  test('posting: the market must allow it, the seller be ready for UdozoPay, and the reserve be at least the start', async () => {
    const seller = await customer('Chinedu Okafor');
    assert.equal((await seller.post('/v1/classifieds/listings', { title: 'Bad reserve', price: 10_000_000, sale_method: 'auction', auction_reserve: 5_000_000 })).json.error.code, 'reserve_below_start');
    assert.equal((await seller.post('/v1/classifieds/listings', { title: 'Bad length', price: 10_000_000, sale_method: 'auction', auction_days: 4 })).json.error.code, 'parameter_invalid');
    const listing = await draft(seller, { stock: 5 });
    assert.deepEqual([listing.sale_method, listing.auction_days, listing.stock], ['auction', 3, 1], 'one item at auction');

    await switchAuctions(false);
    assert.equal((await seller.post(`/v1/classifieds/listings/${listing.id}/submit`)).json.error.code, 'auctions_unavailable');
    await switchAuctions(true);
    assert.equal((await seller.post(`/v1/classifieds/listings/${listing.id}/submit`)).json.error.code, 'seller_not_ready');
    await ready(seller);
    const live = (await seller.post(`/v1/classifieds/listings/${listing.id}/submit`)).json;
    assert.equal(live.status, 'active', JSON.stringify(live));

    const lot = await lotOf(listing);
    assert.deepEqual([lot.kind, lot.status, lot.startPriceMinor], ['listing', 'live', 10_000_000n]);
    assert.ok(Math.abs(lot.endsAt.getTime() - Date.now() - 3 * 86_400_000) < 60_000, 'three days');
    const shown = await page(listing);
    assert.deepEqual([shown.sale_method, shown.auction.next_bid, shown.auction.reserve_met], ['auction', 10_000_000, null]);
    assert.equal(shown.auction_reserve, undefined, 'the reserve is never public');
  });

  test('bidding on its page; offers, buy orders and fixed-price UdozoPay refused; fixed once bid on', async () => {
    const seller = await customer('Amaka Obi');
    await ready(seller);
    await switchAuctions(true);
    const listing = await draft(seller, { auction_reserve: 15_000_000 });
    await seller.post(`/v1/classifieds/listings/${listing.id}/submit`);
    const alice = await customer('Alice Bidder');
    const bola = await customer('Bola Bidder');

    assert.equal((await seller.post(`/v1/classifieds/listings/${listing.id}/bids`, { amount: 10_000_000 })).json.error.code, 'own_item');
    assert.equal((await alice.get(`/v1/classifieds/listings/${listing.id}/safe-pay`)).json.error.code, 'auction_not_won');
    const chat = (await alice.post('/v1/classifieds/conversations', { listing_id: listing.id, body: 'Is it still for sale?' })).json;
    const chatId = chat.conversation?.id ?? chat.id;
    assert.ok(chatId, JSON.stringify(chat));
    assert.equal((await alice.post(`/v1/classifieds/conversations/${chatId}/offers`, { price: 9_000_000 })).json.error.code, 'auction_listing');

    const first = (await alice.post(`/v1/classifieds/listings/${listing.id}/bids`, { amount: 10_000_000 })).json;
    assert.deepEqual([first.viewer.leading, first.reserve_met, first.next_bid], [true, false, 10_500_000], '5% above, at least ₦500');
    assert.equal((await bola.post(`/v1/classifieds/listings/${listing.id}/bids`, { amount: 10_400_000 })).json.error.code, 'bid_too_low');
    const second = (await bola.post(`/v1/classifieds/listings/${listing.id}/bids`, { amount: 16_000_000 })).json;
    assert.deepEqual([second.viewer.leading, second.reserve_met, second.recent_bids[0].name], [true, true, 'Bola B.']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: alice.id, title: { contains: 'outbid' } } }));

    assert.equal((await seller.patch(`/v1/classifieds/listings/${listing.id}`, { price: 20_000_000 })).json.error.code, 'auction_has_bids');
    assert.equal((await seller.delete(`/v1/classifieds/listings/${listing.id}`)).json?.error?.code, 'auction_has_bids');
    assert.equal((await seller.post(`/v1/classifieds/listings/${listing.id}/sold`)).json.error.code, 'auction_running');
    const viewer = (await alice.get(`/v1/classifieds/listings/${listing.id}/viewer`)).json;
    assert.deepEqual([viewer.auction.viewer.highest, viewer.auction.viewer.leading], [10_000_000, false]);
  });

  test('the highest bid at or above the reserve wins and pays with UdozoPay; unpaid, it passes on; paid and handed over, sold', async () => {
    const seller = await customer('Emeka Nwosu');
    await ready(seller);
    await switchAuctions(true);
    const listing = await draft(seller, { auction_reserve: 12_000_000 });
    await seller.post(`/v1/classifieds/listings/${listing.id}/submit`);
    const [alice, bola, carl] = [await customer('Alice Low'), await customer('Bola Mid'), await customer('Carl High')];
    await alice.post(`/v1/classifieds/listings/${listing.id}/bids`, { amount: 10_000_000 });
    await bola.post(`/v1/classifieds/listings/${listing.id}/bids`, { amount: 13_000_000 });
    await carl.post(`/v1/classifieds/listings/${listing.id}/bids`, { amount: 14_000_000 });

    await prisma.connectAuction.updateMany({ where: { listingId: listing.id }, data: { startsAt: new Date(Date.now() - 2000), endsAt: new Date(Date.now() - 1000) } });
    await services.auctions.runDue();
    assert.equal((await carl.get(`/v1/classifieds/listings/${listing.id}/viewer`)).json.auction.viewer.to_pay.amount, 14_000_000);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: carl.id, title: { contains: 'You won' } } }));
    assert.equal((await bola.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json.error.code, 'auction_not_won');

    // Carl asks with UdozoPay: already accepted, at his bid; then lets the time to pay pass.
    const asked = (await carl.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json;
    assert.deepEqual([asked.status, asked.price], ['awaiting_payment', 14_000_000], JSON.stringify(asked));
    await prisma.connectAuction.updateMany({ where: { listingId: listing.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await services.auctions.runDue();
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: asked.id } })).status, 'lapsed');

    // Offered to Bola (above the reserve), never to Alice (below it).
    const offer = (await bola.get(`/v1/classifieds/listings/${listing.id}/viewer`)).json.auction.viewer.to_pay;
    assert.equal(offer.amount, 13_000_000);
    const order = (await bola.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json;
    await fund(bola, 20_000_000);
    const paid = (await bola.post(`/v1/classifieds/orders/${order.id}/pay`)).json;
    assert.equal(paid.status, 'paid', JSON.stringify(paid));
    const lot = await lotOf(listing);
    assert.deepEqual([lot.status, lot.buyerId, lot.saleMinor], ['sold', bola.id, 13_000_000n]);

    const code = (await bola.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/release`, { code })).json.status, 'released');
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: listing.id } })).status, 'sold', 'sold, not out of stock');
  });

  test('no bid at the reserve: unsold, the listing expires, and renewing it auctions it again', async () => {
    const seller = await customer('Funmi Bello');
    await ready(seller);
    await switchAuctions(true);
    const listing = await draft(seller, { auction_reserve: 50_000_000 });
    await seller.post(`/v1/classifieds/listings/${listing.id}/submit`);
    const alice = await customer('Alice Short');
    await alice.post(`/v1/classifieds/listings/${listing.id}/bids`, { amount: 10_000_000 });
    await prisma.connectAuction.updateMany({ where: { listingId: listing.id }, data: { startsAt: new Date(Date.now() - 2000), endsAt: new Date(Date.now() - 1000) } });
    await services.auctions.runDue();
    assert.equal((await lotOf(listing)).status, 'unsold');
    const expired = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: listing.id } });
    assert.deepEqual([expired.status, expired.expiredReason], ['expired', 'auction_unsold']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: seller.id, title: { contains: 'did not sell' } } }));

    const renewed = (await seller.post(`/v1/classifieds/listings/${listing.id}/renew`)).json;
    assert.equal(renewed.status, 'active', JSON.stringify(renewed));
    const lot = await lotOf(listing);
    assert.deepEqual([lot.status, await prisma.connectAuction.count({ where: { listingId: listing.id } })], ['live', 2], 'a new lot');
  });
});
