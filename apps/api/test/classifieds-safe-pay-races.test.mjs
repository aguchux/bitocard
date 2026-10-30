// BitoCard Shop, step 11: Safe pay's money paths under parallel requests, as for P2P trades. Every race leaves each
// order paid at most once and settled at most once (released, refunded or partly refunded, never two), the escrow
// account holding exactly what open orders hold, and the ledger balanced. On PGlite the requests queue on one
// connection; on Docker's Postgres (`npm run test:docker`) they truly race.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let prisma;
let admin;
let services;

before(async () => {
  // BitoCard Shop is Udozo's (docs/UDOZO_SPINOFF_PLAN.md).
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  services = {
    safePay: server.app.get((await import('../dist/classifieds/safe-pay.service.js')).SafePayService),
    ledger: server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService),
    house: server.app.get((await import('../dist/checkout/house.service.js')).HouseService),
  };
  admin = await adminClient(server);
  for (const name of ['classifieds', 'classifieds_safe_pay']) assert.equal((await admin.put(`/v1/admin/switches/${name}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 1000 } });
  const set = await admin.put('/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 150, buyer_fee_cap: 100000, seller_fee_bps: 200, seller_fee_cap: 500000, new_seller_order_limit: 50000000 });
  assert.equal(set.status, 200, JSON.stringify(set.json));
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
        ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
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
async function customer(name = 'Kemi Adeyemi') {
  const shopper = storeServer();
  const email = `race${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  // The BitoCard Shop terms, accepted before posting or Safe pay.
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  shopper.name = name;
  return shopper;
}

/** A seller who has passed the identity check and added a payout bank account (live). */
async function readySeller() {
  const seller = await customer(`Chinedu Okafor ${counter}`);
  const house = await services.house.resellerFor('NG');
  await prisma.identityVerification.create({
    data: { subject: 'customer', resellerId: house.id, mode: 'live', customerReference: seller.id, method: 'document', provider: 'test', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: seller.name },
  });
  await prisma.customerBankAccount.create({
    data: { customerId: seller.id, mode: 'live', country: 'NG', currency: 'NGN', bankCode: '044', bankName: 'Access Bank', accountNumberEncrypted: 'sealed', accountNumberLast4: String(1000 + counter).slice(-4), accountName: seller.name, payoutsFrom: new Date() },
  });
  return seller;
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

async function live(seller, title, { delivery = 'none' } = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: area.id, delivery })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

/** Requested and accepted, the buyer funded for it: an order awaiting payment. */
async function acceptedOrder(seller, listing, buyer, fulfilment = 'meet_up') {
  const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment, ...(fulfilment === 'delivery' ? { delivery_address: '12 Adetokunbo Ademola Crescent, Wuse 2, Abuja' } : {}) })).json;
  assert.equal(order.status, 'requested', JSON.stringify(order));
  assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/accept`)).json.status, 'awaiting_payment');
  return order;
}

/** A paid order in escrow: a meet-up, or a delivery the seller has sent. */
async function paidOrder(title, { delivery = false } = {}) {
  const seller = await readySeller();
  const buyer = await customer();
  const listing = await live(seller, title, { delivery: delivery ? 'state' : 'none' });
  const order = await acceptedOrder(seller, listing, buyer, delivery ? 'delivery' : 'meet_up');
  await fund(buyer, order.total);
  assert.equal((await buyer.post(`/v1/classifieds/orders/${order.id}/pay`)).json.status, 'paid');
  if (delivery) {
    await prisma.classifiedDispatchPhoto.createMany({ data: [0, 1].map(index => ({ orderId: order.id, objectKey: `test/dispatch/${order.id}/${index}`, contentType: 'image/jpeg', size: 1000 })) });
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/sent`, { courier: 'GIG Logistics', tracking_number: 'GIG1001' })).json.status, 'sent');
  }
  return { seller, buyer, listing, order };
}

const settledKinds = ['released', 'refunded', 'partly_refunded'];

/** The order's money moved at most once each way: one payment, and at most one settlement of any kind. */
async function movedOnce(orderId) {
  const entries = await prisma.journalEntry.findMany({ where: { reference: { startsWith: `classified_order:${orderId}:` } }, select: { reference: true } });
  const kinds = entries.map(entry => entry.reference.split(':')[2]);
  assert.ok(kinds.filter(kind => kind === 'paid').length <= 1, `paid once: ${kinds}`);
  assert.ok(kinds.filter(kind => settledKinds.includes(kind)).length <= 1, `settled once: ${kinds}`);
  const order = await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (settledKinds.includes(order.status)) assert.deepEqual(kinds.filter(kind => kind !== 'paid'), [order.status], 'the settlement matches the order');
  return order;
}

