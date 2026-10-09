// Card payment disputes (chargebacks): re-read from Stripe or recorded by finance, the disputed amount held from the
// reseller's wallet while open, returned when won, paid back to the gateway when lost (BitoCard bearing what the wallet
// could not cover, or all of it under chargeback protection), and withdrawals waiting meanwhile.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeFlutterwave, fakeStripe } from './fakes.mjs';

let server;
let stripe;
let flw;
let prisma;
let wallets;
let admin;

before(async () => {
  [stripe, flw] = await Promise.all([fakeStripe(), fakeFlutterwave()]);
  server = await startApp({ env: { ...stripe.env, ...flw.env } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/countries/NG/payment-methods', { purpose: 'wallet_top_up', enabled: ['stripe', 'flutterwave'] })).status, 200);
});

after(async () => {
  await Promise.all([server?.close(), stripe?.close(), flw?.close()]);
});

function stripeWebhook(body) {
  const raw = JSON.stringify(body);
  const at = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'whsec_fake').update(`${at}.${raw}`).digest('hex');
  return fetch(`${server.base}/v1/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${signature}` }, body: raw });
}

const disputeEvent = (id, type = 'charge.dispute.created') => ({ type, data: { object: { id, object: 'dispute' } } });
const wallet = async browser => (await browser.get('/v1/wallet')).json;
const balance = async (kind, extra = {}) => (await prisma.ledgerAccount.findFirst({ where: { kind, mode: 'live', currency: 'NGN', ...extra } }))?.balanceMinor ?? 0n;
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

/** A verified Nigerian reseller who topped up by card through Stripe. */
async function toppedUp(amount = 500_000) {
  const reseller = await resellerClient(server);
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  const created = await reseller.browser.post('/v1/wallet/top-ups', { amount, method: 'stripe' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: created.json.id } });
  Object.assign(stripe.state.sessions[payment.providerTransactionId], { status: 'complete', payment_status: 'paid' });
  await stripeWebhook({ type: 'checkout.session.completed', data: { object: { id: payment.providerTransactionId, object: 'checkout.session' } } });
  assert.equal((await wallet(reseller.browser)).available, amount);
  return { ...reseller, payment, intent: stripe.state.sessions[payment.providerTransactionId].payment_intent };
}

let disputes = 0;
function stripeDispute(intent, amount, status = 'needs_response') {
  const id = `dp_${(disputes += 1)}_${Date.now()}`;
  stripe.state.disputes[id] = { amount, currency: 'ngn', status, payment_intent: intent, reason: 'fraudulent' };
  return id;
}

