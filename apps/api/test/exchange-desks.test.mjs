// The instant exchange's money-safety rules and phase 3 desks: a fallback trade uses BitoCard's own reserves, never
// the store's reseller's; the daily limit per taker; reseller desks only while switched on, capped by their market even
// after a cap is lowered, sessions only; admin money actions confirmed with the authenticator app or the emailed code
// (resends capped); notices after trades and when a reserve runs low; the Coinbase cross-check; desk and trade lists.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, adminCode, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let finance;
let afrippaAdmin;
let prisma;
let prices;
let coingecko;
let coinbase;
const market = { tether: 0.9996, 'usd-coin': 1.0001, bitcoin: 60000, ethereum: 3000, binancecoin: 600, 'polygon-ecosystem-token': 0.5, tron: 0.25, litecoin: 80, dogecoin: 0.2 };
const second = { BTC: '60100', USDT: '1.0002' };

before(async () => {
  coingecko = await fakeService(call => {
    const url = new URL(call.url, 'http://x');
    if (url.pathname !== '/api/v3/simple/price') return { status: 404, body: {} };
    const body = {};
    for (const id of (url.searchParams.get('ids') ?? '').split(',')) if (market[id]) body[id] = { usd: market[id], usd_24h_change: 1.2, last_updated_at: Math.floor(Date.now() / 1000) };
    return { body };
  });
  coinbase = await fakeService(call => {
    const match = /^\/v2\/prices\/([A-Z]+)-USD\/spot$/.exec(new URL(call.url, 'http://x').pathname);
    return match && second[match[1]] ? { body: { data: { amount: second[match[1]] } } } : { status: 404, body: {} };
  });
  server = await startApp({ env: { CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  prices = server.app.get((await import('../dist/crypto/prices.js')).CryptoPricesService);
  admin = await adminClient(server);
  finance = await adminClient(server, ['finance']);
  afrippaAdmin = await afrippaAdminClient(server);
  for (const [source, rate] of [['open_exchange_rates', 1490], ['flutterwave', 1510]]) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: rate, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  const saved = await afrippaAdmin.put('/v1/afrippa/admin/integrations/crypto_prices', { values: { COINGECKO_API_URL: coingecko.url, COINBASE_PRICE_URL: coinbase.url }, code: await adminCode(server, afrippaAdmin) });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  for (const key of ['crypto_wallets', 'crypto_exchange']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { enabled: true })).status, 200);
  for (const asset of ['BTC', 'USDT']) {
    const set = await admin.put('/v1/admin/exchange/markups', { mode: 'test', asset, currency: 'NGN', buy_markup_bps: 100, sell_markup_bps: 100, min_fiat: 100, max_fiat: null, enabled: true });
    assert.equal(set.status, 200, JSON.stringify(set.json));
  }
  // BitoCard's reserves: 0.5 BTC and NGN 50,000,000.
  await move({ kind: 'fund', reserve: 'crypto', asset: 'BTC', amount: '0.5' });
  await move({ kind: 'fund', reserve: 'fiat', country: 'NG', amount: '50000000', external_reference: 'BANK-REF-1' });
});

after(async () => {
  await server?.close();
  await coingecko?.close();
  await coinbase?.close();
});

const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const financeCode = () => lastEmailCode(server.app, finance.admin.email);

async function move(body, method = 'email') {
  const asked = await finance.post('/v1/admin/exchange/reserves/movements', { mode: 'test', reason: 'Exchange float', ...body });
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  const code = method === 'authenticator' ? await adminCode(server, finance) : await financeCode();
  const done = await finance.post(`/v1/admin/exchange/reserves/movements/${asked.json.id}/confirm`, { code, method });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  return done.json;
}

let counter = 0;
async function customer(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `exd-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  const shopper = { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
  const email = `exd${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function fund(shopper, amount) {
  const asked = await finance.post(`/v1/admin/customers/${shopper.id}/top-ups`, { amount, source: 'goodwill', reason: 'Exchange test money' });
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  assert.equal((await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: await financeCode() })).status, 200);
}

const balance = async (kind, resellerId, currency) =>
  (await prisma.ledgerAccount.findFirst({ where: { mode: 'test', kind, resellerId, currency }, select: { balanceMinor: true } }))?.balanceMinor ?? 0n;

/** A verified reseller with a published store, and a customer of it. */
async function resellerStore() {
  const { browser, email, resellerId } = await resellerClient(server);
  assert.equal((await browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'active' } });
  const created = await browser.post('/v1/stores', { name: 'Ada Coins', subdomain: `desk${Date.now().toString(36)}${counter}` });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal((await browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
  return { browser, resellerId, shopper: await customer(created.json.subdomain) };
}

describe('admin money actions', () => {
  test('confirmed with the authenticator app or the emailed code; an authenticator code is used once', async () => {
    const asked = await finance.post('/v1/admin/exchange/reserves/movements', { mode: 'test', kind: 'fund', reserve: 'crypto', asset: 'USDT', amount: '10', reason: 'Exchange float' });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.deepEqual(asked.json.confirm_with, ['authenticator', 'email']);
    const code = await adminCode(server, finance);
    const done = await finance.post(`/v1/admin/exchange/reserves/movements/${asked.json.id}/confirm`, { code, method: 'authenticator' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    // The same authenticator code cannot confirm another action.
    const again = await finance.post('/v1/admin/exchange/reserves/movements', { mode: 'test', kind: 'fund', reserve: 'crypto', asset: 'USDT', amount: '1', reason: 'Exchange float' });
    const replay = await finance.post(`/v1/admin/exchange/reserves/movements/${again.json.id}/confirm`, { code, method: 'authenticator' });
    assert.equal(replay.status, 400, JSON.stringify(replay.json));
    // The emailed code still works for it.
    assert.equal((await finance.post(`/v1/admin/exchange/reserves/movements/${again.json.id}/confirm`, { code: await financeCode() })).status, 200);
    // Manual top-ups take the authenticator too.
    const shopper = await customer();
    const topUp = await finance.post(`/v1/admin/customers/${shopper.id}/top-ups`, { amount: 1000, source: 'goodwill', reason: 'Authenticator test' });
    assert.deepEqual(topUp.json.confirm_with, ['authenticator', 'email']);
    assert.equal((await finance.post(`/v1/admin/top-ups/${topUp.json.id}/confirm`, { code: await adminCode(server, finance), method: 'authenticator' })).status, 200);
    await ledgerOk();
  });

  test('a request gets at most five codes: resends never give unlimited guesses', async () => {
    const asked = await finance.post('/v1/admin/exchange/reserves/movements', { mode: 'test', kind: 'fund', reserve: 'crypto', asset: 'USDT', amount: '1', reason: 'Exchange float' });
    for (let sent = 1; sent < 5; sent++) {
      await prisma.reserveMovement.update({ where: { id: asked.json.id }, data: { codeSentAt: new Date(Date.now() - 120_000) } });
      assert.equal((await finance.post(`/v1/admin/exchange/reserves/movements/${asked.json.id}/resend-code`)).status, 200);
    }
    await prisma.reserveMovement.update({ where: { id: asked.json.id }, data: { codeSentAt: new Date(Date.now() - 120_000) } });
    const capped = await finance.post(`/v1/admin/exchange/reserves/movements/${asked.json.id}/resend-code`);
    assert.equal(capped.json.error.code, 'code_resend_limit');
  });
});

describe('BitoCard desk', () => {
  test('quotes say what is available; the customer is told after a trade; admins when a reserve runs low', async () => {
    const shopper = await customer();
    await fund(shopper, 50_000_000_00);
    const quoted = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '0.01' });
    assert.equal(quoted.status, 201, JSON.stringify(quoted.json));
    assert.equal(Number(quoted.json.available.amount) >= 0.01, true);
    assert.equal(quoted.json.capped, false);
    // Alert when BitoCard's BTC reserve falls below what it holds now.
    const held = await prisma.ledgerAccount.findFirst({ where: { mode: 'test', kind: 'reserve_crypto', currency: 'BTC', resellerId: '00000000-0000-4000-8000-0000000000b1' } });
    await prisma.cryptoAsset.update({ where: { code: 'BTC' }, data: { exchangeReserveAlert: (Number(held.balanceMinor) / 1e8).toFixed(8) } });
    try {
      assert.equal((await shopper.post('/v1/store/exchange/trades', { quote_id: quoted.json.id })).status, 201);
      assert.equal(await prisma.notification.count({ where: { customerId: shopper.id, type: 'customer.exchange.completed' } }), 1);
      assert.ok((await prisma.notification.count({ where: { type: 'admin.exchange.reserve_low' } })) >= 1);
    } finally {
      await prisma.cryptoAsset.update({ where: { code: 'BTC' }, data: { exchangeReserveAlert: null } });
    }
    await ledgerOk();
  });

  test('the daily limit per customer and coin holds across trades', async () => {
    const shopper = await customer();
    await fund(shopper, 50_000_000_00);
    assert.equal((await afrippaAdmin.patch('/v1/afrippa/admin/crypto/assets/BTC', { exchange_daily_limit: '0.015' })).json.exchange_daily_limit, '0.015');
    try {
      const first = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '0.01' });
      assert.equal((await shopper.post('/v1/store/exchange/trades', { quote_id: first.json.id })).status, 201);
      const next = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '0.01' });
      const refused = await shopper.post('/v1/store/exchange/trades', { quote_id: next.json.id });
      assert.equal(refused.json.error.code, 'exchange_limit');
      assert.match(refused.json.error.message, /0\.005/);
    } finally {
      assert.equal((await afrippaAdmin.patch('/v1/afrippa/admin/crypto/assets/BTC', { exchange_daily_limit: null })).json.exchange_daily_limit, null);
    }
  });

  test('one quote used twice at once settles once', async () => {
    const shopper = await customer();
    await fund(shopper, 50_000_000_00);
    const quoted = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '0.001' });
    const results = await Promise.all([1, 2, 3].map(() => shopper.post('/v1/store/exchange/trades', { quote_id: quoted.json.id })));
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.equal(await prisma.exchangeTrade.count({ where: { customerId: shopper.id } }), 1);
    await ledgerOk();
  });

  test('prices that disagree with Coinbase pause the coin', async () => {
    const values = { COINGECKO_API_URL: coingecko.url, COINBASE_PRICE_URL: coinbase.url, CRYPTO_PRICE_SECONDARY: true };
    assert.equal((await afrippaAdmin.put('/v1/afrippa/admin/integrations/crypto_prices', { values, code: await adminCode(server, afrippaAdmin) })).status, 200);
    try {
      const shopper = await customer();
      prices.forget();
      assert.equal((await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '0.001' })).status, 201, '0.17% apart: fine');
      second.BTC = '63000';
      prices.forget();
      const paused = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '0.001' });
      assert.equal(paused.json.error.code, 'price_unavailable');
      assert.ok((await prisma.notification.count({ where: { type: 'admin.exchange.price_divergence' } })) >= 1);
    } finally {
      second.BTC = '60100';
      prices.forget();
      assert.equal((await afrippaAdmin.put('/v1/afrippa/admin/integrations/crypto_prices', { values: { CRYPTO_PRICE_SECONDARY: false }, code: await adminCode(server, afrippaAdmin) })).status, 200);
    }
  });
});

