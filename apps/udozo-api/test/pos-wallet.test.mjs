// Udozo POS milestone 3 (docs/UDOZO_POS_PLAN.md): paying at the till from the buyer's Udozo wallet. The till asks for the
// wallet part of a basket (a QR code anyone signed in may pay, or one buyer by their mobile number); the buyer confirms
// on udozo.com, and in one transaction the basket becomes the sale (its stock taken) and the money moves from the
// buyer's wallet to the owner's payouts, held for the market's payout hold. Nothing is taken without the buyer, from a
// wallet too low, or for a basket that changed at the shop; a refund puts the money back. Off unless the market's
// `pos_wallet_payments` switch is on.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let ledger;
let admin;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ledger = server.app.get((await import('../dist/ledger/ledger.service.js')).LedgerService);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'pos']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'free' }, data: { limits: { products: 10, shops: 1, tills: 2, staff: 3 } } });
});

after(() => server?.close());

const walletSwitch = enabled => admin.put('/v1/admin/switches/pos_wallet_payments', { country_code: 'NG', enabled });

function client() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `wallet-${randomUUID()}` } : {}),
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
async function person({ pos = false, name = 'Ada Okafor' } = {}) {
  const who = client();
  const email = `wallet${(counter += 1)}-${Date.now()}@example.com`;
  const phone = testMobile('NG');
  const signup = await who.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, who);
  assert.equal((await who.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  who.id = signup.json.customer.id;
  // Where the test market cannot text, confirm the mobile directly.
  const row = await prisma.customer.update({ where: { id: who.id }, data: { phoneVerifiedAt: new Date() } });
  who.phone = row.phone;
  if (pos) {
    await who.post('/v1/classifieds/terms/accept', { version: (await who.get('/v1/classifieds/terms')).json.version });
    assert.equal((await who.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: "Ada's Gadget Hub", vat_bps: 0 } })).status, 201);
    const me = await who.get('/v1/pos/owner');
    who.till = me.json.account.shops[0].tills[0];
    who.mode = me.json.account.mode;
  }
  return who;
}

