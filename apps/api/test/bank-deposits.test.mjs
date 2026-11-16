// Bank deposits: where a market's `bank_deposits` switch is on and Golojan has a receiving account there, a customer
// asks to top up by paying cash into, or transferring to, that account, says "I've sent it", and finance credits what
// arrived (once) or rejects it saying why.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;

before(async () => {
  server = await startApp({ env: { CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server, ['finance', 'operations']);
});

after(async () => {
  await server?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
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

let counter = 0;
async function customer() {
  const shopper = storeServer();
  const email = `deposit${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Obi', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

const naira = async shopper => (await shopper.get('/v1/store/wallet')).json.wallets.find(item => item.currency === 'NGN').balance;
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

let account;

describe('bank deposits', () => {
  test('off by default, and nothing is offered without a receiving account', async () => {
    const shopper = await customer();
    const closed = await shopper.get('/v1/store/wallet/bank-deposits/options');
    assert.equal(closed.status, 200);
    assert.deepEqual([closed.json.available, closed.json.accounts], [false, []]);
    const refused = await shopper.post('/v1/store/wallet/bank-deposits', { amount: 500_000 });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'bank_deposits_unavailable']);

    assert.equal((await admin.put('/v1/admin/switches/bank_deposits', { country_code: 'NG', enabled: true })).status, 200);
    assert.equal((await shopper.get('/v1/store/wallet/bank-deposits/options')).json.available, false, 'switched on, but no account to pay into yet');
  });

  test('finance sets Golojan’s receiving accounts per market', async () => {
    const support = await adminClient(server, ['support']);
    const forbidden = await support.post('/v1/admin/bank-deposit-accounts', { country: 'NG', bank_name: 'Zenith Bank', account_name: 'Golojan Ltd', account_number: '1012345678' });
    assert.equal(forbidden.status, 403);
    const made = await admin.post('/v1/admin/bank-deposit-accounts', { country: 'NG', bank_name: 'Zenith Bank', account_name: 'De-Golojan Technologies Ltd', account_number: '1012345678', details: 'Write the reference as the description.' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.currency, 'NGN', "the market's currency by default");
    account = made.json;
    const listed = await support.get('/v1/admin/bank-deposit-accounts?country=NG');
    assert.deepEqual(listed.json.data.map(item => item.account_number), ['1012345678']);
  });

  test('a customer asks, pays, says they sent it, and finance credits what arrived, once', async () => {
    const shopper = await customer();
    const options = await shopper.get('/v1/store/wallet/bank-deposits/options');
    assert.equal(options.json.available, true);
    assert.equal(options.json.accounts[0].account_number, '1012345678');

    const made = await shopper.post('/v1/store/wallet/bank-deposits', { amount: 500_000, account_id: account.id });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const deposit = made.json;
    assert.equal(deposit.status, 'awaiting_payment');
    assert.match(deposit.number, /^BD-\d{6}$/);
    assert.match(deposit.reference, /^BC[A-Z2-9]{8}$/);
    assert.equal(deposit.account.account_name, 'De-Golojan Technologies Ltd');

    // A change to the account never changes what the customer was told.
    await admin.patch(`/v1/admin/bank-deposit-accounts/${account.id}`, { details: 'Use your reference.' });
    assert.equal((await shopper.get(`/v1/store/wallet/bank-deposits/${deposit.id}`)).json.account.details, 'Write the reference as the description.');

    // Others never see it.
    const other = await customer();
    assert.equal((await other.get(`/v1/store/wallet/bank-deposits/${deposit.id}`)).status, 404);

    const sent = await shopper.post(`/v1/store/wallet/bank-deposits/${deposit.id}/sent`, { method: 'transfer', sender_name: 'Ada Obi', note: 'From GTBank' });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.status, 'sent');
    assert.equal((await shopper.post(`/v1/store/wallet/bank-deposits/${deposit.id}/cancel`)).json.error.code, 'deposit_not_waiting', 'no cancelling once said sent');
    assert.equal(await naira(shopper), 0, 'nothing is credited on the customer’s word');

    const queue = await admin.get('/v1/admin/bank-deposits?status=sent');
    const row = queue.json.data.find(item => item.id === deposit.id);
    assert.equal(row.customer.name, 'Ada Obi');
    assert.equal(row.sender_name, 'Ada Obi');
    assert.ok((await admin.get(`/v1/admin/bank-deposits?q=${deposit.reference}`)).json.data.some(item => item.id === deposit.id), 'found by its reference');

    const ops = await adminClient(server, ['operations']);
    assert.equal((await ops.post(`/v1/admin/bank-deposits/${deposit.id}/credit`, {})).status, 403, 'only finance credits');

    // Less arrived than asked: what arrived is what is credited.
    const credited = await admin.post(`/v1/admin/bank-deposits/${deposit.id}/credit`, { amount: 450_000, external_reference: 'ZEN-77812' });
    assert.equal(credited.status, 200, JSON.stringify(credited.json));
    assert.deepEqual([credited.json.status, credited.json.credited_amount, credited.json.decided_by.id !== null], ['credited', 450_000, true]);
    assert.equal(await naira(shopper), 450_000);
    const again = await admin.post(`/v1/admin/bank-deposits/${deposit.id}/credit`, {});
    assert.deepEqual([again.status, again.json.error.code], [409, 'deposit_closed']);
    assert.equal(await naira(shopper), 450_000, 'credited once');
    await ledgerOk();
    const inbox = await prisma.notification.findFirst({ where: { customerId: shopper.id, type: 'customer.wallet.credited' } });
    assert.match(inbox.body, /4,500/);
  });

  test('rejected with why; cancelled and expired requests; at most three open', async () => {
    const shopper = await customer();
    const first = (await shopper.post('/v1/store/wallet/bank-deposits', { amount: 100_000 })).json;
    await shopper.post(`/v1/store/wallet/bank-deposits/${first.id}/sent`, { method: 'cash', sender_name: 'Ada Obi' });
    const rejected = await admin.post(`/v1/admin/bank-deposits/${first.id}/reject`, { reason: 'No deposit with this reference reached our account.' });
    assert.equal(rejected.json.status, 'rejected');
    const seen = await shopper.get(`/v1/store/wallet/bank-deposits/${first.id}`);
    assert.equal(seen.json.decision_note, 'No deposit with this reference reached our account.');
    assert.equal(await naira(shopper), 0);

    const second = (await shopper.post('/v1/store/wallet/bank-deposits', { amount: 100_000 })).json;
    assert.equal((await shopper.post(`/v1/store/wallet/bank-deposits/${second.id}/cancel`)).json.status, 'cancelled');

    const open = [];
    for (let i = 0; i < 3; i += 1) open.push((await shopper.post('/v1/store/wallet/bank-deposits', { amount: 100_000 })).json);
    const fourth = await shopper.post('/v1/store/wallet/bank-deposits', { amount: 100_000 });
    assert.deepEqual([fourth.status, fourth.json.error.code], [409, 'too_many_deposits']);

    // Past its window, unpaid: expired by the job, can no longer be marked sent, but finance can still credit it.
    await prisma.bankDeposit.update({ where: { id: open[0].id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const job = await fetch(`${server.base}/v1/cron/bank-deposits`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    assert.equal(job.result.expired, 1);
    const late = await shopper.post(`/v1/store/wallet/bank-deposits/${open[0].id}/sent`, { method: 'transfer', sender_name: 'Ada Obi' });
    assert.equal(late.json.error.code, 'deposit_not_waiting');
    assert.equal((await admin.post(`/v1/admin/bank-deposits/${open[0].id}/credit`, {})).json.status, 'credited');
    assert.equal(await naira(shopper), 100_000);

    // The Deposits list: every deposit newest first, filtered to open or done ones, a page at a time.
    const all = (await shopper.get('/v1/store/wallet/bank-deposits')).json;
    assert.equal(all.data.length, 5);
    assert.equal(all.has_more, false);
    assert.equal(all.data[0].id, open[2].id);
    assert.deepEqual((await shopper.get('/v1/store/wallet/bank-deposits?show=open')).json.data.map(item => item.id).sort(), [open[1].id, open[2].id].sort());
    assert.deepEqual(new Set((await shopper.get('/v1/store/wallet/bank-deposits?show=done')).json.data.map(item => item.status)), new Set(['credited', 'rejected', 'cancelled']));
    assert.deepEqual((await shopper.get('/v1/store/wallet/bank-deposits?show=rejected')).json.data.map(item => item.id), [first.id]);
    const page = (await shopper.get('/v1/store/wallet/bank-deposits?limit=3')).json;
    assert.deepEqual([page.data.length, page.has_more], [3, true]);
    const rest = (await shopper.get(`/v1/store/wallet/bank-deposits?limit=3&starting_after=${page.data[2].id}`)).json;
    assert.deepEqual([rest.data.length, rest.has_more], [2, false]);
    assert.equal(new Set([...page.data, ...rest.data].map(item => item.id)).size, 5);
    assert.equal((await shopper.get('/v1/store/wallet/bank-deposits?show=lost')).status, 400);
    await ledgerOk();
  });

  test('switched off for the market: no new requests', async () => {
    assert.equal((await admin.put('/v1/admin/switches/bank_deposits', { country_code: 'NG', enabled: false })).status, 200);
    const shopper = await customer();
    assert.equal((await shopper.get('/v1/store/wallet/bank-deposits/options')).json.available, false);
  });
});
