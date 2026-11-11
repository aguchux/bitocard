// Udozo POS customers (docs/UDOZO_POS_PLAN.md; 11 November 2026, the owner's decision): every customer at the till is
// the shop's own record, needing no Udozo account. Records keep details, sales and what a customer owes for goods sold on
// credit (pay later, repaid at the counter); a Udozo customer paying through Udozo joins the shop's customers on the way,
// linked to their account, with their Udozo rating shown. Udozo's admins read them under the POS account.
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
  for (const key of ['classifieds', 'pos', 'pos_wallet_payments']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
  await prisma.posPlan.update({ where: { code: 'free' }, data: { limits: { products: 10, shops: 1, tills: 2, staff: 3 } } });
});

after(() => server?.close());

function client() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `customers-${randomUUID()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function person({ pos = false, name = 'Ada Okafor' } = {}) {
  const who = client();
  const email = `customers${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await who.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, who);
  assert.equal((await who.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  who.id = signup.json.customer.id;
  who.phone = (await prisma.customer.update({ where: { id: who.id }, data: { phoneVerifiedAt: new Date() } })).phone;
  if (pos) {
    await who.post('/v1/classifieds/terms/accept', { version: (await who.get('/v1/classifieds/terms')).json.version });
    assert.equal((await who.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: "Ada's Gadget Hub", vat_bps: 0 } })).status, 201);
    const me = await who.get('/v1/pos/owner');
    who.till = me.json.account.shops[0].tills[0];
    who.mode = me.json.account.mode;
    who.account = me.json.account.id;
  }
  return who;
}

async function product(owner, title, { price = 500_000, stock = 10 } = {}) {
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
  const made = await owner.post('/v1/classifieds/listings', { title, price, category_id: category.id, stock, pos_enabled: true, on_shop: false });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return (await owner.post(`/v1/classifieds/listings/${made.json.id}/submit`)).json;
}

const sell = (owner, tv, payments, extra = {}) => {
  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  return owner.post('/v1/pos/owner/sales', { till_id: owner.till.id, client_sale_id: randomUUID(), lines: [{ listing_id: tv.id, quantity: total / 500_000 }], payments, expected_total: total, ...extra });
};

async function fund(customerId, mode, amount) {
  await ledger.post({ mode, type: 'adjustment', reference: `test-fund:${randomUUID()}`, description: 'Test top-up', lines: [{ account: { kind: 'adjustments', currency: 'NGN' }, debit: BigInt(amount) }, { account: { kind: 'customer_wallet', currency: 'NGN', customerId }, credit: BigInt(amount) }] });
}

describe('the shop’s own customers', () => {
  test('are added with no Udozo account, found by name, number or mobile, and kept once they have history', async () => {
    const owner = await person({ pos: true });
    const added = await owner.post('/v1/pos/owner/customers', { name: '  Mama  Nkechi ', phone: '0803 555 0101', email: 'Nkechi@Example.com', notes: 'Buys on Fridays' });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual([added.json.name, added.json.phone, added.json.email, added.json.udozo, added.json.udozo_rating, added.json.number.startsWith('C-')], ['Mama Nkechi', '+2348035550101', 'nkechi@example.com', false, null, true]);
    assert.equal((await owner.post('/v1/pos/owner/customers', { name: 'Someone else', phone: '+2348035550101' })).json.error.code, 'customer_phone_taken');
    assert.equal((await owner.post('/v1/pos/owner/customers', { name: '' })).json.error.code, 'parameter_missing');

    for (const q of ['nkechi', '5550101', added.json.number]) assert.equal((await owner.get(`/v1/pos/owner/customers?q=${encodeURIComponent(q)}`)).json.total, 1, q);
    assert.equal((await owner.patch(`/v1/pos/owner/customers/${added.json.id}`, { credit_limit: 1_000_000 })).json.credit_limit, 1_000_000);

    const tv = await product(owner, 'Hisense 32 inch TV');
    assert.equal((await sell(owner, tv, [{ method: 'cash', amount: 500_000 }], { customer_id: added.json.id })).status, 201);
    const seen = await owner.get(`/v1/pos/owner/customers/${added.json.id}`);
    assert.deepEqual([seen.json.sales_count, seen.json.spent, seen.json.sales.length], [1, 500_000, 1]);
    assert.equal((await owner.del(`/v1/pos/owner/customers/${added.json.id}`)).json.error.code, 'customer_in_use');
    const spare = await owner.post('/v1/pos/owner/customers', { name: 'Walk-in' });
    assert.equal((await owner.del(`/v1/pos/owner/customers/${spare.json.id}`)).status, 204);

    // Another shop never sees them.
    const other = await person({ pos: true });
    assert.equal((await other.get(`/v1/pos/owner/customers/${added.json.id}`)).status, 404);
    assert.equal((await sell(other, await product(other, 'LG TV'), [{ method: 'cash', amount: 500_000 }], { customer_id: added.json.id })).json.error.code, 'customer_unknown');
  });

  test('pay later: a customer owes the credit part, within their limit, repaid at the counter; a refund takes it off', async () => {
    const owner = await person({ pos: true });
    const tv = await product(owner, 'TCL 43 inch TV');
    const customer = (await owner.post('/v1/pos/owner/customers', { name: 'Chief Okoro', credit_limit: 800_000 })).json;

    assert.equal((await sell(owner, tv, [{ method: 'credit', amount: 500_000 }])).json.error.code, 'customer_required');
    const onCredit = await sell(owner, tv, [{ method: 'cash', amount: 200_000 }, { method: 'credit', amount: 800_000 }], { customer_id: customer.id });
    assert.equal(onCredit.status, 201, JSON.stringify(onCredit.json));
    assert.deepEqual(onCredit.json.payments.map(p => p.method), ['cash', 'credit']);
    assert.equal((await sell(owner, tv, [{ method: 'credit', amount: 500_000 }], { customer_id: customer.id })).json.error.code, 'credit_limit_reached');

    assert.equal((await owner.post(`/v1/pos/owner/customers/${customer.id}/repayments`, { amount: 900_000, method: 'cash' })).json.error.code, 'repayment_too_much');
    const repaid = await owner.post(`/v1/pos/owner/customers/${customer.id}/repayments`, { amount: 300_000, method: 'transfer', reference: 'TRF 991' });
    assert.equal(repaid.status, 200, JSON.stringify(repaid.json));
    assert.equal(repaid.json.owed, 500_000);
    assert.deepEqual(repaid.json.entries.map(e => [e.kind, e.amount, e.owed_after]), [['repayment', -300_000, 500_000], ['credit_sale', 800_000, 800_000]]);
    assert.deepEqual((await owner.get('/v1/pos/owner/customers?owing=true')).json.summary, { owing: 1, owed: 500_000 });

    // Refunding the sale takes off what it put on credit, as far as it is still owed.
    assert.equal((await owner.post(`/v1/pos/owner/sales/${onCredit.json.id}/refund`, { reason: 'Returned' })).status, 200);
    const after = (await owner.get(`/v1/pos/owner/customers/${customer.id}`)).json;
    assert.deepEqual([after.owed, after.spent, after.entries[0].kind, after.entries[0].amount], [0, 0, 'refund', -500_000]);
  });
});

