// Identity checks: reseller owners with Didit before going live (consent, signed webhooks re-read from Didit,
// automatic or manual activation, admin review, expiry), customer checks with BVN consent in Nigeria and Didit
// elsewhere, sandbox simulation and events, and payout accounts that must belong to the verified reseller.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeDidit, fakeFlutterwave } from './fakes.mjs';

const { namesMatch, accountNameMatches } = await import('../dist/identity/providers.js');

let server;
let didit;
let flutterwave;
let admin;
let prisma;
let email;

before(async () => {
  didit = await fakeDidit();
  flutterwave = await fakeFlutterwave();
  server = await startApp({ env: { ...didit.env, ...flutterwave.env, CRON_SECRET: 'cron-secret', EVENTS_SETTLE_SECONDS: '0' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  email = server.app.get((await import('../dist/notifications/email.service.js')).EmailService);
});

after(async () => {
  await server?.close();
  await didit?.close();
  await flutterwave?.close();
});

const sandbox = { 'bitocard-mode': 'test' };
const cron = job => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());

/** Didit's webhook: X-Signature is the HMAC of the raw body; the status in it is never trusted. */
async function diditWebhook(body, { secret = didit.secret, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(body);
  return fetch(`${server.base}/v1/webhooks/didit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-timestamp': String(timestamp), 'x-signature': createHmac('sha256', secret).update(raw).digest('hex') },
    body: raw,
  });
}

const sessionOf = url => url.split('/').pop();

async function startReseller(browser) {
  const res = await browser.post('/v1/account/verification', { consent: true });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

async function finishReseller(sessionId, status, names = { first_name: 'Ada', last_name: 'Obi' }) {
  Object.assign(didit.state.sessions[sessionId], { status, ...names });
  const res = await diditWebhook({ webhook_type: 'status.updated', session_id: sessionId, status });
  assert.equal(res.status, 200);
  return res.json();
}

describe('reseller identity checks', () => {
  test('the owner consents, gets a Didit page, and an unfinished check is offered again', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.get('/v1/account/verification')).json.status, 'not_started');
    assert.equal((await browser.post('/v1/account/verification', { consent: false })).json.error.code, 'consent_required');
    const started = await startReseller(browser);
    assert.deepEqual([started.status, started.verified, started.reseller_status], ['in_progress', false, 'pending']);
    assert.match(started.url, /^https:\/\/verify\.didit\.test\/session\//);
    const again = await startReseller(browser);
    assert.equal(again.url, started.url, 'the same session, not a new one');
    assert.equal(didit.state.created.filter(body => body.vendor_data?.startsWith('reseller:')).length >= 1, true);
    assert.equal(didit.state.created.at(-1).workflow_id, 'wf-test');
  });

  test('an approved check verifies the owner and takes the account live, once', async () => {
    const { browser, resellerId, email: owner } = await resellerClient(server);
    const started = await startReseller(browser);
    const session = sessionOf(started.url);

    // The webhook claims Approved, but Didit still says In Progress: nothing changes.
    didit.state.sessions[session].status = 'In Progress';
    await diditWebhook({ webhook_type: 'status.updated', session_id: session, status: 'Approved' });
    assert.equal((await browser.get('/v1/account/verification')).json.status, 'in_progress', 'the notification body is never trusted');

    await finishReseller(session, 'Approved');
    await finishReseller(session, 'Approved');
    const status = (await browser.get('/v1/account/verification')).json;
    assert.deepEqual([status.status, status.verified, status.reseller_status], ['approved', true, 'active']);
    const reseller = await prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } });
    assert.equal(reseller.verifiedName, 'Ada Obi');
    assert.match(email.outbox.filter(m => m.to === owner).at(-1).subject, /identity is verified/);
    assert.equal((await browser.post('/v1/account/verification', { consent: true })).json.error.code, 'already_verified');
    assert.equal((await browser.post('/v1/api-keys', { name: 'Live', mode: 'live' })).status, 201, 'live keys once verified');

    const stored = await prisma.identityVerification.findFirstOrThrow({ where: { resellerId } });
    assert.ok(!JSON.stringify(stored).includes('A12345678'), 'document numbers are never kept');
    const history = (await admin.get(`/v1/admin/resellers/${resellerId}/history`)).json.data;
    assert.ok(history.some(entry => entry.action === 'verification.approved'));
  });

  test('webhooks need a valid, recent signature', async () => {
    const body = { webhook_type: 'status.updated', session_id: 'x', status: 'Approved' };
    assert.equal((await diditWebhook(body, { secret: 'wrong' })).status, 401);
    assert.equal((await diditWebhook(body, { timestamp: Math.floor(Date.now() / 1000) - 600 })).status, 401);
    const res = await fetch(`${server.base}/v1/webhooks/didit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(res.status, 401);
    assert.deepEqual(await (await diditWebhook({ webhook_type: 'data.updated', session_id: 'x' })).json(), { received: true });
  });

  test('with manual approval switched on, a verified reseller waits for an admin', async () => {
    await admin.put('/v1/admin/switches/manual_reseller_approval', { country_code: 'GH', enabled: true });
    try {
      const { browser, resellerId } = await resellerClient(server, { country: 'GH' });
      await finishReseller(sessionOf((await startReseller(browser)).url), 'Approved');
      const status = (await browser.get('/v1/account/verification')).json;
      assert.deepEqual([status.verified, status.reseller_status], [true, 'pending']);
      const activated = await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' });
      assert.equal(activated.json.status, 'active');
    } finally {
      await admin.put('/v1/admin/switches/manual_reseller_approval', { country_code: 'GH', enabled: null });
    }
  });

  test('declined checks can be retried; checks in review are decided by an admin', async () => {
    const { browser, resellerId, email: owner } = await resellerClient(server);
    const first = sessionOf((await startReseller(browser)).url);
    didit.state.sessions[first].review = 'Document photo unreadable';
    await finishReseller(first, 'Declined', {});
    let status = (await browser.get('/v1/account/verification')).json;
    assert.deepEqual([status.status, status.reason, status.reseller_status], ['declined', 'not_verified', 'pending']);
    assert.match(email.outbox.filter(m => m.to === owner).at(-1).subject, /could not verify/);

    const second = sessionOf((await startReseller(browser)).url);
    assert.notEqual(second, first, 'a new session after a decline');
    await finishReseller(second, 'In Review', {});
    assert.equal((await browser.post('/v1/account/verification', { consent: true })).json.error.code, 'verification_in_review');

    const queue = (await admin.get(`/v1/admin/verifications?status=in_review&reseller_id=${resellerId}`)).json.data;
    assert.equal(queue.length, 1);
    assert.equal(queue[0].provider_reference, second);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/verifications/${queue[0].id}/decide`, { decision: 'approved', reason: 'Checked by hand' })).status, 403);
    const decided = await admin.post(`/v1/admin/verifications/${queue[0].id}/decide`, { decision: 'approved', reason: 'Document checked in the Didit console', verified_name: 'Ada Obi' });
    assert.equal(decided.json.status, 'approved');
    status = (await browser.get('/v1/account/verification')).json;
    assert.deepEqual([status.status, status.reseller_status], ['approved', 'active']);
    assert.equal((await admin.post(`/v1/admin/verifications/${queue[0].id}/decide`, { decision: 'declined', reason: 'Changed my mind' })).json.error.code, 'verification_not_in_review');
  });

  test('the scheduled job picks up results Didit never reported, and closes abandoned checks', async () => {
    const reported = await resellerClient(server);
    const abandoned = await resellerClient(server);
    const a = sessionOf((await startReseller(reported.browser)).url);
    const b = sessionOf((await startReseller(abandoned.browser)).url);
    Object.assign(didit.state.sessions[a], { status: 'Approved', first_name: 'Ada', last_name: 'Obi' });
    didit.state.sessions[b].status = 'In Progress';
    await prisma.identityVerification.updateMany({ where: { providerReference: a }, data: { createdAt: new Date(Date.now() - 3600_000) } });
    await prisma.identityVerification.updateMany({ where: { providerReference: b }, data: { createdAt: new Date(Date.now() - 8 * 24 * 3600_000) } });
    const result = (await cron('identity')).result;
    assert.ok(result.decided >= 1 && result.expired >= 1, JSON.stringify(result));
    assert.equal((await reported.browser.get('/v1/account/verification')).json.status, 'approved');
    const closed = (await abandoned.browser.get('/v1/account/verification')).json;
    assert.deepEqual([closed.status, closed.reason], ['expired', 'expired']);
  });

  test('API keys and staff cannot start the owner’s check', async () => {
    const { browser } = await resellerClient(server);
    const key = (await browser.post('/v1/api-keys', { name: 'Sandbox', mode: 'test' })).json.secret;
    const res = await fetch(`${server.base}/v1/account/verification`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: '{"consent":true}' });
    assert.equal(res.status, 403);
  });
});

describe('customer identity checks', () => {
  async function liveReseller(country = 'NG') {
    const reseller = await resellerClient(server, { country });
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
    return reseller;
  }
  const customer = { country: 'NG', first_name: 'Chinedu', last_name: 'Okafor', bvn: '22222222222', redirect_url: 'https://shop.example/verified', consent: true };

  test('in the sandbox a check is simulated, and the outcome is an event', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.post('/v1/customers/cust-1/verification', { ...customer, bvn: undefined }, sandbox)).json.error.param, 'bvn');
    assert.equal((await browser.post('/v1/customers/cust-1/verification', { ...customer, consent: false }, sandbox)).json.error.code, 'consent_required');
    assert.equal((await browser.post('/v1/customers/bad%20ref/verification', customer, sandbox)).json.error.param, 'reference');
    const started = await browser.post('/v1/customers/cust-1/verification', customer, sandbox);
    assert.equal(started.status, 201);
    assert.deepEqual([started.json.status, started.json.method, started.json.mode, started.json.url], ['in_progress', 'bvn', 'test', null]);
    const calls = flutterwave.calls.length;
    const done = (await browser.post('/v1/customers/cust-1/verification/simulate', { outcome: 'approved' }, sandbox)).json;
    assert.deepEqual([done.status, done.verified_name], ['approved', 'Chinedu Okafor']);
    assert.equal(flutterwave.calls.length, calls, 'the sandbox never calls providers');
    assert.equal((await browser.post('/v1/customers/cust-1/verification', customer, sandbox)).json.id, done.id, 'an approved customer is not checked again');
    const events = (await browser.get('/v1/events?type=customer_verification.approved', sandbox)).json.data;
    assert.equal(events[0].data.object.customer_reference, 'cust-1');
    assert.equal((await browser.get('/v1/customers/cust-1/verification')).status, 404, 'live and test are separate');
  });

  test('in Nigeria the BVN record must match the customer’s name, and the BVN is never stored', async () => {
    const { browser, resellerId } = await liveReseller();
    flutterwave.state.bvns['22222222222'] = 'CHINEDU OKAFOR';
    flutterwave.state.bvns['33333333333'] = 'EMEKA NWOSU';
    const ok = (await browser.post('/v1/customers/cust-ok/verification', customer)).json;
    assert.match(ok.url, /nibss-consent/);
    const mismatch = (await browser.post('/v1/customers/cust-x/verification', { ...customer, bvn: '33333333333' })).json;

    const flw = body => fetch(`${server.base}/v1/webhooks/flutterwave`, { method: 'POST', headers: { 'content-type': 'application/json', 'verif-hash': 'flw-webhook-hash' }, body: JSON.stringify(body) });
    const refOf = async id => (await prisma.identityVerification.findUniqueOrThrow({ where: { id } })).providerReference;
    for (const check of [ok, mismatch]) flutterwave.state.bvnChecks[await refOf(check.id)].status = 'COMPLETED';
    assert.equal((await flw({ event: 'bvn.completed', data: { reference: await refOf(ok.id) } })).status, 200);
    await flw({ event: 'bvn.completed', data: { reference: await refOf(mismatch.id) } });

    const approved = (await browser.get('/v1/customers/cust-ok/verification')).json;
    assert.deepEqual([approved.status, approved.verified_name], ['approved', 'CHINEDU OKAFOR'], 'the name as on the BVN record');
    const declined = (await browser.get('/v1/customers/cust-x/verification')).json;
    assert.deepEqual([declined.status, declined.reason], ['declined', 'name_mismatch']);
    const rows = await prisma.identityVerification.findMany({ where: { resellerId } });
    assert.ok(!JSON.stringify(rows).includes('22222222222') && !JSON.stringify(rows).includes('33333333333'), 'the BVN is never stored');
    const events = (await browser.get('/v1/events')).json.data.map(event => event.type);
    assert.deepEqual(events.sort(), ['customer_verification.approved', 'customer_verification.declined']);
  });

  test('outside Nigeria customers use Didit with their expected name', async () => {
    const { browser } = await liveReseller('GH');
    const started = (await browser.post('/v1/customers/gh-1/verification', { ...customer, country: 'GH', bvn: undefined })).json;
    assert.equal(started.method, 'document');
    const body = didit.state.created.at(-1);
    assert.deepEqual([body.callback, body.expected_details.first_name], ['https://shop.example/verified', 'Chinedu']);
    await finishReseller(sessionOf(started.url), 'Approved', { first_name: 'Chinedu', last_name: 'Okafor', issuing_state: 'GHA' });
    assert.equal((await browser.get('/v1/customers/gh-1/verification')).json.status, 'approved');
  });

  test('live customer checks need a live reseller and the customers:verify scope', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.post('/v1/customers/c/verification', customer)).json.error.code, 'reseller_not_verified');
    const key = (await browser.post('/v1/api-keys', { name: 'Orders', mode: 'test', scopes: ['orders:read'] })).json.secret;
    const res = await fetch(`${server.base}/v1/customers/c/verification`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal(res.status, 403);
  });
});

describe('payout accounts', () => {
  test('live accounts need a verified reseller and must be in its name', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'active' } });
    const add = number => browser.post('/v1/bank-accounts', { bank_code: '058', account_number: number });
    assert.equal((await add('0123456789')).json.error.code, 'reseller_not_verified');
    await prisma.reseller.update({ where: { id: resellerId }, data: { verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
    const stranger = await add('0987654321');
    assert.deepEqual([stranger.status, stranger.json.error.code], [400, 'account_name_mismatch']);
    assert.equal((await add('0123456789')).status, 201);
  });

  test('name matching', () => {
    assert.equal(namesMatch('Chinedu Okafor', 'OKAFOR CHINEDU EMEKA'), true);
    assert.equal(namesMatch('Chinédu Okafor', 'chinedu okafor'), true);
    assert.equal(namesMatch('Chinedu Okafor', 'Chinedu Nwosu'), false);
    assert.equal(namesMatch('Chinedu', 'Chinedu Okafor'), false, 'one name is not enough');
    assert.equal(accountNameMatches('ADA OBI DIGITAL', ['Ada Obi']), true);
    assert.equal(accountNameMatches('ADA DIGITAL VENTURES LTD', [null, 'Ada Digital']), true);
    assert.equal(accountNameMatches('GLOBAL SERVICES LTD', ['Global Services Ltd']), false, 'generic business words do not count');
    assert.equal(accountNameMatches('JOHN STRANGER', ['Ada Obi', 'Ada Digital']), false);
  });
});
