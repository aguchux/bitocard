// Crypto wallets and the P2P market: instant trades paid from BitoCard wallets, settled in one transaction, with
// admin freezes. Races from other P2P systems (two buyers on one ad, cancel against a trade) must never move money twice.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, lastEmailCode, startApp } from './helpers.mjs';

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

const returnUrl = 'https://shop.example/account/wallet';
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
const switches = async enabled => {
  for (const key of ['crypto_wallets', 'p2p_trading']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { enabled })).status, 200);
};

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
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), put: (path, body) => request('PUT', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function customer() {
  const shopper = storeServer();
  const email = `p2p${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  shopper.email = email;
  return shopper;
}

/** A sandbox top-up of the customer's NGN wallet, paid. */
async function fund(shopper, amount) {
  const started = await shopper.post('/v1/store/wallet/top-ups', { amount, return_url: returnUrl });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  assert.equal((await shopper.post(`/v1/store/wallet/top-ups/${started.json.id}/simulate`, { outcome: 'succeeded' })).status, 200);
}

async function deposit(shopper, asset, amount) {
  const res = await shopper.post('/v1/store/crypto/test-deposits', { asset, amount });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

const balance = async (shopper, asset) => (await shopper.get('/v1/store/crypto')).json.assets.find(item => item.asset === asset);
const cash = async shopper => (await shopper.get('/v1/store/crypto')).json.cash;

/** Every asset's customer balances plus fees and adjustments equal what BitoCard holds in custody: crypto is never made or lost. */
async function cryptoConserved() {
  const accounts = await prisma.ledgerAccount.findMany({ where: { kind: { in: ['crypto_wallet', 'crypto_locked', 'crypto_frozen', 'crypto_withdrawing', 'crypto_fees', 'crypto_custody', 'adjustments'] } } });
  const sums = new Map();
  for (const account of accounts) {
    if (account.kind === 'adjustments' && !['USDT', 'USDC', 'BTC', 'ETH', 'BNB'].includes(account.currency)) continue;
    const key = `${account.mode}:${account.currency}`;
    const signed = account.kind === 'crypto_custody' ? -account.balanceMinor : account.balanceMinor;
    sums.set(key, (sums.get(key) ?? 0n) + signed);
  }
  for (const [key, sum] of sums) assert.equal(sum, 0n, `${key} is off by ${sum}`);
}

const sellAd = (shopper, overrides = {}) =>
  shopper.post('/v1/store/p2p/ads', { side: 'sell', asset: 'USDT', price: 165000, amount: '100', min_fiat: 100_00, max_fiat: 500_000_00, ...overrides });

describe('switched off', () => {
  test('crypto is off until an admin switches it on', async () => {
    const shopper = await customer();
    const overview = await shopper.get('/v1/store/crypto');
    assert.deepEqual([overview.status, overview.json.enabled, overview.json.p2p_enabled, overview.json.mode], [200, false, false, 'test']);
    assert.deepEqual(overview.json.assets.map(item => item.asset), ['USDT', 'USDC', 'BTC', 'ETH', 'BNB']);
    const market = await shopper.get('/v1/store/p2p/market?asset=USDT&side=buy');
    assert.deepEqual([market.status, market.json.error.code], [409, 'crypto_not_enabled']);
    assert.equal((await shopper.post('/v1/store/crypto/test-deposits', { asset: 'USDT', amount: '1' })).json.error.code, 'crypto_not_enabled');
  });
});

describe('instant P2P trades', () => {
  before(() => switches(true));
  after(() => switches(null));

  test('a sell ad locks its crypto; a buyer pays from their wallet and gets it at once, less the fee', async () => {
    const seller = await customer();
    const buyer = await customer();
    await deposit(seller, 'USDT', '250.5');
    const ad = await sellAd(seller, { amount: '200' });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.deepEqual([ad.json.side, ad.json.available, ad.json.price, ad.json.status], ['sell', '200.000000', 165000, 'active']);
    const locked = await balance(seller, 'USDT');
    assert.deepEqual([locked.available, locked.locked, locked.total], ['50.500000', '200.000000', '250.500000']);

    // Not enough cash: refused, nothing moves.
    const poor = await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, amount: '10' });
    assert.deepEqual([poor.status, poor.json.error.code], [402, 'insufficient_funds']);
    assert.equal(await prisma.p2pTrade.count({ where: { adId: ad.json.id } }), 0);

    await fund(buyer, 200_000_00);
    const market = await buyer.get('/v1/store/p2p/market?asset=USDT&side=buy');
    assert.ok(market.json.data.some(item => item.id === ad.json.id && item.trader.nickname.startsWith('Trader')), 'listed with the seller nickname only');
    assert.equal(JSON.stringify(market.json).includes(seller.email), false, 'never the seller email');
    assert.equal((await seller.get('/v1/store/p2p/market?asset=USDT&side=buy')).json.data.some(item => item.id === ad.json.id), false, 'never your own ad');

    const quote = await buyer.get('/v1/store/p2p/quote?asset=USDT&side=buy&fiat=8250000');
    assert.equal(quote.status, 200, JSON.stringify(quote.json));
    assert.deepEqual([quote.json.ad.id, quote.json.amount, quote.json.fiat, quote.json.fee, quote.json.received], [ad.json.id, '50.000000', 82_500_00, '0.100000', '49.900000']);

    const changed = await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 160000, amount: '50' });
    assert.deepEqual([changed.status, changed.json.error.code], [409, 'price_changed']);
    const own = await seller.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, amount: '50' });
    assert.equal(own.json.error.code, 'own_ad');
    const preview = await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, fiat: 82_500_00, preview: true });
    assert.deepEqual([preview.json.object, preview.json.side, preview.json.amount], ['p2p_quote', 'buy', '50.000000']);

    const trade = await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, fiat: 82_500_00 });
    assert.equal(trade.status, 201, JSON.stringify(trade.json));
    assert.match(trade.json.number, /^P2P-\d{6}$/);
    assert.deepEqual([trade.json.side, trade.json.role, trade.json.status, trade.json.received, trade.json.fiat], ['buy', 'taker', 'completed', '49.900000', 82_500_00]);
    assert.equal((await balance(buyer, 'USDT')).available, '49.900000');
    assert.deepEqual(await cash(buyer), { currency: 'NGN', proceeds: 0, wallet: 117_500_00, locked: 0 });
    assert.equal((await balance(seller, 'USDT')).locked, '150.000000');
    assert.deepEqual(await cash(seller), { currency: 'NGN', proceeds: 82_500_00, wallet: 0, locked: 0 });
    const sellerView = await seller.get(`/v1/store/p2p/trades/${trade.json.id}`);
    assert.deepEqual([sellerView.json.side, sellerView.json.role], ['sell', 'maker']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: seller.id, type: 'customer.p2p.trade_completed' } }), 'the seller is told');
    assert.equal((await seller.get('/v1/store/p2p/profile')).json.trades_total, 1);

    const fees = await prisma.ledgerAccount.findFirst({ where: { kind: 'crypto_fees', currency: 'USDT', mode: 'test' } });
    assert.ok(fees.balanceMinor >= 100_000n, 'BitoCard took its fee');
    await cryptoConserved();
    await ledgerOk();
  });

  test('two buyers racing for the last of an ad: exactly one wins, nothing is paid twice', async () => {
    const seller = await customer();
    await deposit(seller, 'USDT', '10');
    const ad = await sellAd(seller, { amount: '10', min_fiat: 100_00 });
    const buyers = await Promise.all([customer(), customer(), customer()]);
    await Promise.all(buyers.map(buyer => fund(buyer, 50_000_00)));
    const results = await Promise.all(buyers.map(buyer => buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, amount: '10' })));
    assert.deepEqual(results.map(res => res.status).sort(), [201, 409, 409], JSON.stringify(results.map(res => res.json)));
    assert.equal(await prisma.p2pTrade.count({ where: { adId: ad.json.id } }), 1);
    const row = await prisma.p2pAd.findUniqueOrThrow({ where: { id: ad.json.id } });
    assert.deepEqual([row.status, row.remainingAmount], ['completed', 0n]);
    assert.equal((await balance(seller, 'USDT')).locked, '0.000000');
    await cryptoConserved();
    await ledgerOk();
  });

  test('closing an ad while it is being taken: either the trade or the refund, never both', async () => {
    const seller = await customer();
    const buyer = await customer();
    await deposit(seller, 'USDT', '20');
    await fund(buyer, 50_000_00);
    const ad = await sellAd(seller, { amount: '20' });
    const [cancel, trade] = await Promise.all([seller.post(`/v1/store/p2p/ads/${ad.json.id}/cancel`), buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, amount: '20' })]);
    assert.ok([cancel.status, trade.status].includes(200) || [cancel.status, trade.status].includes(201));
    const usdt = await balance(seller, 'USDT');
    if (trade.status === 201) assert.deepEqual([usdt.available, usdt.locked, cancel.json.error.code], ['0.000000', '0.000000', 'ad_closed']);
    else assert.deepEqual([usdt.available, usdt.locked, trade.json.error.code], ['20.000000', '0.000000', 'ad_unavailable']);
    await cryptoConserved();
    await ledgerOk();
  });

  test('a buy ad locks the fiat it needs, proceeds first; sellers fill it in parts; closing gives the rest back', async () => {
    const buyer = await customer();
    const seller = await customer();
    await fund(buyer, 100_000_00);
    await deposit(seller, 'BTC', '0.01');
    // Not enough cash for the ad: refused.
    const tooBig = await buyer.post('/v1/store/p2p/ads', { side: 'buy', asset: 'BTC', price: 150_000_000_00, amount: '1', min_fiat: 1000_00, max_fiat: 10_000_000_00 });
    assert.deepEqual([tooBig.status, tooBig.json.error.code], [402, 'insufficient_funds']);
    const ad = await buyer.post('/v1/store/p2p/ads', { side: 'buy', asset: 'BTC', price: 150_000_000_00, amount: '0.0005', min_fiat: 1000_00, max_fiat: 100_000_00 });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.deepEqual(await cash(buyer), { currency: 'NGN', proceeds: 0, wallet: 25_000_00, locked: 75_000_00 });

    const sold = await seller.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 150_000_000_00, amount: '0.0002' });
    assert.equal(sold.status, 201, JSON.stringify(sold.json));
    assert.deepEqual([sold.json.side, sold.json.fiat, sold.json.fee], ['sell', 30_000_00, '0.00000040']);
    assert.equal((await balance(seller, 'BTC')).available, '0.00980000');
    assert.equal((await balance(buyer, 'BTC')).available, '0.00019960');
    assert.deepEqual(await cash(seller), { currency: 'NGN', proceeds: 30_000_00, wallet: 0, locked: 0 });
    assert.equal((await cash(buyer)).locked, 45_000_00);

    // A new price locks more (or gives back) in the same step.
    const repriced = await buyer.patch(`/v1/store/p2p/ads/${ad.json.id}`, { price: 140_000_000_00 });
    assert.equal(repriced.status, 200, JSON.stringify(repriced.json));
    assert.deepEqual(await cash(buyer), { currency: 'NGN', proceeds: 0, wallet: 28_000_00, locked: 42_000_00 });
    const stale = await seller.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 150_000_000_00, amount: '0.0001' });
    assert.equal(stale.json.error.code, 'price_changed');

    const closed = await buyer.post(`/v1/store/p2p/ads/${ad.json.id}/cancel`);
    assert.deepEqual([closed.status, closed.json.status], [200, 'cancelled']);
    assert.deepEqual(await cash(buyer), { currency: 'NGN', proceeds: 0, wallet: 70_000_00, locked: 0 });
    assert.equal((await buyer.post(`/v1/store/p2p/ads/${ad.json.id}/cancel`)).json.error.code, 'ad_closed', 'closed once');

    // The seller spends their P2P proceeds before their wallet.
    await deposit(buyer, 'USDT', '10');
    const usdtAd = await sellAd(buyer, { amount: '10' });
    const spent = await seller.post('/v1/store/p2p/trades', { ad_id: usdtAd.json.id, price: 165000, amount: '10' });
    assert.equal(spent.status, 201, JSON.stringify(spent.json));
    assert.deepEqual(await cash(seller), { currency: 'NGN', proceeds: 13_500_00, wallet: 0, locked: 0 });
    await cryptoConserved();
    await ledgerOk();
  });

  test('ads check their limits and amounts', async () => {
    const seller = await customer();
    const buyer = await customer();
    await deposit(seller, 'USDT', '100');
    assert.equal((await sellAd(seller, { amount: '101' })).json.error.code, 'insufficient_funds');
    assert.equal((await sellAd(seller, { amount: '1.1234567' })).json.error.code, 'parameter_invalid', 'USDT keeps 6 places');
    assert.equal((await sellAd(seller, { min_fiat: 1000_00, max_fiat: 100_00 })).json.error.param, 'max_fiat');
    const ad = await sellAd(seller, { amount: '100', min_fiat: 10_000_00, max_fiat: 20_000_00 });
    await fund(buyer, 100_000_00);
    assert.equal((await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, fiat: 5_000_00 })).json.error.code, 'below_ad_limit');
    assert.equal((await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, fiat: 30_000_00 })).json.error.code, 'above_ad_limit');
    assert.equal((await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, amount: '101' })).json.error.code, 'amount_unavailable');
    // Paused ads leave the market and cannot be taken.
    assert.equal((await seller.patch(`/v1/store/p2p/ads/${ad.json.id}`, { status: 'paused' })).json.status, 'paused');
    assert.equal((await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 165000, fiat: 15_000_00 })).json.error.code, 'ad_unavailable');
    assert.equal((await seller.get('/v1/store/p2p/ads')).json.data.length, 1);
    // A nickname is chosen once, and unique.
    assert.equal((await seller.put('/v1/store/p2p/profile', { nickname: `Ada_${counter}` })).json.nickname_chosen, true);
    assert.equal((await seller.put('/v1/store/p2p/profile', { nickname: 'Another' })).json.error.code, 'nickname_locked');
    assert.equal((await buyer.put('/v1/store/p2p/profile', { nickname: `ada_${counter}` })).json.error.code, 'nickname_taken');
  });
});

describe('admin freezes', () => {
  before(() => switches(true));
  after(() => switches(null));

  test('an amount freeze holds crypto until released once; finance seizes; an account freeze stops trading and hides ads', async () => {
    const trader = await customer();
    const buyer = await customer();
    await deposit(trader, 'ETH', '2');
    const ad = await trader.post('/v1/store/p2p/ads', { side: 'sell', asset: 'ETH', price: 500_000_000, amount: '1', min_fiat: 100_00, max_fiat: 10_000_000_00 });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/crypto/customers/${trader.id}/freezes`, { asset: 'ETH', amount: '0.5', mode: 'test', reason: 'Checking a report' })).status, 403);
    const tooMuch = await admin.post(`/v1/admin/crypto/customers/${trader.id}/freezes`, { asset: 'ETH', amount: '1.5', mode: 'test', reason: 'Checking a report' });
    assert.deepEqual([tooMuch.status, tooMuch.json.error.code], [402, 'insufficient_funds'], 'only available crypto, never what an ad locks');
    const freeze = await admin.post(`/v1/admin/crypto/customers/${trader.id}/freezes`, { asset: 'ETH', amount: '0.5', mode: 'test', reason: 'Checking a report' });
    assert.equal(freeze.status, 201, JSON.stringify(freeze.json));
    assert.deepEqual([(await balance(trader, 'ETH')).available, (await balance(trader, 'ETH')).frozen], ['0.50000000', '0.50000000']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: trader.id, type: 'customer.crypto.frozen' } }));

    const [first, second] = await Promise.all([
      admin.post(`/v1/admin/crypto/freezes/${freeze.json.id}/release`, { note: 'All clear' }),
      admin.post(`/v1/admin/crypto/freezes/${freeze.json.id}/release`, { note: 'All clear' }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409], 'released once');
    assert.equal((await balance(trader, 'ETH')).available, '1.00000000');

    const again = await admin.post(`/v1/admin/crypto/customers/${trader.id}/freezes`, { asset: 'ETH', amount: '0.25', mode: 'test', reason: 'Court order' });
    assert.equal((await admin.post(`/v1/admin/crypto/freezes/${again.json.id}/seize`, { note: 'Order 123' })).status, 200, 'super admins pass every role');
    const operations = await adminClient(server, ['operations']);
    const third = await admin.post(`/v1/admin/crypto/customers/${trader.id}/freezes`, { asset: 'ETH', amount: '0.25', mode: 'test', reason: 'Court order' });
    assert.equal((await operations.post(`/v1/admin/crypto/freezes/${third.json.id}/seize`, { note: 'Order 124' })).status, 403, 'only finance seizes');
    assert.equal((await balance(trader, 'ETH')).frozen, '0.25000000');

    const frozen = await admin.put(`/v1/admin/crypto/customers/${trader.id}/account-freeze`, { frozen: true, reason: 'Fraud report' });
    assert.deepEqual([frozen.status, frozen.json.frozen], [200, true]);
    assert.equal((await trader.post('/v1/store/p2p/ads', { side: 'sell', asset: 'ETH', price: 500_000_000, amount: '0.1', min_fiat: 100_00, max_fiat: 100_000_00 })).json.error.code, 'crypto_account_frozen');
    assert.equal((await buyer.get('/v1/store/p2p/market?asset=ETH&side=buy')).json.data.some(item => item.id === ad.json.id), false, 'their ads leave the market');
    await fund(buyer, 10_000_00);
    assert.equal((await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 500_000_000, fiat: 5_000_00 })).json.error.code, 'ad_unavailable');
    assert.equal((await admin.put(`/v1/admin/crypto/customers/${trader.id}/account-freeze`, { frozen: false, reason: 'Cleared' })).json.frozen, false);
    assert.equal((await buyer.post('/v1/store/p2p/trades', { ad_id: ad.json.id, price: 500_000_000, fiat: 5_000_00 })).status, 201);

    const view = await support.get(`/v1/admin/crypto/customers/${trader.id}`);
    assert.deepEqual(view.json.freezes.map(item => item.status).sort(), ['frozen', 'released', 'seized']);
    assert.ok((await support.get(`/v1/admin/p2p/trades?customer_id=${trader.id}`)).json.data.length === 1);
    const audit = await prisma.auditLog.findMany({ where: { targetId: trader.id, action: { startsWith: 'crypto.' } } });
    assert.deepEqual([...new Set(audit.map(item => item.action))].sort(), ['crypto.account_frozen', 'crypto.account_unfrozen', 'crypto.frozen', 'crypto.seized', 'crypto.unfrozen']);
    await cryptoConserved();
    await ledgerOk();
  });

  test('live crypto needs the identity check; test credits are sandbox only', async () => {
    const shopper = await customer();
    const credited = await admin.post(`/v1/admin/crypto/customers/${shopper.id}/test-credits`, { asset: 'USDC', amount: '5', reason: 'Trying the market' });
    assert.equal(credited.status, 201, JSON.stringify(credited.json));
    assert.equal(credited.json.balances.test.find(item => item.asset === 'USDC').available, '5.000000');
    const off = await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: false }, code: await adminCode(server, admin) });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    try {
      const overview = await shopper.get('/v1/store/crypto');
      assert.deepEqual([overview.json.mode, overview.json.verified], ['live', false]);
      assert.equal((await shopper.get('/v1/store/p2p/market?asset=USDT&side=buy')).json.error.code, 'customer_verification_required');
      assert.equal((await shopper.post('/v1/store/crypto/test-deposits', { asset: 'USDT', amount: '1' })).json.error.code, 'customer_verification_required');
    } finally {
      await admin.put('/v1/admin/integrations/checkout', { values: { CHECKOUT_SANDBOX: true }, code: await adminCode(server, admin) });
    }
  });
});