describe('Stripe disputes', () => {
  test('opened: the amount is held and withdrawals wait; lost: it pays the cardholder back through Stripe', async () => {
    const { browser, payment, intent, resellerId } = await toppedUp();
    const account = (await browser.post('/v1/bank-accounts', { bank_code: '058', account_number: '0123456789' })).json;
    await wallets.adjust(null, { resellerId, mode: 'live', balance: 'earnings', amount: 100_000, reason: 'Matured test earnings' });
    const stripeBefore = await balance('provider_balance', { ownerKey: 'provider:stripe' });

    const id = stripeDispute(intent, 500_000);
    // The webhook body is never trusted: only the dispute's ID, re-read from Stripe.
    assert.equal((await stripeWebhook(disputeEvent(id))).status, 200);
    assert.equal((await stripeWebhook(disputeEvent(id, 'charge.dispute.updated'))).status, 200, 'told again: opened once');
    const open = await prisma.dispute.findFirstOrThrow({ where: { providerDisputeId: id } });
    assert.deepEqual([open.status, open.paymentId, open.heldMinor, open.shortfallMinor, open.protected], ['open', payment.id, 500_000n, 0n, false]);
    const held = await wallet(browser);
    assert.deepEqual([held.available, held.reserved], [100_000, 500_000], 'the disputed amount cannot be spent or withdrawn');
    const payout = await browser.post('/v1/payouts', { amount: 100_000, bank_account_id: account.id });
    assert.equal(payout.json.error.code, 'payouts_on_hold');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'dispute.opened', resellerId } }), 'the reseller is told');

    stripe.state.disputes[id].status = 'lost';
    assert.equal((await stripeWebhook(disputeEvent(id, 'charge.dispute.closed'))).status, 200);
    const lost = await prisma.dispute.findUniqueOrThrow({ where: { id: open.id } });
    assert.equal(lost.status, 'lost');
    const after = await wallet(browser);
    assert.deepEqual([after.available, after.reserved], [100_000, 0]);
    assert.equal(stripeBefore - (await balance('provider_balance', { ownerKey: 'provider:stripe' })), 500_000n, 'paid back from BitoCard’s Stripe balance');
    assert.notEqual((await browser.post('/v1/payouts', { amount: 100_000, bank_account_id: account.id })).json.error?.code, 'payouts_on_hold', 'covered in full: withdrawals no longer wait for it');
    await ledgerOk();
  });

  test('won: the hold goes back', async () => {
    const { browser, intent } = await toppedUp(300_000);
    const id = stripeDispute(intent, 300_000, 'warning_needs_response');
    await stripeWebhook(disputeEvent(id));
    assert.equal((await wallet(browser)).available, 0);
    stripe.state.disputes[id].status = 'won';
    await stripeWebhook(disputeEvent(id, 'charge.dispute.closed'));
    assert.equal((await prisma.dispute.findFirstOrThrow({ where: { providerDisputeId: id } })).status, 'won');
    assert.deepEqual([(await wallet(browser)).available, (await wallet(browser)).reserved], [300_000, 0]);
    await ledgerOk();
  });

  test('a wallet that cannot cover it: the rest is a shortfall BitoCard bears, and withdrawals wait until finance clears it', async () => {
    const { browser, intent, resellerId } = await toppedUp(500_000);
    await wallets.hold({ resellerId, mode: 'live', amount: 300_000n, reference: `spent:${resellerId}`, description: 'Spent on an order' });
    const id = stripeDispute(intent, 500_000);
    await stripeWebhook(disputeEvent(id));
    const open = await prisma.dispute.findFirstOrThrow({ where: { providerDisputeId: id } });
    assert.deepEqual([open.heldMinor, open.shortfallMinor], [200_000n, 300_000n]);

    const losses = await balance('chargebacks');
    stripe.state.disputes[id].status = 'lost';
    await stripeWebhook(disputeEvent(id, 'charge.dispute.closed'));
    assert.equal(losses - (await balance('chargebacks')), 300_000n, 'BitoCard paid the part the wallet could not');
    await wallets.adjust(null, { resellerId, mode: 'live', balance: 'earnings', amount: 100_000, reason: 'Matured test earnings' });
    const account = (await browser.post('/v1/bank-accounts', { bank_code: '058', account_number: '0123456789' })).json;
    assert.equal((await browser.post('/v1/payouts', { amount: 100_000, bank_account_id: account.id })).json.error.code, 'payouts_on_hold');

    const cleared = await admin.post(`/v1/admin/disputes/${open.id}/clear`, { reason: 'Recovered from the reseller by transfer' });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
    assert.ok(cleared.json.cleared_at);
    assert.notEqual((await browser.post('/v1/payouts', { amount: 100_000, bank_account_id: account.id })).json.error?.code, 'payouts_on_hold');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'dispute.cleared', targetId: open.id } }));
    await ledgerOk();
  });

  test('chargeback protection (Premium): nothing is held, and BitoCard bears a loss', async () => {
    const { browser, intent, resellerId } = await toppedUp(400_000);
    await prisma.reseller.update({ where: { id: resellerId }, data: { planCode: 'premium' } });
    const id = stripeDispute(intent, 400_000);
    await stripeWebhook(disputeEvent(id));
    const open = await prisma.dispute.findFirstOrThrow({ where: { providerDisputeId: id } });
    assert.deepEqual([open.protected, open.heldMinor], [true, 0n]);
    assert.equal((await wallet(browser)).available, 400_000);
    const losses = await balance('chargebacks');
    stripe.state.disputes[id].status = 'lost';
    await stripeWebhook(disputeEvent(id, 'charge.dispute.closed'));
    assert.equal(losses - (await balance('chargebacks')), 400_000n);
    assert.equal((await wallet(browser)).available, 400_000, 'the reseller keeps their money');
    await ledgerOk();
  });

  test('a dispute for a payment BitoCard does not know is acknowledged and changes nothing', async () => {
    const id = stripeDispute('pi_unknown', 1000);
    const res = await stripeWebhook(disputeEvent(id));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).handled, false);
    assert.equal(await prisma.dispute.count({ where: { providerDisputeId: id } }), 0);
  });
});

describe('disputes recorded by finance', () => {
  test('finance records another gateway’s dispute and decides it; other admins cannot', async () => {
    const reseller = await resellerClient(server);
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
    const created = await reseller.browser.post('/v1/wallet/top-ups', { amount: 200_000, method: 'flutterwave' });
    const reference = flw.calls.findLast(c => c.url === '/payments').body.tx_ref;
    flw.state.charges[reference] = { id: 7701, status: 'successful', amount: 2000, currency: 'NGN', app_fee: 0 };
    await reseller.browser.get(`/v1/wallet/top-ups/${created.json.id}`);
    assert.equal((await wallet(reseller.browser)).available, 200_000);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post('/v1/admin/disputes', { payment_id: created.json.id, provider_dispute_id: 'FLW-CB-1', reason: 'Chargeback in the dashboard' })).status, 403);
    const recorded = await admin.post('/v1/admin/disputes', { payment_id: created.json.id, provider_dispute_id: 'FLW-CB-1', reason: 'Chargeback in the dashboard' });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.json));
    assert.deepEqual([recorded.json.status, recorded.json.held, recorded.json.provider], ['open', 200_000, 'flutterwave']);
    const again = await admin.post('/v1/admin/disputes', { payment_id: created.json.id, provider_dispute_id: 'FLW-CB-1', reason: 'Recorded twice' });
    assert.equal(again.json.id, recorded.json.id, 'one per gateway dispute');
    assert.equal((await wallet(reseller.browser)).available, 0);

    const listed = await admin.get(`/v1/admin/disputes?status=open&reseller_id=${reseller.resellerId}`);
    assert.deepEqual(listed.json.data.map(item => item.id), [recorded.json.id]);
    const won = await admin.post(`/v1/admin/disputes/${recorded.json.id}/resolve`, { outcome: 'won', reason: 'Flutterwave ruled for the merchant' });
    assert.equal(won.json.status, 'won');
    const twice = await admin.post(`/v1/admin/disputes/${recorded.json.id}/resolve`, { outcome: 'lost', reason: 'Changed mind' });
    assert.equal(twice.json.error.code, 'dispute_closed', 'decided once');
    assert.equal((await wallet(reseller.browser)).available, 200_000);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'dispute.won', targetId: recorded.json.id } }));
    await ledgerOk();
  });
});
