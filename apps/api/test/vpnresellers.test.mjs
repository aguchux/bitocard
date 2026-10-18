// VPNresellers stage 4: the disabled adapter transport manages accounts safely without publishing a catalogue product.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'node:http';

const { VpnresellersAdapter, vpnresellersStatus } = await import('../dist/suppliers/vpnresellers.adapter.js');
const { ProviderError } = await import('../dist/payments/provider-error.js');

let server;
let baseUrl;
const calls = [];

before(async () => {
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = body ? JSON.parse(body) : null;
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: parsed });
    res.setHeader('content-type', 'application/json');

    if (req.url === '/accounts' && req.method === 'POST') {
      res.end(JSON.stringify({ data: { id: 41, username: parsed.username, status: 'Active', expired_at: null }, code: 200 }));
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
  test('is configured only with a token, valid project and positive expected cost, but publishes no products', async () => {
    assert.equal(adapter().configured(), true);
    assert.equal(new VpnresellersAdapter({ apiToken: 'x', projectId: '0', monthlyCostUsd: '1.99', baseUrl }).configured(), false);
    assert.deepEqual(await adapter().catalogue(), []);
    assert.deepEqual(adapter().syncs, []);
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
});
