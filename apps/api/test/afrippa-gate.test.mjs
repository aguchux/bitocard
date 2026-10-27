// Afrippa's own surface (docs/CRYPTO_SPINOFF_PLAN.md, step 2, items 3 and 4): its operator account and store, kept
// out of BitoCard, and the gate in front of its customer and public routes, which only its server, signing every
// request with AFRIPPA_SERVER_SECRET, can pass. Signed requests always act for Afrippa's store, so a bitocard.com
// customer's session never counts there.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, lastEmailCode, startApp } from './helpers.mjs';

const { signAfrippaRequest, verifyAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { afrippaOperatorId, afrippaStoreId } = await import('../dist/afrippa/ids.js');
const { loadConfig } = await import('../dist/config/config.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');

const secret = 'afrippa-test-secret-afrippa-test-secret';
const storeSecret = 'store-test-secret-store-test-secret-0';
let server;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, STORE_SERVER_SECRET: storeSecret, CHECKOUT_SANDBOX: 'on' } });
});

after(async () => {
  await server?.close();
});

/** A request as Afrippa's server sends it: the method, address and exact body signed. */
async function afrippa(app, method, url, { body, headers = {}, key = secret, at = Date.now(), signedUrl = url, signedBody } = {}) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const signature = signAfrippaRequest(key, { method, url: signedUrl, body: signedBody ?? raw }, at);
  const res = await fetch(`${app.base}${url}`, {
    method,
    headers: {
      'afrippa-signature': signature,
      ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method === 'POST' ? { 'idempotency-key': `afrippa-${Date.now()}-${Math.random()}` } : {}),
      ...headers,
    },
    body: raw,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const missing = res => assert.deepEqual([res.status, res.json?.error?.code], [404, 'resource_missing'], JSON.stringify(res.json));

async function bitocardCustomer(app) {
  const post = async (path, body, token) => {
    const res = await fetch(`${app.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `c-${Date.now()}-${Math.random()}`, ...(token ? { 'bitocard-customer-session': token } : {}) },
      body: JSON.stringify(body),
    });
    return res.json();
  };
  const email = `trader-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const signup = await post('/v1/store/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  await post('/v1/store/account/email/verify', { code: await lastEmailCode(app.app, email) }, signup.session.token);
  return signup.session.token;
}

describe("Afrippa's operator account and store", () => {
  test('are seeded as Afrippa’s, the store unpublished and never given a bitocard.com address', async () => {
    const prisma = server.app.get(PrismaService);
    const operator = await prisma.reseller.findUniqueOrThrow({ where: { id: afrippaOperatorId } });
    const store = await prisma.store.findUniqueOrThrow({ where: { id: afrippaStoreId } });
    assert.deepEqual([operator.platform, operator.house, operator.name], ['afrippa', false, 'Afrippa']);
    assert.deepEqual([store.platform, store.subdomain, store.status, store.resellerId], ['afrippa', 'afrippa', 'draft', afrippaOperatorId]);
    // The address job never picks it up.
    await prisma.store.update({ where: { id: afrippaStoreId }, data: { hostStatus: 'pending' } });
    const { StoreHostsService } = await import('../dist/stores/store-hosts.service.js');
    assert.equal(await server.app.get(StoreHostsService).sync(afrippaStoreId), null);
    await prisma.store.update({ where: { id: afrippaStoreId }, data: { hostStatus: 'none' } });
  });

  test("are not BitoCard's: left out of the admin's resellers and refused on a reseller's page", async () => {
    const admin = await adminClient(server);
    const list = (await admin.get('/v1/admin/resellers')).json.data;
    assert.equal(list.some(item => item.id === afrippaOperatorId), false);
    assert.equal((await admin.get(`/v1/admin/resellers/${afrippaOperatorId}`)).status, 404);
    assert.equal((await admin.patch(`/v1/admin/resellers/${afrippaOperatorId}`, { status: 'suspended' })).status, 404);
  });

  test("BitoCard's storefront never serves the store (its name is reserved: stores.test.mjs)", async () => {
    assert.equal((await fetch(`${server.base}/v1/storefronts/afrippa`)).status, 404);
    assert.equal((await fetch(`${server.base}/v1/store/products?store=afrippa`)).status, 404);
  });
});

describe('the gate in front of Afrippa’s routes', () => {
  test('lets through only what Afrippa’s server signed: method, address and body exactly', async () => {
    assert.equal((await afrippa(server, 'GET', '/v1/afrippa/markets')).status, 200);
    missing(await fetch(`${server.base}/v1/afrippa/markets`).then(async res => ({ status: res.status, json: await res.json() })));
    missing(await afrippa(server, 'GET', '/v1/afrippa/markets', { key: 'another-secret-another-secret-another-se' }));
    missing(await afrippa(server, 'GET', '/v1/afrippa/markets?x=1', { signedUrl: '/v1/afrippa/markets' }));
    missing(await afrippa(server, 'GET', '/v1/afrippa/traders/Ada', { signedUrl: '/v1/afrippa/markets' }));
    missing(await afrippa(server, 'GET', '/v1/afrippa/markets', { at: Date.now() - 6 * 60_000 }));
    missing(await afrippa(server, 'GET', '/v1/afrippa/markets', { at: Date.now() + 6 * 60_000 }));
    // A body changed after signing is another request.
    const body = { version: '2026-10-27' };
    missing(await afrippa(server, 'POST', '/v1/afrippa/crypto/declaration', { body, signedBody: JSON.stringify({ version: 'x' }) }));
  });

  test("signed requests act for Afrippa's store: a bitocard.com customer's session is not signed in there", async () => {
    const token = await bitocardCustomer(server);
    const asked = await afrippa(server, 'GET', '/v1/afrippa/crypto', { headers: { 'bitocard-customer-session': token, 'bitocard-store': 'bitocard' } });
    assert.equal(asked.status, 401, JSON.stringify(asked.json));
    // The same customer on BitoCard's own routes is signed in as ever.
    const own = await fetch(`${server.base}/v1/store/account`, { headers: { 'bitocard-customer-session': token } });
    assert.equal(own.status, 200);
  });

  test("Afrippa's admin and chain notifications have their own checks, and the retired routes stay shut even signed", async () => {
    const admin = await afrippaAdminClient(server);
    assert.equal((await admin.get('/v1/afrippa/admin/crypto/assets')).status, 200);
    missing(await afrippa(server, 'GET', '/v1/crypto'));
    missing(await afrippa(server, 'GET', '/v1/exchange/desk'));
  });

  test('without AFRIPPA_SERVER_SECRET nothing can be signed, so the routes stay shut', async () => {
    const unset = await startApp({ env: { CRYPTO_ROUTES: 'closed' } });
    try {
      missing(await afrippa(unset, 'GET', '/v1/afrippa/markets'));
    } finally {
      await unset.close();
    }
  });

  test('the signature: a known vector, and nothing malformed is accepted', () => {
    const at = Date.UTC(2026, 9, 27, 12);
    const header = signAfrippaRequest('k'.repeat(32), { method: 'post', url: '/v1/afrippa/p2p/trades?preview=1', body: '{"a":1}' }, at);
    const t = String(at / 1000);
    const bodyHash = createHash('sha256').update('{"a":1}').digest('hex');
    const expected = createHmac('sha256', 'k'.repeat(32)).update(`${t}.POST./v1/afrippa/p2p/trades?preview=1.${bodyHash}`).digest('hex');
    assert.equal(header, `t=${t},v1=${expected}`);
    const request = { method: 'POST', url: '/v1/afrippa/p2p/trades?preview=1', body: Buffer.from('{"a":1}') };
    assert.equal(verifyAfrippaRequest(header, 'k'.repeat(32), request, at), true);
    for (const bad of [undefined, '', 't=1', `v1=${expected}`, `t=${t},v1=zz`, `t=abc,v1=${expected}`, `${header},`.repeat(10)]) {
      assert.equal(verifyAfrippaRequest(bad, 'k'.repeat(32), request, at), false, String(bad));
    }
    assert.equal(verifyAfrippaRequest(header, undefined, request, at), false);
  });

  test('its secret is its own: production starts only with two different secrets', () => {
    assert.throws(() => loadConfig({ AFRIPPA_SERVER_SECRET: secret, STORE_SERVER_SECRET: secret }), /AFRIPPA_SERVER_SECRET must differ/);
    assert.throws(() => loadConfig({ AFRIPPA_SERVER_SECRET: 'too-short' }), /AFRIPPA_SERVER_SECRET/);
    assert.equal(loadConfig({ AFRIPPA_SERVER_SECRET: secret, STORE_SERVER_SECRET: storeSecret }).AFRIPPA_SERVER_SECRET, secret);
  });
});

describe("Afrippa's visitors are rate limited one by one", () => {
  test("by the address Afrippa's server signs with its own secret, never one a store's server signed", async () => {
    const limited = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, STORE_SERVER_SECRET: storeSecret, RATE_LIMIT_PER_MINUTE: '2' } });
    const visitor = (ip, key) => {
      const t = String(Math.floor(Date.now() / 1000));
      return { 'bitocard-client': `t=${t},ip=${ip},v1=${createHmac('sha256', key).update(`${t}.${ip}`).digest('hex')}` };
    };
    try {
      const get = headers => afrippa(limited, 'GET', '/v1/afrippa/markets', { headers });
      assert.deepEqual([(await get(visitor('203.0.113.1', secret))).status, (await get(visitor('203.0.113.1', secret))).status], [200, 200]);
      assert.equal((await get(visitor('203.0.113.1', secret))).status, 429);
      assert.equal((await get(visitor('203.0.113.2', secret))).status, 200, 'another visitor has their own limit');
      // Addresses a store's server signed are not taken here: those requests all count as the caller's own address.
      assert.deepEqual([(await get(visitor('203.0.113.3', storeSecret))).status, (await get(visitor('203.0.113.4', storeSecret))).status], [200, 200]);
      assert.equal((await get(visitor('203.0.113.5', storeSecret))).status, 429);
    } finally {
      await limited.close();
    }
  });
});
