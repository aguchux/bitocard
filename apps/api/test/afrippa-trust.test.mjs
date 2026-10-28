// Trust between Afrippa's traders (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 6): figures from their orders and feedback
// on their ads and card, feedback once per party after a released order, blocks that hide each other's ads and stop
// orders, and reports Afrippa's operations decide (an upheld one is a strike).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-trust-secret-afrippa-trust-secret-a';
let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret } });
  prisma = server.app.get(PrismaService);
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await prisma.featureSwitch.create({ data: { key, enabled: true } });
    await prisma.featureSwitch.create({ data: { key, countryCode: 'NG', enabled: true } });
  }
  await prisma.cryptoAsset.update({ where: { code: 'USDT' }, data: { enabled: true, p2pFeeBps: 0 } });
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
        ...(method === 'POST' ? { 'idempotency-key': `trust-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), delete: path => request('DELETE', path) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

async function trader(name) {
  const client = afrippaServer();
  const email = `trust-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const added = await client.post('/v1/afrippa/p2p/payment-methods', { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `80${String(counter).padStart(8, '0')}` });
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  // The trader's nickname, made on their first visit to the market.
  const profile = await client.get('/v1/afrippa/p2p/profile');
  assert.equal(profile.status, 200, JSON.stringify(profile.json));
  const nickname = profile.json.nickname;
  return { client, id: signup.json.customer.id, bank: added.json.id, nickname };
}

async function sellAd(seller, amount = '50') {
  assert.equal((await seller.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount })).status, 201);
  const ad = await seller.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount, min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [seller.bank] });
  assert.equal(ad.status, 201, JSON.stringify(ad.json));
  return ad.json;
}

const open = (buyer, ad) => buyer.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id });

async function completed(seller, buyer, ad) {
  const order = await open(buyer, ad);
  assert.equal(order.status, 201, JSON.stringify(order.json));
  await buyer.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/paid`, { payment_method_id: buyer.bank });
  assert.equal((await seller.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/release`, { payer_checked: true })).status, 200);
  return order.json.id;
}

