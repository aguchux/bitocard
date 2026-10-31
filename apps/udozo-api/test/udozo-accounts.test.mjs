// Udozo (docs/UDOZO_SPINOFF_PLAN.md, step 3): one Udozo account works on udozo.com and on every reseller's store, and
// its sign-in hands over to stores' sandbox addresses and their own domains. On BitoCard a reseller's store keeps its own.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { lastEmailCode, resellerClient, startApp } from './helpers.mjs';

const houseStoreId = '00000000-0000-4000-8000-0000000000b2';
let server;
let prisma;
let store;
let counter = 0;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', STOREFRONT_URL: 'https://udozo.com' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  const owner = await resellerClient(server);
  store = await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Gadget Hub', subdomain: `gadgets${Date.now() % 100000}`, status: 'published' } });
});

after(() => server?.close());

/** A site's server: `store` names the store (none: udozo.com), the session kept as the site would. */
function site(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `udz-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), token: () => token, use: value => (token = value) };
}

async function signUp(at, country = 'NG') {
  const email = `udz${(counter += 1)}-${Date.now()}@example.com`;
  const made = await at.post('/v1/store/account/signup', { name: 'Amaka Eze', email, password: 'correct horse battery', country });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await at.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  return { email, id: made.json.customer.id };
}

describe('one Udozo account', () => {
  test('signing up on a store makes a Udozo account; it signs in on udozo.com and on every store', async () => {
    const atStore = site(store.subdomain);
    const { email, id } = await signUp(atStore);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id } })).storeId, houseStoreId, "the account is Udozo's, not the store's");

    const home = site();
    assert.equal((await home.post('/v1/store/account/signin', { email, password: 'correct horse battery' })).status, 200);
    assert.equal((await home.get('/v1/store/account')).json.id, id);
    // The same session shops at the store too.
    const there = site(store.subdomain);
    there.use(home.token());
    assert.equal((await there.get('/v1/store/account')).json.id, id);
    // And signing in at another store finds the same account.
    const other = await prisma.store.create({ data: { resellerId: store.resellerId, name: 'Second', subdomain: `second${Date.now() % 100000}`, status: 'published' } });
    const atOther = site(other.subdomain);
    assert.equal((await atOther.post('/v1/store/account/signin', { email, password: 'correct horse battery' })).json.customer.id, id);
  });

  test('a store that is not open is not a place to shop', async () => {
    const draft = await prisma.store.create({ data: { resellerId: store.resellerId, name: 'Draft', subdomain: `draft${Date.now() % 100000}`, status: 'draft' } });
    const home = site();
    await signUp(home);
    const there = site(draft.subdomain);
    there.use(home.token());
    assert.equal((await there.get('/v1/store/account')).status, 401);
  });
});

describe("Udozo's sign-in handoff", () => {
  test("from udozo.com to a store's sandbox address and to its own domain; never anywhere else", async () => {
    const home = site();
    const { id } = await signUp(home);
    const toSubdomain = await home.post('/v1/store/account/handoff', { to: `https://${store.subdomain}.udozo.com` });
    assert.equal(toSubdomain.status, 200, JSON.stringify(toSubdomain.json));
    const there = site(store.subdomain);
    assert.equal((await there.post('/v1/store/account/handoff/exchange', { code: toSubdomain.json.code, origin: `https://${store.subdomain}.udozo.com` })).json.customer.id, id);
    assert.equal((await there.get('/v1/store/account')).json.id, id);

    const name = `gadgets${Date.now() % 100000}.example`;
    const domain = await prisma.storeDomain.create({ data: { storeId: store.id, resellerId: store.resellerId, name, source: 'connected', status: 'active', primary: true } });
    for (const origin of [`https://${name}`, `https://www.${name}`]) assert.equal((await home.post('/v1/store/account/handoff', { to: origin })).status, 200, origin);
    for (const origin of [`http://${name}`, `https://${name}:8443`, 'https://elsewhere.example', 'https://shop.bitocard.com', 'https://bitocard.com']) {
      assert.equal((await home.post('/v1/store/account/handoff', { to: origin })).status, 400, origin);
    }
    await prisma.storeDomain.update({ where: { id: domain.id }, data: { status: 'suspended' } });
    assert.equal((await home.post('/v1/store/account/handoff', { to: `https://${name}` })).status, 400, 'a domain that is not active');
  });
});
