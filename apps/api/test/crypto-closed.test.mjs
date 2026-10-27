// Crypto has left BitoCard (docs/CRYPTO_SPINOFF_PLAN.md): with CRYPTO_ROUTES closed (the default), every crypto route
// for store customers, resellers and the public answers as an unknown route does, while the cash-out Safe pay sellers
// use stays at /v1/store/cash. Production refuses to open them.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

const { loadConfig } = await import('../dist/config/config.js');
const { closedCryptoRoutes } = await import('../dist/crypto/closed.guard.js');

let server;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', CHECKOUT_SANDBOX: 'on' } });
});

after(async () => {
  await server?.close();
});

async function customer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `closed-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  const shopper = { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
  const email = `closed-${Date.now()}@example.com`;
  assert.equal((await shopper.post('/v1/store/account/signup', { name: 'Ada Closed', email, password: 'correct horse battery', country: 'NG' })).status, 201);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  return shopper;
}

describe('crypto is closed to BitoCard', () => {
  test('store customers get an unknown route for every crypto, P2P and exchange address', async () => {
    const shopper = await customer();
    for (const path of ['/v1/store/crypto', '/v1/store/crypto/deposits', '/v1/store/p2p/market?asset=USDT&side=buy', '/v1/store/crypto/cash', '/v1/crypto/markets']) {
      const res = await shopper.get(path);
      assert.equal(res.status, 404, path);
      assert.deepEqual([res.json.error.type, res.json.error.code, res.json.error.message], ['not_found_error', 'resource_missing', 'No such resource or route.'], path);
    }
    assert.equal((await shopper.post('/v1/store/exchange/quotes', { asset: 'USDT', side: 'buy', fiat: 1000 })).status, 404);
  });

  test("resellers' crypto and exchange routes are gone too, and left out of the OpenAPI document", async () => {
    const reseller = await resellerClient(server);
    assert.equal((await reseller.browser.get('/v1/crypto')).status, 404);
    assert.equal((await reseller.browser.get('/v1/exchange/desk')).status, 404);
    const document = (await reseller.browser.get('/v1/openapi.json')).json;
    const paths = Object.keys(document.paths);
    assert.equal(paths.filter(path => closedCryptoRoutes.test(path)).length, 0, paths.filter(path => closedCryptoRoutes.test(path)).join(', '));
    assert.equal((document.tags ?? []).some(tag => ['Crypto', 'Exchange'].includes(tag.name)), false);
  });

  test("the cash-out for Safe pay sellers stays, at /v1/store/cash", async () => {
    const shopper = await customer();
    const accounts = await shopper.get('/v1/store/cash/bank-accounts');
    assert.equal(accounts.status, 200, JSON.stringify(accounts.json));
    assert.deepEqual(accounts.json.data, []);
    assert.equal((await shopper.get('/v1/store/cash/payouts')).status, 200);
  });

  test('admin routes are not closed by it (they move with Afrippa), and only these prefixes are', () => {
    for (const path of ['/v1/admin/crypto/assets', '/v1/store/cash', '/v1/store/spins', '/v1/store/wallet', '/v1/webhooks/chain/alchemy', '/v1/cryptography']) {
      assert.equal(closedCryptoRoutes.test(path), false, path);
    }
    for (const path of ['/v1/store/crypto', '/v1/store/crypto/cash', '/v1/store/p2p/ads', '/v1/store/exchange/quotes', '/v1/crypto', '/v1/crypto/markets', '/v1/exchange/desk']) {
      assert.equal(closedCryptoRoutes.test(path), true, path);
    }
  });

  test("BitoCard's admins no longer see the blockchain integrations (they are Afrippa's)", async () => {
    const admin = await adminClient(server);
    const list = (await admin.get('/v1/admin/integrations')).json.data;
    assert.equal(list.some(item => item.section === 'blockchain'), false);
    assert.ok(list.some(item => item.section === 'platform'));
  });

  test('production refuses to open them', () => {
    assert.throws(() => loadConfig({ APP_ENV: 'production', CRYPTO_ROUTES: 'open' }), /CRYPTO_ROUTES must be closed in production/);
    assert.equal(loadConfig({}).CRYPTO_ROUTES, 'closed');
  });
});
