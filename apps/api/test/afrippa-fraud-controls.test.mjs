// Afrippa's fraud controls (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 7): the buyer names their own paying account
// (same kind as the seller's, in their verified name) and the seller confirms the payer before releasing; reversible
// payments are flagged; the market's limits apply to orders, tighter for new traders; a buyer opening orders too fast
// is slowed; and the same person on both sides is refused.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { afrippaAdminClient, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-fraud-secret-afrippa-fraud-secret-a';
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
        ...(method === 'POST' ? { 'idempotency-key': `fraud-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

async function method(client, body) {
  const added = await client.post('/v1/afrippa/p2p/payment-methods', body);
  assert.equal(added.status, 201, JSON.stringify(added.json));
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return added.json;
}

async function trader(name) {
  const client = afrippaServer();
  const email = `fraud-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const accountNumber = `11${String(counter).padStart(8, '0')}`;
  const bank = (await method(client, { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: accountNumber })).id;
  return { client, id: signup.json.customer.id, bank, accountNumber };
}

async function sellAd(seller, methods = [seller.bank], amount = '100') {
  assert.equal((await seller.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount })).status, 201);
  const ad = await seller.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount, min_fiat: 100000, max_fiat: 500000000, payment_method_ids: methods });
  assert.equal(ad.status, 201, JSON.stringify(ad.json));
  return ad.json;
}

const open = (buyer, ad, fiat = 1650000, payInto = ad.payment_methods[0].id) => buyer.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat, payment_method_id: payInto });

describe("Afrippa's fraud controls", () => {
  test('the buyer names their own paying account of the same kind; the seller confirms the payer before releasing', async () => {
    const ada = await trader('Ada Seller');
    const bola = await trader('Bola Buyer');
    const cara = await trader('Cara Third');
    const ad = await sellAd(ada);
    const order = (await open(bola, ad)).json;
    const paid = path => bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, path);
    assert.equal((await paid({})).status, 400, 'the paying account is required');
    assert.equal((await paid({ payment_method_id: cara.bank })).json.error.code, 'parameter_invalid', "never a third party's account");
    const pounds = await method(bola.client, { kind: 'named', currency: 'GBP', provider: 'wise', handle: 'bola@example.com' });
    assert.equal((await paid({ payment_method_id: pounds.id })).json.error.code, 'payment_method_currency');
    const momo = await method(bola.client, { kind: 'mobile_money', currency: 'NGN', network: 'MTN MoMo', phone: '08031230000' });
    assert.equal((await paid({ payment_method_id: momo.id })).json.error.code, 'payment_method_mismatch', 'mobile money cannot pay into a bank account');

    const marked = await paid({ payment_method_id: bola.bank });
    assert.equal(marked.status, 200, JSON.stringify(marked.json));
    const sellerView = (await ada.client.get(`/v1/afrippa/p2p/orders/${order.id}`)).json;
    assert.deepEqual([sellerView.paid_from.label, sellerView.paid_from.holder_name, sellerView.warnings], ['Example Bank', 'Bola Buyer', []]);
    const line = (await ada.client.get(`/v1/afrippa/p2p/orders/${order.id}/messages`)).json.data.at(-1).body;
    assert.match(line, /paid from Example Bank .* \(Bola Buyer\)/);

    for (const body of [{}, { payer_checked: false }]) {
      assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true })).status, 200);
  });

  test('payments the payer can take back (PayPal) are flagged on the ad and the order', async () => {
    const ada = await trader('Ada PayPal');
    const bola = await trader('Bola PayPal');
    const paypal = await method(ada.client, { kind: 'named', currency: 'NGN', provider: 'paypal', handle: 'ada@paypal.example' });
    assert.equal(paypal.reversible, true);
    const ad = await sellAd(ada, [paypal.id]);
    const listed = (await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.find(item => item.id === ad.id);
    assert.equal(listed.payment_methods[0].reversible, true);
    const order = (await open(bola, ad)).json;
    assert.deepEqual(order.warnings, ['reversible_payment']);
  });

  test("the market's limits apply to orders, tighter for new traders, daily ones counting open and released orders", async () => {
    const operations = await afrippaAdminClient(server, ['operations']);
    const set = await operations.put('/v1/afrippa/admin/crypto/market-limits', { mode: 'test', market: 'NG', currency: 'NGN', per_trade: 50000000, per_day: 100000000, new_trader_per_trade: 2000000, new_trader_per_day: 3000000 });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual([set.json.new_trader_per_trade, set.json.new_trader_per_day], [2000000, 3000000]);
    try {
      const ada = await trader('Ada Limits');
      const bola = await trader('Bola New');
      const ad = await sellAd(ada);
      const big = await open(bola, ad, 3300000);
      assert.deepEqual([big.status, big.json.error.code], [409, 'trade_limit'], 'a new trader: NGN 20,000 at most per order');
      assert.equal((await open(bola, ad, 1650000)).status, 201);
      const second = await open(bola, ad, 1650000);
      assert.deepEqual([second.status, second.json.error.code], [409, 'trade_limit'], 'NGN 30,000 a day, the open order counted');
    } finally {
      await prisma.cryptoMarketLimit.deleteMany({ where: { mode: 'test', market: 'NG', currency: 'NGN' } });
    }
  });

  test('a buyer opening orders too fast is slowed', async () => {
    const ada = await trader('Ada Busy');
    const bola = await trader('Bola Fast');
    const ad = await sellAd(ada);
    for (let index = 0; index < 10; index += 1) {
      const order = await open(bola, ad);
      assert.equal(order.status, 201, JSON.stringify(order.json));
      await bola.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/cancel`);
      // Out of the cancellation limit's day (this checks only the pace of opening).
      await prisma.p2pOrder.update({ where: { id: order.json.id }, data: { closedAt: new Date(Date.now() - 2 * 86_400_000) } });
    }
    const eleventh = await open(bola, ad);
    assert.deepEqual([eleventh.status, eleventh.json.error.code], [429, 'order_rate_limited']);
  });

  test('the same person on both sides, sharing a payment account, is refused', async () => {
    const ada = await trader('Ada Twin');
    const bola = await trader('Bola Twin');
    const ad = await sellAd(ada);
    await method(bola.client, { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: ada.accountNumber });
    const refused = await open(bola, ad);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'same_person']);
  });
});
