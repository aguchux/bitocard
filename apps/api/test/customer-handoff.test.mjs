// The sign-in handoff between BitoCard's own sites (docs/BITOCARD_CLASSIFIEDS_PLAN.md, phase 1 step 6): a bitocard.com
// customer signed in on one browser of bitocard.com gets a one-time code its server exchanges once, within 60 seconds and
// only there, for its own session. Country stores are retired (docs/BITOCARD_MULTI_WALLETS_PLAN.md), so ng.bitocard.com
// and the rest are never a target; resellers' stores never take part.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp({ env: { STOREFRONT_URL: 'https://bitocard.com', SHOP_URL: 'https://shop.bitocard.com' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(() => server?.close());

/** A store's server: its store named in `BitoCard-Store` (none: bitocard.com), the customer's session in a header. */
function storeServer(subdomain = null, initial = null) {
  let token = initial;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `handoff-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), token: () => token };
}

let counter = 0;
async function customer(subdomain = null) {
  const shopper = storeServer(subdomain);
  const email = `handoff${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Adaeze Okafor', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  shopper.id = signup.json.customer.id;
  return shopper;
}

describe('sign-in handoff', () => {
  test('bitocard.com: one code, once, a new session for the same account', async () => {
    const shopper = await customer();
    const issued = await shopper.post('/v1/store/account/handoff', { to: 'https://bitocard.com/' });
    assert.equal(issued.status, 200, JSON.stringify(issued.json));
    assert.match(issued.json.code, /^bch_[A-Za-z0-9_-]{40,}$/);
    assert.equal(issued.json.to, 'https://bitocard.com');
    const row = await prisma.customerHandoff.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.notEqual(row.codeHash, issued.json.code, 'only the hash is kept');

    const other = storeServer();
    assert.equal((await other.post('/v1/store/account/handoff/exchange', { code: issued.json.code, origin: 'https://ng.bitocard.com' })).json.error.code, 'handoff_invalid', 'only on the site it was made for');
    const exchanged = await other.post('/v1/store/account/handoff/exchange', { code: issued.json.code, origin: 'https://bitocard.com' });
    assert.equal(exchanged.status, 200, JSON.stringify(exchanged.json));
    assert.equal(exchanged.json.customer.id, shopper.id);
    assert.notEqual(other.token(), shopper.token(), 'a session of its own');
    assert.equal((await other.get('/v1/store/account')).json.id, shopper.id);
    assert.equal((await storeServer().post('/v1/store/account/handoff/exchange', { code: issued.json.code, origin: 'https://bitocard.com' })).json.error.code, 'handoff_invalid', 'once');

    const late = (await shopper.post('/v1/store/account/handoff', { to: 'https://bitocard.com' })).json;
    await prisma.customerHandoff.updateMany({ where: { usedAt: null, customerId: shopper.id }, data: { createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await storeServer().post('/v1/store/account/handoff/exchange', { code: late.code, origin: 'https://bitocard.com' })).json.error.code, 'handoff_invalid', 'codes expire after a minute');
  });

  test("crypto's and the Shop's sites, and the retired country stores, are not among them", async () => {
    const shopper = await customer();
    for (const to of ['https://crypto.bitocard.com', 'https://afrippa.com', 'https://shop.bitocard.com', 'https://udozo.com', 'https://ng.bitocard.com', 'https://gh.bitocard.com']) {
      assert.equal((await shopper.post('/v1/store/account/handoff', { to })).status, 400, to);
    }
    assert.equal((await fetch(`${server.base}/v1/storefronts/ng`)).status, 404, 'ng.bitocard.com is no store any more');
  });

  test("only BitoCard's own site, only BitoCard's own accounts, and never for a suspended account", async () => {
    const shopper = await customer();
    for (const to of ['https://evil.example', 'https://bitocard.com/path', 'http://bitocard.com', 'https://zz.bitocard.com', 'https://bitocard.com.evil.example', 'not a url']) {
      const refused = await shopper.post('/v1/store/account/handoff', { to });
      assert.deepEqual([refused.status, refused.json.error.param], [400, 'to'], to);
    }
    assert.equal((await storeServer().post('/v1/store/account/handoff', { to: 'https://bitocard.com' })).status, 401, 'signed in only');
    assert.equal((await storeServer().post('/v1/store/account/handoff/exchange', { code: 'bch_made-up', origin: 'https://bitocard.com' })).json.error.code, 'handoff_invalid');

    const reseller = await resellerClient(server);
    const subdomain = `handoffstore${Date.now() % 100000}`;
    const store = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
    await prisma.store.update({ where: { id: store.json.id }, data: { status: 'published', publishedAt: new Date() } });
    const theirs = await customer(subdomain);
    assert.equal((await theirs.post('/v1/store/account/handoff', { to: 'https://bitocard.com' })).json.error.code, 'handoff_unavailable');

    const code = (await shopper.post('/v1/store/account/handoff', { to: 'https://bitocard.com' })).json.code;
    await prisma.customer.update({ where: { id: shopper.id }, data: { status: 'disabled' } });
    assert.equal((await storeServer().post('/v1/store/account/handoff/exchange', { code, origin: 'https://bitocard.com' })).json.error.code, 'handoff_invalid');
  });
});
