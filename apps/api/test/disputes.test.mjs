// Disputes: customers raise them on the store (or resellers log them), the reseller investigates and either resolves
// them or escalates them to BitoCard with a report and a recommendation; resellers' own disputes, disputes at
// BitoCard's own store and chargebacks follow the same path, and only BitoCard executes what moves money.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, client, lastEmailCode, resellerClient, startApp } from './helpers.mjs';
import { fakeFlutterwave, fakeStripe } from './fakes.mjs';
import { responseChecker } from './openapi-docs.mjs';

let server;
let admin;
let prisma;
let stripe;
let flw;
let check;

before(async () => {
  [stripe, flw] = await Promise.all([fakeStripe(), fakeFlutterwave()]);
  server = await startApp({ env: { ...stripe.env, ...flw.env } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  check = await responseChecker(server.app);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await prisma.countryCategory.upsert({
    where: { countryCode_category: { countryCode: 'NG', category: 'gift_cards' } },
    create: { countryCode: 'NG', category: 'gift_cards', enabled: true },
    update: { enabled: true, customerVerification: false },
  });
  const sandboxOff = await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: false }, code: await adminCode(server, admin) });
  assert.equal(sandboxOff.status, 200, JSON.stringify(sandboxOff.json));
  assert.equal((await admin.put('/v1/admin/countries/NG/payment-methods', { purpose: 'checkout', enabled: ['stripe'] })).status, 200);
  assert.equal((await admin.put('/v1/admin/countries/NG/payment-methods', { purpose: 'wallet_top_up', enabled: ['stripe'] })).status, 200);
});

after(async () => {
  await server?.close();
  await Promise.all([stripe?.close(), flw?.close()]);
});

const returnUrl = 'https://shop.example/checkout/return';
let counter = 0;