async function product(owner, title, { price = 500_000, stock = 5 } = {}) {
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
  const made = await owner.post('/v1/classifieds/listings', { title, price, category_id: category.id, stock, pos_enabled: true, on_shop: false });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const submitted = await owner.post(`/v1/classifieds/listings/${made.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  return submitted.json;
}

const balance = async (customerId, kind) => {
  const row = await prisma.ledgerAccount.findFirst({ where: { kind, customerId, currency: 'NGN' }, select: { balanceMinor: true } });
  return Number(row?.balanceMinor ?? 0n);
};

async function fund(customerId, mode, amount) {
  await ledger.post({
    mode,
    type: 'adjustment',
    reference: `test-fund:${randomUUID()}`,
    description: 'Test top-up',
    lines: [
      { account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) },
      { account: { kind: 'customer_wallet', currency: 'NGN', customerId }, credit: BigInt(amount) },
    ],
  });
}

const ask = (owner, tv, extra = {}) =>
  owner.post('/v1/pos/owner/wallet-requests', {
    till_id: owner.till.id,
    client_sale_id: randomUUID(),
    lines: [{ listing_id: tv.id, quantity: 2 }],
    payments: [{ method: 'cash', amount: 200_000, tendered: 200_000 }],
    wallet_amount: 800_000,
    expected_total: 1_000_000,
    ...extra,
  });

describe('Udozo wallet payments at the till', () => {
  test('are closed until the market’s switch is on, and the till is told which', async () => {
    await walletSwitch(false);
    const owner = await person({ pos: true });
    const tv = await product(owner, 'Hisense 32 inch TV');
    assert.equal((await owner.get('/v1/pos/owner')).json.wallet_payments, false);
    const refused = await ask(owner, tv);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'pos_wallet_unavailable']);
    await walletSwitch(true);
    assert.equal((await owner.get('/v1/pos/owner')).json.wallet_payments, true);
  });

  test('a QR code: the buyer sees the sale, pays once from their wallet, and the till sees the sale made', async () => {
    await walletSwitch(true);
    const owner = await person({ pos: true });
    const tv = await product(owner, 'Samsung 43 inch TV');
    const asked = await ask(owner, tv);
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.match(asked.json.token, /^pw_[A-Za-z0-9_-]{32}$/);
    assert.equal(asked.json.pay_url, `https://udozo.com/pay/${asked.json.token}`);
    assert.deepEqual([asked.json.status, asked.json.amount, asked.json.total, asked.json.sale], ['waiting', 800_000, 1_000_000, null]);
    // Nothing was taken by asking.
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: tv.id } })).stock, 5);

    const buyer = await person({ name: 'Bola Ade' });
    const seen = await buyer.get(`/v1/store/account/pos-payments/${asked.json.token}`);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    assert.deepEqual([seen.json.shop.name, seen.json.amount, seen.json.total, seen.json.items, seen.json.own_shop], ["Ada's Gadget Hub", 800_000, 1_000_000, [{ title: 'Samsung 43 inch TV', quantity: 2 }], false]);

    assert.equal((await buyer.post(`/v1/store/account/pos-payments/${asked.json.token}/pay`, { expected_amount: 700_000 })).json.error.code, 'price_changed');
    const low = await buyer.post(`/v1/store/account/pos-payments/${asked.json.token}/pay`, { expected_amount: 800_000 });
    assert.deepEqual([low.status, low.json.error.code], [402, 'wallet_balance_low']);
    assert.equal((await owner.get(`/v1/pos/owner/wallet-requests/${asked.json.id}`)).json.status, 'waiting');
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: tv.id } })).stock, 5);

    await fund(buyer.id, owner.mode, 1_000_000);
    const paid = await buyer.post(`/v1/store/account/pos-payments/${asked.json.token}/pay`, { expected_amount: 800_000 });
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.equal(paid.json.status, 'paid');
    assert.deepEqual([await balance(buyer.id, 'customer_wallet'), await balance(owner.id, 'customer_withdrawable')], [200_000, 800_000]);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: tv.id } })).stock, 3);

    const status = await owner.get(`/v1/pos/owner/wallet-requests/${asked.json.id}`);
    assert.equal(status.json.status, 'paid');
    assert.equal(status.json.sale.number, 'POS-000001');
    assert.deepEqual(status.json.sale.payments.map(p => [p.method, p.amount, p.reference]), [['cash', 200_000, null], ['udozo_wallet', 800_000, asked.json.number]]);
    // Once only.
    assert.equal((await buyer.post(`/v1/store/account/pos-payments/${asked.json.token}/pay`, { expected_amount: 800_000 })).json.error.code, 'request_closed');
    assert.equal(await balance(buyer.id, 'customer_wallet'), 200_000);

    // The money waits for the market's payout hold before it can be paid out.
    const cash = await owner.get('/v1/store/cash');
    assert.equal(cash.status, 200, JSON.stringify(cash.json));
    assert.ok(cash.json.hold_days > 0, 'Nigeria holds payouts');
    assert.equal(cash.json.held, 800_000);
  });

  test('to one buyer by their mobile: only they see it, never the owner themselves, never an unknown number', async () => {
    await walletSwitch(true);
    const owner = await person({ pos: true });
    const tv = await product(owner, 'LG 50 inch TV');
    const buyer = await person({ name: 'Chidi Okeke' });
    assert.equal((await ask(owner, tv, { phone: owner.phone })).json.error.code, 'same_person');
    assert.equal((await ask(owner, tv, { phone: '+2348039999999' })).json.error.code, 'buyer_unknown');

    const asked = await ask(owner, tv, { phone: buyer.phone });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    const notice = await prisma.notification.findFirst({ where: { customerId: buyer.id, type: 'customer.pos.payment' } });
    assert.ok(notice, 'the buyer is asked on udozo.com');
    assert.equal(notice.link, `/pay/${asked.json.token}`);

    const stranger = await person({ name: 'Dayo Bello' });
    assert.equal((await stranger.get(`/v1/store/account/pos-payments/${asked.json.token}`)).status, 404);
    const declined = await buyer.post(`/v1/store/account/pos-payments/${asked.json.token}/decline`);
    assert.equal(declined.json.status, 'declined');
    assert.equal((await owner.get(`/v1/pos/owner/wallet-requests/${asked.json.id}`)).json.status, 'declined');
  });

  test('a basket that changed at the shop takes nothing; the till can cancel; and a refund puts the money back', async () => {
    await walletSwitch(true);
    const owner = await person({ pos: true });
    const tv = await product(owner, 'TCL 55 inch TV', { stock: 2 });
    const buyer = await person({ name: 'Efe Johnson' });
    await fund(buyer.id, owner.mode, 2_000_000);

    const asked = await ask(owner, tv);
    // Meanwhile the shop sells one by cash: the basket's two are no longer free.
    assert.equal((await owner.post('/v1/pos/owner/sales', { till_id: owner.till.id, client_sale_id: randomUUID(), lines: [{ listing_id: tv.id, quantity: 1 }], payments: [{ method: 'cash', amount: 500_000 }], expected_total: 500_000 })).status, 201);
    const changed = await buyer.post(`/v1/store/account/pos-payments/${asked.json.token}/pay`, { expected_amount: 800_000 });
    assert.equal(changed.json.error.code, 'basket_changed');
    assert.equal(await balance(buyer.id, 'customer_wallet'), 2_000_000);
    assert.equal((await owner.get(`/v1/pos/owner/wallet-requests/${asked.json.id}`)).json.status, 'cancelled');

    const second = await ask(owner, tv, { lines: [{ listing_id: tv.id, quantity: 1 }], payments: [], wallet_amount: 500_000, expected_total: 500_000 });
    const cancelled = await owner.post(`/v1/pos/owner/wallet-requests/${second.json.id}/cancel`);
    assert.equal(cancelled.json.status, 'cancelled');
    assert.equal((await buyer.post(`/v1/store/account/pos-payments/${second.json.token}/pay`, { expected_amount: 500_000 })).json.error.code, 'request_closed');

    const third = await ask(owner, tv, { lines: [{ listing_id: tv.id, quantity: 1 }], payments: [], wallet_amount: 500_000, expected_total: 500_000 });
    assert.equal((await buyer.post(`/v1/store/account/pos-payments/${third.json.token}/pay`, { expected_amount: 500_000 })).status, 200);
    const sale = (await owner.get(`/v1/pos/owner/wallet-requests/${third.json.id}`)).json.sale;
    assert.deepEqual([await balance(buyer.id, 'customer_wallet'), await balance(owner.id, 'customer_withdrawable')], [1_500_000, 500_000]);

    // Paid out meanwhile: the refund waits until the owner's payouts hold enough.
    await ledger.post({ mode: owner.mode, type: 'adjustment', reference: `test-out:${randomUUID()}`, description: 'Paid out', lines: [{ account: { kind: 'customer_withdrawable', currency: 'NGN', customerId: owner.id }, debit: 500_000n }, { account: { kind: 'adjustments', currency: 'NGN' }, credit: 500_000n }] });
    assert.equal((await owner.post(`/v1/pos/owner/sales/${sale.id}/refund`, { reason: 'Changed their mind' })).json.error.code, 'refund_funds_short');
    assert.equal((await owner.get(`/v1/pos/owner/sales/${sale.id}`)).json.status, 'completed');
    await ledger.post({ mode: owner.mode, type: 'adjustment', reference: `test-in:${randomUUID()}`, description: 'Came in', lines: [{ account: { kind: 'adjustments', currency: 'NGN' }, debit: 500_000n }, { account: { kind: 'customer_withdrawable', currency: 'NGN', customerId: owner.id }, credit: 500_000n }] });
    const refunded = await owner.post(`/v1/pos/owner/sales/${sale.id}/refund`, { reason: 'Changed their mind' });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.deepEqual([await balance(buyer.id, 'customer_wallet'), await balance(owner.id, 'customer_withdrawable')], [2_000_000, 0]);
  });

  test('the till can never record a wallet part itself', async () => {
    await walletSwitch(true);
    const owner = await person({ pos: true });
    const tv = await product(owner, 'Sony 65 inch TV');
    const forged = await owner.post('/v1/pos/owner/sales', { till_id: owner.till.id, client_sale_id: randomUUID(), lines: [{ listing_id: tv.id, quantity: 1 }], payments: [{ method: 'udozo_wallet', amount: 500_000 }], expected_total: 500_000 });
    assert.equal(forged.status, 400);
  });
});
