// Afrippa traders' standing (docs/CRYPTO_SPINOFF_PLAN.md, step 3): an appeal decided against a trader is a strike and
// a 24-hour cool-off; three strikes in 90 days pause their trading (no orders, no ads, their ads off the market) until
// Afrippa's operations clear them; and a buyer who cancels or lets expire three orders in a day cannot open more as the
// buyer for a day.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { afrippaAdminClient, startApp, withTwoStepCode } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-standing-secret-afrippa-standing-s';
let server;
let prisma;
let operations;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret } });
  prisma = server.app.get(PrismaService);
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await prisma.featureSwitch.create({ data: { key, enabled: true } });
    await prisma.featureSwitch.create({ data: { key, countryCode: 'NG', enabled: true } });
  }
  await prisma.cryptoAsset.update({ where: { code: 'USDT' }, data: { enabled: true, p2pFeeBps: 0 } });
  operations = await afrippaAdminClient(server, ['operations']);
});

after(async () => {
  await server?.close();
});

function afrippaServer(token = null) {
  const request = async (method, path, body) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `std-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => withTwoStepCode(request, 'POST', path, body) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

async function trader(name) {
  const client = afrippaServer();
  const email = `std-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const added = await client.post('/v1/afrippa/p2p/payment-methods', { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `70${String(counter).padStart(8, '0')}` });
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return { client, id: signup.json.customer.id, bank: added.json.id };
}

async function sellAd(seller, amount = '50') {
  assert.equal((await seller.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount })).status, 201);
  const ad = await seller.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount, min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [seller.bank] });
  assert.equal(ad.status, 201, JSON.stringify(ad.json));
  return ad.json;
}

const open = (buyer, ad) => buyer.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id });

/** An order on `ad` by `buyer`, paid, appealed and decided against `fault`. */
async function lostAppeal(seller, buyer, ad, fault) {
  const order = await open(buyer, ad);
  assert.equal(order.status, 201, JSON.stringify(order.json));
  await buyer.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/paid`, { payment_method_id: buyer.bank });
  await seller.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/appeal`, { reason: 'The payment did not arrive in my account.' });
  const decided = await operations.post(`/v1/afrippa/admin/p2p/orders/${order.json.id}/decide`, { outcome: fault === 'buyer' ? 'return' : 'release', fault, note: 'Decided on the evidence given.' });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  return order.json.id;
}

/** Moves an order's decision a day and an hour back (past its cool-off). */
const pastCoolOff = id => prisma.p2pOrder.update({ where: { id }, data: { closedAt: new Date(Date.now() - 25 * 3_600_000) } });

describe("Afrippa traders' standing", () => {
  test('a lost appeal cools the trader off for a day: no ads, no orders, their ads off the market', async () => {
    const ada = await trader('Ada Lost');
    const bola = await trader('Bola Buys');
    const ad = await sellAd(ada);
    const id = await lostAppeal(ada, bola, ad, 'seller');
    const standing = (await ada.client.get('/v1/afrippa/p2p/standing')).json;
    assert.deepEqual([standing.strikes, standing.restriction.code], [1, 'cool_off']);
    const posted = await ada.client.post('/v1/afrippa/p2p/ads', { side: 'buy', asset: 'USDT', currency: 'NGN', price: 165000, amount: '5', min_fiat: 100000, max_fiat: 5000000, payment_method_ids: [ada.bank] });
    assert.deepEqual([posted.status, posted.json.error.code], [409, 'cool_off']);
    const market = (await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.map(item => item.id);
    assert.equal(market.includes(ad.id), false, 'the ad is off the market');
    assert.equal((await open(bola, ad)).json.error.code, 'ad_unavailable');
    // The winning side is untouched.
    assert.equal((await bola.client.get('/v1/afrippa/p2p/standing')).json.restriction, null);

    await pastCoolOff(id);
    assert.equal((await ada.client.get('/v1/afrippa/p2p/standing')).json.restriction, null);
    assert.equal((await open(bola, ad)).status, 201, 'back on the market a day later');
  });

  test("three strikes pause trading until Afrippa's operations clear them", async () => {
    const ada = await trader('Ada Sells');
    const bola = await trader('Bola Strikes');
    const ad = await sellAd(ada, '100');
    for (let index = 0; index < 3; index += 1) await pastCoolOff(await lostAppeal(ada, bola, ad, 'buyer'));
    const standing = (await bola.client.get('/v1/afrippa/p2p/standing')).json;
    assert.deepEqual([standing.strikes, standing.restriction.code, standing.lost_appeals.length], [3, 'trading_suspended', 3]);
    const refused = await open(bola, ad);
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'trading_suspended']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: bola.id, type: 'customer.p2p.standing_changed', title: 'Your trading is paused' } }));

    const seen = await operations.get(`/v1/afrippa/admin/traders/${bola.id}/standing?mode=test`);
    assert.deepEqual([seen.status, seen.json.strikes], [200, 3]);
    const support = await afrippaAdminClient(server, ['support']);
    assert.equal((await support.post(`/v1/afrippa/admin/traders/${bola.id}/standing/clear`, { mode: 'test', reason: 'Reviewed the appeals' })).status, 403);
    const cleared = await operations.post(`/v1/afrippa/admin/traders/${bola.id}/standing/clear`, { mode: 'test', reason: 'Reviewed the appeals with the trader.' });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
    assert.deepEqual([cleared.json.strikes, cleared.json.restriction], [0, null]);
    assert.equal((await prisma.auditLog.findFirst({ where: { action: 'trader.strikes_cleared', targetId: bola.id } })).platform, 'afrippa');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: bola.id, title: 'You can trade again' } }));
    assert.equal((await open(bola, ad)).status, 201);
  });

  test('three cancellations in a day stop a buyer opening orders for a day; selling into a buy ad still works', async () => {
    const ada = await trader('Ada Patient');
    const bola = await trader('Bola Cancels');
    const ad = await sellAd(ada);
    for (let index = 0; index < 3; index += 1) {
      const order = await open(bola, ad);
      assert.equal(order.status, 201, JSON.stringify(order.json));
      assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/cancel`)).status, 200);
    }
    const refused = await open(bola, ad);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'too_many_cancellations']);
    assert.equal((await bola.client.get('/v1/afrippa/p2p/standing')).json.cancellations_today, 3);

    // As the seller (taking Ada's buy ad), Bola is not held back by her cancellations.
    assert.equal((await bola.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '20' })).status, 201);
    const buyAd = await ada.client.post('/v1/afrippa/p2p/ads', { side: 'buy', asset: 'USDT', currency: 'NGN', price: 165000, amount: '10', min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [ada.bank] });
    const sold = await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: buyAd.json.id, price: 165000, fiat: 1650000, payment_method_id: bola.bank });
    assert.equal(sold.status, 201, JSON.stringify(sold.json));
  });
});
