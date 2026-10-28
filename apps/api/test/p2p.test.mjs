// Afrippa's P2P market: traders post escrow ads and take them through orders (test/afrippa-orders.test.mjs covers the
// orders themselves). BitoCard's instant trades are gone. Also admin freezes, the markets a trader may use, market
// limits, the public pages, and paying customers' withdrawable money out to a bank.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, afrippaAdminClient, lastEmailCode, startApp, withTwoStepCode } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { afrippaStoreId } = await import('../dist/afrippa/ids.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');
const { LedgerService } = await import('../dist/ledger/ledger.service.js');

const secret = 'afrippa-p2p-suite-secret-afrippa-p2p-suite';
let server;
let admin;
let afrippaAdmin;
let prisma;
let ledger;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get(PrismaService);
  ledger = server.app.get(LedgerService);
  admin = await adminClient(server);
  afrippaAdmin = await afrippaAdminClient(server);
});

after(async () => {
  await server?.close();
});

const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

/** Sets a switch at one scope (a country, or global), or clears it with null. */
async function setSwitch(key, enabled, country = null) {
  await prisma.featureSwitch.deleteMany({ where: { key, countryCode: country, resellerId: null } });
  if (enabled !== null) await prisma.featureSwitch.create({ data: { key, countryCode: country, enabled } });
}
const switches = async enabled => {
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await setSwitch(key, enabled);
    // Crypto trading is open only in countries switched on by themselves (the global level never allows a country).
    await setSwitch(key, enabled, 'NG');
  }
};

/** Afrippa's server: every request signed, so it acts for Afrippa's store. */
function afrippaServer() {
  let token = null;
  const request = async (method, path, body) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `p2p-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, cache: res.headers.get('cache-control'), json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => withTwoStepCode(request, 'POST', path, body), put: (path, body) => request('PUT', path, body), patch: (path, body) => request('PATCH', path, body) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];
const currencies = { NG: 'NGN', GH: 'GHS', KE: 'KES' };

let counter = 0;

/** A saved payment method, past its 24-hour wait. */
async function method(client, body) {
  const added = await client.post('/v1/afrippa/p2p/payment-methods', body);
  assert.equal(added.status, 201, JSON.stringify(added.json));
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return added.json.id;
}

const bank = (client, currency) => method(client, { kind: 'bank', currency, bank_name: 'Example Bank', account_number: `55${String((counter += 1)).padStart(8, '0')}` });
const wise = (client, currency) => method(client, { kind: 'named', currency, provider: 'wise', handle: `trader${(counter += 1)}@example.com` });

/** An Afrippa trader past two-step, with the declaration made and a bank account in their own currency. */
async function trader(name = 'Ada Trader', country = 'NG', { declare = true } = {}) {
  const client = afrippaServer();
  const email = `p2p-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  if (declare) assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: (await client.get('/v1/afrippa/crypto/declaration')).json.version })).status, 200);
  client.id = signup.json.customer.id;
  client.email = email;
  client.bank = await bank(client, currencies[country]);
  return client;
}

async function deposit(client, asset, amount) {
  const res = await client.post('/v1/afrippa/crypto/test-deposits', { asset, amount });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

const balance = async (client, asset) => (await client.get('/v1/afrippa/crypto')).json.assets.find(item => item.asset === asset);
const credit = async (client, asset, amount) => assert.equal((await afrippaAdmin.post(`/v1/afrippa/admin/crypto/customers/${client.id}/test-credits`, { asset, amount, reason: 'Testing the market' })).status, 201);

/** Every asset's customer balances plus fees and adjustments equal what custody holds: crypto is never made or lost. */
async function cryptoConserved() {
  const accounts = await prisma.ledgerAccount.findMany({ where: { kind: { in: ['crypto_wallet', 'crypto_locked', 'crypto_frozen', 'crypto_withdrawing', 'crypto_escrow', 'crypto_fees', 'crypto_custody', 'adjustments'] } } });
  const sums = new Map();
  for (const account of accounts) {
    if (account.kind === 'adjustments' && !['USDT', 'USDC', 'BTC', 'ETH', 'BNB'].includes(account.currency)) continue;
    const key = `${account.mode}:${account.currency}`;
    const signed = account.kind === 'crypto_custody' ? -account.balanceMinor : account.balanceMinor;
    sums.set(key, (sums.get(key) ?? 0n) + signed);
  }
  for (const [key, sum] of sums) assert.equal(sum, 0n, `${key} is off by ${sum}`);
}

const sellAd = (client, overrides = {}) =>
  client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', price: 165000, amount: '100', min_fiat: 100_00, max_fiat: 500_000_00, payment_method_ids: [client.bank], ...overrides });

/** Opens an order on `ad` for `amount` (or `fiat`), paying into the ad's first payment method. */
const order = (client, ad, size) => client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: ad.price, payment_method_id: ad.payment_methods[0].id, ...size });

describe('switched off', () => {
  test('crypto is off until an admin switches it on', async () => {
    const ada = await trader();
    const overview = await ada.get('/v1/afrippa/crypto');
    assert.deepEqual([overview.status, overview.json.enabled, overview.json.p2p_enabled, overview.json.mode], [200, false, false, 'test']);
    assert.deepEqual(overview.json.assets.map(item => item.asset), ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'POL', 'TRX', 'LTC', 'DOGE']);
    const market = await ada.get('/v1/afrippa/p2p/market?asset=USDT&side=buy');
    assert.deepEqual([market.status, market.json.error.code], [409, 'crypto_not_enabled']);
    assert.equal((await ada.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '1' })).json.error.code, 'crypto_not_enabled');
  });
});