async function giftCard(title, codes) {
  const created = await admin.post('/v1/admin/stock', {
    category: 'gift_cards',
    country: 'NG',
    brand: 'amazon',
    title,
    description: 'An Amazon gift card.',
    redeem_instructions: 'Redeem at amazon.com/redeem.',
    currency: 'USD',
    face_value: 2500,
    cost: 2000,
    listed: true,
    codes: codes.map(code => ({ code })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.product;
}

/** A store's server: its store named in `BitoCard-Store` (none: bitocard.com), the customer's session in a header. */
function storeServer(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `store-${Date.now()}-${Math.random()}` } : {}),
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

async function customer(subdomain = null) {
  const shopper = storeServer(subdomain);
  const email = `disputer${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** A verified reseller with a published, live store on <subdomain>.bitocard.com listing `products`. */
async function resellerStore(products) {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  const subdomain = `dispute${(counter += 1)}${Date.now().toString(36)}`.slice(0, 30);
  const created = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await reseller.browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
  assert.equal((await reseller.browser.post('/v1/catalogue/listing', { listed: true, product_ids: products.map(item => item.id) })).status, 200);
  assert.equal((await reseller.browser.patch(`/v1/stores/${created.json.id}`, { checkout_mode: 'live' })).status, 200);
  return { ...reseller, subdomain };
}

/** A delivered order at the store, paid by card. */
async function boughtAt(shopper, product) {
  const started = await shopper.post('/v1/store/checkouts', { product_id: product.id, face_value: 2500, country: 'NG', return_url: returnUrl });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const row = await prisma.checkout.findUniqueOrThrow({ where: { id: started.json.id }, include: { payment: true } });
  Object.assign(stripe.state.sessions[row.payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
  const done = (await shopper.get(`/v1/store/checkouts/${started.json.id}`)).json;
  assert.equal(done.order?.status, 'completed', JSON.stringify(done));
  return done;
}

function stripeWebhook(body) {
  const raw = JSON.stringify(body);
  const at = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'whsec_fake').update(`${at}.${raw}`).digest('hex');
  return fetch(`${server.base}/v1/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${signature}` }, body: raw });
}

describe('a customer’s dispute: the reseller investigates, BitoCard decides', () => {
  let product;
  before(async () => {
    product = await giftCard('Amazon Dispute Card', ['DISPUTE-CODE-0001', 'DISPUTE-CODE-0002', 'DISPUTE-CODE-0003', 'DISPUTE-CODE-0004', 'DISPUTE-CODE-0005', 'DISPUTE-CODE-0006']);
  });

  test('opened on the store, investigated with staff notes the customer never sees, escalated, then refunded by finance', async () => {
    const store = await resellerStore([product]);
    const shopper = await customer(store.subdomain);
    const bought = await boughtAt(shopper, product);

    const opened = await shopper.post('/v1/store/account/disputes', { checkout_id: bought.id, subject: 'Code already used', message: 'The code says it was already redeemed.' });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.deepEqual([opened.json.status, opened.json.topic, opened.json.checkout_id], ['open', 'order', bought.id]);
    assert.match(opened.json.reference, /^D-\d{6}$/);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'dispute.opened', resellerId: store.resellerId } }), 'the reseller is told');
    const stranger = await customer(store.subdomain);
    assert.equal((await stranger.get(`/v1/store/account/disputes/${opened.json.id}`)).status, 404, 'only the customer’s own');
    assert.equal((await stranger.post('/v1/store/account/disputes', { checkout_id: bought.id, subject: 'Not mine', message: 'Trying another customer’s order' })).status, 400);

    const list = await store.browser.get('/v1/disputes');
    check('GET /v1/disputes', 200, list.json);
    assert.deepEqual(list.json.data.map(item => item.id), [opened.json.id]);
    const note = await store.browser.post(`/v1/disputes/${opened.json.id}/messages`, { body: 'Supplier log shows the code unused at delivery.', visibility: 'staff' });
    check('POST /v1/disputes/{id}/messages', 201, note.json);
    await store.browser.post(`/v1/disputes/${opened.json.id}/messages`, { body: 'We are looking into it with our supplier.' });
    const seen = await shopper.get(`/v1/store/account/disputes/${opened.json.id}`);
    assert.deepEqual(seen.json.messages.map(item => item.body), ['The code says it was already redeemed.', 'We are looking into it with our supplier.'], 'staff notes never reach the customer');
    assert.equal(seen.json.report, undefined);

    assert.equal((await store.browser.post(`/v1/disputes/${opened.json.id}/escalate`, { recommendation: 'credit_reseller', report: 'Short report text' })).json.error.code, 'parameter_invalid', 'a credit needs an amount');
    const escalated = await store.browser.post(`/v1/disputes/${opened.json.id}/escalate`, { recommendation: 'refund_customer', report: 'The customer tried the code within the hour; the supplier confirms it was used elsewhere.' });
    assert.equal(escalated.status, 200, JSON.stringify(escalated.json));
    check('POST /v1/disputes/{id}/escalate', 200, escalated.json);
    assert.equal(escalated.json.status, 'escalated');
    assert.equal((await shopper.get(`/v1/store/account/disputes/${opened.json.id}`)).json.status, 'escalated');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.dispute.escalated' } }), 'BitoCard is told');
    assert.equal((await store.browser.post(`/v1/disputes/${opened.json.id}/resolve`, { note: 'Too late' })).json.error.code, 'dispute_not_open', 'it is with BitoCard now');

    const queue = await admin.get('/v1/admin/disputes?status=escalated');
    assert.ok(queue.json.data.some(item => item.id === opened.json.id));
    const support = await adminClient(server, ['support']);
    const refused = await support.post(`/v1/admin/disputes/${opened.json.id}/execute`, { action: 'refund_customer', note: 'Refunding' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'not_permitted'], 'money actions need finance');
    const executed = await admin.post(`/v1/admin/disputes/${opened.json.id}/execute`, { action: 'refund_customer', note: 'Refunded in full: the code was used before delivery.' });
    assert.equal(executed.status, 200, JSON.stringify(executed.json));
    assert.deepEqual([executed.json.status, executed.json.outcome], ['resolved', 'refunded_customer']);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: bought.order.id } })).status, 'refunded');
    assert.equal((await shopper.get(`/v1/store/checkouts/${bought.id}`)).json.status, 'refunded', 'the customer is refunded through the gateway');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'dispute.refund_customer', targetId: opened.json.id } }));
    assert.equal((await admin.post(`/v1/admin/disputes/${opened.json.id}/execute`, { action: 'reject', note: 'Twice' })).json.error.code, 'dispute_not_escalated', 'decided once');
    const final = await shopper.get(`/v1/store/account/disputes/${opened.json.id}`);
    assert.deepEqual([final.json.status, final.json.outcome], ['resolved', 'refunded_customer']);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'customer.dispute.updated', customerId: shopper.id } }), 'the customer is told');
  });

  test('the reseller resolves one themselves; a closed dispute takes no more messages', async () => {
    const store = await resellerStore([product]);
    const shopper = await customer(store.subdomain);
    const bought = await boughtAt(shopper, product);
    const opened = (await shopper.post('/v1/store/account/disputes', { checkout_id: bought.id, subject: 'How do I redeem?', message: 'Where do I enter the code?' })).json;
    const resolved = await store.browser.post(`/v1/disputes/${opened.id}/resolve`, { note: 'Enter it at amazon.com/redeem. Glad it worked!' });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.json));
    check('POST /v1/disputes/{id}/resolve', 200, resolved.json);
    assert.deepEqual([resolved.json.status, resolved.json.outcome], ['resolved', 'resolved_by_reseller']);
    const seen = await shopper.get(`/v1/store/account/disputes/${opened.id}`);
    assert.equal(seen.json.messages.at(-1).body, 'Enter it at amazon.com/redeem. Glad it worked!');
    assert.equal((await shopper.post(`/v1/store/account/disputes/${opened.id}/messages`, { body: 'Thanks' })).json.error.code, 'dispute_resolved');
  });

  test('BitoCard can send one back to the reseller, who can escalate it again; support can reject', async () => {
    const store = await resellerStore([product]);
    const shopper = await customer(store.subdomain);
    const bought = await boughtAt(shopper, product);
    const opened = (await shopper.post('/v1/store/account/disputes', { checkout_id: bought.id, subject: 'Wrong value', message: 'I wanted a bigger card.' })).json;
    await store.browser.post(`/v1/disputes/${opened.id}/escalate`, { recommendation: 'reject', report: 'The customer chose this value at checkout.' });
    const returned = await admin.post(`/v1/admin/disputes/${opened.id}/return`, { note: 'Please attach the checkout details first.' });
    assert.equal(returned.json.status, 'open');
    const mine = await store.browser.get(`/v1/disputes/${opened.id}`);
    check('GET /v1/disputes/{id}', 200, mine.json);
    assert.equal(mine.json.messages.at(-1).body, 'Please attach the checkout details first.');
    await store.browser.post(`/v1/disputes/${opened.id}/escalate`, { recommendation: 'reject', report: 'Checkout shows the customer chose 25 USD.' });
    const support = await adminClient(server, ['support']);
    const rejected = await support.post(`/v1/admin/disputes/${opened.id}/execute`, { action: 'reject', note: 'The value was chosen at checkout.' });
    assert.deepEqual([rejected.json.status, rejected.json.outcome], ['resolved', 'rejected']);
  });

  test('every change the reseller did not make sends them an event, recorded with the change and matching its schema', async () => {
    const store = await resellerStore([product]);
    const shopper = await customer(store.subdomain);
    const bought = await boughtAt(shopper, product);
    const opened = (await shopper.post('/v1/store/account/disputes', { checkout_id: bought.id, subject: 'Wrong card', message: 'I got the wrong card.' })).json;
    await shopper.post(`/v1/store/account/disputes/${opened.id}/messages`, { body: 'Any news?' });
    await store.browser.post(`/v1/disputes/${opened.id}/messages`, { body: 'Checking now.' });
    await store.browser.post(`/v1/disputes/${opened.id}/escalate`, { recommendation: 'reject', report: 'The customer chose this card at checkout.' });
    await admin.post(`/v1/admin/disputes/${opened.id}/messages`, { body: 'Looking at it.', visibility: 'staff' });
    await admin.post(`/v1/admin/disputes/${opened.id}/return`, { note: 'Attach the checkout details.' });
    await store.browser.post(`/v1/disputes/${opened.id}/escalate`, { recommendation: 'reject', report: 'Checkout details: the customer chose this card.' });
    await admin.post(`/v1/admin/disputes/${opened.id}/execute`, { action: 'reject', note: 'Chosen at checkout.' });

    const events = (await prisma.event.findMany({ where: { resellerId: store.resellerId, type: { startsWith: 'dispute.' } }, orderBy: { createdAt: 'asc' } })).map(row => JSON.parse(row.payload));
    assert.deepEqual(
      events.map(event => event.type),
      ['dispute.opened', 'dispute.message_received', 'dispute.escalated', 'dispute.message_received', 'dispute.returned', 'dispute.escalated', 'dispute.resolved'],
      'never for the reseller’s own messages',
    );
    const validate = check.compile({ $ref: '#/components/schemas/DisputeSummary' });
    for (const event of events) {
      assert.ok(validate(event.data.object), `${event.type}: ${JSON.stringify(validate.errors)}`);
      assert.equal(event.data.object.id, opened.id);
      assert.ok(!JSON.stringify(event).includes('Any news?'), 'messages are never in events');
    }
    assert.deepEqual([events.at(-1).data.object.status, events.at(-1).data.object.outcome], ['resolved', 'rejected']);
  });

  test('at BitoCard’s own store, BitoCard is the store: a dispute goes straight to BitoCard', async () => {
    const shopper = await customer();
    const bought = await boughtAt(shopper, product);
    const opened = await shopper.post('/v1/store/account/disputes', { checkout_id: bought.id, subject: 'Late delivery', message: 'My code took long to arrive.' });
    assert.equal(opened.json.status, 'escalated');
    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/disputes/${opened.json.id}/return`, { note: 'Back to you' })).json.error.code, 'not_returnable');
  });
});

