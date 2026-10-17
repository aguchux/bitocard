// Finance admins' manual top-ups of reseller and customer wallets: nothing moves until the admin who asked enters the
// code emailed to them; then one ledger entry credits the wallet once (from the provider balance for money received,
// from adjustments for goodwill), audited, with the reseller or customer told.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let finance;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  finance = await adminClient(server, ['finance']);
});

after(() => server?.close());

const ledgerOk = async () => assert.equal((await finance.get('/v1/admin/ledger/check')).json.ok, true);
const code = () => lastEmailCode(server.app, finance.admin.email);

let counter = 0;
async function customer() {
  const headers = { 'content-type': 'application/json' };
  let token = null;
  const post = async (path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `mt-${Math.random()}`, ...(token ? { 'bitocard-customer-session': token } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  const get = async path => {
    const res = await fetch(`${server.base}${path}`, { headers: { 'bitocard-customer-session': token } });
    return { status: res.status, json: await res.json() };
  };
  const email = `topup${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await post('/v1/store/account/signup', { name: 'Chi Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  return { id: signup.json.customer.id, email, get };
}

describe('reseller top-ups', () => {
  test('money received: the code emailed to the admin confirms it, once, into topped-up funds', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const asked = await finance.post(`/v1/admin/resellers/${resellerId}/top-ups`, { amount: 250000, source: 'received', external_reference: 'GTB-778812', reason: 'Bank transfer to BitoCard' });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.deepEqual([asked.json.status, asked.json.currency, asked.json.mode, asked.json.target.type], ['awaiting_code', 'NGN', 'live', 'reseller']);
    assert.match(asked.json.number, /^MT-\d{6}$/);
    assert.equal((await browser.get('/v1/wallet')).json.available, 0, 'nothing moves before the code');

    const sent = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox.at(-1);
    assert.equal(sent.to, finance.admin.email);
    assert.match(sent.text, /NGN 2,500\.00/);
    assert.match(sent.text, /Ada Digital/);

    const wrong = await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: (await code()) === '000000' ? '111111' : '000000' });
    assert.equal(wrong.json.error.code, 'code_invalid');

    const done = await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: await code() });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.status, 'completed');
    const wallet = (await browser.get('/v1/wallet')).json;
    assert.equal(wallet.available, 250000);
    assert.equal(wallet.earnings.withdrawable, 0, 'topped-up funds are never withdrawable');

    const again = await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: await code() });
    assert.equal(again.json.error.code, 'top_up_not_awaiting_code');
    assert.equal((await browser.get('/v1/wallet')).json.available, 250000, 'credited once');

    const entry = await prisma.journalEntry.findUnique({ where: { reference: `manual_top_up:${asked.json.id}` }, include: { postings: { include: { account: true } } } });
    assert.equal(entry.type, 'top_up');
    assert.ok(entry.postings.some(posting => posting.account.kind === 'provider_balance' && posting.account.ownerKey === 'provider:manual'));
    const txns = (await browser.get('/v1/wallet/transactions')).json.data;
    assert.deepEqual([txns[0].type, txns[0].amount], ['top_up', 250000]);

    const history = (await finance.get(`/v1/admin/resellers/${resellerId}/history`)).json.data;
    assert.ok(history.some(item => item.action === 'wallet.manual_top_up_requested'));
    assert.ok(history.some(item => item.action === 'wallet.manual_top_up' && item.after.external_reference === 'GTB-778812'));
    assert.ok(await prisma.notification.findFirst({ where: { resellerId, type: 'top_up.credited' } }), 'the reseller is told');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.wallet.manual_top_up', link: `/resellers/${resellerId}` } }), 'finance admins are told');
    await ledgerOk();
  });

  test('goodwill into the US dollar wallet in the sandbox comes from adjustments', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const asked = await finance.post(`/v1/admin/resellers/${resellerId}/top-ups`, { mode: 'test', currency: 'usd', amount: 1500, source: 'goodwill', reason: 'Sorry for the delay' });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.equal((await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: await code() })).status, 200);
    const entry = await prisma.journalEntry.findUnique({ where: { reference: `manual_top_up:${asked.json.id}` }, include: { postings: { include: { account: true } } } });
    assert.equal(entry.type, 'adjustment');
    assert.ok(entry.postings.some(posting => posting.account.kind === 'adjustments' && posting.account.currency === 'USD'));
    const usd = (await browser.get('/v1/wallet?currency=USD', { 'bitocard-mode': 'test' })).json;
    assert.equal(usd.available, 1500);
    assert.equal((await browser.get('/v1/wallet?currency=USD')).json.available, 0, 'live is untouched');
    await ledgerOk();
  });

  test('wrong currency, missing reference, house accounts and the wrong roles are refused', async () => {
    const { resellerId } = await resellerClient(server);
    assert.equal((await finance.post(`/v1/admin/resellers/${resellerId}/top-ups`, { currency: 'GHS', amount: 100, source: 'goodwill', reason: 'Wrong wallet' })).json.error.code, 'currency_unsupported');
    assert.equal((await finance.post(`/v1/admin/resellers/${resellerId}/top-ups`, { amount: 100, source: 'received', reason: 'No reference' })).json.error.param, 'external_reference');
    assert.equal((await finance.post(`/v1/admin/resellers/${resellerId}/top-ups`, { amount: 0, source: 'goodwill', reason: 'Nothing' })).status, 400);
    const house = await prisma.reseller.findFirst({ where: { house: true } });
    assert.equal((await finance.post(`/v1/admin/resellers/${house.id}/top-ups`, { amount: 100, source: 'goodwill', reason: 'House account' })).json.error.code, 'house_account');

    for (const role of ['operations', 'support']) {
      const other = await adminClient(server, [role]);
      assert.equal((await other.post(`/v1/admin/resellers/${resellerId}/top-ups`, { amount: 100, source: 'goodwill', reason: 'Not allowed' })).status, 403, role);
      assert.equal((await other.get(`/v1/admin/top-ups?reseller_id=${resellerId}`)).status, 200, `${role} can read`);
    }
  });
});

describe('codes', () => {
  test('only the admin who asked confirms; five wrong attempts, expiry, resend once a minute, cancel', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const asked = (await finance.post(`/v1/admin/resellers/${resellerId}/top-ups`, { amount: 900, source: 'goodwill', reason: 'Testing codes' })).json;
    const right = await code();

    const colleague = await adminClient(server, ['finance']);
    assert.equal((await colleague.post(`/v1/admin/top-ups/${asked.id}/confirm`, { code: right })).json.error.code, 'not_requester');

    assert.equal((await finance.post(`/v1/admin/top-ups/${asked.id}/resend-code`)).json.error.code, 'code_recently_sent');

    const wrongCode = right === '123456' ? '654321' : '123456';
    const guesses = await Promise.all(Array.from({ length: 8 }, () => finance.post(`/v1/admin/top-ups/${asked.id}/confirm`, { code: wrongCode })));
    assert.equal(guesses.filter(guess => guess.json.error.code === 'code_invalid').length, 5, 'parallel guesses never pass the limit');
    assert.equal((await finance.post(`/v1/admin/top-ups/${asked.id}/confirm`, { code: right })).json.error.code, 'code_attempts_exceeded');

    // A minute later a fresh code starts the attempts again.
    await prisma.manualTopUp.update({ where: { id: asked.id }, data: { codeSentAt: new Date(Date.now() - 61_000) } });
    assert.equal((await finance.post(`/v1/admin/top-ups/${asked.id}/resend-code`)).status, 200);
    const fresh = await code();

    await prisma.manualTopUp.update({ where: { id: asked.id }, data: { codeExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await finance.get(`/v1/admin/top-ups/${asked.id}`)).json.status, 'expired');
    assert.equal((await finance.post(`/v1/admin/top-ups/${asked.id}/confirm`, { code: fresh })).json.error.code, 'code_expired');

    const cancelled = await colleague.post(`/v1/admin/top-ups/${asked.id}/cancel`);
    assert.equal(cancelled.json.status, 'cancelled');
    assert.equal((await colleague.post(`/v1/admin/top-ups/${asked.id}/cancel`)).json.error.code, 'top_up_not_awaiting_code');
    assert.equal((await browser.get('/v1/wallet')).json.available, 0);
    const listed = (await finance.get(`/v1/admin/top-ups?reseller_id=${resellerId}`)).json.data;
    assert.deepEqual(listed.map(item => item.status), ['cancelled']);
  });
});

describe('customer top-ups', () => {
  test("a customer's wallet is credited in their store's mode and they are told", async () => {
    const shopper = await customer();
    const asked = await finance.post(`/v1/admin/customers/${shopper.id}/top-ups`, { amount: 50000, source: 'received', external_reference: 'TRF-1', reason: 'Paid at the office' });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.deepEqual([asked.json.target.type, asked.json.target.email, asked.json.currency], ['customer', shopper.email, 'NGN']);
    const other = asked.json.mode === 'live' ? 'test' : 'live';
    assert.equal((await finance.post(`/v1/admin/customers/${shopper.id}/top-ups`, { mode: other, amount: 1, source: 'goodwill', reason: 'Other mode' })).json.error.code, 'mode_mismatch');

    assert.equal((await shopper.get('/v1/store/wallet')).json.balance, 0);
    assert.equal((await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: await code() })).status, 200);
    assert.equal((await shopper.get('/v1/store/wallet')).json.balance, 50000);
    const txns = (await shopper.get('/v1/store/wallet/transactions')).json.data;
    assert.deepEqual([txns[0].type, txns[0].amount], ['customer_top_up', 50000]);
    const entry = await prisma.journalEntry.findUnique({ where: { reference: `manual_top_up:${asked.json.id}` } });
    assert.equal(entry.resellerId, null, "kept out of the seller's wallet transactions");
    assert.ok(await prisma.notification.findFirst({ where: { customerId: shopper.id, type: 'customer.wallet.credited' } }));
    assert.ok((await finance.get(`/v1/admin/top-ups?customer_id=${shopper.id}`)).json.data.length === 1);
    await ledgerOk();
  });
});
