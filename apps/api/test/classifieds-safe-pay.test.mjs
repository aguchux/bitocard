// BitoCard Shop, phase 1 step 4: Safe pay. The buyer asks (their fee fixed, capped), the seller accepts once checked,
// the buyer pays from the wallet into escrow, hand-over by release code or delivery, release with both fees to revenue,
// refunds in full when cancelled or not handed over, disputes decided by BitoCard, and deadlines in the job.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let prisma;
let admin;
let services;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  services = {
    safePay: server.app.get((await import('../dist/classifieds/safe-pay.service.js')).SafePayService),
    ledger: server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService),
    house: server.app.get((await import('../dist/checkout/house.service.js')).HouseService),
  };
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
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
        ...(method === 'POST' ? { 'idempotency-key': `shop-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `safepay${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  // The BitoCard Shop terms, accepted before posting or Safe pay.
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  shopper.name = name;
  return shopper;
}

/** A seller who has passed the identity check and added a payout bank account (live). */
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

async function live(seller, title, { price = 25000000, delivery = 'none' } = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price, condition: 'used', category_id: cat.id, area_id: area.id, delivery })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

/** Requested, accepted and paid: a meet-up order in escrow. */
async function paidOrder(title, extra = {}) {
  const seller = await customer('Chinedu Okafor');
  const buyer = await customer('Kemi Adeyemi');
  await ready(seller);
  const listing = await live(seller, title, extra);
  const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: extra.delivery && extra.delivery !== 'none' ? 'delivery' : 'meet_up', ...(extra.address ? { delivery_address: extra.address } : {}) })).json;
  assert.equal(order.status, 'requested', JSON.stringify(order));
  assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/accept`)).json.status, 'awaiting_payment');
  await fund(buyer, order.total);
  assert.equal((await buyer.post(`/v1/classifieds/orders/${order.id}/pay`)).json.status, 'paid');
  return { seller, buyer, listing, order };
}

describe('Safe pay', () => {
  test('closed until the switch is on and finance sets both fees', async () => {
    const seller = await customer('Ada Eze');
    const buyer = await customer('Musa Bello');
    const listing = await live(seller, 'LG 43 inch TV');
    assert.equal((await buyer.get(`/v1/classifieds/listings/${listing.id}/safe-pay`)).json.error.code, 'safe_pay_unavailable');
    assert.equal((await admin.put('/v1/admin/switches/classifieds_safe_pay', { country_code: 'NG', enabled: true })).status, 200);
    assert.match((await buyer.get(`/v1/classifieds/listings/${listing.id}/safe-pay`)).json.error.message, /not set up/);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150 })).status, 403, 'finance sets fees');
    const set = await admin.put('/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150, buyer_fee_cap: 100000, seller_fee_bps: 200, seller_fee_cap: 500000, new_seller_order_limit: 50000000 });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.ready, true);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.safe_pay_settings_changed' } }), 1);

    const quote = await buyer.get(`/v1/classifieds/listings/${listing.id}/safe-pay`);
    assert.deepEqual([quote.json.price, quote.json.buyer_fee, quote.json.total], [25000000, 100000, 25100000], '1.5% capped at ₦1,000');
    assert.ok(quote.json.accept_hours > 0 && quote.json.pay_hours > 0, 'the time limits the buyer is told');
    assert.deepEqual(quote.json.fulfilment, ['meet_up'], 'no delivery offered: meet in person');
    assert.equal((await seller.get(`/v1/classifieds/listings/${listing.id}/safe-pay`)).json.error.param, 'listing_id', 'not your own');
  });

  test('a meet-up: the seller checks in, the buyer pays into escrow, the release code pays the seller', async () => {
    const seller = await customer('Chinedu Okafor');
    const buyer = await customer('Kemi Adeyemi');
    const listing = await live(seller, 'Hisense 50 inch TV');
    const order = await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' });
    assert.equal(order.status, 201, JSON.stringify(order.json));
    assert.match(order.json.number, /^SP-\d{6}$/);
    assert.deepEqual([order.json.buyer_fee, order.json.total, order.json.seller_fee], [100000, 25100000, undefined], 'the buyer never sees the seller\'s fee');
    assert.equal((await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json.error.code, 'order_exists');

    const notReady = await seller.post(`/v1/classifieds/orders/${order.json.id}/accept`);
    assert.deepEqual([notReady.json.error.code, notReady.json.error.param], ['seller_not_ready', 'identity']);
    assert.deepEqual((await seller.get('/v1/classifieds/me/safe-pay')).json, { object: 'classified_safe_pay_readiness', identity_checked: false, payout_account: false, ready: false, limited: false, strikes: 0, strike_limit: 3 });
    await ready(seller);
    assert.equal((await buyer.post(`/v1/classifieds/orders/${order.json.id}/accept`)).json.error.code, 'order_not_yours');
    const accepted = await seller.post(`/v1/classifieds/orders/${order.json.id}/accept`);
    assert.deepEqual([accepted.json.status, accepted.json.seller_fee, accepted.json.payout, accepted.json.buyer_fee], ['awaiting_payment', 500000, 24500000, undefined], 'the seller sees their fee and payout, never the buyer\'s fee');

    const low = await buyer.post(`/v1/classifieds/orders/${order.json.id}/pay`);
    assert.deepEqual([low.status, low.json.error.code], [402, 'wallet_balance_low']);
    assert.match(low.json.error.message, /₦251,000/);
    await fund(buyer, 25100000);
    const escrowBefore = await balance('classified_escrow');
    const paid = await buyer.post(`/v1/classifieds/orders/${order.json.id}/pay`);
    assert.equal(paid.json.status, 'paid');
    assert.equal(await balance('customer_wallet', buyer.id), 0n);
    assert.equal((await balance('classified_escrow')) - escrowBefore, 25100000n);
    assert.equal((await storeServer().get(`/v1/classifieds/listings/${listing.ref}?country=NG`)).json.reserved, true);
    assert.equal((await (await customer('Tunde Bakare')).post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json.error.code, 'listing_reserved');

    assert.equal((await seller.get(`/v1/classifieds/orders/${order.json.id}/release-code`)).json.error.code, 'order_not_yours', 'the seller never sees the code');
    const code = (await buyer.get(`/v1/classifieds/orders/${order.json.id}/release-code`)).json.code;
    assert.match(code, /^\d{6}$/);
    const wrong = await seller.post(`/v1/classifieds/orders/${order.json.id}/release`, { code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.json.error.code, 'release_code_wrong');
    assert.match(wrong.json.error.message, /4 tries left/);

    const revenueBefore = await balance('classifieds_revenue');
    const released = await seller.post(`/v1/classifieds/orders/${order.json.id}/release`, { code });
    assert.deepEqual([released.json.status, released.json.seller_fee, released.json.payout], ['released', 500000, 24500000]);
    assert.equal(await balance('customer_withdrawable', seller.id), 24500000n, 'the price less the seller\'s fee, withdrawable after the payout hold');
    assert.equal((await balance('classifieds_revenue')) - revenueBefore, 600000n, 'both fees');
    assert.equal((await balance('classified_escrow')) - escrowBefore, 0n);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: listing.id } })).status, 'sold');
    assert.equal(await prisma.journalEntry.count({ where: { reference: `classified_order:${order.json.id}:released`, type: 'classified_release' } }), 1);
    assert.equal(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.order_released' } }), 1);
  });

  test('five wrong codes lock the release', async () => {
    const { seller, buyer, order } = await paidOrder('Samsung 43 inch TV');
    const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let n = 0; n < 5; n += 1) assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/release`, { code: wrong })).json.error.code, 'release_code_wrong');
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/release`, { code })).json.error.code, 'release_locked');
  });

  test('a delivery: the address only once paid, sent, then released by itself when not confirmed in time', async () => {
    const seller = await customer('Bisi Ola');
    const buyer = await customer('Yemi Ade');
    await ready(seller);
    const listing = await live(seller, 'Sony 40 inch TV', { delivery: 'state' });
    const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'delivery', delivery_address: '12 Adetokunbo Ademola Crescent, Wuse 2, Abuja' })).json;
    assert.equal((await seller.get(`/v1/classifieds/orders/${order.id}`)).json.delivery_address, null, 'not before payment');
    await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
    await fund(buyer, order.total);
    await buyer.post(`/v1/classifieds/orders/${order.id}/pay`);
    assert.match((await seller.get(`/v1/classifieds/orders/${order.id}`)).json.delivery_address, /Wuse 2/);
    assert.equal((await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.error.code, 'release_code_unavailable');

    const sent = await seller.post(`/v1/classifieds/orders/${order.id}/sent`, { tracking_note: 'GIG Logistics, waybill 4471' });
    assert.equal(sent.json.status, 'sent');
    assert.equal((await buyer.post(`/v1/classifieds/orders/${order.id}/cancel`)).json.error.code, 'order_handed_over');
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { confirmBy: new Date(Date.now() - 1000) } });
    assert.ok((await services.safePay.runDue()).released >= 1);
    assert.equal((await buyer.get(`/v1/classifieds/orders/${order.id}`)).json.status, 'released');
  });

  test('cancelled once paid, or not handed over in time: the buyer is refunded in full, fee included', async () => {
    const first = await paidOrder('Toshiba 55 inch TV');
    const cancelled = await first.seller.post(`/v1/classifieds/orders/${first.order.id}/cancel`, { reason: 'It broke' });
    assert.equal(cancelled.json.status, 'refunded');
    assert.equal(await balance('customer_wallet', first.buyer.id), BigInt(first.order.total));
    assert.equal((await first.buyer.get(`/v1/classifieds/orders/${first.order.id}`)).json.refund, first.order.total);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: first.listing.id } })).status, 'active', 'the listing is free again');

    const second = await paidOrder('Philips 50 inch TV');
    await prisma.classifiedOrder.update({ where: { id: second.order.id }, data: { handoverBy: new Date(Date.now() - 1000) } });
    assert.ok((await services.safePay.runDue()).refunded >= 1);
    const refunded = (await second.buyer.get(`/v1/classifieds/orders/${second.order.id}`)).json;
    assert.deepEqual([refunded.status, refunded.ended_by, refunded.end_reason], ['refunded', 'bitocard', 'not_handed_over']);
    assert.equal(await balance('customer_wallet', second.buyer.id), BigInt(second.order.total));
  });

  test('requests not answered or not paid in time lapse; paying closes other buyers\' requests', async () => {
    const seller = await customer('Gbenga Lawal');
    await ready(seller);
    const listing = await live(seller, 'TCL 65 inch TV');
    const [early, late, slow] = [await customer('Ifeoma Nwosu'), await customer('Halima Yusuf'), await customer('Emeka Obi')];
    const orders = [];
    for (const buyer of [early, late, slow]) orders.push((await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json);

    await prisma.classifiedOrder.update({ where: { id: orders[2].id }, data: { acceptBy: new Date(Date.now() - 1000) } });
    await services.safePay.runDue();
    assert.deepEqual([(await slow.get(`/v1/classifieds/orders/${orders[2].id}`)).json.status, (await slow.get(`/v1/classifieds/orders/${orders[2].id}`)).json.end_reason], ['lapsed', 'not_accepted_in_time']);

    await seller.post(`/v1/classifieds/orders/${orders[0].id}/accept`);
    await seller.post(`/v1/classifieds/orders/${orders[1].id}/accept`);
    await fund(early, orders[0].total);
    await early.post(`/v1/classifieds/orders/${orders[0].id}/pay`);
    const closed = (await late.get(`/v1/classifieds/orders/${orders[1].id}`)).json;
    assert.deepEqual([closed.status, closed.end_reason], ['cancelled', 'reserved_for_another_buyer']);
    assert.equal(await prisma.notification.count({ where: { customerId: late.id, type: 'customer.classifieds.order_cancelled' } }), 1);
  });

  test('an accepted offer sets the price; the new-seller limit applies to their first five sales', async () => {
    const seller = await customer('Rita Okon');
    const buyer = await customer('Ngozi Eke');
    const listing = await live(seller, 'Panasonic 50 inch TV', { price: 30000000 });
    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: listing.id, body: 'Would you take ₦280,000?' })).json;
    const offer = (await buyer.post(`/v1/classifieds/conversations/${chat.id}/offers`, { price: 28000000 })).json;
    assert.equal((await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, offer_id: offer.id, fulfilment: 'meet_up' })).json.error.code, 'offer_not_accepted');
    await seller.post(`/v1/classifieds/offers/${offer.id}/accept`);
    const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, offer_id: offer.id, fulfilment: 'meet_up' })).json;
    assert.equal(order.price, 28000000);
    const note = await prisma.classifiedMessage.findFirst({ where: { conversationId: chat.id, kind: 'system', body: { contains: 'Safe pay' } } });
    assert.ok(note, 'the request is noted in the chat');

    const big = await live(seller, 'Samsung 85 inch QLED TV', { price: 90000000 });
    const limited = await buyer.post('/v1/classifieds/orders', { listing_id: big.id, fulfilment: 'meet_up' });
    assert.equal(limited.json.error.code, 'new_seller_limit');
    assert.match(limited.json.error.message, /₦500,000/);
  });

  test('a dispute stops the release; BitoCard decides a part refund (finance), audited', async () => {
    const { seller, buyer, order } = await paidOrder('LG 55 inch OLED TV');
    assert.equal((await buyer.post(`/v1/classifieds/orders/${order.id}/dispute`, { reason: 'not_as_described', details: 'Bad' })).json.error.param, 'details');
    const opened = await buyer.post(`/v1/classifieds/orders/${order.id}/dispute`, { reason: 'not_as_described', details: 'The screen has a crack it did not show.' });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.equal(opened.json.status, 'disputed');
    const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json;
    assert.equal(code.error.code, 'release_code_unavailable', 'no release while disputed');
    assert.equal(await prisma.notification.count({ where: { type: 'admin.classifieds.dispute_opened' } }) > 0, true);

    await seller.post(`/v1/classifieds/orders/${order.id}/dispute/messages`, { body: 'It was fine when they saw it.' });
    const thread = await buyer.get(`/v1/classifieds/orders/${order.id}/dispute`);
    assert.deepEqual(thread.json.messages.map(message => message.from), ['me', 'them']);
    await admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/messages`, { body: 'Please both send photos.' });
    const seen = (await admin.get(`/v1/admin/classifieds/orders/${order.id}`)).json;
    assert.deepEqual(seen.rates, { buyer_fee_bps: 150, buyer_fee_cap: 100000, seller_fee_bps: 200, seller_fee_cap: 500000 }, 'admins see the rates fixed on the order');

    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'refund', note: 'Cracked' })).json.error.code, 'finance_required');
    assert.equal((await admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'partial', refund: 25000000, note: 'x x' })).json.error.param, 'refund', 'less than the price');

    const sellerBefore = await balance('customer_withdrawable', seller.id);
    const decided = await admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'partial', refund: 5000000, note: 'Crack confirmed from photos; part refund agreed.' });
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
    assert.deepEqual([decided.json.status, decided.json.dispute.decision, decided.json.dispute.refund], ['partly_refunded', 'partial', 5000000]);
    assert.equal(await balance('customer_wallet', buyer.id), 5000000n, 'part of the price back, the buyer\'s fee kept');
    assert.equal((await balance('customer_withdrawable', seller.id)) - sellerBefore, 20000000n - 400000n, 'the rest less 2% of it');
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.dispute_decided', targetId: order.id } }), 1);
    assert.equal((await admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'release', note: 'again' })).json.error.code, 'dispute_closed');
    assert.equal(await prisma.notification.count({ where: { customerId: buyer.id, type: 'customer.classifieds.dispute_decided' } }), 1);
  });

  test('asking and accepting need the current BitoCard Shop terms accepted', async () => {
    const seller = await customer('Funke Ade');
    const buyer = await customer('Segun Bello');
    await ready(seller);
    const listing = await live(seller, 'Skyworth 43 inch TV');
    await prisma.classifiedTermsAcceptance.deleteMany({ where: { customerId: { in: [buyer.id, seller.id] } } });
    const asked = await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' });
    assert.deepEqual([asked.status, asked.json.error.code], [409, 'terms_not_accepted']);
    const version = (await buyer.get('/v1/classifieds/terms')).json.version;
    await buyer.post('/v1/classifieds/terms/accept', { version });
    const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json;
    assert.equal(order.status, 'requested', JSON.stringify(order));
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/accept`)).json.error.code, 'terms_not_accepted');
    await seller.post('/v1/classifieds/terms/accept', { version });
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/accept`)).json.status, 'awaiting_payment');
  });

  test('admins list and read orders; each side lists its own', async () => {
    const { seller, buyer, order } = await paidOrder('Haier 32 inch TV');
    const listed = await admin.get(`/v1/admin/classifieds/orders?q=${order.number}`);
    assert.equal(listed.json.total, 1);
    assert.equal(listed.json.data[0].buyer.id, buyer.id);
    assert.equal(listed.json.data[0].buyer_fee, 100000);
    assert.equal((await buyer.get('/v1/classifieds/orders?role=buying')).json.data[0].id, order.id);
    assert.equal((await seller.get('/v1/classifieds/orders?role=buying')).json.total, 0);
    assert.equal((await (await customer('Lola Ige')).get(`/v1/classifieds/orders/${order.id}`)).status, 404);
  });
});

