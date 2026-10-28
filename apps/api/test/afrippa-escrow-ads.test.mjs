// Afrippa's escrow ads (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 2): an Afrippa trader's ad lists the payment methods it
// is paid through (their own, past the 24-hour wait, in the ad's currency) and a payment window; a sell ad locks its
// coins, a buy ad locks nothing; instant trades refuse them (orders take them); and escrow and instant ads never share
// a book. Afrippa's traders get their market from their own country, never a reseller's.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-escrow-ads-secret-afrippa-escrow-ads';
let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret } });
  prisma = server.app.get(PrismaService);
  // Crypto and P2P on for Nigeria by itself (the global level never opens a country).
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await prisma.featureSwitch.create({ data: { key, enabled: true } });
    await prisma.featureSwitch.create({ data: { key, countryCode: 'NG', enabled: true } });
  }
  await prisma.cryptoAsset.update({ where: { code: 'USDT' }, data: { enabled: true } });
});

after(async () => {
  await server?.close();
});

function afrippaServer(token = null) {
  const request = async (method, path, body, { signed = true } = {}) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(signed ? { 'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }) } : {}),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `ads-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    patch: (path, body = {}) => request('PATCH', path, body),
  };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

/** A trader signed in past two-step, with the crypto declaration made and a bank account usable now. */
async function trader(name = 'Ada Trader') {
  const client = afrippaServer();
  const email = `ads-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const bank = await method(client, { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `30${String(counter).padStart(8, '0')}` });
  return { client, email, id: signup.json.customer.id, bank };
}

/** Saves a payment method and lets it be used now (past its 24-hour wait). */
async function method(client, body, { ready = true } = {}) {
  const added = await client.post('/v1/afrippa/p2p/payment-methods', body);
  assert.equal(added.status, 201, JSON.stringify(added.json));
  if (ready) await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return added.json.id;
}

async function fund(client, amount) {
  const deposit = await client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount });
  assert.equal(deposit.status, 201, JSON.stringify(deposit.json));
}

const sellAd = (paymentMethods, extra = {}) => ({ side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount: '50', min_fiat: 100000, max_fiat: 5000000, payment_method_ids: paymentMethods, payment_window: 30, ...extra });

describe("Afrippa's escrow ads", () => {
  test('a sell ad lists its payment methods and window and locks its coins; others see where to pay, never the details', async () => {
    const ada = await trader();
    await fund(ada.client, '100');
    const ad = await ada.client.post('/v1/afrippa/p2p/ads', sellAd([ada.bank]));
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.deepEqual([ad.json.escrow, ad.json.payment_window, ad.json.market, ad.json.currency], [true, 30, 'NG', 'NGN']);
    assert.deepEqual(ad.json.payment_methods, [{ kind: 'bank', label: 'Example Bank', currency: 'NGN', reversible: false, id: ada.bank, hint: ad.json.payment_methods[0].hint }]);
    const wallet = (await ada.client.get('/v1/afrippa/crypto')).json;
    const usdt = wallet.assets.find(balance => balance.asset === 'USDT');
    assert.deepEqual([usdt.available, usdt.locked], ['50.000000', '50.000000']);

    const bola = await trader('Bola Buyer');
    const market = await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy');
    assert.equal(market.status, 200, JSON.stringify(market.json));
    const listed = market.json.data.find(item => item.id === ad.json.id);
    assert.deepEqual(listed.payment_methods, [{ kind: 'bank', label: 'Example Bank', currency: 'NGN', reversible: false }], 'no id or hint for anyone but the owner');
    assert.equal(listed.mine, false);

    // Instant trades are BitoCard's: an escrow ad is taken through an order.
    const instant = await bola.client.post('/v1/afrippa/p2p/trades', { ad_id: ad.json.id, price: 165000, amount: '1' });
    assert.deepEqual([instant.status, instant.json.error.code], [409, 'order_required']);

    // Closing it gives the coins back.
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/ads/${ad.json.id}/cancel`)).status, 200);
    const back = (await ada.client.get('/v1/afrippa/crypto')).json.assets.find(balance => balance.asset === 'USDT');
    assert.deepEqual([back.available, back.locked], ['100.000000', '0.000000']);
  });

  test('a buy ad locks nothing, and takes up to its rest at its price', async () => {
    const ada = await trader();
    const ad = await ada.client.post('/v1/afrippa/p2p/ads', { side: 'buy', asset: 'USDT', currency: 'NGN', price: 160000, amount: '10', min_fiat: 100000, max_fiat: 5000000, payment_method_ids: [ada.bank] });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.deepEqual([ad.json.escrow, ad.json.payment_window, ad.json.max_fiat], [true, 15, 1600000], 'the default window; 10 USDT at NGN 1,600.00');
    assert.equal(await prisma.journalEntry.count({ where: { reference: { startsWith: `p2p_ad:${ad.json.id}` } } }), 0, 'nothing locked');
    const row = await prisma.p2pAd.findUniqueOrThrow({ where: { id: ad.json.id } });
    assert.equal(row.fiatLockedMinor, 0n);

    // A new price changes nothing locked; the payment methods and window can change.
    const wise = await method(ada.client, { kind: 'named', currency: 'NGN', provider: 'wise', handle: 'ada@example.com' });
    const changed = await ada.client.patch(`/v1/afrippa/p2p/ads/${ad.json.id}`, { price: 170000, payment_method_ids: [wise], payment_window: 60 });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.deepEqual([changed.json.max_fiat, changed.json.payment_window, changed.json.payment_methods.map(item => item.label)], [1700000, 60, ['Wise']]);
    assert.equal(await prisma.journalEntry.count({ where: { reference: { startsWith: `p2p_ad:${ad.json.id}` } } }), 0);
  });

  test('payment methods are checked: the owner’s own, in the currency, past their wait, one to five', async () => {
    const ada = await trader();
    const bola = await trader('Bola Other');
    await fund(ada.client, '100');
    const pound = await method(ada.client, { kind: 'named', currency: 'GBP', provider: 'wise', handle: 'ada-gbp@example.com' });
    const fresh = await method(ada.client, { kind: 'bank', currency: 'NGN', bank_name: 'New Bank', account_number: '9988776655' }, { ready: false });
    const refusals = [
      [sellAd([]), 400, 'parameter_missing'],
      [sellAd(undefined), 400, 'parameter_missing'],
      [sellAd([bola.bank]), 400, 'parameter_invalid'],
      [sellAd([pound]), 400, 'payment_method_currency'],
      [sellAd([fresh]), 409, 'payment_method_not_ready'],
      [sellAd([ada.bank], { payment_window: 45 }), 400, null],
      [sellAd(Array.from({ length: 6 }, () => ada.bank)), 400, null],
    ];
    for (const [body, status, code] of refusals) {
      const refused = await ada.client.post('/v1/afrippa/p2p/ads', body);
      assert.equal(refused.status, status, JSON.stringify(refused.json));
      if (code) assert.equal(refused.json.error.code, code);
    }
    assert.equal(await prisma.p2pAd.count({ where: { customerId: ada.id } }), 0, 'nothing posted or locked');
  });

  test("a trader's book holds escrow ads only", async () => {
    const ada = await trader();
    const bola = await trader('Bola Viewer');
    // An instant ad in the same book (BitoCard's kind, made directly here: no trader can post one).
    const instant = await prisma.p2pAd.create({
      data: { mode: 'test', customerId: ada.id, country: 'NG', currency: 'NGN', asset: 'USDT', side: 'sell', priceMinor: 150000n, totalAmount: 5_000_000n, remainingAmount: 5_000_000n, minFiatMinor: 100n, maxFiatMinor: 10_000_000n },
    });
    await fund(ada.client, '20');
    const escrow = await ada.client.post('/v1/afrippa/p2p/ads', sellAd([ada.bank], { amount: '10' }));
    assert.equal(escrow.status, 201, JSON.stringify(escrow.json));
    const shown = (await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.map(item => item.id);
    assert.ok(shown.includes(escrow.json.id));
    assert.equal(shown.includes(instant.id), false);
  });
});