/** Escrow holds exactly the totals of the orders still holding money, and the whole ledger balances. */
async function conserved() {
  const holding = await prisma.classifiedOrder.findMany({ where: { mode: 'live', status: { in: ['paid', 'sent', 'disputed'] } }, select: { priceMinor: true, buyerFeeMinor: true } });
  assert.equal(await balance('classified_escrow'), holding.reduce((sum, order) => sum + order.priceMinor + order.buyerFeeMinor, 0n));
  assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
}

const codes = results => results.map(res => (res.status < 300 ? res.status : res.json?.error?.code)).sort();

describe('Safe pay under parallel requests', () => {
  test('the same request sent twice at once makes one order', async () => {
    const seller = await readySeller();
    const buyer = await customer();
    const listing = await live(seller, 'TCL 43 inch TV');
    const results = await Promise.all([0, 1, 2].map(() => buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })));
    assert.deepEqual(codes(results), [201, 'order_exists', 'order_exists'], JSON.stringify(results.map(res => res.json)));
    assert.equal(await prisma.classifiedOrder.count({ where: { listingId: listing.id } }), 1);
  });

  test('accepting twice at once: one acceptance', async () => {
    const seller = await readySeller();
    const buyer = await customer();
    const listing = await live(seller, 'Hisense 32 inch TV');
    const order = (await buyer.post('/v1/classifieds/orders', { listing_id: listing.id, fulfilment: 'meet_up' })).json;
    const results = await Promise.all([0, 1].map(() => seller.post(`/v1/classifieds/orders/${order.id}/accept`)));
    assert.deepEqual(codes(results), [200, 'order_changed']);
    assert.equal(await prisma.notification.count({ where: { customerId: buyer.id, type: 'customer.classifieds.order_accepted' } }), 1, 'the buyer is told once');
  });

  test('paying twice at once (a double click): the wallet is charged once', async () => {
    const seller = await readySeller();
    const buyer = await customer();
    const listing = await live(seller, 'LG 50 inch TV');
    const order = await acceptedOrder(seller, listing, buyer);
    await fund(buyer, order.total * 3);
    const results = await Promise.all([0, 1, 2].map(() => buyer.post(`/v1/classifieds/orders/${order.id}/pay`)));
    assert.deepEqual(codes(results), [200, 'order_changed', 'order_changed'], JSON.stringify(results.map(res => res.json)));
    assert.equal(await balance('customer_wallet', buyer.id), BigInt(order.total * 2));
    await movedOnce(order.id);
    await conserved();
  });

  test('two accepted buyers paying for the same item at once: one pays, the other keeps their money', async () => {
    const seller = await readySeller();
    const listing = await live(seller, 'Samsung 55 inch QLED TV');
    const buyers = await Promise.all([customer(), customer(), customer()]);
    const orders = [];
    for (const buyer of buyers) orders.push(await acceptedOrder(seller, listing, buyer));
    await Promise.all(buyers.map((buyer, n) => fund(buyer, orders[n].total)));
    const results = await Promise.all(buyers.map((buyer, n) => buyer.post(`/v1/classifieds/orders/${orders[n].id}/pay`)));
    assert.equal(results.filter(res => res.status === 200).length, 1, JSON.stringify(results.map(res => res.json)));
    for (const res of results.filter(res => res.status !== 200)) assert.ok(['listing_reserved', 'order_changed'].includes(res.json.error.code), JSON.stringify(res.json));
    assert.equal(await prisma.classifiedOrder.count({ where: { listingId: listing.id, status: 'paid' } }), 1);
    for (const [n, buyer] of buyers.entries()) {
      const paid = results[n].status === 200;
      assert.equal(await balance('customer_wallet', buyer.id), paid ? 0n : BigInt(orders[n].total), paid ? 'the winner paid' : 'the others were never charged');
      if (!paid) assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: orders[n].id } })).status, 'cancelled', 'their requests closed: the item is reserved');
    }
    await conserved();
  });

  test('one wallet, two orders paid at once with money for one: one is paid, the other is told to add funds', async () => {
    const buyer = await customer();
    const sellers = await Promise.all([readySeller(), readySeller()]);
    const orders = [];
    for (const [n, seller] of sellers.entries()) orders.push(await acceptedOrder(seller, await live(seller, `Sony ${n + 40} inch TV`), buyer));
    await fund(buyer, orders[0].total);
    const results = await Promise.all(orders.map(order => buyer.post(`/v1/classifieds/orders/${order.id}/pay`)));
    assert.deepEqual(codes(results), [200, 'wallet_balance_low'], JSON.stringify(results.map(res => res.json)));
    assert.equal(results.find(res => res.status !== 200).status, 402);
    assert.equal(await balance('customer_wallet', buyer.id), 0n, 'never below zero');
    for (const order of orders) await movedOnce(order.id);
    await conserved();
  });

  test('the right release code entered twice at once pays the seller once', async () => {
    const { seller, buyer, order } = await paidOrder('Philips 43 inch TV');
    const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
    const results = await Promise.all([0, 1, 2].map(() => seller.post(`/v1/classifieds/orders/${order.id}/release`, { code })));
    assert.equal(results.filter(res => res.status === 200).length, 1, JSON.stringify(results.map(res => res.json)));
    for (const res of results.filter(res => res.status !== 200)) assert.ok(['order_changed', 'release_locked'].includes(res.json.error.code), JSON.stringify(res.json));
    assert.equal(await balance('customer_withdrawable', seller.id), 24500000n, 'the payout once');
    assert.equal(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.order_released' } }), 1);
    assert.equal((await movedOnce(order.id)).status, 'released');
    await conserved();
  });

  test('wrong codes guessed in parallel never get more than five tries', async () => {
    const { seller, buyer, order } = await paidOrder('Haier 50 inch TV');
    const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
    const wrong = code === '000000' ? '111111' : '000000';
    const results = await Promise.all(Array.from({ length: 9 }, () => seller.post(`/v1/classifieds/orders/${order.id}/release`, { code: wrong })));
    assert.deepEqual(codes(results), [...Array(5).fill('release_code_wrong'), ...Array(4).fill('release_locked')]);
    assert.equal((await prisma.classifiedOrder.findUniqueOrThrow({ where: { id: order.id } })).releaseAttempts, 5);
    assert.equal((await seller.post(`/v1/classifieds/orders/${order.id}/release`, { code })).json.error.code, 'release_locked', 'not even the right code now');
    await conserved();
  });

  test('releasing while the buyer cancels: either the seller is paid or the buyer refunded, never both', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { seller, buyer, order } = await paidOrder(`Toshiba ${round + 32} inch TV`);
      const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
      const [release, cancel] = await Promise.all([seller.post(`/v1/classifieds/orders/${order.id}/release`, { code }), buyer.post(`/v1/classifieds/orders/${order.id}/cancel`, { reason: 'Changed my mind' })]);
      assert.equal([release.status, cancel.status].filter(status => status === 200).length, 1, JSON.stringify([release.json, cancel.json]));
      const settled = await movedOnce(order.id);
      if (release.status === 200) {
        assert.deepEqual([settled.status, await balance('customer_wallet', buyer.id), await balance('customer_withdrawable', seller.id)], ['released', 0n, 24500000n]);
      } else {
        assert.deepEqual([settled.status, await balance('customer_wallet', buyer.id), await balance('customer_withdrawable', seller.id)], ['refunded', BigInt(order.total), 0n]);
      }
      await conserved();
    }
  });

  test('releasing at the hand-over deadline while the job refunds it: one of them', async () => {
    const { seller, buyer, order } = await paidOrder('Sharp 40 inch TV');
    const code = (await buyer.get(`/v1/classifieds/orders/${order.id}/release-code`)).json.code;
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { handoverBy: new Date(Date.now() - 1000) } });
    const [release, job] = await Promise.all([seller.post(`/v1/classifieds/orders/${order.id}/release`, { code }), services.safePay.runDue()]);
    const settled = await movedOnce(order.id);
    assert.ok(['released', 'refunded'].includes(settled.status));
    assert.equal(release.status === 200, settled.status === 'released', JSON.stringify(release.json));
    assert.equal(job.refunded, settled.status === 'refunded' ? 1 : 0, 'the job refunded it only if the release lost');
    await conserved();
  });

  test('a delivery confirmed while it is disputed: the money is released or held for BitoCard, never both', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { seller, buyer, order } = await paidOrder(`Vizio ${round + 43} inch TV`, { delivery: true });
      const [received, dispute] = await Promise.all([
        buyer.post(`/v1/classifieds/orders/${order.id}/received`),
        buyer.post(`/v1/classifieds/orders/${order.id}/dispute`, { reason: 'damaged', details: 'The stand arrived broken in two.' }),
      ]);
      assert.equal([received.status, dispute.status].filter(status => status < 300).length, 1, JSON.stringify([received.json, dispute.json]));
      const settled = await movedOnce(order.id);
      if (received.status === 200) {
        assert.deepEqual([settled.status, await prisma.classifiedDispute.count({ where: { orderId: order.id } })], ['released', 0]);
        assert.equal(await balance('customer_withdrawable', seller.id), 24500000n);
      } else {
        assert.equal(settled.status, 'disputed');
        assert.equal(await balance('customer_withdrawable', seller.id), 0n, 'held until BitoCard decides');
      }
      await conserved();
    }
  });

  test('confirming a delivery as the job releases it: released once', async () => {
    const { seller, buyer, order } = await paidOrder('Panasonic 49 inch TV', { delivery: true });
    await prisma.classifiedOrder.update({ where: { id: order.id }, data: { confirmBy: new Date(Date.now() - 1000) } });
    const [received] = await Promise.all([buyer.post(`/v1/classifieds/orders/${order.id}/received`), services.safePay.runDue()]);
    assert.ok([200, 409].includes(received.status), JSON.stringify(received.json));
    assert.equal((await movedOnce(order.id)).status, 'released');
    assert.equal(await balance('customer_withdrawable', seller.id), 24500000n, 'paid once');
    await conserved();
  });

  test('two admins deciding the same dispute at once: one decision, one movement of money, one audit', async () => {
    const { seller, buyer, order } = await paidOrder('JVC 55 inch TV');
    assert.equal((await buyer.post(`/v1/classifieds/orders/${order.id}/dispute`, { reason: 'not_as_described', details: 'The remote and stand are missing.' })).status, 201);
    const other = await adminClient(server);
    const results = await Promise.all([
      admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'refund', note: 'Missing parts confirmed.' }),
      other.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'release', note: 'Parts were never listed.' }),
      admin.post(`/v1/admin/classifieds/orders/${order.id}/dispute/decide`, { decision: 'partial', refund: 5000000, note: 'Half the parts were listed.' }),
    ]);
    assert.equal(results.filter(res => res.status === 200).length, 1, JSON.stringify(results.map(res => res.json)));
    for (const res of results.filter(res => res.status !== 200)) assert.ok(['order_changed', 'dispute_closed'].includes(res.json.error.code), JSON.stringify(res.json));
    const settled = await movedOnce(order.id);
    const dispute = await prisma.classifiedDispute.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.equal(dispute.status, 'decided');
    assert.equal(settled.status, { refund: 'refunded', release: 'released', partial: 'partly_refunded' }[dispute.decision]);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.dispute_decided', targetId: order.id } }), 1);
    const paidBack = { refunded: BigInt(order.total), released: 0n, partly_refunded: 5000000n }[settled.status];
    assert.equal(await balance('customer_wallet', buyer.id), paidBack);
    assert.equal(await balance('customer_withdrawable', seller.id), { refunded: 0n, released: 24500000n, partly_refunded: 19600000n }[settled.status]);
    await conserved();
  });

  test('the job run twice at once settles each due order once', async () => {
    const due = [];
    for (let n = 0; n < 3; n += 1) due.push(await paidOrder(`Hitachi ${n + 32} inch TV`));
    for (let n = 0; n < 2; n += 1) due.push(await paidOrder(`Grundig ${n + 40} inch TV`, { delivery: true }));
    for (const { order } of due.slice(0, 3)) await prisma.classifiedOrder.update({ where: { id: order.id }, data: { handoverBy: new Date(Date.now() - 1000) } });
    for (const { order } of due.slice(3)) await prisma.classifiedOrder.update({ where: { id: order.id }, data: { confirmBy: new Date(Date.now() - 1000) } });
    const runs = await Promise.all([services.safePay.runDue(), services.safePay.runDue()]);
    assert.equal(runs[0].refunded + runs[1].refunded, 3, JSON.stringify(runs));
    assert.equal(runs[0].released + runs[1].released, 2, JSON.stringify(runs));
    for (const [n, { order }] of due.entries()) assert.equal((await movedOnce(order.id)).status, n < 3 ? 'refunded' : 'released');
    await conserved();
  });
});
