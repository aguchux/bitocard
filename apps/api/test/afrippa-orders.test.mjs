// Afrippa's P2P orders (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 3): the escrow. Taking an escrow ad opens an order and
// moves the seller's coins into escrow; the buyer pays the seller directly and marks it paid; the seller releases (the
// coins less the buyer's fee to the buyer), or the buyer cancels, or the window ends unpaid (the job), or an appeal is
// decided by Afrippa's operations. Each step happens once, whatever runs at the same time, and the books balance.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp, withTwoStepCode } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { LedgerService } = await import('../dist/ledger/ledger.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-orders-secret-afrippa-orders-secret';
let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get(PrismaService);
  for (const key of ['crypto_wallets', 'p2p_trading']) {
    await prisma.featureSwitch.create({ data: { key, enabled: true } });
    await prisma.featureSwitch.create({ data: { key, countryCode: 'NG', enabled: true } });
  }
  // The buyer pays 1% of the coins traded.
  await prisma.cryptoAsset.update({ where: { code: 'USDT' }, data: { enabled: true, p2pFeeBps: 100 } });
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
        ...(method === 'POST' ? { 'idempotency-key': `ord-${Date.now()}-${Math.random()}` } : {}),
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

async function method(client, body) {
  const added = await client.post('/v1/afrippa/p2p/payment-methods', body);
  assert.equal(added.status, 201, JSON.stringify(added.json));
  await prisma.p2pPaymentMethod.update({ where: { id: added.json.id }, data: { usableFrom: new Date(Date.now() - 1000) } });
  return added.json.id;
}

