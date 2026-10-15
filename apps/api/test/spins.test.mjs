// Spin and win: each customer (one per person across every store) wins exactly $1 in BNB, USDT and USDC over 50 to
// 100 spins, at most two a day, never told the total. Wins are fixed on the server and credited once to spin rewards
// (never withdrawn or traded); parallel spins never pay twice; rewards are exchanged into the store wallet.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, fakeService, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let coingecko;
const bnbPrice = { usd: 600 };

before(async () => {
  coingecko = await fakeService(call => {
    const url = new URL(call.url, 'http://x');
    if (url.pathname !== '/api/v3/simple/price') return { status: 404, body: {} };
    if (bnbPrice.down) return { status: 503, body: {} };
    return { body: { binancecoin: { usd: bnbPrice.usd } } };
  });
  server = await startApp({ env: { CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  const saved = await admin.put('/v1/admin/integrations/crypto_prices', { values: { COINGECKO_API_URL: coingecko.url, COINGECKO_API_KEY: 'cg-demo-key' }, code: await adminCode(server, admin) });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
});

after(async () => {
  await server?.close();
  await coingecko?.close();
});

const switches = async enabled => {
  for (const key of ['crypto_wallets', 'spin_rewards']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { enabled })).status, 200);
};
const ledgerOk = async () => assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);

function storeServer(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `spin-${Date.now()}-${Math.random()}` } : {}),
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
async function customer(subdomain = null, email = `spin${(counter += 1)}-${Date.now()}@example.com`) {
  const shopper = storeServer(subdomain);
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Spinner', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email.toLowerCase()) })).status, 200);
  shopper.id = signup.json.customer.id;
  shopper.email = email;
  return shopper;
}

/** Lets the customer's spins so far count as yesterday's, so today's two are free again. */
const nextDay = shopper => prisma.spin.updateMany({ where: { customerId: shopper.id }, data: { createdAt: new Date(Date.now() - 26 * 3_600_000) } });

describe('the schedule', () => {
  test('50 to 100 wins of 1 to 10 cents, on the wheel, adding up to exactly $1', async () => {
    const { spinSchedule, spinSegments } = await import('../dist/crypto/spins.service.js');
    const onWheel = new Set(spinSegments.map(item => item.cents));
    for (let count = 50; count <= 100; count += 1) {
      for (let run = 0; run < 5; run += 1) {
        const wins = spinSchedule(count);
        assert.equal(wins.length, count);
        assert.equal(wins.reduce((sum, value) => sum + value, 0), 100, `${count} spins`);
        assert.ok(wins.every(value => onWheel.has(value) && value >= 1 && value <= 10));
      }
    }
    assert.ok(spinSchedule(50).some(value => value > 1), 'fewer spins win more each');
    assert.ok(spinSchedule(100).every(value => value === 1));
    assert.throws(() => spinSchedule(5), /cannot add up/);
    assert.equal(spinSegments.length, 12);
    for (const asset of ['USDT', 'USDC', 'BNB']) assert.ok(spinSegments.some(item => item.asset === asset && item.cents === 1), `${asset} has the smallest win`);
  });
});

