// The instant exchange: every coin priced from its live US dollar market price (stablecoins included, never assumed to
// be $1) at the mid rate, plus BitoCard's markup only; reserves funded by finance with an emailed code; trades capped at
// the reserve, held for 30 seconds, settled once in one balanced entry, never coin to coin.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, adminCode, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
/** Afrippa's admin: the price settings are Afrippa's. */
let afrippaAdmin;
let finance;
let prisma;
let prices;
let coingecko;
const market = { tether: 0.9996, 'usd-coin': 1.0001, bitcoin: 60000, ethereum: 3000, binancecoin: 600, 'polygon-ecosystem-token': 0.5, tron: 0.25, litecoin: 80, dogecoin: 0.2 };
const feed = { age: 0, down: false };

before(async () => {
  coingecko = await fakeService(call => {
    const url = new URL(call.url, 'http://x');
    if (url.pathname !== '/api/v3/simple/price' || feed.down) return { status: 503, body: {} };
    const updated = Math.floor((Date.now() - feed.age) / 1000);
    const body = {};
    for (const id of (url.searchParams.get('ids') ?? '').split(',')) if (market[id]) body[id] = { usd: market[id], usd_24h_change: 1.84, last_updated_at: updated };
    return { body };
  });
  server = await startApp({ env: { CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  prices = server.app.get((await import('../dist/crypto/prices.js')).CryptoPricesService);
  admin = await adminClient(server);
  afrippaAdmin = await afrippaAdminClient(server);
  finance = await adminClient(server, ['finance']);
  // Two sources 1490 and 1510: the mid rate is 1500, with no conversion margin.
  for (const [source, rate] of [['open_exchange_rates', 1490], ['flutterwave', 1510]]) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: rate, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  const saved = await afrippaAdmin.put('/v1/afrippa/admin/integrations/crypto_prices', { values: { COINGECKO_API_URL: coingecko.url }, code: await adminCode(server, afrippaAdmin) });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  for (const key of ['crypto_wallets', 'crypto_exchange']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { enabled: true })).status, 200);
  for (const asset of ['BTC', 'USDT']) {
    const set = await admin.put('/v1/admin/exchange/markups', { mode: 'test', asset, currency: 'NGN', buy_markup_bps: 100, sell_markup_bps: 200, min_fiat: 100, max_fiat: null, enabled: true });
    assert.equal(set.status, 200, JSON.stringify(set.json));
  }
});

after(async () => {
  await server?.close();
  await coingecko?.close();
});

const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const financeCode = () => lastEmailCode(server.app, finance.admin.email);

/** Finance moves a reserve: asks, then confirms with the emailed code. */
async function move(body) {
  const asked = await finance.post('/v1/admin/exchange/reserves/movements', { mode: 'test', reason: 'Exchange float', ...body });
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  const done = await finance.post(`/v1/admin/exchange/reserves/movements/${asked.json.id}/confirm`, { code: await financeCode() });
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
        ...(method === 'POST' ? { 'idempotency-key': `ex-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  const shopper = { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
  const email = `ex${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** Money into the customer's NGN wallet, as a manual top-up by finance. */
async function fund(shopper, amount) {
  const asked = await finance.post(`/v1/admin/customers/${shopper.id}/top-ups`, { amount, source: 'goodwill', reason: 'Exchange test money' });
  assert.equal(asked.status, 201, JSON.stringify(asked.json));
  assert.equal((await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: await financeCode() })).status, 200);
}

describe('pricing', () => {
  test('the live market price at the mid rate, plus only the markup, rounded for the desk', async () => {
    const { deskPrice, marketPriceMinor, tradeTerms } = await import('../dist/crypto/exchange/pricing.js');
    const { Prisma } = await import('../dist/generated/prisma/client.js');
    const mid = new Prisma.Decimal(1500);
    // $60,000 a coin x 1500 = NGN 90,000,000.00 a coin.
    assert.equal(marketPriceMinor(6_000_000_000_000n, mid).toString(), '9000000000');
    assert.equal(deskPrice(6_000_000_000_000n, mid, 100, 'buy'), 9_090_000_000n);
    assert.equal(deskPrice(6_000_000_000_000n, mid, 200, 'sell'), 8_820_000_000n);
    // A stablecoin at its own market price: $0.9996 is NGN 1,499.40, not NGN 1,500.
    assert.equal(marketPriceMinor(99_960_000n, mid).toString(), '149940');
    // Buying NGN 100,000.00 of BTC: coins rounded down, never charging more than typed.
    const buy = tradeTerms('buy', 9_090_000_000n, 8, { fiat: 10_000_000n });
    assert.equal(buy.amount, 110_011n);
    assert.ok(buy.fiat <= 10_000_000n && buy.fiat > 9_999_000n);
    // Selling for NGN 100,000.00: enough coins rounded up, the money rounded down but at least what was asked.
    const sell = tradeTerms('sell', 8_820_000_000n, 8, { fiat: 10_000_000n });
    assert.ok(sell.fiat >= 10_000_000n);
  });
});

describe('reserves', () => {
  test('finance funds and draws down reserves with the emailed code; only finance; never below zero', async () => {
    const coins = await move({ kind: 'fund', reserve: 'crypto', asset: 'BTC', amount: '0.5' });
    assert.deepEqual([coins.status, coins.amount, coins.number.startsWith('RM-')], ['completed', '0.50000000', true]);
    const money = await move({ kind: 'fund', reserve: 'fiat', country: 'NG', amount: '50000000.00', external_reference: 'GTB-RES-1' });
    assert.equal(money.amount, '50000000.00');
    await move({ kind: 'fund', reserve: 'fiat', country: 'NG', currency: 'USD', amount: '1000.00', external_reference: 'USD-RES-1' });
    await move({ kind: 'fund', reserve: 'crypto', asset: 'USDT', amount: '1000' });

    const reserves = (await admin.get('/v1/admin/exchange/reserves?mode=test')).json;
    assert.equal(reserves.coins.find(item => item.asset === 'BTC').balance, '0.50000000');
    assert.equal(reserves.coins.find(item => item.asset === 'USDT').market.usd, '0.9996');
    assert.equal(reserves.markets.find(item => item.country === 'NG').balance, 5_000_000_000);
    assert.equal(reserves.markets.find(item => item.country === 'NG' && item.currency === 'USD').balance, 100_000);

    const tooMuch = await finance.post('/v1/admin/exchange/reserves/movements', { mode: 'test', kind: 'withdraw', reserve: 'crypto', asset: 'BTC', amount: '9', reason: 'Too much' });
    assert.equal(tooMuch.json.error.code, 'reserve_insufficient');
    assert.equal((await finance.post('/v1/admin/exchange/reserves/movements', { mode: 'test', kind: 'fund', reserve: 'fiat', country: 'NG', amount: '1.00', reason: 'No reference' })).json.error.param, 'external_reference');

    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.post('/v1/admin/exchange/reserves/movements', { mode: 'test', kind: 'fund', reserve: 'crypto', asset: 'BTC', amount: '1', reason: 'Not allowed' })).status, 403);

    const asked = (await finance.post('/v1/admin/exchange/reserves/movements', { mode: 'test', kind: 'withdraw', reserve: 'crypto', asset: 'BTC', amount: '0.01', reason: 'Testing codes' })).json;
    const colleague = await adminClient(server, ['finance']);
    assert.equal((await colleague.post(`/v1/admin/exchange/reserves/movements/${asked.id}/confirm`, { code: await financeCode() })).json.error.code, 'not_requester');
    assert.equal((await colleague.post(`/v1/admin/exchange/reserves/movements/${asked.id}/cancel`)).json.status, 'cancelled');
    const history = (await admin.get('/v1/admin/activity?limit=50')).json;
    assert.ok(JSON.stringify(history).includes('exchange.reserve_funded'));
    await ledgerOk();
  });
});

describe('trading', () => {
  test('buys at the live price with the markup, from the reserve, paid from the wallet; sells back for P2P money', async () => {
    const shopper = await customer();
    await fund(shopper, 20_000_000);
    const overview = (await shopper.get('/v1/store/exchange')).json;
    assert.equal(overview.enabled, true, JSON.stringify(overview));
    const btc = overview.assets.find(item => item.asset === 'BTC');
    assert.deepEqual([btc.market.usd, btc.market.price, btc.buy.price, btc.sell.price, btc.market.change_24h], ['60000', 9_000_000_000, 9_090_000_000, 8_820_000_000, 1.84]);
    assert.ok(Number(btc.buy.available_amount) >= 0.49, 'the reserve is shown');
    assert.equal(overview.assets.find(item => item.asset === 'ETH').closed, 'not_offered');

    const quote = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', fiat: 10_000_000 });
    assert.equal(quote.status, 201, JSON.stringify(quote.json));
    assert.deepEqual([quote.json.amount, quote.json.price, quote.json.market_usd, quote.json.fx_rate], ['0.00110011', 9_090_000_000, '60000.00000000', '1500']);
    const trade = await shopper.post('/v1/store/exchange/trades', { quote_id: quote.json.id });
    assert.equal(trade.status, 201, JSON.stringify(trade.json));
    assert.match(trade.json.number, /^EX-\d{6}$/);
    assert.equal(trade.json.from_wallet, quote.json.fiat);
    assert.equal((await shopper.post('/v1/store/exchange/trades', { quote_id: quote.json.id })).json.error.code, 'quote_used');

    const after = (await shopper.get('/v1/store/exchange?asset=BTC')).json;
    assert.equal(after.assets[0].holding, '0.00110011');
    assert.equal(after.balances.wallet, 20_000_000 - quote.json.fiat);
    const stored = await prisma.exchangeTrade.findUnique({ where: { id: trade.json.id } });
    assert.ok(stored.markupMinor > 0n, 'the markup is recorded as BitoCard’s margin');

    const sell = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'sell', amount: '0.001' });
    assert.equal(sell.json.price, 8_820_000_000);
    assert.equal(sell.json.fiat, 8_820_000);
    assert.equal((await shopper.post('/v1/store/exchange/trades', { quote_id: sell.json.id })).status, 201);
    const sold = (await shopper.get('/v1/store/exchange?asset=BTC')).json;
    assert.deepEqual([sold.assets[0].holding, sold.balances.proceeds], ['0.00010011', 8_820_000]);
    const listed = (await shopper.get('/v1/store/exchange/trades')).json.data;
    assert.deepEqual(listed.map(item => item.side), ['sell', 'buy']);
    assert.ok((await admin.get('/v1/admin/exchange/trades?mode=test')).json.data.some(item => item.customer?.id === shopper.id && item.markup >= 0));
    await ledgerOk();
  });

  test('capped at the reserve, limits, held for 30 seconds, coin-to-coin refused', async () => {
    const shopper = await customer();
    await fund(shopper, 2_000_000_000);
    const over = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount: '5' });
    assert.deepEqual([over.status, over.json.error.code], [402, 'reserve_insufficient']);
    assert.match(over.json.error.message, /BitoCard has 0\.\d+ BTC available/);
    assert.equal((await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', fiat: 50 })).json.error.code, 'amount_too_small', 'NGN 0.50 buys no BTC');
    assert.equal((await shopper.post('/v1/store/exchange/quotes', { asset: 'USDT', side: 'buy', fiat: 50 })).json.error.code, 'below_limit');
    assert.equal((await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'swap', amount: '1' })).status, 400);
    assert.equal((await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy' })).json.error.code, 'parameter_missing');

    const quote = (await shopper.post('/v1/store/exchange/quotes', { asset: 'USDT', side: 'buy', amount: '10' })).json;
    // USDT at its market price ($0.9996 x 1500 = NGN 1,499.40) plus 1%: NGN 1,514.40 a coin.
    assert.equal(quote.price, 151_440);
    await prisma.exchangeQuote.update({ where: { id: quote.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await shopper.post('/v1/store/exchange/trades', { quote_id: quote.id })).json.error.code, 'quote_expired');
  });

  test('parallel buys on the last of a reserve: one wins, the rest are refused, the ledger balances', async () => {
    const shopper = await customer();
    await fund(shopper, 3_000_000_000);
    const reserve = (await shopper.get('/v1/store/exchange?asset=BTC')).json.assets[0].buy.available_amount;
    const amount = (Number(reserve) * 0.6).toFixed(8);
    const quotes = [];
    for (let i = 0; i < 3; i += 1) quotes.push((await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', amount })).json);
    const results = await Promise.all(quotes.map(quote => shopper.post('/v1/store/exchange/trades', { quote_id: quote.id })));
    assert.equal(results.filter(result => result.status === 201).length, 1, JSON.stringify(results.map(result => result.json)));
    assert.ok(results.filter(result => result.status !== 201).every(result => result.json.error.code === 'reserve_insufficient'));
    await ledgerOk();
  });

  test('a stale or missing market price closes the pair; never a price older than five minutes', async () => {
    const shopper = await customer();
    prices.forget();
    feed.age = 6 * 60_000;
    try {
      const overview = (await shopper.get('/v1/store/exchange?asset=BTC')).json;
      assert.equal(overview.assets[0].closed, 'price_unavailable');
      const refused = await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', fiat: 100_000 });
      assert.deepEqual([refused.status, refused.json.error.code], [503, 'price_unavailable']);
    } finally {
      feed.age = 0;
      prices.forget();
    }
    feed.down = true;
    try {
      assert.equal((await shopper.get('/v1/store/exchange?asset=BTC')).json.assets[0].closed, 'price_unavailable');
    } finally {
      feed.down = false;
      prices.forget();
    }
  });

  test('switched off, the screen says why and nothing can be quoted', async () => {
    assert.equal((await admin.put('/v1/admin/switches/crypto_exchange', { enabled: null })).status, 200);
    try {
      const shopper = await customer();
      const overview = (await shopper.get('/v1/store/exchange')).json;
      assert.deepEqual([overview.enabled, overview.reason, overview.assets.length], [false, 'exchange_not_enabled', 0]);
      assert.equal((await shopper.post('/v1/store/exchange/quotes', { asset: 'BTC', side: 'buy', fiat: 100_000 })).json.error.code, 'exchange_not_enabled');
    } finally {
      assert.equal((await admin.put('/v1/admin/switches/crypto_exchange', { enabled: true })).status, 200);
    }
  });

  test('markups: admins only, at most 20%, shown beside the live price', async () => {
    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/exchange/markups', { mode: 'test', asset: 'ETH', currency: 'NGN', buy_markup_bps: 100, sell_markup_bps: 100, min_fiat: 0, max_fiat: null, enabled: true })).status, 403);
    assert.equal((await admin.put('/v1/admin/exchange/markups', { mode: 'test', asset: 'ETH', currency: 'NGN', buy_markup_bps: 2500, sell_markup_bps: 100, min_fiat: 0, max_fiat: null, enabled: true })).status, 400);
    const rows = (await support.get('/v1/admin/exchange/markups?mode=test')).json.data;
    const btc = rows.find(row => row.asset === 'BTC' && row.currency === 'NGN');
    assert.deepEqual([btc.enabled, btc.market_usd, btc.buy_price, btc.sell_price], [true, '60000', 9_090_000_000, 8_820_000_000]);
  });
});

describe('reseller exchange', () => {
  test('a reseller buys from BitoCard, funds its separate coin reserve, and cannot overspend', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const headers = { 'bitocard-mode': 'test' };
    const disabled = await browser.get('/v1/exchange?currency=NGN', headers);
    assert.equal(disabled.json.error.code, 'exchange_not_enabled');
    assert.equal((await admin.put('/v1/admin/switches/reseller_exchange', { enabled: true })).status, 200);
    try {
      await move({ kind: 'fund', reserve: 'crypto', asset: 'BTC', amount: '0.02' });
      const asked = await finance.post(`/v1/admin/resellers/${resellerId}/top-ups`, { mode: 'test', currency: 'NGN', amount: 2_000_000_00, source: 'goodwill', reason: 'Reseller exchange test' });
      assert.equal(asked.status, 201, JSON.stringify(asked.json));
      assert.equal((await finance.post(`/v1/admin/top-ups/${asked.json.id}/confirm`, { code: await financeCode() })).status, 200);
      const overview = await browser.get('/v1/exchange?currency=NGN', headers);
      assert.equal(overview.status, 200, JSON.stringify(overview.json));
      const btc = overview.json.assets.find(row => row.asset === 'BTC');
      assert.ok(Number(btc.available_to_buy) >= 0.02);
      const quoted = await browser.post('/v1/exchange/quotes', { asset: 'BTC', currency: 'NGN', side: 'buy', amount: '0.01' }, headers);
      assert.equal(quoted.status, 201, JSON.stringify(quoted.json));
      const done = await browser.post('/v1/exchange/trades', { quote_id: quoted.json.id }, headers);
      assert.equal(done.status, 201, JSON.stringify(done.json));
      assert.equal(done.json.amount, '0.01000000');
      assert.equal((await browser.post('/v1/exchange/trades', { quote_id: quoted.json.id }, headers)).json.error.code, 'quote_expired');
      const reserveBefore = (await browser.get('/v1/exchange/reserves', headers)).json.coins.find(row => row.asset === 'BTC').balance;
      assert.equal(Number(reserveBefore), 0);
      // Coins behind the reseller's own desk need the desk switch.
      assert.equal((await browser.post('/v1/exchange/reserves/coins/transfers', { asset: 'BTC', amount: '0.006', direction: 'fund' }, headers)).json.error.code, 'exchange_not_enabled');
      assert.equal((await admin.put('/v1/admin/switches/reseller_desks', { enabled: true })).status, 200);
      const funded = await browser.post('/v1/exchange/reserves/coins/transfers', { asset: 'BTC', amount: '0.006', direction: 'fund' }, headers);
      assert.equal(funded.status, 201, JSON.stringify(funded.json));
      assert.deepEqual([funded.json.wallet, funded.json.reserve], ['0.00400000', '0.00600000']);
      assert.equal((await browser.post('/v1/exchange/reserves/coins/transfers', { asset: 'BTC', amount: '0.005', direction: 'withdraw' }, headers)).status, 201);
      assert.equal((await browser.post('/v1/exchange/reserves/coins/transfers', { asset: 'BTC', amount: '0.002', direction: 'withdraw' }, headers)).json.error.code, 'insufficient_funds');
      // A closed pair still shows what the reseller holds of the coin.
      prices.forget();
      feed.age = 6 * 60_000;
      try {
        const closed = (await browser.get('/v1/exchange?currency=NGN', headers)).json.assets.find(row => row.asset === 'BTC');
        assert.deepEqual([closed.closed, closed.your_coins], ['price_unavailable', '0.00900000']);
      } finally {
        feed.age = 0;
        prices.forget();
      }
      await ledgerOk();
    } finally {
      assert.equal((await admin.put('/v1/admin/switches/reseller_exchange', { enabled: null })).status, 200);
      assert.equal((await admin.put('/v1/admin/switches/reseller_desks', { enabled: null })).status, 200);
    }
  });

  test('a reseller-store customer sees the reseller desk for offered pairs and BitoCard for fallback pairs', async () => {
    const { browser, email, resellerId } = await resellerClient(server);
    assert.equal((await browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'active' } });
    const created = await browser.post('/v1/stores', { name: 'Ada Coins', subdomain: `exchange${Date.now().toString(36)}` });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal((await browser.post(`/v1/stores/${created.json.id}/publish`)).status, 200);
    const shopper = await customer(created.json.subdomain);
    const headers = { 'bitocard-mode': 'test' };
    const initially = (await shopper.get('/v1/store/exchange')).json;
    assert.equal(initially.assets.find(row => row.asset === 'BTC').desk.name, 'BitoCard');
    assert.equal((await admin.put('/v1/admin/switches/reseller_desks', { enabled: true })).status, 200);
    try {
      const offered = await browser.put('/v1/exchange/markups', { mode: 'test', asset: 'BTC', currency: 'NGN', buy_markup_bps: 100,
        sell_markup_bps: 100, min_fiat: 100, max_fiat: null, enabled: true }, headers);
      assert.equal(offered.status, 200, JSON.stringify(offered.json));
      const rows = (await shopper.get('/v1/store/exchange')).json.assets;
      assert.equal(rows.find(row => row.asset === 'BTC').desk.name, 'Ada Coins');
      assert.equal(rows.find(row => row.asset === 'USDT').desk.name, 'BitoCard');
      assert.equal((await browser.put('/v1/exchange/desk', { fallback_to_bitocard: false }, headers)).status, 200);
      const withoutFallback = (await shopper.get('/v1/store/exchange')).json.assets;
      assert.equal(withoutFallback.find(row => row.asset === 'USDT').closed, 'not_offered');
      assert.equal((await shopper.post('/v1/store/exchange/quotes', { asset: 'USDT', side: 'buy', amount: '1' })).json.error.code, 'pair_unavailable');
    } finally {
      assert.equal((await admin.put('/v1/admin/switches/reseller_desks', { enabled: null })).status, 200);
    }
  });
});