describe('reseller desks', () => {
  test('a fallback trade uses BitoCard’s reserves: the customer’s money never reaches the store’s reseller', async () => {
    const { resellerId, shopper } = await resellerStore();
    await fund(shopper, 50_000_000_00);
    const houseNg = (await prisma.reseller.findFirst({ where: { house: true, country: 'NG' }, select: { id: true } })).id;
    const before = { house: await balance('reserve_fiat', houseNg, 'NGN'), reseller: await balance('reserve_fiat', resellerId, 'NGN') };
    const quoted = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '0.002' });
    assert.equal(quoted.status, 201, JSON.stringify(quoted.json));
    const done = await shopper.post('/v1/store/exchange/trades', { quote_id: quoted.json.id });
    assert.equal(done.status, 201, JSON.stringify(done.json));
    assert.equal(done.json.desk.name, 'BitoCard');
    assert.equal(await balance('reserve_fiat', houseNg, 'NGN'), before.house + BigInt(quoted.json.fiat), 'paid into BitoCard’s NGN reserve');
    assert.equal(await balance('reserve_fiat', resellerId, 'NGN'), before.reseller, 'the reseller’s reserve is untouched');
    // Selling back on fallback is paid from BitoCard's reserve too, even with the reseller's reserve empty.
    const sell = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'sell', amount: '0.001' });
    assert.equal((await shopper.post('/v1/store/exchange/trades', { quote_id: sell.json.id })).status, 201);
    await ledgerOk();
  });

  test('desk settings need the switch; API keys are refused; a lowered cap holds on prices already saved', async () => {
    const { browser, resellerId, shopper } = await resellerStore();
    const headers = { 'bitocard-mode': 'test' };
    const offer = { mode: 'test', asset: 'BTC', currency: 'NGN', buy_markup_bps: 400, sell_markup_bps: 400, min_fiat: 100, max_fiat: null, enabled: true };
    assert.equal((await browser.put('/v1/exchange/markups', offer, headers)).json.error.code, 'exchange_not_enabled');
    assert.equal((await browser.put('/v1/exchange/desk', { fallback_to_bitocard: false }, headers)).json.error.code, 'exchange_not_enabled');
    assert.equal((await browser.post('/v1/exchange/reserves/transfers', { currency: 'NGN', amount: 100, direction: 'fund' }, headers)).json.error.code, 'exchange_not_enabled');
    const key = (await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' })).json.secret;
    const withKey = await fetch(`${server.base}/v1/exchange/reserves`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal(withKey.status, 403);

    assert.equal((await admin.put(`/v1/admin/switches/reseller_desks`, { enabled: true })).status, 200);
    try {
      // The switch on but a plan without the desk: refused for the plan.
      assert.equal((await admin.put('/v1/admin/plans/standard/features/reseller_desks', { enabled: false })).status, 200);
      const noPlan = await browser.put('/v1/exchange/desk', { fallback_to_bitocard: false }, headers);
      assert.deepEqual([noPlan.status, noPlan.json.error.code, noPlan.json.error.param], [403, 'plan_feature_required', 'reseller_desks']);
      assert.equal((await browser.get('/v1/exchange/desk', headers)).json.enabled, false);
      assert.equal((await admin.put('/v1/admin/plans/standard/features/reseller_desks', { enabled: true })).status, 200);
      assert.equal((await admin.patch('/v1/admin/countries/NG', { exchange_markup_cap_bps: 300 })).json.exchange_markup_cap_bps, 300);
      assert.equal((await browser.get('/v1/exchange/desk', headers)).json.markup_cap_bps, 300);
      assert.equal((await browser.put('/v1/exchange/markups', offer, headers)).json.error.code, 'markup_above_cap');
      assert.equal((await admin.patch('/v1/admin/countries/NG', { exchange_markup_cap_bps: 500 })).status, 200);
      assert.equal((await browser.put('/v1/exchange/markups', offer, headers)).status, 200);
      // The cap lowered after the price was saved: the price is held to it.
      assert.equal((await admin.patch('/v1/admin/countries/NG', { exchange_markup_cap_bps: 200 })).status, 200);
      const btc = (await shopper.get('/v1/store/exchange')).json.assets.find(row => row.asset === 'BTC');
      assert.equal(btc.desk.id, resellerId);
      assert.equal(btc.buy.markup_bps, 200);
    } finally {
      await admin.put('/v1/admin/plans/standard/features/reseller_desks', { enabled: true });
      await admin.patch('/v1/admin/countries/NG', { exchange_markup_cap_bps: 500 });
      assert.equal((await admin.put('/v1/admin/switches/reseller_desks', { enabled: null })).status, 200);
    }
  });

  test('a reseller desk serves its customers from its own reserves; trades are listed for it and for admins', async () => {
    const { browser, resellerId, shopper } = await resellerStore();
    const headers = { 'bitocard-mode': 'test' };
    assert.equal((await admin.put('/v1/admin/switches/reseller_desks', { enabled: true })).status, 200);
    assert.equal((await admin.put('/v1/admin/switches/reseller_exchange', { enabled: true })).status, 200);
    try {
      // The reseller buys coins from BitoCard and puts them behind its desk.
      const asked = await finance.post(`/v1/admin/resellers/${resellerId}/top-ups`, { mode: 'test', currency: 'NGN', amount: 5_000_000_00, source: 'goodwill', reason: 'Desk test' });
      assert.equal((await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: await financeCode() })).status, 200);
      const quote = await browser.post('/v1/exchange/quotes', { asset: 'BTC', currency: 'NGN', side: 'buy', amount: '0.01' }, headers);
      assert.equal((await browser.post('/v1/exchange/trades', { quote_id: quote.json.id }, headers)).status, 201);
      assert.equal((await browser.post('/v1/exchange/reserves/coins/transfers', { asset: 'BTC', amount: '0.01', direction: 'fund' }, headers)).status, 201);
      const offer = { mode: 'test', asset: 'BTC', currency: 'NGN', buy_markup_bps: 300, sell_markup_bps: 300, min_fiat: 100, max_fiat: null, enabled: true };
      assert.equal((await browser.put('/v1/exchange/markups', offer, headers)).status, 200);

      await fund(shopper, 50_000_000_00);
      const buy = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '0.01' });
      assert.equal(buy.status, 201, JSON.stringify(buy.json));
      const done = await shopper.post('/v1/store/exchange/trades', { quote_id: buy.json.id });
      assert.equal(done.status, 201, JSON.stringify(done.json));
      assert.equal(done.json.desk.id, resellerId);
      assert.equal(await balance('reserve_fiat', resellerId, 'NGN'), BigInt(buy.json.fiat), 'the money is in the reseller’s own reserve');
      // The reserve is now empty: the reseller is told.
      assert.equal(await prisma.notification.count({ where: { resellerId, type: 'exchange.reserve_low' } }) >= 1, true);

      const theirs = await browser.get('/v1/exchange/desk/trades', headers);
      assert.equal(theirs.status, 200, JSON.stringify(theirs.json));
      assert.equal(theirs.json.data[0].customer.id, shopper.id);
      const listed = (await admin.get('/v1/admin/exchange/desks?mode=test')).json.data.find(row => row.reseller.id === resellerId);
      assert.equal(listed.allowed, true);
      assert.equal(listed.pairs[0].asset, 'BTC');
      assert.equal(listed.reserves.fiat[0].balance, buy.json.fiat);
      assert.equal((await admin.get(`/v1/admin/exchange/trades?mode=test&desk=${resellerId}`)).json.data.length, 1);
      const resellerTrades = (await admin.get(`/v1/admin/exchange/reseller-trades?mode=test&reseller_id=${resellerId}`)).json.data;
      assert.equal(resellerTrades.length, 1);
      assert.equal(resellerTrades[0].reseller.id, resellerId);
      await ledgerOk();
    } finally {
      await admin.put('/v1/admin/switches/reseller_desks', { enabled: null });
      await admin.put('/v1/admin/switches/reseller_exchange', { enabled: null });
    }
  });
});
