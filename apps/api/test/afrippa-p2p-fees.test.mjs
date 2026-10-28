// Afrippa's P2P fees (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 4): in crypto, both sides paying, the seller more, at
// rates Afrippa's finance admins set per coin and market. A sell ad keeps its seller's fee locked beside the coins it
// offers; an order takes it from there (then the wallet), gives it back if the order does not complete, and closing
// the ad returns what is left. Live trading needs a rate.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { P2pFeesService } = await import('../dist/crypto/p2p-fees.service.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { LedgerService } = await import('../dist/ledger/ledger.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-fees-secret-afrippa-fees-secret-af';
let server;
let prisma;
let finance;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret } });
  prisma = server.app.get(PrismaService);
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await prisma.featureSwitch.create({ data: { key, enabled: true } });
    await prisma.featureSwitch.create({ data: { key, countryCode: 'NG', enabled: true } });
  }
  await prisma.cryptoAsset.update({ where: { code: 'USDT' }, data: { enabled: true, p2pFeeBps: 0 } });
  finance = await afrippaAdminClient(server, ['finance']);
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
        ...(method === 'POST' ? { 'idempotency-key': `fee-${Date.now()}-${Math.random()}` } : {}),
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

async function trader(name) {
  const client = afrippaServer();
  const email = `fee-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const added = await client.post('/v1/afrippa/p2p/payment-methods', { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `50${String(counter).padStart(8, '0')}` });
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return { client, id: signup.json.customer.id, bank: added.json.id };
}

async function balances(who) {
  const accounts = await prisma.ledgerAccount.findMany({ where: { customerId: who.id, currency: 'USDT', mode: 'test' } });
  const of = kind => Number(accounts.find(account => account.kind === kind)?.balanceMinor ?? 0n) / 1e6;
  return { wallet: of('crypto_wallet'), locked: of('crypto_locked'), escrow: of('crypto_escrow') };
}

const feesHeld = async () => Number((await prisma.ledgerAccount.aggregate({ where: { kind: 'crypto_fees', currency: 'USDT', mode: 'test' }, _sum: { balanceMinor: true } }))._sum.balanceMinor ?? 0n) / 1e6;

describe("Afrippa's P2P fees", () => {
  test("finance sets each coin's rates, per market or for every market; flagged when the seller pays less", async () => {
    const every = await finance.put('/v1/afrippa/admin/p2p/fee-rates', { asset: 'USDT', market: null, buyer_bps: 50, seller_bps: 100 });
    assert.equal(every.status, 200, JSON.stringify(every.json));
    assert.deepEqual([every.json.market, every.json.buyer_bps, every.json.seller_bps, every.json.warnings], [null, 50, 100, []]);
    const ghana = await finance.put('/v1/afrippa/admin/p2p/fee-rates', { asset: 'usdt', market: 'gh', buyer_bps: 100, seller_bps: 50 });
    assert.equal(ghana.status, 200, JSON.stringify(ghana.json));
    assert.deepEqual([ghana.json.market, ghana.json.warnings], ['GH', ['seller_below_buyer']]);
    const service = server.app.get(P2pFeesService);
    const usdt = await prisma.cryptoAsset.findUniqueOrThrow({ where: { code: 'USDT' } });
    assert.deepEqual(await service.rates(usdt, 'GH', 'live'), { buyerBps: 100, sellerBps: 50 }, "a market's own rate wins");
    assert.deepEqual(await service.rates(usdt, 'NG', 'live'), { buyerBps: 50, sellerBps: 100 });
    assert.equal((await finance.get('/v1/afrippa/admin/p2p/fee-rates')).json.data.length, 2);
    assert.equal((await finance.delete('/v1/afrippa/admin/p2p/fee-rates/USDT/GH')).status, 200);
    assert.deepEqual(await service.rates(usdt, 'GH', 'live'), { buyerBps: 50, sellerBps: 100 });
    assert.equal((await prisma.auditLog.findFirst({ where: { action: 'p2p_fee_rate.set' } })).platform, 'afrippa');

    for (const body of [{ asset: 'USDT', market: 'ZZ', buyer_bps: 10, seller_bps: 20 }, { asset: 'USDT', market: null, buyer_bps: 1001, seller_bps: 20 }]) {
      assert.equal((await finance.put('/v1/afrippa/admin/p2p/fee-rates', body)).status, 400, JSON.stringify(body));
    }
    const support = await afrippaAdminClient(server, ['support']);
    assert.equal((await support.put('/v1/afrippa/admin/p2p/fee-rates', { asset: 'USDT', market: null, buyer_bps: 0, seller_bps: 0 })).status, 403);
    const bitocard = await adminClient(server, ['super_admin']);
    assert.equal((await bitocard.get('/v1/afrippa/admin/p2p/fee-rates')).status, 401);

    // Live trading needs a rate; the sandbox falls back to the coin's P2P rate for the buyer.
    const btc = await prisma.cryptoAsset.findUniqueOrThrow({ where: { code: 'BTC' } });
    await assert.rejects(service.rates(btc, 'NG', 'live'), { code: 'fee_rates_unset' });
    assert.deepEqual(await service.rates(btc, 'NG', 'test'), { buyerBps: btc.p2pFeeBps, sellerBps: 0 });
  });

  test('a sell ad reserves its fee; an order takes both fees, gives the reserve back if cancelled, and closing returns the rest', async () => {
    // USDT: the buyer pays 0.5%, the seller 1% (set above, for every market).
    const ada = await trader('Ada Seller');
    const bola = await trader('Bola Buyer');
    assert.equal((await ada.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '100' })).status, 201);
    const ad = await ada.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount: '50', min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [ada.bank] });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    assert.deepEqual([ad.json.available, ad.json.fee_locked], ['50.000000', '0.500000'], 'buyers can take all 50');
    assert.deepEqual(await balances(ada), { wallet: 49.5, locked: 50.5, escrow: 0 });
    const market = (await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json;
    assert.deepEqual(market.fees, { buyer_bps: 50, seller_bps: 100 });
    assert.equal(market.data.find(item => item.id === ad.json.id).fee_locked, null, 'only the owner sees the reserve');

    const payInto = ad.json.payment_methods[0].id;
    const first = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.json.id, price: 165000, fiat: 1650000, payment_method_id: payInto })).json;
    assert.deepEqual([first.amount, first.buyer_fee, first.seller_fee, first.received, first.escrow], ['10.000000', '0.050000', '0.100000', '9.950000', '10.100000']);
    assert.deepEqual(await balances(ada), { wallet: 49.5, locked: 40.4, escrow: 10.1 }, 'the seller fee came from the reserve');
    await bola.client.post(`/v1/afrippa/p2p/orders/${first.id}/paid`);
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${first.id}/release`)).status, 200);
    assert.deepEqual(await balances(bola), { wallet: 9.95, locked: 0, escrow: 0 });
    assert.equal(await feesHeld(), 0.15, 'both fees to Afrippa');

    const second = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.json.id, price: 165000, fiat: 1650000, payment_method_id: payInto })).json;
    assert.deepEqual(await balances(ada), { wallet: 49.5, locked: 30.3, escrow: 10.1 });
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${second.id}/cancel`)).status, 200);
    assert.deepEqual(await balances(ada), { wallet: 49.5, locked: 40.4, escrow: 0 }, 'cancelled: the coins and the fee back on the ad');
    assert.equal(await feesHeld(), 0.15, 'a cancelled order charges no one');
    assert.equal((await prisma.p2pAd.findUniqueOrThrow({ where: { id: ad.json.id } })).feeLocked, 400_000n);

    assert.equal((await ada.client.post(`/v1/afrippa/p2p/ads/${ad.json.id}/cancel`)).status, 200);
    assert.deepEqual(await balances(ada), { wallet: 89.9, locked: 0, escrow: 0 }, 'closing returns the coins and the reserve');
    assert.equal((await server.app.get(LedgerService).check('afrippa')).ok, true);
  });

  test("taking a buy ad, the seller pays their fee from their wallet", async () => {
    const bola = await trader('Bola Wants');
    const ada = await trader('Ada Sells');
    assert.equal((await ada.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '20' })).status, 201);
    const ad = await bola.client.post('/v1/afrippa/p2p/ads', { side: 'buy', asset: 'USDT', currency: 'NGN', price: 165000, amount: '10', min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [bola.bank] });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    const order = await ada.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.json.id, price: 165000, fiat: 1650000, payment_method_id: ada.bank });
    assert.equal(order.status, 201, JSON.stringify(order.json));
    assert.deepEqual(await balances(ada), { wallet: 9.9, locked: 0, escrow: 10.1 });
    await bola.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/paid`);
    await ada.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/release`);
    assert.deepEqual(await balances(bola), { wallet: 9.95, locked: 0, escrow: 0 });
    assert.equal((await server.app.get(LedgerService).check('afrippa')).ok, true);
  });
});