describe('Udozo customers paying through Udozo', () => {
  test('join the shop’s customers on the way, linked to their account, with their Udozo rating', async () => {
    const owner = await person({ pos: true });
    const tv = await product(owner, 'Samsung 50 inch TV');
    const buyer = await person({ name: 'Bola Ade' });
    await fund(buyer.id, owner.mode, 5_000_000);

    const ask = extra => owner.post('/v1/pos/owner/wallet-requests', { till_id: owner.till.id, client_sale_id: randomUUID(), lines: [{ listing_id: tv.id, quantity: 1 }], payments: [], wallet_amount: 500_000, expected_total: 500_000, ...extra });
    const qr = await ask();
    assert.equal((await buyer.post(`/v1/store/account/pos-payments/${qr.json.token}/pay`, { expected_amount: 500_000 })).status, 200);
    const list = (await owner.get('/v1/pos/owner/customers')).json;
    assert.equal(list.total, 1);
    const record = (await owner.get(`/v1/pos/owner/customers/${list.data[0].id}`)).json;
    assert.deepEqual([record.name, record.phone, record.email, record.udozo, record.source, record.sales_count], ['Bola Ade', buyer.phone, null, true, 'udozo', 1]);
    assert.ok(record.udozo_rating.member_since, 'their Udozo rating');
    assert.equal(record.udozo_rating.in_good_standing, true);

    // Paying again (asked by their number this time) finds the same record.
    const byPhone = await ask({ phone: buyer.phone });
    assert.equal(byPhone.status, 201, JSON.stringify(byPhone.json));
    assert.equal((await owner.get('/v1/pos/owner/customers')).json.total, 1);
    await buyer.post(`/v1/store/account/pos-payments/${byPhone.json.token}/pay`, { expected_amount: 500_000 });
    assert.equal((await owner.get(`/v1/pos/owner/customers/${record.id}`)).json.sales_count, 2);
  });

  test('a customer the cashier chose becomes linked to the Udozo account that paid', async () => {
    const owner = await person({ pos: true });
    const tv = await product(owner, 'Sony 55 inch TV');
    const buyer = await person({ name: 'Efe Johnson' });
    await fund(buyer.id, owner.mode, 1_000_000);
    const chosen = (await owner.post('/v1/pos/owner/customers', { name: 'Efe (regular)' })).json;
    const asked = await owner.post('/v1/pos/owner/wallet-requests', { till_id: owner.till.id, client_sale_id: randomUUID(), lines: [{ listing_id: tv.id, quantity: 1 }], payments: [], wallet_amount: 500_000, expected_total: 500_000, customer_id: chosen.id });
    assert.equal((await buyer.post(`/v1/store/account/pos-payments/${asked.json.token}/pay`, { expected_amount: 500_000 })).status, 200);
    const record = (await owner.get(`/v1/pos/owner/customers/${chosen.id}`)).json;
    assert.deepEqual([record.name, record.udozo, record.sales_count], ['Efe (regular)', true, 1]);
    assert.equal((await owner.get('/v1/pos/owner/customers')).json.total, 1);
  });
});

describe('Udozo’s admins', () => {
  test('read a shop’s customers under its POS account', async () => {
    const owner = await person({ pos: true });
    const added = (await owner.post('/v1/pos/owner/customers', { name: 'Aunty Grace', phone: '0803 555 0199' })).json;
    const list = await admin.get(`/v1/admin/pos/accounts/${owner.account}/customers`);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.deepEqual(list.json.data.map(c => c.name), ['Aunty Grace']);
    const one = await admin.get(`/v1/admin/pos/accounts/${owner.account}/customers/${added.id}`);
    assert.deepEqual([one.json.phone, one.json.entries, one.json.sales], ['+2348035550199', [], []]);
    const other = await person({ pos: true });
    assert.equal((await admin.get(`/v1/admin/pos/accounts/${other.account}/customers/${added.id}`)).status, 404);
  });
});