describe('a reseller’s own dispute with BitoCard', () => {
  test('goes to BitoCard at once; finance credits the wallet; the reseller cannot close it themselves', async () => {
    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
    const topUp = (await reseller.browser.post('/v1/wallet/top-ups', { amount: 300_000, method: 'stripe' })).json;
    const opened = await reseller.browser.post('/v1/disputes', { kind: 'reseller', topic: 'funding', subject: 'Top-up not credited', message: 'I paid by card but my wallet shows nothing.', top_up_id: topUp.id });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    check('POST /v1/disputes', 201, opened.json);
    assert.deepEqual([opened.json.status, opened.json.payment_id], ['escalated', topUp.id]);
    assert.equal((await reseller.browser.post(`/v1/disputes/${opened.json.id}/resolve`, { note: 'Never mind' })).json.error.code, 'escalation_required');
    assert.equal((await admin.post(`/v1/admin/disputes/${opened.json.id}/execute`, { action: 'refund_customer', note: 'No order' })).json.error.code, 'action_not_applicable');

    const before = (await reseller.browser.get('/v1/wallet')).json.available;
    const credited = await admin.post(`/v1/admin/disputes/${opened.json.id}/execute`, { action: 'credit_reseller', amount: 300_000, note: 'Paid at Stripe; credited by hand.' });
    assert.equal(credited.status, 200, JSON.stringify(credited.json));
    assert.deepEqual([credited.json.outcome, credited.json.outcome_amount], ['credited_reseller', 300_000]);
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available - before, 300_000);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'wallet.adjusted', targetId: reseller.resellerId } }));
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });

  test('orders and top-ups must be the reseller’s own; API keys need the disputes scopes', async () => {
    const reseller = await resellerClient(server);
    const other = await resellerClient(server);
    const top = (await other.browser.post('/v1/wallet/top-ups', { amount: 100_000, method: 'stripe' }, { 'bitocard-mode': 'test' })).json;
    const refused = await reseller.browser.post('/v1/disputes', { kind: 'reseller', topic: 'funding', subject: 'Not mine', message: 'Someone else’s top-up', top_up_id: top.id }, { 'bitocard-mode': 'test' });
    assert.deepEqual([refused.status, refused.json.error.param], [400, 'top_up_id']);
    const key = (await reseller.browser.post('/v1/api-keys', { name: 'Read only', mode: 'test', scopes: ['disputes:read'] })).json.secret;
    const api = client(server.base, { origin: null, autoIdempotency: true });
    const auth = { authorization: `Bearer ${key}` };
    assert.equal((await api.get('/v1/disputes', auth)).status, 200);
    assert.equal((await api.post('/v1/disputes', { kind: 'customer', topic: 'order', subject: 'From my system', message: 'A customer complaint' }, auth)).status, 403);
  });
});

