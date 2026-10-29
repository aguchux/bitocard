// Afrippa's merchants (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 6): traders who meet their market's thresholds apply,
// Afrippa's operations approve or reject; merchants have a badge, a filter of their own and the market's merchant
// limits; a strike suspends them at once, falling below the thresholds at the daily check too; operations revoke.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp, withTwoStepCode } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');
const { CryptoMarketLimitsService } = await import('../dist/crypto/market-limits.service.js');

const secret = 'afrippa-merchants-secret-afrippa-merchants-x';
let server;
let prisma;
let operations;
let support;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get(PrismaService);
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await prisma.featureSwitch.create({ data: { key, enabled: true } });
    await prisma.featureSwitch.create({ data: { key, countryCode: 'NG', enabled: true } });
  }
  await prisma.cryptoAsset.update({ where: { code: 'USDT' }, data: { enabled: true, p2pFeeBps: 100 } });
  operations = await afrippaAdminClient(server, ['operations']);
  support = await afrippaAdminClient(server, ['support']);
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
        ...(method === 'POST' ? { 'idempotency-key': `mer-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => withTwoStepCode(request, 'POST', path, body) };
}

const lastCodeTo = email => /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1).subject)[1];

/** A trader signed in past two-step, declared, with a bank account usable now. */
async function trader(name) {
  const client = afrippaServer();
  const email = `mer-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const added = await client.post('/v1/afrippa/p2p/payment-methods', { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `55${String(counter).padStart(8, '0')}` });
  assert.equal(added.status, 201, JSON.stringify(added.json));
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return { client, email, id: signup.json.customer.id, bank: added.json.id };
}

/** A sell ad by `seller`, and an order on it by `buyer`, marked paid. */
async function paidOrder(seller, buyer) {
  assert.equal((await seller.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '40' })).status, 201);
  // Larger than the order, so the ad stays in the book.
  const ad = (await seller.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount: '30', min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [seller.bank], payment_window: 15 })).json;
  const order = await buyer.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  assert.equal((await buyer.client.post(`/v1/afrippa/p2p/orders/${order.json.id}/paid`, { payment_method_id: buyer.bank })).status, 200);
  return { ad, order: order.json };
}