describe('Trust between Afrippa traders', () => {
  test('feedback once per party after a released order; figures on the card and the ads', async () => {
    const ada = await trader('Ada Seller');
    const bola = await trader('Bola Buyer');
    const ad = await sellAd(ada);
    const id = await completed(ada, bola, ad);
    const given = await bola.client.post(`/v1/afrippa/p2p/orders/${id}/feedback`, { rating: 'positive', comment: 'Fast release, thank you.' });
    assert.equal(given.status, 201, JSON.stringify(given.json));
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${id}/feedback`, { rating: 'negative' })).json.error.code, 'feedback_given');
    // The order says who has rated it already: the buyer has, the seller not yet; lists do not say.
    assert.equal((await bola.client.get(`/v1/afrippa/p2p/orders/${id}`)).json.feedback_given, true);
    assert.equal((await ada.client.get(`/v1/afrippa/p2p/orders/${id}`)).json.feedback_given, false);
    assert.equal((await bola.client.get('/v1/afrippa/p2p/orders?status=closed')).json.data[0].feedback_given, null);
    const phone = await ada.client.post(`/v1/afrippa/p2p/orders/${id}/feedback`, { rating: 'positive', comment: 'Call me on 0803 123 4567 next time' });
    assert.deepEqual([phone.status, phone.json.error.code], [400, 'comment_refused']);
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${id}/feedback`, { rating: 'positive' })).status, 201);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.p2p.feedback_received' } }));

    const card = await bola.client.get(`/v1/afrippa/p2p/traders/${ada.nickname}`);
    assert.equal(card.status, 200, JSON.stringify(card.json));
    assert.deepEqual([card.json.orders_total, card.json.orders_30d, card.json.completion_rate_30d, card.json.feedback], [1, 1, 100, { positive: 1, negative: 0 }]);
    assert.equal(card.json.latest_feedback[0].comment, 'Fast release, thank you.');
    assert.equal(card.json.latest_feedback[0].from, bola.nickname);
    assert.equal(typeof card.json.avg_release_minutes, 'number');

    const cara = await trader('Cara Looks');
    const listed = (await cara.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.find(item => item.id === ad.id);
    assert.deepEqual([listed.trader.trades_total, listed.trader.completion_rate_30d, listed.trader.feedback], [1, 100, { positive: 1, negative: 0 }]);

    // Feedback only on a released order.
    const cancelled = await open(bola, ad);
    await bola.client.post(`/v1/afrippa/p2p/orders/${cancelled.json.id}/cancel`);
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${cancelled.json.id}/feedback`, { rating: 'negative' })).json.error.code, 'feedback_not_open');
    // The buyer's cancellation counts against their completion rate.
    assert.equal((await ada.client.get(`/v1/afrippa/p2p/traders/${bola.nickname}`)).json.completion_rate_30d, 50);
  });

  test("blocked traders never see each other's ads or open orders on them", async () => {
    const ada = await trader('Ada Blocks');
    const bola = await trader('Bola Blocked');
    const adaAd = await sellAd(ada);
    const bolaAd = await sellAd(bola);
    const blocked = await ada.client.post('/v1/afrippa/p2p/blocks', { nickname: bola.nickname });
    assert.equal(blocked.status, 201, JSON.stringify(blocked.json));
    assert.deepEqual((await ada.client.get('/v1/afrippa/p2p/blocks')).json.data.map(item => item.nickname), [bola.nickname]);
    const seenByBola = (await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.map(item => item.id);
    const seenByAda = (await ada.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.map(item => item.id);
    assert.equal(seenByBola.includes(adaAd.id), false);
    assert.equal(seenByAda.includes(bolaAd.id), false, 'both ways');
    assert.equal((await open(bola, adaAd)).json.error.code, 'ad_unavailable');
    assert.equal((await ada.client.post('/v1/afrippa/p2p/blocks', { nickname: ada.nickname })).status, 400, 'not oneself');

    assert.equal((await ada.client.delete(`/v1/afrippa/p2p/blocks/${bola.nickname}`)).status, 200);
    assert.equal((await open(bola, adaAd)).status, 201);
  });

  test("reports: one open each; Afrippa's operations decide; an upheld one is a strike", async () => {
    const ada = await trader('Ada Reported');
    const bola = await trader('Bola Reports');
    const ad = await sellAd(ada);
    const order = (await open(bola, ad)).json;
    const filed = await bola.client.post('/v1/afrippa/p2p/reports', { nickname: ada.nickname, reason: 'off_platform', details: 'Asked me to pay outside the order to another account.', order_id: order.id });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    assert.match(filed.json.number, /^R-\d{6}$/);
    assert.equal((await bola.client.post('/v1/afrippa/p2p/reports', { nickname: ada.nickname, reason: 'abuse', details: 'Another report on the same trader.' })).json.error.code, 'report_open');
    const cara = await trader('Cara Stranger');
    assert.equal((await cara.client.post('/v1/afrippa/p2p/reports', { nickname: ada.nickname, reason: 'fraud', details: 'Not my order at all, though.', order_id: order.id })).status, 400, 'only an order between them');

    const support = await afrippaAdminClient(server, ['support']);
    const queue = await support.get('/v1/afrippa/admin/p2p/reports?status=open');
    assert.ok(queue.json.data.some(item => item.id === filed.json.id && item.reporter === bola.nickname));
    assert.equal((await support.post(`/v1/afrippa/admin/p2p/reports/${filed.json.id}/decide`, { decision: 'upheld', note: 'Seen in the room' })).status, 403);
    const bitocard = await adminClient(server, ['super_admin']);
    assert.equal((await bitocard.get('/v1/afrippa/admin/p2p/reports')).status, 401);

    const operations = await afrippaAdminClient(server, ['operations']);
    const decided = await operations.post(`/v1/afrippa/admin/p2p/reports/${filed.json.id}/decide`, { decision: 'upheld', note: 'The room shows the request to pay elsewhere.' });
    assert.deepEqual([decided.status, decided.json.status], [200, 'upheld']);
    assert.equal((await operations.post(`/v1/afrippa/admin/p2p/reports/${filed.json.id}/decide`, { decision: 'dismissed', note: 'Changed my mind' })).json.error.code, 'report_decided');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: bola.id, type: 'customer.p2p.report_decided' } }));
    assert.equal((await prisma.auditLog.findFirst({ where: { action: 'p2p_report.upheld', targetId: filed.json.id } })).platform, 'afrippa');
    const standing = (await ada.client.get('/v1/afrippa/p2p/standing')).json;
    assert.deepEqual([standing.strikes, standing.upheld_reports.length, standing.restriction.code], [1, 1, 'cool_off']);
  });
});