describe('spin and win', () => {
  before(() => switches(true));
  after(() => switches(null));

  test('off by default: the wheel says why and a spin is refused', async () => {
    assert.equal((await admin.put('/v1/admin/switches/spin_rewards', { enabled: null })).status, 200);
    try {
      const shopper = await customer();
      const status = await shopper.get('/v1/store/spins');
      assert.equal(status.status, 200, JSON.stringify(status.json));
      assert.deepEqual([status.json.enabled, status.json.reason, status.json.allowance, status.json.segments.length], [false, 'not_enabled', null, 12]);
      const spin = await shopper.post('/v1/store/spins');
      assert.deepEqual([spin.status, spin.json.error.code], [409, 'spins_not_enabled']);
    } finally {
      await switches(true);
    }
  });

  test('two spins a day, each credited at once to spin rewards; all of them add up to exactly $1, never shown', async () => {
    const shopper = await customer();
    const before = (await shopper.get('/v1/store/spins')).json;
    assert.deepEqual([before.enabled, before.reason, before.allowance], [true, null, null]);
    assert.ok(before.segments.every(item => Number(item.usd) <= 0.1), 'the wheel shows only what can be won');

    const first = await shopper.post('/v1/store/spins');
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.number, 1);
    const total = (await prisma.spinAllowance.findFirstOrThrow({ where: { customerId: shopper.id } })).schedule.length;
    assert.ok(total >= 50 && total <= 100, `${total} spins`);
    for (const hidden of ['total_usd', 'spins_total', 'spins_left']) assert.equal(hidden in first.json.allowance, false, `${hidden} is not shown`);
    const segment = before.segments[first.json.segment];
    assert.equal(segment.usd, first.json.usd, 'it lands on a segment showing what it won');
    const rewards = (await shopper.get('/v1/store/spins')).json.rewards;
    assert.deepEqual(rewards.coins.map(item => [item.asset, item.amount]), [[first.json.asset, first.json.amount]], 'credited to spin rewards at once');
    assert.deepEqual(rewards.exchange_currencies, ['NGN', 'USD']);
    const wallets = (await shopper.get('/v1/store/crypto')).json.assets;
    assert.ok(wallets.every(item => Number(item.available) === 0), 'never in the crypto wallet: rewards cannot be withdrawn or traded');

    assert.equal((await shopper.post('/v1/store/spins')).status, 200);
    const limited = await shopper.post('/v1/store/spins');
    assert.deepEqual([limited.status, limited.json.error.code], [409, 'spin_limit_today']);
    const today = (await shopper.get('/v1/store/spins')).json.allowance;
    assert.deepEqual([today.spins_used, today.today_left, today.daily_limit], [2, 0, 2]);
    assert.ok(today.next_spin_at, 'tells them when they can spin again');

    let done = 2;
    while (done < total) {
      await nextDay(shopper);
      for (let spin = 0; spin < 2 && done < total; spin += 1) {
        const res = await shopper.post('/v1/store/spins');
        assert.equal(res.status, 200, JSON.stringify(res.json));
        done += 1;
      }
    }
    const finished = (await shopper.get('/v1/store/spins')).json;
    assert.deepEqual([finished.enabled, finished.allowance.finished, finished.allowance.won_usd], [false, true, '1.00']);
    await nextDay(shopper);
    const more = await shopper.post('/v1/store/spins');
    assert.deepEqual([more.status, more.json.error.code], [409, 'spins_finished']);

    // Exactly $1 in all: stablecoins at $1, BNB at the price it was paid at.
    const spins = await prisma.spin.findMany({ where: { customerId: shopper.id } });
    assert.equal(spins.length, total);
    assert.equal(spins.reduce((sum, item) => sum + item.cents, 0), 100);
    for (const item of spins.filter(row => row.asset === 'BNB')) {
      assert.equal(item.priceUsd, '600');
      assert.equal(item.amount, (BigInt(item.cents) * 10n ** 8n * 100_000_000n) / (100n * 60_000_000_000n), 'BNB worth the win, rounded down');
    }
    for (const item of spins.filter(row => row.asset !== 'BNB')) assert.equal(item.amount, BigInt(item.cents) * 10_000n);
    const credited = await prisma.journalEntry.count({ where: { reference: { startsWith: 'crypto_spin:' }, postings: { some: { account: { customerId: shopper.id } } } } });
    assert.equal(credited, total, 'one ledger entry per spin');
    await ledgerOk();
  });

  test('admins set the spins per day per market on Settings > Markets', async () => {
    const ops = await adminClient(server, ['support']);
    assert.equal((await ops.patch('/v1/admin/countries/NG', { spin_daily_limit: 3 })).status, 403, 'operations only');
    for (const bad of [0, 11, 2.5]) assert.equal((await admin.patch('/v1/admin/countries/NG', { spin_daily_limit: bad })).status, 400);
    const saved = await admin.patch('/v1/admin/countries/NG', { spin_daily_limit: 3 });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.spin_daily_limit, 3);
    assert.equal('spin_daily_limit' in (await fetch(`${server.base}/v1/countries`).then(res => res.json())).data[0], false, 'not in the public market view');
    try {
      const shopper = await customer();
      assert.equal((await shopper.get('/v1/store/spins')).json.daily_limit, 3);
      for (let spin = 0; spin < 3; spin += 1) assert.equal((await shopper.post('/v1/store/spins')).status, 200);
      const limited = await shopper.post('/v1/store/spins');
      assert.deepEqual([limited.status, limited.json.error.code], [409, 'spin_limit_today']);
      assert.deepEqual([(await shopper.get('/v1/store/spins')).json.allowance.today_left, (await shopper.get('/v1/store/spins')).json.allowance.daily_limit], [0, 3]);
      // Lowered below what was spun today: nothing more today, never a negative count.
      assert.equal((await admin.patch('/v1/admin/countries/NG', { spin_daily_limit: 1 })).status, 200);
      assert.equal((await shopper.get('/v1/store/spins')).json.allowance.today_left, 0);
    } finally {
      assert.equal((await admin.patch('/v1/admin/countries/NG', { spin_daily_limit: 2 })).status, 200);
    }
  });

  test('spins sent at once are paid once each, never twice', async () => {
    const shopper = await customer();
    const results = await Promise.all(Array.from({ length: 6 }, () => shopper.post('/v1/store/spins')));
    const won = results.filter(res => res.status === 200);
    assert.ok(won.length >= 1 && won.length <= 2);
    assert.ok(results.every(res => res.status === 200 || ['spin_in_progress', 'spin_limit_today'].includes(res.json.error?.code)), JSON.stringify(results.map(res => res.json.error?.code)));
    const spins = await prisma.spin.findMany({ where: { customerId: shopper.id } });
    assert.equal(spins.length, won.length);
    assert.equal(new Set(spins.map(item => item.number)).size, spins.length);
    const allowance = await prisma.spinAllowance.findFirstOrThrow({ where: { customerId: shopper.id } });
    assert.deepEqual([allowance.spinsUsed, allowance.wonCents], [spins.length, spins.reduce((sum, item) => sum + item.cents, 0)]);
    await ledgerOk();
  });

  test('one per person: the same email at another store has had it', async () => {
    const email = `same${Date.now()}@example.com`;
    const first = await customer(null, email);
    assert.equal((await first.post('/v1/store/spins')).status, 200);

    const reseller = await resellerClient(server);
    await reseller.browser.post('/v1/auth/email/verify', { code: await lastEmailCode(server.app, reseller.email) });
    await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active' } });
    const store = await reseller.browser.post('/v1/stores', { name: 'Ada Spins', subdomain: `spin${Date.now().toString(36)}` });
    assert.equal((await reseller.browser.post(`/v1/stores/${store.json.id}/publish`)).status, 200);
    const again = await customer(store.json.subdomain, email.toUpperCase());
    const status = (await again.get('/v1/store/spins')).json;
    assert.deepEqual([status.enabled, status.reason], [false, 'claimed_elsewhere']);
    const spin = await again.post('/v1/store/spins');
    assert.deepEqual([spin.status, spin.json.error.code], [409, 'claimed_elsewhere']);
  });

  test('BNB without a price pays its win in a stablecoin; a frozen account cannot spin', async () => {
    const { SpinsService } = await import('../dist/crypto/spins.service.js');
    const { CryptoPricesService } = await import('../dist/crypto/prices.js');
    const spins = server.app.get(SpinsService);
    const assets = new Map((await prisma.cryptoAsset.findMany({ where: { code: { in: ['USDT', 'USDC', 'BNB'] } } })).map(asset => [asset.code, asset]));
    server.app.get(CryptoPricesService).forget();
    const priced = await spins.payout(5, assets);
    assert.deepEqual([priced.asset.code, priced.segment, priced.priceUsd], ['BNB', 1, '600'], 'only BNB shows 5 cents');
    bnbPrice.down = true;
    server.app.get(CryptoPricesService).forget();
    try {
      const fallback = await spins.payout(5, assets);
      assert.deepEqual([fallback.asset.code, fallback.amount, fallback.segment], ['USDT', 50_000n, 1], 'still lands on the segment, paid in USDT');
    } finally {
      bnbPrice.down = false;
    }

    const shopper = await customer();
    await admin.put(`/v1/admin/crypto/customers/${shopper.id}/account-freeze`, { frozen: true, reason: 'checking' });
    const status = (await shopper.get('/v1/store/spins')).json;
    assert.deepEqual([status.enabled, status.reason], [false, 'crypto_account_frozen']);
    assert.equal((await shopper.post('/v1/store/spins')).json.error.code, 'crypto_account_frozen');
  });

  test('rewards are exchanged into the store wallet, in US dollars or the local currency, once', async () => {
    const shopper = await customer();
    assert.equal((await shopper.post('/v1/store/spins/exchange', { preview: true })).json.error.code, 'nothing_to_exchange');
    for (let spin = 0; spin < 2; spin += 1) assert.equal((await shopper.post('/v1/store/spins')).status, 200);
    const cents = (await prisma.spin.findMany({ where: { customerId: shopper.id } })).reduce((sum, item) => sum + item.cents, 0);
    const rewards = (await shopper.get('/v1/store/spins')).json.rewards;
    // BNB is paid rounded down, so its value can fall a cent short.
    assert.ok([cents, cents - 1].includes(Math.round(Number(rewards.usd) * 100)), `${rewards.usd} for ${cents} cents`);

    assert.equal((await shopper.post('/v1/store/spins/exchange', { currency: 'GHS' })).json.error.code, 'currency_unsupported');
    const preview = await shopper.post('/v1/store/spins/exchange', { currency: 'NGN', preview: true });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.equal(preview.json.object, 'spin_exchange_preview');
    const usdCents = Math.round(Number(preview.json.usd) * 100);
    assert.equal(preview.json.amount, Math.floor(usdCents * Number(preview.json.rate)), 'at BitoCard’s receive rate, rounded down');
    assert.equal((await shopper.post('/v1/store/spins/exchange', { currency: 'NGN', expected_amount: preview.json.amount + 1 })).json.error.code, 'rate_changed');

    const results = await Promise.all([1, 2].map(() => shopper.post('/v1/store/spins/exchange', { currency: 'NGN', expected_amount: preview.json.amount })));
    const done = results.filter(res => res.status === 200);
    assert.equal(done.length, 1, JSON.stringify(results.map(res => res.json)));
    assert.ok(results.every(res => res.status === 200 || res.json.error.code === 'nothing_to_exchange'));
    assert.deepEqual([done[0].json.object, done[0].json.currency, done[0].json.amount], ['spin_exchange', 'NGN', preview.json.amount]);

    const wallet = (await shopper.get('/v1/store/wallet?currency=NGN')).json;
    assert.equal(wallet.balance, preview.json.amount, 'credited to the store wallet');
    const activity = (await shopper.get('/v1/store/wallet/transactions')).json.data;
    assert.deepEqual([activity[0].type, activity[0].amount], ['spin_exchange', preview.json.amount]);
    assert.deepEqual((await shopper.get('/v1/store/spins')).json.rewards.coins, [], 'nothing left in rewards');
    assert.equal((await shopper.post('/v1/store/spins/exchange', {})).json.error.code, 'nothing_to_exchange');

    // Into US dollars: a stablecoin cent is a cent.
    // Two spins, so a BNB win paid rounded down still adds up to a whole cent.
    await nextDay(shopper);
    for (let spin = 0; spin < 2; spin += 1) await shopper.post('/v1/store/spins');
    const later = (await shopper.get('/v1/store/spins')).json.rewards;
    const dollars = await shopper.post('/v1/store/spins/exchange', { currency: 'usd' });
    assert.equal(dollars.status, 200, JSON.stringify(dollars.json));
    assert.equal(dollars.json.amount, Math.round(Number(later.usd) * 100));
    assert.equal((await shopper.get('/v1/store/wallet?currency=USD')).json.balance, dollars.json.amount);

    // Rewards already won are never trapped: exchanging needs no switch.
    await nextDay(shopper);
    for (let spin = 0; spin < 2; spin += 1) await shopper.post('/v1/store/spins');
    await switches(null);
    try {
      assert.equal((await shopper.post('/v1/store/spins/exchange', { currency: 'USD' })).status, 200);
    } finally {
      await switches(true);
    }
    await ledgerOk();
  });

  test('admins see every spin with totals per coin; Test connection reads the BNB price', async () => {
    const list = await admin.get('/v1/admin/crypto/spins?mode=test');
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.ok(list.json.data.length > 0 && list.json.customers >= 3);
    assert.ok(list.json.data.every(item => item.customer.email && item.mode === 'test'));
    const usd = list.json.totals.reduce((sum, item) => sum + Number(item.usd), 0);
    assert.ok(usd >= 1, 'at least the finished customer’s $1');
    assert.ok(list.json.exchanged.some(item => item.currency === 'NGN' && item.exchanges === 1 && item.amount > 0), JSON.stringify(list.json.exchanged));
    const support = await adminClient(server, ['support']);
    assert.equal((await support.get('/v1/admin/crypto/spins')).status, 200);
    const tested = (await admin.post('/v1/admin/integrations/crypto_prices/test')).json;
    assert.deepEqual([tested.ok, tested.message], [true, 'BNB is $600.']);
    assert.equal(coingecko.calls.at(-1).headers['x-cg-demo-api-key'], 'cg-demo-key');
  });
});