describe('Safe pay protections', () => {
  /** A BitoCard Verify case for the customer with these details. */
  async function verifyCase(customer, details) {
    const house = await services.house.resellerFor('NG');
    const check = await prisma.identityVerification.create({
      data: { subject: 'customer', resellerId: house.id, mode: 'live', customerReference: customer.id, method: 'document', provider: 'bitocard', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date() },
    });
    await prisma.kycCase.create({ data: { verificationId: check.id, subject: 'customer', kind: 'kyc', mode: 'live', country: 'NG', resellerId: house.id, customerReference: customer.id, status: 'approved', ...details } });
  }

  test('the same verified person cannot be buyer and seller: by ID document, name and birth date, or bank account', async () => {
    const seller = await customer('Amaka Obi');
    const listing = await live(seller, 'Hisense 32 inch TV');
    const twin = await customer('Amaka N. Obi');
    await verifyCase(seller, { idFingerprint: 'fp-amaka', fullName: 'Amaka Obi', dateOfBirth: '1990-04-01' });
    await verifyCase(twin, { idFingerprint: 'fp-amaka' });
    const refused = await twin.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'same_person']);
    assert.doesNotMatch(refused.json.error.message, /document|bank|name/, 'never says how they matched');
    assert.equal((await prisma.notification.count({ where: { type: 'admin.classifieds.same_person' } })) > 0, true);

    const named = await customer('Obi Amaka');
    await verifyCase(named, { idFingerprint: 'fp-other', fullName: 'OBI  amaka', dateOfBirth: '1990-04-01' });
    assert.equal((await named.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json.error.code, 'same_person');

    const { Encryption } = await import('../dist/common/encryption.js');
    const { IntegrationsService } = await import('../dist/integrations/integrations.service.js');
    const sealed = new Encryption(server.app.get(IntegrationsService).env.ENCRYPTION_KEY);
    const account = (customerId, name) => ({ customerId, mode: 'live', country: 'NG', currency: 'NGN', bankCode: '058', bankName: 'GTBank', accountNumberEncrypted: sealed.encrypt('0123456789'), accountNumberLast4: '6789', accountName: name, payoutsFrom: new Date() });
    const banked = await customer('Chuka Eze');
    await prisma.customerBankAccount.create({ data: account(seller.id, 'Amaka Obi') });
    await prisma.customerBankAccount.create({ data: account(banked.id, 'Chuka Eze') });
    assert.equal((await banked.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json.error.code, 'same_person');

    const stranger = await customer('Femi Ade');
    await verifyCase(stranger, { idFingerprint: 'fp-femi', fullName: 'Femi Ade', dateOfBirth: '1992-01-01' });
    assert.equal((await stranger.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).status, 201);
  });

  test('a seller with three strikes in 90 days cannot take Safe pay orders until an admin lifts it', async () => {
    const seller = await customer('Bayo Ola');
    await ready(seller);
    for (const n of [1, 2, 3]) {
      const buyer = await customer(`Strike Buyer ${n}`);
      const listing = await live(seller, `Sony ${40 + n} inch TV`);
      const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json;
      await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
      assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/cancel`, { reason: 'Changed my mind' })).json.status, 'cancelled');
    }
    const readiness = (await seller.get('/v1/classifieds/me/safe-pay')).json;
    assert.deepEqual([readiness.limited, readiness.strikes, readiness.strike_limit, readiness.ready], [true, 3, 3, false]);
    assert.equal(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.safe_pay_limited' } }), 1);
    assert.equal((await prisma.notification.count({ where: { type: 'admin.classifieds.seller_limited' } })) > 0, true);

    const buyer = await customer('Next Buyer');
    const listing = await live(seller, 'Sony 50 inch TV');
    const refused = await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' });
    assert.equal(refused.json.error.code, 'safe_pay_limited');
    assert.match(refused.json.error.message, /still chat/);

    assert.equal((await admin.get(`/v1/admin/classifieds/sellers/${seller.id}/safe-pay`)).json.cancelled_after_accepting, 3);
    const cleared = await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/safe-pay/clear`, { reason: 'Stock problem, now fixed' });
    assert.deepEqual([cleared.json.strikes, cleared.json.limited], [0, false]);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.safe_pay_limit_cleared', targetId: seller.id } }), 1);
    assert.equal((await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).status, 201);
  });

  test('paid from a recent card top-up: the payout to the seller waits for finance', async () => {
    const seller = await customer('Dapo Bello');
    const buyer = await customer('Card Buyer');
    await ready(seller);
    const house = await services.house.resellerFor('NG');
    await prisma.payment.create({ data: { resellerId: house.id, customerId: buyer.id, mode: 'live', purpose: 'customer_top_up', provider: 'stripe', reference: `bc_test_${randomUUID()}`, amountMinor: 30000000n, currency: 'NGN', status: 'succeeded', completedAt: new Date() } });
    const listing = await live(seller, 'Samsung 40 inch TV', { price: 10000000 });
    const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json;
    await seller.post(`/v1/classifieds/orders/${order.id}/accept`);
    await fund(buyer, order.total);
    await buyer.post(`/v1/classifieds/orders/${order.id}/pay`);
    const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
    const released = (await seller.post(`/v1/classifieds/orders/${order.id}/release`, { code })).json;
    assert.deepEqual([released.status, released.payout_review], ['released', 'pending']);
    assert.equal((await buyer.get(`/v1/classifieds/orders/${order.id}`)).json.payout_review, null, 'the buyer never sees it');
    assert.equal((await prisma.notification.count({ where: { type: 'admin.classifieds.payout_review' } })) > 0, true);

    // With no payout hold in the market, only the review holds it.
    await prisma.country.update({ where: { code: 'NG' }, data: { payoutHoldDays: 0 } });
    try {
      const cash = await seller.get('/v1/store/crypto/cash');
      assert.equal(cash.status, 200, JSON.stringify(cash.json));
      assert.deepEqual([cash.json.held, cash.json.available], [released.payout, 0]);
      const finance = await adminClient(server, ['finance']);
      const approved = await finance.post(`/v1/admin/classifieds/orders/${order.id}/payout-review`, { decision: 'approve', note: 'Card payment settled, no dispute.' });
      assert.equal(approved.json.payout_review, 'approved');
      const after = (await seller.get('/v1/store/crypto/cash')).json;
      assert.deepEqual([after.held, after.available], [0, released.payout]);
      assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.payout_review_decided', targetId: order.id } }), 1);
    } finally {
      await prisma.country.update({ where: { code: 'NG' }, data: { payoutHoldDays: 15 } });
    }
    assert.equal((await admin.get('/v1/admin/classifieds/orders?payout_review=approved')).json.data.some(row => row.id === order.id), true);
  });
});
