// Afrippa's refused words (docs/CRYPTO_SPINOFF_PLAN.md, instruments: the lifted moderation): ad terms, nicknames and
// feedback never carry contact that moves a trade off Afrippa (links, emails, handles, phone numbers) or a phrase
// Afrippa's admins refuse. BitoCard Shop's word list is now per product: each product's admins keep their own, and
// neither reads or removes the other's.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-words-secret-afrippa-words-secret-a';
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
        ...(method === 'POST' ? { 'idempotency-key': `words-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body = {}) => request('PATCH', path, body), put: (path, body = {}) => request('PUT', path, body) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

async function trader(name) {
  const client = afrippaServer();
  const email = `words-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const added = await client.post('/v1/afrippa/p2p/payment-methods', { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `90${String(counter).padStart(8, '0')}` });
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return { client, id: signup.json.customer.id, bank: added.json.id };
}

const buyAd = (who, terms) => who.client.post('/v1/afrippa/p2p/ads', { side: 'buy', asset: 'USDT', currency: 'NGN', price: 165000, amount: '10', min_fiat: 100000, max_fiat: 5000000, payment_method_ids: [who.bank], terms });

describe("Afrippa's refused words", () => {
  test('ad terms never carry links, emails, handles or phone numbers', async () => {
    const ada = await trader('Ada Terms');
    for (const terms of ['Call 0803 123 4567 before paying', 'Pay faster on https://example.com/pay', 'Email ada@example.com for rates', 'Message @adatrades first', 'See adatrades.com for rates']) {
      const refused = await buyAd(ada, terms);
      assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [400, 'text_refused', 'terms'], terms);
    }
    const ad = await buyAd(ada, 'Pay within the window from your own account, please.');
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    const changed = await ada.client.patch(`/v1/afrippa/p2p/ads/${ad.json.id}`, { terms: 'Text me on +234 803 123 4567' });
    assert.deepEqual([changed.status, changed.json.error.code], [400, 'text_refused']);
  });

  test("Afrippa's admins keep their own list; it refuses terms, nicknames and feedback, never the Shop's text", async () => {
    const added = await operations.post('/v1/afrippa/admin/p2p/refused-words', { phrase: 'Pay Outside', market: null });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual([added.json.phrase, added.json.market], ['pay outside', null]);
    assert.equal((await operations.post('/v1/afrippa/admin/p2p/refused-words', { phrase: 'pay outside' })).json.error.code, 'word_exists');
    const nigeria = await operations.post('/v1/afrippa/admin/p2p/refused-words', { phrase: 'scammer', market: 'NG' });
    assert.equal(nigeria.status, 201, JSON.stringify(nigeria.json));
    assert.equal((await prisma.auditLog.findFirst({ where: { action: 'p2p_word.added', targetId: added.json.id } })).platform, 'afrippa');

    const ada = await trader('Ada Words');
    assert.equal((await buyAd(ada, 'Happy to pay outside the order too')).json.error.code, 'text_refused');
    const nickname = await ada.client.put('/v1/afrippa/p2p/profile', { nickname: 'scammer' });
    assert.deepEqual([nickname.status, nickname.json.error.param], [400, 'nickname']);
    assert.equal((await ada.client.put('/v1/afrippa/p2p/profile', { nickname: 'Ada08031234567' })).status, 400, 'a phone number in a nickname');
    assert.equal((await ada.client.put('/v1/afrippa/p2p/profile', { nickname: 'AdaTrades' })).status, 200);

    // Feedback: the same checks.
    const bola = await trader('Bola Rates');
    assert.equal((await bola.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '20' })).status, 201);
    const sell = (await bola.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount: '10', min_fiat: 100000, max_fiat: 5000000, payment_method_ids: [bola.bank] })).json;
    const order = (await ada.client.post('/v1/afrippa/p2p/orders', { ad_id: sell.id, price: 165000, fiat: 1650000, payment_method_id: sell.payment_methods[0].id })).json;
    await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, { payment_method_id: ada.bank });
    await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true });
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/feedback`, { rating: 'negative', comment: 'Total scammer' })).json.error.code, 'comment_refused');

    // The lists are each product's own: BitoCard's admins neither see nor remove Afrippa's, and the other way round.
    const bitocard = await adminClient(server, ['super_admin']);
    const shopWord = await bitocard.post('/v1/admin/classifieds/prohibited-words', { phrase: 'cheap rates', action: 'block' });
    assert.equal(shopWord.status, 201, JSON.stringify(shopWord.json));
    const shopList = (await bitocard.get('/v1/admin/classifieds/prohibited-words')).json.data.map(word => word.phrase);
    assert.equal(shopList.includes('pay outside'), false);
    assert.equal((await bitocard.delete(`/v1/admin/classifieds/prohibited-words/${added.json.id}`)).status, 404);
    assert.equal((await operations.delete(`/v1/afrippa/admin/p2p/refused-words/${shopWord.json.id}`)).status, 404);
    assert.equal((await operations.get('/v1/afrippa/admin/p2p/refused-words')).json.data.some(word => word.phrase === 'cheap rates'), false);
    assert.equal((await buyAd(ada, 'Cheap rates, quick release')).status, 201, "BitoCard Shop's words never refuse Afrippa's text");
    // The same phrase can be on both lists.
    assert.equal((await operations.post('/v1/afrippa/admin/p2p/refused-words', { phrase: 'cheap rates' })).status, 201);

    const support = await afrippaAdminClient(server, ['support']);
    assert.equal((await support.get('/v1/afrippa/admin/p2p/refused-words')).status, 200);
    assert.equal((await support.post('/v1/afrippa/admin/p2p/refused-words', { phrase: 'another one' })).status, 403);
    assert.equal((await bitocard.get('/v1/afrippa/admin/p2p/refused-words')).status, 401);
    assert.equal((await operations.delete(`/v1/afrippa/admin/p2p/refused-words/${nigeria.json.id}`)).status, 200);
  });
});