describe("Afrippa's merchants", () => {
  let ada;
  let bola;
  let merchantId;

  test("thresholds for all of Afrippa and per market; a trader who falls short cannot apply", async () => {
    const rules = (await support.get('/v1/afrippa/admin/p2p/merchant-rules')).json.data;
    assert.deepEqual(rules.map(rule => [rule.market, rule.min_orders, rule.min_completion_bps, rule.window_days, rule.min_account_days]), [['WW', 100, 9800, 90, 30]]);
    assert.equal((await support.put('/v1/afrippa/admin/p2p/merchant-rules/NG', { min_orders: 1, min_completion_bps: 5000, window_days: 30, min_account_days: 0 })).status, 403);
    assert.deepEqual((await operations.delete('/v1/afrippa/admin/p2p/merchant-rules/WW')).json.error.code, 'rule_required');

    ada = await trader('Ada Merchant');
    bola = await trader('Bola Buyer');
    const before = (await ada.client.get('/v1/afrippa/p2p/merchant')).json;
    assert.deepEqual([before.status, before.eligible], ['none', false]);
    assert.deepEqual(before.requirements.find(item => item.key === 'orders'), { key: 'orders', label: 'Completed orders', needed: '100', value: '0', met: false }, "all of Afrippa's thresholds");
    const refused = await ada.client.post('/v1/afrippa/p2p/merchant/apply');
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'merchant_not_eligible']);
    assert.match(refused.json.error.message, /completed orders/);

    // Nigeria's own thresholds win for Nigerian traders.
    const set = await operations.put('/v1/afrippa/admin/p2p/merchant-rules/ng', { min_orders: 1, min_completion_bps: 5000, window_days: 30, min_account_days: 0 });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal((await prisma.auditLog.findFirst({ where: { action: 'p2p_merchant_rule.set', targetId: 'NG' } })).platform, 'afrippa');
  });

  test('a trader who qualifies applies; operations approve; the badge, the filter and the card show it', async () => {
    const { order } = await paidOrder(ada, bola);
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true })).status, 200);
    const status = (await ada.client.get('/v1/afrippa/p2p/merchant')).json;
    assert.equal(status.eligible, true, JSON.stringify(status.requirements));
    const applied = await ada.client.post('/v1/afrippa/p2p/merchant/apply');
    assert.deepEqual([applied.status, applied.json.status], [200, 'applied']);
    assert.equal((await ada.client.post('/v1/afrippa/p2p/merchant/apply')).json.error.code, 'merchant_applied');
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.p2p.merchant_applied' } }), "Afrippa's operations are told");

    const waiting = (await support.get('/v1/afrippa/admin/p2p/merchants?status=applied')).json.data;
    const mine = waiting.find(item => item.customer.id === ada.id);
    merchantId = mine.id;
    assert.ok(mine.requirements.every(item => item.met));
    assert.equal((await support.post(`/v1/afrippa/admin/p2p/merchants/${merchantId}/approve`, { note: 'Good record.' })).status, 403);
    const approved = await operations.post(`/v1/afrippa/admin/p2p/merchants/${merchantId}/approve`, { note: 'Good record.' });
    assert.deepEqual([approved.status, approved.json.status], [200, 'active']);
    assert.equal((await operations.post(`/v1/afrippa/admin/p2p/merchants/${merchantId}/approve`, { note: 'Again, once only.' })).json.error.code, 'merchant_not_applied');
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.p2p.merchant_changed' } }));

    // A merchant's ad carries the badge, and the merchants-only book shows only merchants.
    const cara = await trader('Cara Seller');
    await cara.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount: '20' });
    await cara.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 166000, amount: '10', min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [cara.bank] });
    const book = (await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data;
    assert.deepEqual(book.map(ad => ad.trader.merchant).sort(), [false, true]);
    const merchants = (await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&merchant=true')).json.data;
    assert.ok(merchants.length >= 1 && merchants.every(ad => ad.trader.merchant === true));
    const nickname = book.find(ad => ad.trader.merchant).trader.nickname;
    assert.equal((await bola.client.get(`/v1/afrippa/p2p/traders/${nickname}`)).json.merchant, true);
  });

  test("a merchant has the market's merchant limits in their own market", async () => {
    const limits = server.app.get(CryptoMarketLimitsService);
    await prisma.cryptoMarketLimit.create({ data: { mode: 'test', market: 'GH', currency: 'GHS', perTradeMinor: 10_000n, merchantPerTradeMinor: 100_000n } });
    const check = merchant => limits.check(prisma, { mode: 'test', market: 'GH', currency: 'GHS', fiat: 50_000n, parties: [{ customerId: ada.id, home: 'GH', taker: true, merchant }] });
    await assert.rejects(check(false), error => error.code === 'trade_limit');
    await check(true);
    // From elsewhere, a merchant has the market's cross-border limits, not its merchant ones.
    await assert.rejects(limits.check(prisma, { mode: 'test', market: 'GH', currency: 'GHS', fiat: 50_000n, parties: [{ customerId: ada.id, home: 'NG', taker: true, merchant: true }] }), error => error.code === 'trade_limit');
  });

  test('a strike suspends a merchant at once; operations revoke with a reason the trader sees', async () => {
    const { order } = await paidOrder(ada, bola);
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/appeal`, { reason: 'I paid and the seller does not release.' })).status, 200);
    const decided = await operations.post(`/v1/afrippa/admin/p2p/orders/${order.id}/decide`, { outcome: 'release', fault: 'seller', note: 'The payment arrived.' });
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
    const suspended = (await ada.client.get('/v1/afrippa/p2p/merchant')).json;
    assert.deepEqual([suspended.status, suspended.suspended_reason, suspended.eligible], ['suspended', 'strike', false]);
    assert.equal((await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy&merchant=true')).json.data.length, 0, 'no badge while suspended');

    const revoked = await operations.post(`/v1/afrippa/admin/p2p/merchants/${merchantId}/revoke`, { reason: 'Repeated late releases.' });
    assert.deepEqual([revoked.status, revoked.json.status], [200, 'revoked']);
    assert.deepEqual([(await ada.client.get('/v1/afrippa/p2p/merchant')).json.status, (await ada.client.get('/v1/afrippa/p2p/merchant')).json.reason], ['revoked', 'Repeated late releases.']);
    assert.equal((await prisma.auditLog.findFirst({ where: { action: 'p2p_merchant.revoked' } })).platform, 'afrippa');
  });

  test('the daily check suspends a merchant below the thresholds; an upheld report is a strike too', async () => {
    const dana = await trader('Dana Thin');
    await prisma.p2pMerchant.create({ data: { customerId: dana.id, mode: 'test', status: 'active', appliedAt: new Date() } });
    const job = await fetch(`${server.base}/v1/cron/p2p-merchants`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    assert.ok(job.result.suspended >= 1, JSON.stringify(job));
    assert.equal((await prisma.p2pMerchant.findFirstOrThrow({ where: { customerId: dana.id } })).suspendedReason, 'thresholds');

    const eve = await trader('Eve Reported');
    await prisma.p2pMerchant.create({ data: { customerId: eve.id, mode: 'test', status: 'active', appliedAt: new Date() } });
    const { nickname } = (await eve.client.get('/v1/afrippa/p2p/profile')).json;
    const report = await bola.client.post('/v1/afrippa/p2p/reports', { nickname, reason: 'abuse', details: 'Insulted me in the order room.' });
    assert.equal(report.status, 201, JSON.stringify(report.json));
    assert.equal((await operations.post(`/v1/afrippa/admin/p2p/reports/${report.json.id}/decide`, { decision: 'upheld', note: 'Confirmed in the room.' })).status, 200);
    const after = await prisma.p2pMerchant.findFirstOrThrow({ where: { customerId: eve.id } });
    assert.deepEqual([after.status, after.suspendedReason], ['suspended', 'strike']);
  });

  test("BitoCard's admins never reach them", async () => {
    const bitocard = await adminClient(server, ['super_admin']);
    assert.equal((await bitocard.get('/v1/afrippa/admin/p2p/merchants')).status, 401);
    assert.equal((await bitocard.get('/v1/afrippa/admin/p2p/merchant-rules')).status, 401);
  });
});