/** A trader signed in past two-step, declared, with a bank account usable now. */
async function trader(name) {
  const client = afrippaServer();
  const email = `ord-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name, email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  const declaration = await client.get('/v1/afrippa/crypto/declaration');
  assert.equal((await client.post('/v1/afrippa/crypto/declaration', { version: declaration.json.version })).status, 200);
  const bank = await method(client, { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: `40${String(counter).padStart(8, '0')}` });
  return { client, email, id: signup.json.customer.id, bank, name };
}

async function fund(who, amount) {
  const deposit = await who.client.post('/v1/afrippa/crypto/test-deposits', { asset: 'USDT', amount });
  assert.equal(deposit.status, 201, JSON.stringify(deposit.json));
}

async function sellAd(seller, amount = '50') {
  const ad = await seller.client.post('/v1/afrippa/p2p/ads', { side: 'sell', asset: 'USDT', currency: 'NGN', price: 165000, amount, min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [seller.bank], payment_window: 15 });
  assert.equal(ad.status, 201, JSON.stringify(ad.json));
  return ad.json;
}

async function balances(who) {
  const accounts = await prisma.ledgerAccount.findMany({ where: { customerId: who.id, currency: 'USDT', mode: 'test' } });
  const of = kind => Number(accounts.find(account => account.kind === kind)?.balanceMinor ?? 0n) / 1e6;
  return { wallet: of('crypto_wallet'), locked: of('crypto_locked'), escrow: of('crypto_escrow') };
}

const ledgerOk = async () => {
  const check = await server.app.get(LedgerService).check('afrippa');
  assert.equal(check.ok, true, JSON.stringify(check));
};

describe("Afrippa's P2P orders", () => {
  test('a sell ad: escrow, paid, released to the buyer less their fee; the books balance', async () => {
    const ada = await trader('Ada Seller');
    const bola = await trader('Bola Buyer');
    await fund(ada, '100');
    const ad = await sellAd(ada);
    const adSeen = (await bola.client.get('/v1/afrippa/p2p/market?asset=USDT&side=buy')).json.data.find(item => item.id === ad.id);
    const payInto = adSeen.payment_methods[0].id;
    assert.equal(payInto, ad.payment_methods[0].id, 'the buyer names the method they pay into by its id');
    assert.equal(adSeen.payment_methods[0].hint, undefined, 'but never sees its hint');

    // The ad on its own, to take: the same as the book shows; another trader's closed ad is unavailable.
    const one = await bola.client.get(`/v1/afrippa/p2p/ads/${ad.id}`);
    assert.equal(one.status, 200, JSON.stringify(one.json));
    assert.deepEqual([one.json.id, one.json.mine, one.json.payment_methods[0].id, one.json.payment_methods[0].hint], [ad.id, false, payInto, undefined]);
    assert.equal((await ada.client.get(`/v1/afrippa/p2p/ads/${ad.id}`)).json.mine, true);
    assert.equal((await bola.client.get('/v1/afrippa/p2p/ads/00000000-0000-4000-8000-000000000000')).json.error.code, 'ad_unavailable');

    const preview = await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: payInto, preview: true });
    assert.equal(preview.status, 201, JSON.stringify(preview.json));
    assert.deepEqual([preview.json.amount, preview.json.buyer_fee, preview.json.received, preview.json.fiat], ['10.000000', '0.100000', '9.900000', 1650000]);
    assert.equal(await prisma.p2pOrder.count(), 0, 'a preview opens nothing');

    const opened = await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: payInto });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    const order = opened.json;
    assert.match(order.number, /^ORD-\d{6}$/);
    assert.deepEqual([order.status, order.side, order.amount, order.escrow, order.payment_window], ['pending_payment', 'buy', '10.000000', '10.000000', 15]);
    // The buyer sees where to pay, and that it must come from their own account.
    assert.equal(order.payment_method.details.account_number.length, 10);
    assert.equal(order.payment_method.holder_name, 'Ada Seller');
    assert.equal(order.payer_name, 'Bola Buyer');
    assert.deepEqual(await balances(ada), { wallet: 50, locked: 40, escrow: 10 });
    assert.equal((await prisma.p2pAd.findUniqueOrThrow({ where: { id: ad.id } })).remainingAmount, 40_000_000n);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.p2p.order_opened' } }));

    // Nobody else sees it; only the seller releases, only the buyer marks paid.
    const cara = await trader('Cara Other');
    assert.equal((await cara.client.get(`/v1/afrippa/p2p/orders/${order.id}`)).status, 404);
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true })).json.error.code, 'seller_only');
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, { payment_method_id: ada.bank })).json.error.code, 'buyer_only');

    const paid = await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, { payment_method_id: bola.bank });
    assert.deepEqual([paid.status, paid.json.status], [200, 'paid']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.p2p.order_paid' } }));
    const sellerView = (await ada.client.get(`/v1/afrippa/p2p/orders/${order.id}`)).json;
    assert.deepEqual([sellerView.side, sellerView.payer_name], ['sell', 'Bola Buyer'], 'the seller checks the money came from the buyer');

    const released = await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true });
    assert.deepEqual([released.status, released.json.status, released.json.payment_method.details], [200, 'released', null], 'details are gone once closed');
    assert.deepEqual(await balances(ada), { wallet: 50, locked: 40, escrow: 0 });
    assert.deepEqual(await balances(bola), { wallet: 9.9, locked: 0, escrow: 0 });
    const fees = await prisma.ledgerAccount.aggregate({ where: { kind: 'crypto_fees', currency: 'USDT', mode: 'test' }, _sum: { balanceMinor: true } });
    assert.equal(fees._sum.balanceMinor, 100_000n);
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true })).json.error.code, 'order_closed', 'released once');
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/cancel`)).json.error.code, 'order_closed', 'released coins are never taken back');
    assert.deepEqual((await bola.client.get('/v1/afrippa/p2p/orders?status=closed')).json.data.map(item => item.id), [order.id]);
    await ledgerOk();
  });

  test("a buy ad: the taker sells into one of their own accounts the ad accepts; cancelled, the coins go back", async () => {
    const bola = await trader('Bola Wants');
    const ada = await trader('Ada Sells');
    await fund(ada, '30');
    const ad = await bola.client.post('/v1/afrippa/p2p/ads', { side: 'buy', asset: 'USDT', currency: 'NGN', price: 165000, amount: '20', min_fiat: 100000, max_fiat: 50000000, payment_method_ids: [bola.bank] });
    assert.equal(ad.status, 201, JSON.stringify(ad.json));
    const momo = await method(ada.client, { kind: 'mobile_money', currency: 'NGN', network: 'MTN MoMo', phone: '08031234567' });
    const mismatch = await ada.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.json.id, price: 165000, fiat: 1650000, payment_method_id: momo });
    assert.equal(mismatch.json.error.code, 'payment_method_mismatch', 'the buyer pays by bank, not mobile money');
    const notMine = await ada.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.json.id, price: 165000, fiat: 1650000, payment_method_id: bola.bank });
    assert.equal(notMine.status, 400);

    const opened = await ada.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.json.id, price: 165000, fiat: 1650000, payment_method_id: ada.bank });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.deepEqual([opened.json.side, opened.json.payer_name], ['sell', 'Bola Wants']);
    assert.deepEqual(await balances(ada), { wallet: 20, locked: 0, escrow: 10 });
    const buyerView = (await bola.client.get(`/v1/afrippa/p2p/orders/${opened.json.id}`)).json;
    assert.deepEqual([buyerView.side, buyerView.payment_method.holder_name], ['buy', 'Ada Sells'], 'the buyer pays into the seller’s account');

    const cancelled = await bola.client.post(`/v1/afrippa/p2p/orders/${opened.json.id}/cancel`);
    assert.deepEqual([cancelled.status, cancelled.json.status, cancelled.json.cancel_reason], [200, 'cancelled', 'buyer']);
    assert.deepEqual(await balances(ada), { wallet: 30, locked: 0, escrow: 0 });
    assert.equal((await prisma.p2pAd.findUniqueOrThrow({ where: { id: ad.json.id } })).remainingAmount, 20_000_000n, 'the ad takes the amount again');
    await ledgerOk();
  });

  test('unpaid past its window, an order cannot be marked paid and the job expires it, the coins back on the ad', async () => {
    const ada = await trader('Ada Waits');
    const bola = await trader('Bola Late');
    await fund(ada, '50');
    const ad = await sellAd(ada);
    const order = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id })).json;
    await prisma.p2pOrder.update({ where: { id: order.id }, data: { payBy: new Date(Date.now() - 1000) } });
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, { payment_method_id: bola.bank })).json.error.code, 'order_expired');
    const job = await fetch(`${server.base}/v1/cron/p2p-orders`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    assert.ok(job.result.expired >= 1, JSON.stringify(job));
    const closed = await prisma.p2pOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.deepEqual([closed.status, closed.cancelReason], ['cancelled', 'expired']);
    assert.deepEqual(await balances(ada), { wallet: 0, locked: 50, escrow: 0 }, 'back on the still-open sell ad');
    // A paid order never expires.
    const second = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id })).json;
    await bola.client.post(`/v1/afrippa/p2p/orders/${second.id}/paid`, { payment_method_id: bola.bank });
    await prisma.p2pOrder.update({ where: { id: second.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await fetch(`${server.base}/v1/cron/p2p-orders`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal((await prisma.p2pOrder.findUniqueOrThrow({ where: { id: second.id } })).status, 'paid');
    await ledgerOk();
  });

  test("appeals: once paid; Afrippa's operations decide, audited in Afrippa's trail", async () => {
    const ada = await trader('Ada Disputes');
    const bola = await trader('Bola Claims');
    await fund(ada, '50');
    const ad = await sellAd(ada);
    const order = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id })).json;
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/appeal`, { reason: 'Nothing has arrived in my account yet.' })).json.error.code, 'order_not_appealable', 'not before it is marked paid');
    await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, { payment_method_id: bola.bank });
    const appealed = await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/appeal`, { reason: 'Nothing has arrived in my account yet.' });
    assert.deepEqual([appealed.status, appealed.json.status, appealed.json.appealed_by], [200, 'appealed', 'seller']);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: bola.id, type: 'customer.p2p.order_appealed' } }));

    const bitocard = await adminClient(server, ['super_admin']);
    assert.equal((await bitocard.post(`/v1/afrippa/admin/p2p/orders/${order.id}/decide`, { outcome: 'release', fault: 'none', note: 'BitoCard has no say' })).status, 401);
    const support = await afrippaAdminClient(server, ['support']);
    assert.equal((await support.get(`/v1/afrippa/admin/p2p/orders/${order.id}`)).status, 200);
    assert.equal((await support.post(`/v1/afrippa/admin/p2p/orders/${order.id}/decide`, { outcome: 'return', fault: 'buyer', note: 'No payment shown' })).status, 403);
    const operations = await afrippaAdminClient(server, ['operations']);
    const decided = await operations.post(`/v1/afrippa/admin/p2p/orders/${order.id}/decide`, { outcome: 'return', fault: 'buyer', note: 'The buyer showed no payment.' });
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
    assert.deepEqual([decided.json.status, decided.json.decision.fault], ['returned', 'buyer']);
    assert.deepEqual(await balances(ada), { wallet: 0, locked: 50, escrow: 0 }, 'back on the still-open sell ad');
    const audit = await prisma.auditLog.findFirst({ where: { targetId: order.id, action: 'p2p_order.returned' } });
    assert.equal(audit.platform, 'afrippa');
    assert.equal((await operations.post(`/v1/afrippa/admin/p2p/orders/${order.id}/decide`, { outcome: 'release', fault: 'none', note: 'Again, once only' })).json.error.code, 'order_not_appealed');
    await ledgerOk();
  });

  test('at the same time, only one step wins: release or cancel, and two buyers for the last coins', async () => {
    const ada = await trader('Ada Races');
    const bola = await trader('Bola Races');
    const cara = await trader('Cara Races');
    await fund(ada, '20');
    const ad = await sellAd(ada, '10');
    const order = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id })).json;
    await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, { payment_method_id: bola.bank });
    const [release, cancel] = await Promise.all([ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true }), bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/cancel`)]);
    assert.equal([release.status, cancel.status].filter(status => status === 200).length, 1, `${release.status} ${cancel.status}`);
    const closed = await prisma.p2pOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(await prisma.journalEntry.count({ where: { reference: { startsWith: `p2p_order:${order.id}:` } } }), 2, 'escrow, then one release or one return');
    assert.equal((await balances(ada)).escrow, 0);
    assert.ok(['released', 'cancelled'].includes(closed.status));

    // The ad's coins, all of them, taken by two buyers at once: one order opens.
    const last = await sellAd(ada, '10');
    const [first, second] = await Promise.all([
      bola.client.post('/v1/afrippa/p2p/orders', { ad_id: last.id, price: 165000, fiat: 1650000, payment_method_id: last.payment_methods[0].id }),
      cara.client.post('/v1/afrippa/p2p/orders', { ad_id: last.id, price: 165000, fiat: 1650000, payment_method_id: last.payment_methods[0].id }),
    ]);
    assert.equal([first.status, second.status].filter(status => status === 201).length, 1, `${first.status} ${second.status}`);
    const loser = first.status === 201 ? second : first;
    assert.ok(['amount_unavailable', 'ad_unavailable'].includes(loser.json.error.code), JSON.stringify(loser.json));
    assert.equal((await prisma.p2pAd.findUniqueOrThrow({ where: { id: last.id } })).remainingAmount, 0n);
    await ledgerOk();
  });
});

describe('step 5: hardening the escrow', () => {
  test('releasing coins takes a fresh two-step code: missing or wrong, nothing moves; an emailed confirmation code works', async () => {
    const ada = await trader('Ada Confirms');
    const bola = await trader('Bola Pays');
    await fund(ada, '50');
    const ad = await sellAd(ada);
    const order = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id })).json;
    await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, { payment_method_id: bola.bank });

    const missing = await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true, code: undefined });
    assert.deepEqual([missing.status, missing.json.error.code, missing.json.error.param], [400, 'mfa_code_required', 'code']);
    const wrong = await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true, code: '000000' });
    assert.deepEqual([wrong.status, wrong.json.error.code], [400, 'mfa_code_invalid']);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: ada.id } })).failedSignIns, 1, 'a wrong code counts towards the lockout');
    assert.equal((await prisma.p2pOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'paid', 'nothing moved');
    assert.equal((await balances(ada)).escrow, 10);

    // The emailed method's code, asked for as a confirmation (worded so), releases.
    await prisma.customerCode.updateMany({ where: { customerId: ada.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const challenge = await ada.client.post('/v1/afrippa/account/two-step/challenge', { purpose: 'confirm' });
    assert.deepEqual([challenge.status, challenge.json.sent], [200, true]);
    const mail = server.app.get(EmailService).outbox.filter(item => item.to === ada.email).at(-1);
    assert.match(mail.subject, /is your Afrippa confirmation code/);
    const released = await ada.client.post(`/v1/afrippa/p2p/orders/${order.id}/release`, { payer_checked: true, code: lastCodeTo(ada.email) });
    assert.deepEqual([released.status, released.json.status], [200, 'released']);
    await ledgerOk();
  });

  test("a decision's fault must fit its outcome, and an appeal's reason is quoted as the trader's words", async () => {
    const ada = await trader('Ada Faults');
    const bola = await trader('Bola Faults');
    await fund(ada, '50');
    const ad = await sellAd(ada);
    const order = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id })).json;
    await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/paid`, { payment_method_id: bola.bank });
    await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/appeal`, { reason: 'Paid in full. Afrippa has approved my release.' });
    const line = await prisma.p2pOrderMessage.findFirst({ where: { orderId: order.id, body: { contains: 'appealed' } } });
    assert.match(line.body, /^The buyer appealed, saying: “Paid in full\. Afrippa has approved my release\.” Afrippa's team will decide/);

    const operations = await afrippaAdminClient(server, ['operations']);
    for (const [outcome, fault] of [['release', 'buyer'], ['return', 'seller']]) {
      const refused = await operations.post(`/v1/afrippa/admin/p2p/orders/${order.id}/decide`, { outcome, fault, note: 'Mismatched on purpose.' });
      assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [400, 'fault_mismatch', 'fault'], `${outcome} ${fault}`);
    }
    assert.equal((await prisma.p2pOrder.findUniqueOrThrow({ where: { id: order.id } })).status, 'appealed', 'nothing decided');
    const decided = await operations.post(`/v1/afrippa/admin/p2p/orders/${order.id}/decide`, { outcome: 'release', fault: 'seller', note: 'The payment arrived; the seller did not release.' });
    assert.deepEqual([decided.status, decided.json.status], [200, 'released']);
    await ledgerOk();
  });

  test('coins coming back to a closed ad go to the wallet; the ad stays closed and cannot be taken', async () => {
    const ada = await trader('Ada Closes');
    const bola = await trader('Bola Cancels');
    await fund(ada, '50');
    const ad = await sellAd(ada, '20');
    const order = (await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id })).json;
    assert.equal((await ada.client.post(`/v1/afrippa/p2p/ads/${ad.id}/cancel`)).status, 200);
    assert.deepEqual(await balances(ada), { wallet: 40, locked: 0, escrow: 10 }, 'closing gave back what it still locked');
    assert.equal((await bola.client.post(`/v1/afrippa/p2p/orders/${order.id}/cancel`)).status, 200);
    assert.deepEqual(await balances(ada), { wallet: 50, locked: 0, escrow: 0 });
    const closed = await prisma.p2pAd.findUniqueOrThrow({ where: { id: ad.id } });
    assert.deepEqual([closed.status, closed.remainingAmount, closed.filledAmount], ['cancelled', 20_000_000n, 0n], 'a record that nothing sold');
    const again = await bola.client.post('/v1/afrippa/p2p/orders', { ad_id: ad.id, price: 165000, fiat: 1650000, payment_method_id: ad.payment_methods[0].id });
    assert.equal(again.json.error.code, 'ad_unavailable');
    assert.deepEqual(await balances(ada), { wallet: 50, locked: 0, escrow: 0 }, 'and its coins stay in the wallet');
    await ledgerOk();
  });
});