describe('owners who can no longer trade, changed fees and huge amounts', () => {
  before(() => switches(true));
  after(() => switches(null));

  test('an ad leaves the market when its owner can no longer trade, and cannot be taken', async () => {
    const seller = await customer();
    const buyer = await customer();
    await deposit(seller, 'USDT', '50');
    await fund(buyer, 1_000_000_00);
    const ad = (await sellAd(seller, { amount: '50', price: 170000 })).json;
    const listed = async () => (await buyer.get('/v1/store/p2p/market?asset=USDT&side=buy&limit=100')).json.data.some(item => item.id === ad.id);
    assert.equal(await listed(), true);
    await prisma.customer.update({ where: { id: seller.id }, data: { status: 'disabled' } });
    assert.equal(await listed(), false, 'a disabled account’s ads are off the market');
    const taken = await buyer.post('/v1/store/p2p/trades', { ad_id: ad.id, price: 170000, fiat: 10_000_00 });
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'ad_unavailable']);
    await prisma.customer.update({ where: { id: seller.id }, data: { status: 'active' } });
    assert.equal(await listed(), true);
    await ledgerOk();
  });

  test('a fee changed after the customer saw it is refused, never charged', async () => {
    const seller = await customer();
    const buyer = await customer();
    await deposit(seller, 'USDT', '20');
    await fund(buyer, 1_000_000_00);
    const ad = (await sellAd(seller, { amount: '20', price: 171000 })).json;
    const preview = await buyer.post('/v1/store/p2p/trades', { ad_id: ad.id, price: 171000, fiat: 10_000_00, preview: true });
    assert.equal(typeof preview.json.fee_bps, 'number');
    const changed = await buyer.post('/v1/store/p2p/trades', { ad_id: ad.id, price: 171000, fee_bps: preview.json.fee_bps + 1, fiat: 10_000_00 });
    assert.deepEqual([changed.status, changed.json.error.code], [409, 'fee_changed']);
    const done = await buyer.post('/v1/store/p2p/trades', { ad_id: ad.id, price: 171000, fee_bps: preview.json.fee_bps, fiat: 10_000_00 });
    assert.equal(done.status, 201, JSON.stringify(done.json));
  });

  test('amounts too large for the ledger are refused, never a server error', async () => {
    const shopper = await customer();
    const huge = await shopper.post('/v1/store/crypto/test-deposits', { asset: 'USDT', amount: '99999999999999999999.5' });
    assert.deepEqual([huge.status, huge.json.error.code], [400, 'parameter_invalid']);
    const ad = await sellAd(shopper, { amount: '99999999999999999999' });
    assert.deepEqual([ad.status, ad.json.error.code], [400, 'parameter_invalid']);
  });
});