describe('chargebacks open a dispute for the reseller', () => {
  test('the reseller investigates and recommends contesting; BitoCard contests; the card network decides', async () => {
    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
    const created = (await reseller.browser.post('/v1/wallet/top-ups', { amount: 400_000, method: 'stripe' })).json;
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: created.id } });
    Object.assign(stripe.state.sessions[payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
    await stripeWebhook({ type: 'checkout.session.completed', data: { object: { id: payment.providerTransactionId, object: 'checkout.session' } } });
    const disputeId = `dp_case_${Date.now()}`;
    stripe.state.disputes[disputeId] = { amount: 400_000, currency: 'ngn', status: 'needs_response', payment_intent: stripe.state.sessions[payment.providerTransactionId].payment_intent, reason: 'fraudulent' };
    await stripeWebhook({ type: 'charge.dispute.created', data: { object: { id: disputeId, object: 'dispute' } } });

    const list = (await reseller.browser.get('/v1/disputes?kind=chargeback')).json.data;
    assert.equal(list.length, 1);
    const dispute = list[0];
    assert.deepEqual([dispute.status, dispute.topic, dispute.payment_id], ['open', 'funding', payment.id]);
    assert.equal((await reseller.browser.post(`/v1/disputes/${dispute.id}/resolve`, { note: 'Fine' })).json.error.code, 'escalation_required');
    await reseller.browser.post(`/v1/disputes/${dispute.id}/escalate`, { recommendation: 'contest_chargeback', report: 'This was my own card; I did not dispute it. Bank statement attached by email.' });
    const contested = await admin.post(`/v1/admin/disputes/${dispute.id}/execute`, { action: 'contest_chargeback', note: 'Evidence submitted to Stripe.' });
    assert.equal(contested.json.status, 'contested');

    stripe.state.disputes[disputeId].status = 'won';
    await stripeWebhook({ type: 'charge.dispute.closed', data: { object: { id: disputeId, object: 'dispute' } } });
    const decided = (await reseller.browser.get(`/v1/disputes/${dispute.id}`)).json;
    const types = (await prisma.event.findMany({ where: { resellerId: reseller.resellerId, type: { startsWith: 'dispute.' } }, orderBy: { createdAt: 'asc' } })).map(row => row.type);
    assert.deepEqual(types, ['dispute.opened', 'dispute.escalated', 'dispute.contested', 'dispute.resolved']);
    assert.deepEqual([decided.status, decided.outcome], ['resolved', 'chargeback_won']);
    assert.equal((await reseller.browser.get('/v1/wallet')).json.available, 400_000, 'the hold came back');
  });

  test('BitoCard can accept one: the chargeback is lost and the dispute resolved', async () => {
    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
    const created = (await reseller.browser.post('/v1/wallet/top-ups', { amount: 200_000, method: 'stripe' })).json;
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: created.id } });
    Object.assign(stripe.state.sessions[payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
    await stripeWebhook({ type: 'checkout.session.completed', data: { object: { id: payment.providerTransactionId, object: 'checkout.session' } } });
    const disputeId = `dp_accept_${Date.now()}`;
    stripe.state.disputes[disputeId] = { amount: 200_000, currency: 'ngn', status: 'needs_response', payment_intent: stripe.state.sessions[payment.providerTransactionId].payment_intent, reason: 'fraudulent' };
    await stripeWebhook({ type: 'charge.dispute.created', data: { object: { id: disputeId, object: 'dispute' } } });
    const dispute = (await reseller.browser.get('/v1/disputes?kind=chargeback')).json.data[0];
    await reseller.browser.post(`/v1/disputes/${dispute.id}/escalate`, { recommendation: 'accept_chargeback', report: 'I cannot show this payment was mine.' });
    const accepted = await admin.post(`/v1/admin/disputes/${dispute.id}/execute`, { action: 'accept_chargeback', note: 'Accepted at Stripe.' });
    assert.deepEqual([accepted.json.status, accepted.json.outcome], ['resolved', 'chargeback_lost']);
    assert.equal((await prisma.chargeback.findUniqueOrThrow({ where: { id: dispute.chargeback_id } })).status, 'lost');
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });
});
