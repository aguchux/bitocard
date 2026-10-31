// VPNresellers stages 4–6: account transport, internal catalogue offer and idempotent fixed-term provisioning.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'node:http';

const { VpnresellersAdapter, vpnresellersStatus, vpnExpiry } = await import('../dist/suppliers/vpnresellers.adapter.js');
const { ProviderError } = await import('../dist/payments/provider-error.js');

let server;
let baseUrl;
const calls = [];
const provisioned = { account: null, expiry: null, status: 'Active' };
/** What the fake does next: `timeout` (no reply to the next create), `refuse` (a 400 on create), `never_expire` (ignore expiry). */
const fake = { create: 'ok', expire: 'ok', balance: '12.40' };

before(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : null;
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: parsed });
    res.setHeader('content-type', 'application/json');

    if (req.url?.startsWith('/accounts/check_username?')) {
      const username = new URL(req.url, 'http://x').searchParams.get('username');
      if (username === provisioned.account || username === 'bc-order-41') {
        res.statusCode = 422;
        res.end(JSON.stringify({ message: 'The username has already been taken.', errors: { username: ['The username has already been taken.'] }, code: 422 }));
        return;
      }
      res.end(JSON.stringify({ message: 'The username checking was successfully.', code: 200 }));
      return;
    }
    if (req.url === '/profile') {
      res.end(JSON.stringify({ data: { balance: fake.balance }, code: 200 }));
      return;
    }
    if ((req.url?.startsWith('/accounts?') || req.url?.startsWith('/projects/7/accounts?')) && req.method === 'GET') {
      res.end(JSON.stringify({ data: provisioned.account ? [{ id: 77, username: provisioned.account, status: provisioned.status, expired_at: provisioned.expiry }] : [], meta: { current_page: 1, last_page: 1, total: provisioned.account ? 1 : 0 }, code: 200 }));
      return;
    }
    if (req.url === '/accounts' && req.method === 'POST') {
      if (fake.create === 'refuse') {
        res.statusCode = 400;
        res.end(JSON.stringify({ message: 'Insufficient Balance.', code: 400 }));
        return;
      }
      const id = parsed.username === 'bc-stage6' ? 77 : 41;
      if (fake.create === 'timeout') {
        // The account is created but the reply never arrives (the client times out first).
        if (id === 77) provisioned.account = parsed.username;
        res.statusCode = 504;
        res.end(JSON.stringify({ message: 'Gateway Timeout', code: 504 }));
        return;
      }
      if (id === 77) provisioned.account = parsed.username;
      res.end(JSON.stringify({ data: { id, username: parsed.username, status: 'Active', expired_at: null }, code: 200 }));
      return;
    }
    if (req.url === '/accounts/402') {
      res.statusCode = 402;
      res.end(JSON.stringify({ message: 'Insufficient Balance.', code: 402 }));
      return;
    }
    if (req.url === '/accounts/41') {
      res.end(JSON.stringify({ data: { id: 41, username: 'bc-order-41', status: 'Disabled', expired_at: '2026-11-17T00:00:00.000000Z' }, code: 200 }));
      return;
    }
    if (req.url === '/accounts/77') {
      res.end(JSON.stringify({ data: { id: 77, username: provisioned.account, status: provisioned.status, expired_at: provisioned.expiry }, code: 200 }));
      return;
    }
    const stage6Action = req.url?.match(/^\/accounts\/77\/(enable|disable|change_password|expire)$/)?.[1];
    if (stage6Action) {
      if (stage6Action === 'disable') provisioned.status = 'Disabled';
      if (stage6Action === 'enable') provisioned.status = 'Active';
      if (stage6Action === 'expire' && fake.expire === 'ok') provisioned.expiry = parsed.expire_at ? `${parsed.expire_at}T00:00:00.000000Z` : null;
      res.end(JSON.stringify({ data: { id: 77, username: provisioned.account, status: provisioned.status, expired_at: provisioned.expiry }, code: 200 }));
      return;
    }
    const action = req.url?.match(/^\/accounts\/41\/(enable|disable|change_password|expire)$/)?.[1];
    if (action) {
      const status = action === 'disable' ? 'Disabled' : 'Active';
      const expired_at = action === 'expire' ? `${parsed.expire_at}T00:00:00.000000Z` : null;
      res.end(JSON.stringify({ data: { id: 41, username: 'bc-order-41', status, expired_at }, code: 200 }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'Account not found.', code: 404 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))));

