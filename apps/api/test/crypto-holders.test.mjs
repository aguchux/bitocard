// What a customer already holds stays theirs: closing a reseller's store, switching crypto off or delisting a coin never
// traps their crypto or P2P money. They can still see it, close their ads and withdraw; only new business is refused.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;

before(async () => {
  server = await startApp({ env: { CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
});

const switches = async enabled => {
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    assert.equal((await admin.put(`/v1/admin/switches/${key}`, { enabled })).status, 200);
    // Crypto trading is open only in countries switched on by themselves (the global level never allows a country).
    assert.equal((await admin.put(`/v1/admin/switches/${key}`, { enabled, country_code: 'NG' })).status, 200);
  }
};
const outside = '0x52908400098527886E0F7030069857D2E4169EE7';

function storeServer(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `holder-${Date.now()}-${Math.random()}` } : {}),
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
async function customer(subdomain = null) {
  const shopper = storeServer(subdomain);
  const email = `holder${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Holder', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  // Trading needs the crypto declaration (not a US or UK citizen or resident).
  assert.equal((await shopper.post('/v1/afrippa/crypto/declaration', { version: (await shopper.get('/v1/afrippa/crypto/declaration')).json.version })).status, 200);
  return shopper;
}

async function resellerStore() {
  const reseller = await resellerClient(server);
  await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
  const created = await reseller.browser.post('/v1/stores', { name: 'Ada Coins', subdomain: `coin${Date.now().toString(36)}` });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await reseller.browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
  return { id: created.json.id, subdomain: created.json.subdomain };
}

const usdt = async shopper => (await shopper.get('/v1/afrippa/crypto')).json.assets.find(item => item.asset === 'USDT');

describe('a closed store', () => {
  before(() => switches(true));
  after(() => switches(null));

  test("its customers still see their crypto, close their ads and withdraw; they cannot start anything new", async () => {
    const store = await resellerStore();
    const shopper = await customer(store.subdomain);
    assert.equal((await shopper.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '100' })).status, 201);
    const ad = await shopper.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', price: 165000, amount: '40', min_fiat: 100_00, max_fiat: 500_000_00 });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));

    await prisma.store.update({ where: { id: store.id }, data: { status: 'suspended' } });
    const overview = await shopper.get('/v1/afrippa/crypto');
    assert.equal(overview.status, 200, JSON.stringify(overview.json));
    assert.deepEqual([overview.json.assets.find(item => item.asset === 'USDT').locked, overview.json.cash.paying_out], ['40.000000', 0]);
    assert.equal((await shopper.get('/v1/afrippa/p2p/ads')).status, 200);
    const closed = await shopper.post(`/v1/afrippa/p2p/ads/${ad.json.id}/cancel`);
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.equal((await usdt(shopper)).available, '100.000000', 'the locked crypto is back');

    const again = await shopper.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', price: 165000, amount: '10', min_fiat: 100_00, max_fiat: 500_000_00 });
    assert.deepEqual([again.status, again.json.error.code], [404, 'store_unavailable'], 'no new ads');
    const deposit = await shopper.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '1' });
    assert.deepEqual([deposit.status, deposit.json.error.code], [404, 'store_unavailable'], 'no new deposits');

    const address = await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address: outside, label: 'My wallet' });
    assert.equal(address.status, 201, JSON.stringify(address.json));
    assert.equal((await shopper.get('/v1/afrippa/crypto/withdrawal-networks?asset=USDT')).status, 200);
    assert.equal((await shopper.get('/v1/store/cash')).status, 200, 'P2P money can be paid out');
  });
});

describe('crypto switched off, a coin delisted', () => {
  test('withdrawing what is held needs neither switch; a delisted coin is still shown while held', async () => {
    await switches(true);
    const shopper = await customer();
    assert.equal((await shopper.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '25' })).status, 201);
    await switches(false);
    try {
      const deposit = await shopper.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '1' });
      assert.deepEqual([deposit.status, deposit.json.error.code], [409, 'crypto_not_enabled']);
      assert.equal((await shopper.post('/v1/afrippa/crypto/withdrawal-addresses', { chain: 'ETHEREUM', address: outside, label: 'Mine' })).status, 201);
      const networks = await shopper.get('/v1/afrippa/crypto/withdrawal-networks?asset=USDT');
      assert.equal(networks.status, 200, JSON.stringify(networks.json));

      assert.equal((await admin.patch('/v1/afrippa/admin/crypto/assets/USDT', { enabled: false })).status, 200);
      const overview = (await shopper.get('/v1/afrippa/crypto')).json;
      const held = overview.assets.find(item => item.asset === 'USDT');
      assert.deepEqual([held?.enabled, held?.available], [false, '25.000000'], 'listed while held, marked switched off');
      assert.equal(overview.assets.some(item => item.asset === 'BNB'), true, 'enabled coins stay listed');
      const other = await customer();
      assert.equal((await other.get('/v1/afrippa/crypto')).json.assets.some(item => item.asset === 'USDT'), false, 'not listed for someone holding none');
      assert.equal((await shopper.get('/v1/afrippa/crypto/withdrawal-networks?asset=USDT')).status, 200, 'a delisted coin can still be withdrawn');
    } finally {
      await admin.patch('/v1/afrippa/admin/crypto/assets/USDT', { enabled: true });
      await switches(null);
    }
  });
});