describe('escrow ads', () => {
  before(() => switches(true));
  after(() => switches(null));

  test('a sell ad locks its coins and is listed by nickname; taken through an order, its trades count on the profile', async () => {
    const seller = await trader('Ada Seller');
    const buyer = await trader('Bola Buyer');
    await deposit(seller, 'USDT', '250.5');
    const ad = await sellAd(seller, { amount: '200' });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.deepEqual([ad.json.side, ad.json.available, ad.json.price, ad.json.status, ad.json.payment_window], ['sell', '200.000000', 165000, 'active', 15]);
    const locked = await balance(seller, 'USDT');
    assert.deepEqual([locked.available, locked.locked, locked.total], ['50.500000', '200.000000', '250.500000']);

    const market = await buyer.get('/v1/afrippa/p2p/market?asset=USDT&side=buy');
    assert.ok(market.json.data.some(item => item.id === ad.json.id && item.trader.nickname.startsWith('Trader')), 'listed with the seller nickname only');
    assert.equal(JSON.stringify(market.json).includes(seller.email), false, 'never the seller email');
    assert.equal((await seller.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.some(item => item.id === ad.json.id), false, 'never your own ad');

    // Taken, paid, released: the trade shows on the seller's profile.
    const opened = await order(buyer, ad.json, { fiat: 82_500_00 });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.equal(opened.json.amount, '50.000000');
    assert.equal((await buyer.post(`/v1/afrippa/p2p/orders/${opened.json.id}/paid`, { payment_method_id: buyer.bank })).status, 200);
    assert.equal((await seller.post(`/v1/afrippa/p2p/orders/${opened.json.id}/release`, { payer_checked: true })).status, 200);
    assert.equal((await seller.get('/v1/afrippa/p2p/profile')).json.trades_total, 1);
    assert.equal((await balance(seller, 'USDT')).locked, '150.000000');
    await cryptoConserved();
    await ledgerOk();
  });

  test('ads in US dollars sit in their own book, and the book can be searched by nickname', async () => {
    const buyer = await trader('Ada Dollars');
    const seller = await trader('Bola Dollars');
    const buyerUsd = await wise(buyer, 'USD');
    const sellerUsd = await wise(seller, 'USD');
    await deposit(seller, 'USDT', '20');
    const ad = await buyer.post('/v1/afrippa/p2p/ads', { side: 'buy', asset: 'USDT', currency: 'USD', price: 100, amount: '10', min_fiat: 100, max_fiat: 1000, payment_method_ids: [buyerUsd] });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.equal(ad.json.currency, 'USD');
    const book = async query => (await seller.get(`/v1/afrippa/p2p/market?asset=USDT&side=sell&${query}`)).json.data.some(item => item.id === ad.json.id);
    assert.equal(await book('currency=USD'), true);
    assert.equal(await book('currency=NGN'), false);
    assert.equal(await book(`currency=USD&q=${ad.json.trader.nickname.slice(0, 6).toLowerCase()}`), true);
    assert.equal(await book('currency=USD&q=no-such-trader'), false);
    assert.equal((await buyer.post('/v1/afrippa/p2p/ads', { side: 'buy', asset: 'USDT', currency: 'GBP', price: 100, amount: '1', min_fiat: 100, max_fiat: 100, payment_method_ids: [buyerUsd] })).json.error.code, 'currency_unsupported');
    // The seller sells into it, paid into their own US dollar account.
    const sold = await seller.post('/v1/afrippa/p2p/orders', { ad_id: ad.json.id, price: 100, amount: '4', payment_method_id: sellerUsd });
    assert.equal(sold.status, 201, JSON.stringify(sold.json));
    assert.deepEqual([sold.json.currency, sold.json.fiat], ['USD', 400]);
  });

  test('ads check their limits and amounts; paused ads cannot be taken; a nickname is chosen once and unique', async () => {
    const seller = await trader('Ada Limits');
    const buyer = await trader('Bola Limits');
    await deposit(seller, 'USDT', '100');
    assert.equal((await sellAd(seller, { amount: '101' })).json.error.code, 'insufficient_funds');
    assert.equal((await sellAd(seller, { amount: '1.1234567' })).json.error.code, 'parameter_invalid', 'USDT keeps 6 places');
    assert.equal((await sellAd(seller, { min_fiat: 1000_00, max_fiat: 100_00 })).json.error.param, 'max_fiat');
    const ad = (await sellAd(seller, { amount: '100', min_fiat: 10_000_00, max_fiat: 20_000_00 })).json;
    assert.equal((await order(buyer, ad, { fiat: 5_000_00 })).json.error.code, 'below_ad_limit');
    assert.equal((await order(buyer, ad, { fiat: 30_000_00 })).json.error.code, 'above_ad_limit');
    assert.equal((await order(buyer, ad, { amount: '101' })).json.error.code, 'amount_unavailable');
    assert.equal((await seller.patch(`/v1/afrippa/p2p/ads/${ad.id}`, { status: 'paused' })).json.status, 'paused');
    assert.equal((await order(buyer, ad, { fiat: 15_000_00 })).json.error.code, 'ad_unavailable');
    assert.equal((await seller.get('/v1/afrippa/p2p/ads')).json.data.length, 1);
    assert.equal((await seller.put('/v1/afrippa/p2p/profile', { nickname: `Ada_${counter}` })).json.nickname_chosen, true);
    assert.equal((await seller.put('/v1/afrippa/p2p/profile', { nickname: 'Another' })).json.error.code, 'nickname_locked');
    assert.equal((await buyer.put('/v1/afrippa/p2p/profile', { nickname: `ada_${counter}` })).json.error.code, 'nickname_taken');
  });

  test("the ad's shown maximum takes its whole rest, though that fiat would buy a part of a unit more", async () => {
    const seller = await trader('Ada Rest');
    const buyer = await trader('Bola Rest');
    await deposit(seller, 'USDT', '2');
    const ad = await sellAd(seller, { amount: '1.000001', price: 164999, min_fiat: 1_00 });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.equal(ad.json.max_fiat, 165000, 'the rest, rounded up for the seller');
    assert.ok((await buyer.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&fiat=165000')).json.data.some(item => item.id === ad.json.id));
    const taken = await order(buyer, ad.json, { fiat: 165000 });
    assert.equal(taken.status, 201, JSON.stringify(taken.json));
    assert.deepEqual([taken.json.amount, taken.json.fiat], ['1.000001', 165000]);
    assert.equal((await prisma.p2pAd.findUniqueOrThrow({ where: { id: ad.json.id } })).remainingAmount, 0n);
    await cryptoConserved();
  });
});

describe('instant trades are retired', () => {
  before(() => switches(true));
  after(() => switches(null));

  test('there are no instant trades or quotes, and the market is for Afrippa’s traders only', async () => {
    const ada = await trader();
    for (const [verb, path] of [
      ['get', '/v1/afrippa/p2p/quote?asset=USDT&side=buy&fiat=100000'],
      ['get', '/v1/afrippa/p2p/trades'],
      ['post', '/v1/afrippa/p2p/trades'],
    ]) {
      assert.equal((await ada[verb](path, verb === 'post' ? { ad_id: randomUUID(), price: 1, amount: '1' } : undefined)).status, 404, path);
    }
    assert.equal((await afrippaAdmin.get('/v1/afrippa/admin/p2p/trades')).status, 404);

    // A bitocard.com customer never reaches the market (the gate keeps them off its routes; the service refuses too).
    const shopper = await fetch(`${server.base}/v1/store/account/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `p2p-${Date.now()}` },
      body: JSON.stringify({ name: 'Ada Shopper', email: `p2p-shopper-${Date.now()}@example.com`, password: 'correct horse battery', country: 'NG' }),
    }).then(res => res.json());
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: shopper.customer.id }, include: { store: { include: { reseller: { select: { house: true } } } }, market: true } });
    const { P2pService } = await import('../dist/crypto/p2p.service.js');
    const p2p = server.app.get(P2pService);
    for (const call of [() => p2p.market(row, { asset: 'USDT', side: 'buy' }), () => p2p.markets(row), () => p2p.createAd(row, { side: 'sell', asset: 'USDT', price: 1, amount: '1', min_fiat: 1, max_fiat: 1 })]) {
      await assert.rejects(call(), error => error.code === 'market_unavailable');
    }
  });

});

describe('admin freezes', () => {
  before(() => switches(true));
  after(() => switches(null));

  test('an amount freeze holds crypto until released once; finance seizes; an account freeze stops trading and hides ads', async () => {
    const ada = await trader('Ada Frozen');
    const buyer = await trader('Bola Frozen');
    await deposit(ada, 'ETH', '2');
    const ad = await ada.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'ETH', price: 500_000_000, amount: '1', min_fiat: 100_00, max_fiat: 10_000_000_00, payment_method_ids: [ada.bank] });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));

    const afrippaSupport = await afrippaAdminClient(server, ['support']);
    assert.equal((await afrippaSupport.post(`/v1/afrippa/admin/crypto/customers/${ada.id}/freezes`, { asset: 'ETH', amount: '0.5', mode: 'test', reason: 'Checking a report' })).status, 403);
    const tooMuch = await afrippaAdmin.post(`/v1/afrippa/admin/crypto/customers/${ada.id}/freezes`, { asset: 'ETH', amount: '1.5', mode: 'test', reason: 'Checking a report' });
    assert.deepEqual([tooMuch.status, tooMuch.json.error.code], [402, 'insufficient_funds'], 'only available crypto, never what an ad locks');
    const freeze = await afrippaAdmin.post(`/v1/afrippa/admin/crypto/customers/${ada.id}/freezes`, { asset: 'ETH', amount: '0.5', mode: 'test', reason: 'Checking a report' });
    assert.equal(freeze.status, 201, JSON.stringify(freeze.json));
    assert.deepEqual([(await balance(ada, 'ETH')).available, (await balance(ada, 'ETH')).frozen], ['0.50000000', '0.50000000']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.crypto.frozen' } }));

    // The step-up window opened first, so the two releases race on the freeze, not on one authenticator code.
    assert.equal((await afrippaAdmin.post('/v1/afrippa/admin/auth/step-up', { code: await adminCode(server, afrippaAdmin) })).status, 200);
    const [first, second] = await Promise.all([
      afrippaAdmin.post(`/v1/afrippa/admin/crypto/freezes/${freeze.json.id}/release`, { note: 'All clear' }),
      afrippaAdmin.post(`/v1/afrippa/admin/crypto/freezes/${freeze.json.id}/release`, { note: 'All clear' }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409], 'released once');
    assert.equal((await balance(ada, 'ETH')).available, '1.00000000');

    const again = await afrippaAdmin.post(`/v1/afrippa/admin/crypto/customers/${ada.id}/freezes`, { asset: 'ETH', amount: '0.25', mode: 'test', reason: 'Court order' });
    assert.equal((await afrippaAdmin.post(`/v1/afrippa/admin/crypto/freezes/${again.json.id}/seize`, { note: 'Order 123' })).status, 200, 'super admins pass every role');
    const afrippaOperations = await afrippaAdminClient(server, ['operations']);
    const third = await afrippaAdmin.post(`/v1/afrippa/admin/crypto/customers/${ada.id}/freezes`, { asset: 'ETH', amount: '0.25', mode: 'test', reason: 'Court order' });
    assert.equal((await afrippaOperations.post(`/v1/afrippa/admin/crypto/freezes/${third.json.id}/seize`, { note: 'Order 124' })).status, 403, 'only finance seizes');
    assert.equal((await balance(ada, 'ETH')).frozen, '0.25000000');

    const frozen = await afrippaAdmin.put(`/v1/afrippa/admin/crypto/customers/${ada.id}/account-freeze`, { frozen: true, reason: 'Fraud report' });
    assert.deepEqual([frozen.status, frozen.json.frozen], [200, true]);
    assert.equal((await ada.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'ETH', price: 500_000_000, amount: '0.1', min_fiat: 100_00, max_fiat: 100_000_00, payment_method_ids: [ada.bank] })).json.error.code, 'crypto_account_frozen');
    assert.equal((await buyer.get('/v1/afrippa/p2p/market?asset=ETH&side=buy')).json.data.some(item => item.id === ad.json.id), false, 'their ads leave the market');
    assert.equal((await order(buyer, ad.json, { fiat: 5_000_00 })).json.error.code, 'ad_unavailable');
    assert.equal((await afrippaAdmin.put(`/v1/afrippa/admin/crypto/customers/${ada.id}/account-freeze`, { frozen: false, reason: 'Cleared' })).json.frozen, false);
    assert.equal((await order(buyer, ad.json, { fiat: 5_000_00 })).status, 201);

    const view = await afrippaSupport.get(`/v1/afrippa/admin/crypto/customers/${ada.id}`);
    assert.deepEqual(view.json.freezes.map(item => item.status).sort(), ['frozen', 'released', 'seized']);
    const audit = await prisma.auditLog.findMany({ where: { targetId: ada.id, action: { startsWith: 'crypto.' } } });
    assert.deepEqual([...new Set(audit.map(item => item.action))].sort(), ['crypto.account_frozen', 'crypto.account_unfrozen', 'crypto.frozen', 'crypto.seized', 'crypto.unfrozen']);
    await cryptoConserved();
  });

  test('live crypto needs the identity check; test credits are sandbox only', async () => {
    const ada = await trader('Ada Live');
    const credited = await afrippaAdmin.post(`/v1/afrippa/admin/crypto/customers/${ada.id}/test-credits`, { asset: 'USDC', amount: '5', reason: 'Trying the market' });
    assert.equal(credited.status, 201, JSON.stringify(credited.json));
    assert.equal(credited.json.balances.test.find(item => item.asset === 'USDC').available, '5.000000');
    // Afrippa's store switched live: its traders trade live.
    await prisma.store.update({ where: { id: afrippaStoreId }, data: { checkoutMode: 'live' } });
    try {
      const overview = await ada.get('/v1/afrippa/crypto');
      assert.deepEqual([overview.json.mode, overview.json.verified], ['live', false]);
      assert.equal((await ada.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.error.code, 'customer_verification_required');
      assert.equal((await ada.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '1' })).json.error.code, 'customer_verification_required');
    } finally {
      await prisma.store.update({ where: { id: afrippaStoreId }, data: { checkoutMode: 'test' } });
    }
  });
});

describe('owners who can no longer trade, and huge amounts', () => {
  before(() => switches(true));
  after(() => switches(null));

  test('an ad leaves the market when its owner can no longer trade, and cannot be taken', async () => {
    const seller = await trader('Ada Away');
    const buyer = await trader('Bola Away');
    await deposit(seller, 'USDT', '50');
    const ad = (await sellAd(seller, { amount: '50', price: 170000 })).json;
    const listed = async () => (await buyer.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&limit=100')).json.data.some(item => item.id === ad.id);
    assert.equal(await listed(), true);
    await prisma.customer.update({ where: { id: seller.id }, data: { status: 'disabled' } });
    assert.equal(await listed(), false, 'a disabled account’s ads are off the market');
    const taken = await order(buyer, ad, { fiat: 10_000_00 });
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'ad_unavailable']);
    await prisma.customer.update({ where: { id: seller.id }, data: { status: 'active' } });
    assert.equal(await listed(), true);
  });

  test('amounts too large for the ledger are refused, never a server error', async () => {
    const ada = await trader('Ada Huge');
    const huge = await ada.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '99999999999999999999.5' });
    assert.deepEqual([huge.status, huge.json.error.code], [400, 'parameter_invalid']);
    const ad = await sellAd(ada, { amount: '99999999999999999999' });
    assert.deepEqual([ad.status, ad.json.error.code], [400, 'parameter_invalid']);
  });
});

describe('paying withdrawable money out to a bank', () => {
  before(() => switches(true));
  after(() => switches(null));

  /** A bitocard.com customer through its store's server (no Afrippa signature). */
  function storeServer() {
    let token = null;
    const request = async (method, path, body) => {
      const res = await fetch(`${server.base}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { 'bitocard-customer-session': token } : {}),
          ...(method === 'POST' ? { 'idempotency-key': `store-${Date.now()}-${Math.random()}` } : {}),
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

  /** A customer holding NGN 33,000 from a Safe pay sale (Nigeria's smallest payout is NGN 15,000). */
  async function sellerWithProceeds() {
    const shopper = storeServer();
    const email = `p2p-money${(counter += 1)}-${Date.now()}@example.com`;
    const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Proceeds', email, password: 'correct horse battery', country: 'NG' });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
    shopper.id = signup.json.customer.id;
    await ledger.post({
      mode: 'test',
      type: 'classified_release',
      reference: `classified_order:${randomUUID()}:released`,
      description: 'A Safe pay sale',
      lines: [
        { account: { kind: 'adjustments', currency: 'NGN' }, debit: 33_000_00n },
        { account: { kind: 'customer_withdrawable', currency: 'NGN', customerId: shopper.id }, credit: 33_000_00n },
      ],
    });
    return shopper;
  }

  test('sale money waits for the payout hold, then goes to the customer’s bank account once', async () => {
    const seller = await sellerWithProceeds();
    const held = await seller.get('/v1/store/cash');
    assert.deepEqual([held.json.balance, held.json.available, held.json.held, held.json.hold_days], [33_000_00, 0, 33_000_00, 15]);
    assert.equal('cross_border_hold_days' in held.json, false, 'the cross-border hold is gone');

    const unknown = await seller.post('/v1/store/cash/bank-accounts', { bank_code: 'SBX001', account_number: '0000000000' });
    assert.deepEqual([unknown.status, unknown.json.error.code], [400, 'bank_account_invalid']);
    const added = await seller.post('/v1/store/cash/bank-accounts', { bank_code: 'SBX001', account_number: '0123456789' });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual([added.json.bank_name, added.json.account_number_last4], ['Sandbox Bank', '6789']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: seller.id, type: 'customer.security.bank_account_added' } }));

    const early = await seller.post('/v1/store/cash/payouts', { amount: 15_000_00, bank_account_id: added.json.id });
    assert.deepEqual([early.status, early.json.error.code], [402, 'insufficient_funds'], 'inside the payout hold');

    const country = await prisma.country.findUniqueOrThrow({ where: { code: 'NG' } });
    await prisma.country.update({ where: { code: 'NG' }, data: { payoutHoldDays: 0 } });
    try {
      const small = await seller.post('/v1/store/cash/payouts', { amount: 1, bank_account_id: added.json.id });
      assert.deepEqual([small.status, small.json.error.code], [400, 'amount_too_small']);
      const paid = await seller.post('/v1/store/cash/payouts', { amount: 15_000_00, bank_account_id: added.json.id });
      assert.deepEqual([paid.status, paid.json.status, paid.json.bank_account.account_number_last4], [201, 'processing', '6789']);
      assert.equal((await seller.get('/v1/store/cash')).json.balance, 18_000_00, 'set aside while the transfer runs');
      const settled = await seller.post(`/v1/store/cash/payouts/${paid.json.id}/simulate`, { outcome: 'paid' });
      assert.equal(settled.json.status, 'paid');
      assert.equal((await seller.post(`/v1/store/cash/payouts/${paid.json.id}/simulate`, { outcome: 'failed' })).json.status, 'paid', 'final once paid');

      const failed = await seller.post('/v1/store/cash/payouts', { amount: 18_000_00, bank_account_id: added.json.id });
      assert.equal((await seller.post(`/v1/store/cash/payouts/${failed.json.id}/simulate`, { outcome: 'failed' })).json.status, 'failed');
      assert.equal((await seller.get('/v1/store/cash')).json.available, 18_000_00, 'a failed payout returns the money');
      const too = await seller.post('/v1/store/cash/payouts', { amount: 18_000_01, bank_account_id: added.json.id });
      assert.deepEqual([too.status, too.json.error.code], [402, 'insufficient_funds']);
      assert.deepEqual((await seller.get('/v1/store/cash/payouts')).json.data.map(item => item.status), ['failed', 'paid']);
      assert.ok(await prisma.notification.findFirst({ where: { customerId: seller.id, type: 'customer.payout.paid' } }));
      const listed = (await admin.get(`/v1/admin/crypto/payouts?customer_id=${seller.id}`)).json.data;
      assert.deepEqual(listed.map(item => [item.status, item.account_name]), [['failed', 'SANDBOX ACCOUNT HOLDER'], ['paid', 'SANDBOX ACCOUNT HOLDER']]);
    } finally {
      await prisma.country.update({ where: { code: 'NG' }, data: { payoutHoldDays: country.payoutHoldDays } });
    }
    await ledgerOk();
  });

  test('a frozen account pays nothing out; money can still be paid out after crypto is switched off', async () => {
    const seller = await sellerWithProceeds();
    const account = (await seller.post('/v1/store/cash/bank-accounts', { bank_code: 'SBX002', account_number: '1234567890' })).json;
    await prisma.customer.update({ where: { id: seller.id }, data: { cryptoFrozenAt: new Date() } });
    const frozen = await seller.post('/v1/store/cash/payouts', { amount: 15_000_00, bank_account_id: account.id });
    assert.deepEqual([frozen.status, frozen.json.error.code], [403, 'crypto_account_frozen']);
    await prisma.customer.update({ where: { id: seller.id }, data: { cryptoFrozenAt: null } });
    await switches(false);
    try {
      const cash = await seller.get('/v1/store/cash');
      assert.equal(cash.status, 200, 'switching crypto off never traps money');
      assert.equal(cash.json.balance, 33_000_00);
    } finally {
      await switches(true);
    }
  });

  test('a transfer notification finds a customer payout; one whose outcome stays unclear is flagged for finance once', async () => {
    const seller = await sellerWithProceeds();
    const account = (await seller.post('/v1/store/cash/bank-accounts', { bank_code: 'SBX001', account_number: '2234567890' })).json;
    await prisma.country.update({ where: { code: 'NG' }, data: { payoutHoldDays: 0 } });
    let payout;
    try {
      payout = (await seller.post('/v1/store/cash/payouts', { amount: 15_000_00, bank_account_id: account.id })).json;
    } finally {
      await prisma.country.update({ where: { code: 'NG' }, data: { payoutHoldDays: 15 } });
    }
    const row = await prisma.customerPayout.findUniqueOrThrow({ where: { id: payout.id } });
    const { PayoutsService } = await import('../dist/payouts/payouts.service.js');
    const found = await server.app.get(PayoutsService).refreshByTransferId('sandbox', row.providerTransferId);
    assert.deepEqual(found, { handled: true, status: 'processing' }, 'the reseller payout lookup falls back to customer payouts');

    await prisma.customerPayout.update({ where: { id: payout.id }, data: { status: 'pending', createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    const { CustomerPayoutsService } = await import('../dist/payouts/customer-payouts.service.js');
    const payouts = server.app.get(CustomerPayoutsService);
    await payouts.job();
    await payouts.job();
    assert.ok((await prisma.customerPayout.findUniqueOrThrow({ where: { id: payout.id } })).needsReviewAt);
    assert.ok((await prisma.notification.count({ where: { type: 'admin.customer_payout.unclear', dedupeKey: `admin.customer_payout.unclear:${payout.id}` } })) > 0, 'finance is told');
  });
});

describe('markets: the global market and trading across borders', () => {
  const keys = ['crypto_wallets', 'p2p_trading', 'crypto_global', 'crypto_cross_border', 'crypto_app'];

  after(async () => {
    for (const key of keys) {
      await setSwitch(key, null);
      for (const country of ['NG', 'GH', 'KE']) await setSwitch(key, null, country);
    }
  });

  test('the global market: US dollars across countries, open to residents of a country whose own market is off', async () => {
    // Nigeria's own market is open; Ghana's is off, but Ghanaians may trade on the global market.
    await setSwitch('crypto_wallets', true, 'NG');
    await setSwitch('p2p_trading', true, 'NG');
    await setSwitch('crypto_wallets', false, 'GH');
    await setSwitch('p2p_trading', false, 'GH');
    // The global market itself, and each country whose residents may trade there, set for it by itself.
    await setSwitch('crypto_global', true);
    await setSwitch('crypto_global', true, 'NG');
    await setSwitch('crypto_global', true, 'GH');
    const nigerian = await trader('Ada Lagos', 'NG');
    const ghanaian = await trader('Kofi Accra', 'GH');

    assert.deepEqual((await ghanaian.get('/v1/afrippa/p2p/markets')).json.data.map(item => [item.market, item.currencies, item.home]), [['WW', ['USD'], false]]);
    assert.deepEqual((await nigerian.get('/v1/afrippa/p2p/markets')).json.data.map(item => [item.market, item.currencies, item.home]), [['NG', ['NGN', 'USD'], true], ['WW', ['USD'], false]]);
    // Ghana's own market stays closed to them.
    assert.equal((await ghanaian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.error.code, 'crypto_not_enabled');

    // They hold crypto for the global market: the overview and test deposits are open to them.
    const overview = (await ghanaian.get('/v1/afrippa/crypto')).json;
    assert.deepEqual([overview.enabled, overview.p2p_enabled, overview.global_enabled], [true, false, true]);
    assert.equal((await ghanaian.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '5' })).status, 201);
    await credit(ghanaian, 'USDT', '25');
    const usd = await wise(ghanaian, 'USD');
    const ad = await sellAd(ghanaian, { market: 'WW', price: 100, amount: '10', min_fiat: 100, max_fiat: 1000, payment_method_ids: [usd] });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.deepEqual([ad.json.market, ad.json.currency], ['WW', 'USD']);
    assert.equal((await sellAd(ghanaian, { market: 'WW', currency: 'GHS', price: 100, amount: '1', min_fiat: 100, max_fiat: 100 })).json.error.code, 'currency_unsupported');
    // The global book is its own: not Nigeria's USD book.
    assert.equal((await nigerian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&currency=USD')).json.data.some(item => item.id === ad.json.id), false);
    const book = await nigerian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&market=ww');
    assert.equal(book.json.market, 'WW');
    assert.equal(book.json.data.some(item => item.id === ad.json.id), true);

    const taken = await order(nigerian, ad.json, { amount: '4' });
    assert.equal(taken.status, 201, JSON.stringify(taken.json));
    assert.deepEqual([taken.json.market, taken.json.currency, taken.json.fiat], ['WW', 'USD', 400]);

    // Global trading switched off for Ghana: their ad leaves the book, and they cannot trade there.
    await setSwitch('crypto_global', false, 'GH');
    assert.equal((await nigerian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&market=WW')).json.data.some(item => item.id === ad.json.id), false);
    assert.equal((await order(nigerian, ad.json, { amount: '1' })).json.error.code, 'ad_unavailable');
    assert.equal((await ghanaian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&market=WW')).json.error.code, 'market_unavailable');
    // What they hold is still theirs: closing the ad gives the rest back.
    assert.equal((await ghanaian.post(`/v1/afrippa/p2p/ads/${ad.json.id}/cancel`)).status, 200);
    // The global market itself off: nobody trades there.
    await setSwitch('crypto_global', true, 'GH');
    await setSwitch('crypto_global', false);
    assert.equal((await nigerian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&market=WW')).json.error.code, 'market_unavailable');
    await cryptoConserved();
  });

  test("another country's local book: in its currency only, where it takes cross-border trades", async () => {
    for (const country of ['NG', 'GH', 'KE']) {
      await setSwitch('crypto_wallets', true, country);
      await setSwitch('p2p_trading', true, country);
    }
    const nigerian = await trader('Ada Border', 'NG');
    const ghanaian = await trader('Kofi Border', 'GH');
    await credit(nigerian, 'USDT', '20');
    const cedis = await bank(nigerian, 'GHS');

    // Ghana takes no cross-border trades yet.
    assert.equal((await sellAd(nigerian, { market: 'GH', price: 1_500_00, amount: '5', min_fiat: 100, max_fiat: 100_000_00, payment_method_ids: [cedis] })).json.error.code, 'market_unavailable');
    await setSwitch('crypto_cross_border', true, 'GH');
    assert.deepEqual(
      (await nigerian.get('/v1/afrippa/p2p/markets')).json.data.map(item => [item.market, item.currencies, item.cross_border]),
      [['NG', ['NGN', 'USD'], false], ['GH', ['GHS'], true]],
    );
    assert.equal((await sellAd(nigerian, { market: 'GH', currency: 'USD', price: 100, amount: '1', min_fiat: 100, max_fiat: 100 })).json.error.code, 'currency_unsupported', "another country's USD book is its residents'");
    assert.equal((await sellAd(nigerian, { market: 'KE', price: 100, amount: '1', min_fiat: 100, max_fiat: 100 })).json.error.code, 'market_unavailable', 'Kenya takes no cross-border trades');

    // A Nigerian sells USDT to a Ghanaian for cedis, paid into their Ghanaian account.
    const ad = await sellAd(nigerian, { market: 'GH', price: 15_00, amount: '10', min_fiat: 100, max_fiat: 100_000_00, payment_method_ids: [cedis] });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.deepEqual([ad.json.market, ad.json.currency], ['GH', 'GHS']);
    assert.equal((await ghanaian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.some(item => item.id === ad.json.id), true, "in Ghana's own book");
    const taken = await order(ghanaian, ad.json, { amount: '6' });
    assert.equal(taken.status, 201, JSON.stringify(taken.json));
    assert.deepEqual([taken.json.market, taken.json.currency, taken.json.fiat], ['GH', 'GHS', 90_00]);

    // Cross-border trades closed again: the Nigerian's ad leaves Ghana's book; closing it still works.
    await setSwitch('crypto_cross_border', null, 'GH');
    assert.equal((await ghanaian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.some(item => item.id === ad.json.id), false);
    assert.equal((await nigerian.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&market=GH')).json.error.code, 'market_unavailable');
    assert.equal((await nigerian.post(`/v1/afrippa/p2p/ads/${ad.json.id}/cancel`)).status, 200);
    await cryptoConserved();
  });

  test('trading needs the declaration (not a US or UK citizen or resident) and, live, an ID from an allowed country', async () => {
    await setSwitch('crypto_wallets', true, 'NG');
    await setSwitch('p2p_trading', true, 'NG');
    const ada = await trader('Ada Declares', 'NG', { declare: false });
    const declaration = (await ada.get('/v1/afrippa/crypto/declaration')).json;
    assert.deepEqual([declaration.declared, declaration.text], [false, 'I am not a citizen or a resident of the United States or the United Kingdom.']);
    const refused = await ada.get('/v1/afrippa/p2p/market?asset=USDT&side=buy');
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [409, 'declaration_required', 'declaration']);
    assert.equal((await ada.post('/v1/afrippa/crypto/declaration', { version: '2020-01-01' })).json.error.code, 'declaration_changed');
    const made = await ada.post('/v1/afrippa/crypto/declaration', { version: declaration.version });
    assert.deepEqual([made.status, made.json.declared], [200, true]);
    assert.equal((await ada.post('/v1/afrippa/crypto/declaration', { version: declaration.version })).status, 200, 'declaring again changes nothing');
    assert.equal((await ada.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).status, 200);

    // Live, the ID document's country must be an allowed market: a US passport is refused whatever was declared.
    const { CryptoWalletsService } = await import('../dist/crypto/crypto-wallets.service.js');
    const wallets = server.app.get(CryptoWalletsService);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: ada.id }, include: { store: { include: { reseller: { select: { house: true } } } }, market: true } });
    const context = { ...(await wallets.context(row)), mode: 'live' };
    const check = async documentCountry => {
      await prisma.identityVerification.deleteMany({ where: { customerReference: ada.id } });
      if (documentCountry) {
        await prisma.identityVerification.create({
          data: { subject: 'customer', resellerId: context.seller.id, mode: 'live', customerReference: ada.id, method: 'document', provider: 'sandbox', providerReference: `doc-${Date.now()}-${Math.random()}`, status: 'approved', country: 'NG', consentAt: new Date(), documentCountry },
        });
      }
      try {
        await wallets.requireEligible(context);
        return 'ok';
      } catch (error) {
        return error.code;
      }
    };
    assert.equal(await check('NG'), 'ok');
    assert.equal(await check('US'), 'country_not_allowed');
    assert.equal(await check('GB'), 'country_not_allowed');
    await setSwitch('crypto_wallets', false, 'GH');
    await setSwitch('crypto_global', false, 'GH');
    assert.equal(await check('GH'), 'country_not_allowed', 'Ghana is not allowed until an admin opens it');
    await setSwitch('crypto_app', true, 'GH');
    assert.equal(await check('GH'), 'ok');
    assert.equal(await check(null), 'country_not_allowed', 'no approved check, no live trading');
    await setSwitch('crypto_app', null, 'GH');
    await prisma.identityVerification.deleteMany({ where: { customerReference: ada.id } });
  });
});

describe('market limits and the public pages', () => {
  const limits = body => afrippaAdmin.put('/v1/afrippa/admin/crypto/market-limits', { mode: 'test', ...body });

  before(async () => {
    for (const country of ['NG', 'GH']) {
      await setSwitch('crypto_wallets', true, country);
      await setSwitch('p2p_trading', true, country);
    }
  });
  after(async () => {
    await prisma.cryptoMarketLimit.deleteMany({});
    for (const key of ['crypto_wallets', 'p2p_trading', 'crypto_app', 'crypto_global', 'crypto_cross_border', 'crypto_install_prompt']) {
      await setSwitch(key, null);
      for (const country of ['NG', 'GH']) await setSwitch(key, null, country);
    }
  });

  test('per order and per 24 hours, for the taker and the ad owner alike', async () => {
    assert.equal((await limits({ market: 'WW', currency: 'NGN', per_trade: 1 })).json.error.code, 'parameter_invalid', 'the global market is USD only');
    assert.equal((await limits({ market: 'ZZ', currency: 'USD', per_trade: 1 })).json.error.code, 'parameter_invalid');
    assert.equal((await limits({ market: 'NG', currency: 'NGN', cross_border_hold_days: 30 })).status, 400, 'the cross-border hold is retired');
    const saved = await limits({ market: 'NG', currency: 'NGN', per_trade: 60_00, per_day: 100_00 });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.per_trade, saved.json.per_day, saved.json.cross_border_per_trade], [60_00, 100_00, null]);
    assert.equal('cross_border_hold_days' in saved.json, false);
    assert.equal((await afrippaAdmin.get('/v1/afrippa/admin/crypto/market-limits?mode=test')).json.data.some(row => row.market === 'NG' && row.currency === 'NGN'), true);

    const seller = await trader('Ada Capped');
    const buyer = await trader('Bola Capped');
    const other = await trader('Cara Capped');
    await credit(seller, 'USDT', '10');
    const ad = (await sellAd(seller, { price: 100_00, amount: '5', min_fiat: 100, max_fiat: 500_00 })).json;
    const take = (who, amount) => order(who, ad, { amount });

    const tooBig = await take(buyer, '0.7');
    assert.deepEqual([tooBig.status, tooBig.json.error.code], [409, 'trade_limit']);
    assert.match(tooBig.json.error.message, /NGN 60\.00/);
    assert.equal((await take(buyer, '0.5')).status, 201);
    const overDay = await take(buyer, '0.6');
    assert.equal(overDay.json.error.code, 'trade_limit');
    assert.match(overDay.json.error.message, /NGN 50\.00/, 'what is left today, open orders counted');
    assert.equal((await take(buyer, '0.5')).status, 201);
    // The seller now has NGN 100.00 of orders today: their ad takes no more, whoever asks.
    assert.equal((await take(other, '0.1')).json.error.code, 'ad_limit');
  });

  test("people from other countries have the tighter cross-border limits in a country's book; live, a market needs its limits", async () => {
    await setSwitch('crypto_cross_border', true, 'GH');
    assert.equal((await limits({ market: 'GH', currency: 'GHS', per_trade: 100_00, cross_border_per_trade: 20_00 })).status, 200);
    const nigerian = await trader('Ada Visitor', 'NG');
    const ghanaian = await trader('Kofi Host', 'GH');
    await credit(nigerian, 'USDT', '10');
    const cedis = await bank(nigerian, 'GHS');
    const ad = (await sellAd(nigerian, { market: 'GH', price: 10_00, amount: '5', min_fiat: 100, max_fiat: 100_00, payment_method_ids: [cedis] })).json;
    // The Ghanaian is in their own market (GHS 100.00 an order); the Nigerian owner is from elsewhere (GHS 20.00).
    assert.equal((await order(ghanaian, ad, { amount: '3' })).json.error.code, 'ad_limit');
    assert.equal((await order(ghanaian, ad, { amount: '1.5' })).status, 201);

    const { CryptoMarketLimitsService } = await import('../dist/crypto/market-limits.service.js');
    const service = server.app.get(CryptoMarketLimitsService);
    await assert.rejects(
      prisma.$transaction(tx => service.check(tx, { mode: 'live', market: 'KE', currency: 'KES', fiat: 1n, parties: [] })),
      error => error.code === 'market_limits_unset',
    );
  });

  test('the public pages: markets shown, their ads and traders, with nicknames only and no sign-in', async () => {
    const visitor = afrippaServer();
    assert.deepEqual((await visitor.get('/v1/afrippa/markets')).json.data, []);
    await setSwitch('crypto_app', true, 'NG');
    await setSwitch('crypto_global', true);
    const markets = await visitor.get('/v1/afrippa/markets');
    assert.equal(markets.cache, 'public, max-age=60');
    assert.deepEqual(markets.json.assets.slice(0, 2), ['USDT', 'USDC'], 'the coins on sale, in order');
    assert.deepEqual(markets.json.data.map(item => [item.market, item.currencies, item.install_prompt]), [['WW', ['USD'], false], ['NG', ['NGN', 'USD'], false]]);
    await setSwitch('crypto_install_prompt', true, 'NG');
    assert.deepEqual((await visitor.get('/v1/afrippa/markets')).json.data.map(item => item.install_prompt), [false, true], "each market's own install prompt");
    await setSwitch('crypto_install_prompt', null, 'NG');

    const seller = await trader('Ada Public');
    await credit(seller, 'USDT', '5');
    const ad = await sellAd(seller, { price: 100_00, amount: '2', min_fiat: 100, max_fiat: 50_00 });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    const nickname = ad.json.trader.nickname;
    const book = await visitor.get('/v1/afrippa/markets/ng/ads?asset=USDT&side=buy');
    assert.equal(book.status, 200, JSON.stringify(book.json));
    const listed = book.json.data.find(item => item.id === ad.json.id);
    assert.deepEqual([listed.market, listed.trader.nickname, listed.mine], ['NG', nickname, false]);
    assert.equal(JSON.stringify(book.json).includes(seller.id), false, 'never a customer id');
    assert.equal(JSON.stringify(book.json).includes(seller.email), false);
    assert.ok((await visitor.get('/v1/afrippa/markets')).json.data.find(item => item.market === 'NG').ads.NGN >= 1);
    assert.equal((await visitor.get('/v1/afrippa/markets/NG/ads?asset=USDT&side=buy&currency=GHS')).json.error.code, 'currency_unsupported');
    assert.equal((await visitor.get('/v1/afrippa/markets/GH/ads?asset=USDT&side=buy')).json.error.code, 'market_unavailable', 'Ghana is not shown');

    const card = await visitor.get(`/v1/afrippa/traders/${nickname.toLowerCase()}`);
    assert.equal(card.status, 200, JSON.stringify(card.json));
    assert.deepEqual([card.json.nickname, card.json.open_ads, card.json.markets, card.json.trades_total], [nickname, 1, ['NG'], 0]);
    assert.equal(JSON.stringify(card.json).includes(seller.id), false);
    assert.equal((await visitor.get('/v1/afrippa/traders/NoSuchTrader')).status, 404);
  });
});