const adapter = () => new VpnresellersAdapter({ apiToken: 'secret-token', projectId: '7', monthlyCostUsd: '1.99', baseUrl });

describe('VPNresellers adapter foundation', () => {
  test('is configured only with a token, valid project and positive expected cost, and publishes one internal offer', async () => {
    assert.equal(adapter().configured(), true);
    assert.equal(new VpnresellersAdapter({ apiToken: 'x', projectId: '0', monthlyCostUsd: '1.99', baseUrl }).configured(), false);
    const catalogue = await adapter().catalogue();
    assert.deepEqual([catalogue.length, catalogue[0].sku, catalogue[0].productKey, catalogue[0].category, catalogue[0].fixedValues], [1, 'vpn-30-day', 'vpn:WW:bitocard:vpn-access-30d', 'vpn', [199n]]);
    assert.deepEqual(adapter().syncs, ['vpn']);
  });

  test('creates and reads an account with bearer authentication and normalised state', async () => {
    const client = adapter();
    const created = await client.createAccount({
      username: 'bc-order-41',
      password: 'long-random-password',
      customer: { firstName: 'Ada', lastName: 'Agu', email: 'ada@example.com', projectId: 7 },
    });
    assert.deepEqual(created, { id: '41', username: 'bc-order-41', status: 'active', supplierStatus: 'Active', expiresAt: null });
    assert.deepEqual(calls.at(-1), {
      method: 'POST',
      url: '/accounts',
      authorization: 'Bearer secret-token',
      body: {
        username: 'bc-order-41',
        password: 'long-random-password',
        customer: { first_name: 'Ada', last_name: 'Agu', email: 'ada@example.com', project_id: 7 },
      },
    });

    const found = await client.getAccount('41');
    assert.equal(found.status, 'disabled');
    assert.equal(found.expiresAt.toISOString(), '2026-11-17T00:00:00.000Z');
  });

  test('sets expiry and exposes lifecycle methods without returning supplier private keys', async () => {
    const client = adapter();
    assert.equal((await client.enableAccount('41')).status, 'active');
    assert.equal((await client.disableAccount('41')).status, 'disabled');
    assert.equal((await client.changePassword('41', 'another-long-password')).status, 'active');
    const expired = await client.expireAccount('41', '2026-11-17');
    assert.equal(expired.expiresAt.toISOString(), '2026-11-17T00:00:00.000Z');
    assert.deepEqual(calls.at(-1).body, { expire_at: '2026-11-17' });
    await assert.rejects(client.expireAccount('41', '17/11/2026'), /YYYY-MM-DD/);
  });

  test('classifies a supplier balance refusal as definite', async () => {
    await assert.rejects(adapter().getAccount('402'), error => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 402);
      assert.equal(error.definite, true);
      assert.match(error.message, /Insufficient Balance/);
      return true;
    });
  });

  test('normalises only known account states', () => {
    assert.equal(vpnresellersStatus('Active'), 'active');
    assert.equal(vpnresellersStatus('Disabled'), 'disabled');
    assert.equal(vpnresellersStatus('Paused by support'), 'unknown');
  });

  const provisionRequest = (expiresAt = new Date('2026-11-17T00:00:00.000Z')) => ({
    reference: 'stage6',
    sku: 'vpn-30-day',
    meta: { term_days: 30 },
    category: 'vpn',
    country: 'WW',
    faceValue: 199n,
    faceCurrency: 'USD',
    quantity: 1,
    recipient: {},
    vpnCredentials: { username: 'bc-stage6', password: 'stable-secret-password', expiresAt },
  });
  const reset = () => {
    provisioned.account = null;
    provisioned.expiry = null;
    provisioned.status = 'Active';
    fake.create = 'ok';
    fake.expire = 'ok';
  };
  const creates = () => calls.filter(call => call.method === 'POST' && call.url === '/accounts' && call.body?.username === 'bc-stage6').length;

  test('creates once inside the project, sets and verifies expiry, then recovers the same account by username', async () => {
    reset();
    const client = adapter();
    const first = await client.placeOrder(provisionRequest());
    assert.equal(first.status, 'completed');
    assert.equal(first.supplierTransactionId, '77');
    assert.deepEqual(first.deliveries[0], {
      kind: 'vpn_account',
      code: 'stable-secret-password',
      serial: 'bc-stage6',
      details: { expires_at: '2026-11-17T00:00:00.000Z', duration: '30 days', devices: 'Up to 10', renewal: 'Does not renew automatically' },
    });
    assert.equal(first.vpns[0].expiresAt.toISOString(), '2026-11-17T00:00:00.000Z');
    const create = calls.findLast(call => call.method === 'POST' && call.url === '/accounts');
    // Inside BitoCard's project, under BitoCard's own customer record: no end-user details.
    assert.deepEqual(create.body.customer, { first_name: 'BitoCard', last_name: 'bc-stage6', email: 'vpn+bc-stage6@bitocard.com', project_id: 7 });
    assert.equal(calls.findLast(call => call.url === '/accounts/77/expire').body.expire_at, '2026-11-17');

    const before = creates();
    assert.equal((await client.orderStatus(provisionRequest())).status, 'completed');
    assert.equal((await client.placeOrder(provisionRequest())).status, 'completed', 'a repeated place finds the account');
    assert.equal(creates(), before, 'never a second create');
  });

  test('an unclear create stays pending and the status check finds the account without creating again', async () => {
    reset();
    fake.create = 'timeout';
    const client = adapter();
    const placed = await client.placeOrder(provisionRequest());
    assert.equal(placed.status, 'pending');
    const before = creates();
    fake.create = 'ok';
    const checked = await client.orderStatus(provisionRequest());
    assert.equal(checked.status, 'completed');
    assert.equal(checked.supplierTransactionId, '77');
    assert.equal(creates(), before, 'the status check never creates');
  });

  test('a status check that finds no account stays pending and never creates one', async () => {
    reset();
    const before = creates();
    const checked = await adapter().orderStatus(provisionRequest());
    assert.equal(checked.status, 'pending');
    assert.equal(creates(), before);
  });

  test('a clear refusal before any account exists fails the order', async () => {
    reset();
    fake.create = 'refuse';
    await assert.rejects(adapter().placeOrder(provisionRequest()), error => error instanceof ProviderError && error.definite && !/stable-secret-password/.test(error.message));
  });

  test('an account whose expiry does not stick never completes (it would renew and bill every day)', async () => {
    reset();
    fake.expire = 'ignored';
    const placed = await adapter().placeOrder(provisionRequest());
    assert.equal(placed.status, 'pending');
    assert.equal(placed.supplierTransactionId, '77');
    assert.match(placed.detail, /expiry is not confirmed/);
  });

  test('refuses other products and missing credentials before calling the supplier', async () => {
    const before = calls.length;
    await assert.rejects(adapter().placeOrder({ ...provisionRequest(), sku: 'other' }), error => error.definite);
    await assert.rejects(adapter().placeOrder({ ...provisionRequest(), vpnCredentials: undefined }), error => error.definite);
    assert.equal(calls.length, before);
  });

  test('access always lasts at least 30 full days and ends at midnight UTC', () => {
    assert.equal(vpnExpiry(new Date('2026-10-18T09:15:00.000Z')).toISOString(), '2026-11-18T00:00:00.000Z');
    assert.equal(vpnExpiry(new Date('2026-10-18T00:00:00.000Z')).toISOString(), '2026-11-17T00:00:00.000Z');
    assert.equal(vpnExpiry(new Date('2026-10-18T23:59:59.000Z')).toISOString(), '2026-11-18T00:00:00.000Z');
  });

  test('reads the credit and the project’s active accounts', async () => {
    reset();
    provisioned.account = 'bc-stage6';
    assert.equal(await adapter().balanceUsd(), 12.4);
    const { accounts, complete } = await adapter().listAccounts('Active');
    assert.equal(complete, true);
    assert.deepEqual(accounts.map(item => item.id), ['77']);
    assert.match(calls.findLast(call => call.url?.startsWith('/projects/7/accounts')).url, /status=Active/);
  });
});
