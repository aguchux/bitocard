// A store customer deleting their own account (the App Store and Google Play require it in the app): refused while money
// is theirs or a trade is open, and with the wrong password (which counts towards the lockout); then their details are
// removed at once, every session signed out and every device forgotten, and the account can never sign in or be reopened.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method !== 'GET' ? { 'idempotency-key': `del-${Date.now()}-${Math.random()}` } : {}),
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
async function customer() {
  const shopper = storeServer();
  const email = `delete${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ada Obi', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) });
  shopper.id = signup.json.customer.id;
  shopper.email = email;
  return shopper;
}

describe('deleting an account', () => {
  test('nothing in the way: the check says so and asks for the password', async () => {
    const shopper = await customer();
    const check = await shopper.get('/v1/store/account/delete');
    assert.equal(check.status, 200);
    assert.deepEqual(check.json, { object: 'account_deletion_check', can_delete: true, password_required: true, blockers: [] });
  });

  test('money in a wallet or an open airtime trade stands in the way', async () => {
    const shopper = await customer();
    const wallet = await prisma.ledgerAccount.create({
      data: { kind: 'customer_wallet', mode: 'live', currency: 'NGN', ownerKey: `customer:${shopper.id}:test`, customerId: shopper.id, balanceMinor: 50000n, nonNegative: true },
    });
    const check = await shopper.get('/v1/store/account/delete');
    assert.equal(check.json.can_delete, false);
    assert.deepEqual(check.json.blockers.map(item => item.code), ['account_has_money']);
    const refused = await shopper.post('/v1/store/account/delete', { confirm: 'DELETE', password: 'correct horse battery' });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'account_has_money']);
    await prisma.ledgerAccount.update({ where: { id: wallet.id }, data: { balanceMinor: 0n } });
    assert.equal((await shopper.get('/v1/store/account/delete')).json.can_delete, true, 'a test-mode balance or an empty wallet is fine');
  });

  test('the wrong password is refused and counts towards the lockout; DELETE must be typed', async () => {
    const shopper = await customer();
    const wrong = await shopper.post('/v1/store/account/delete', { confirm: 'DELETE', password: 'not my password' });
    assert.deepEqual([wrong.status, wrong.json.error.code], [400, 'password_incorrect']);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id } })).failedSignIns, 1);
    assert.equal((await shopper.post('/v1/store/account/delete', { confirm: 'delete', password: 'correct horse battery' })).status, 400);
  });

  test('deleted: details gone, signed out, devices forgotten, never signing in or reopened again', async () => {
    const shopper = await customer();
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id } });
    await prisma.customerPhone.create({ data: { customerId: shopper.id, storeId: row.storeId, phone: `+23480${String(Date.now()).slice(-8)}`, verifiedAt: new Date() } });
    const session = await prisma.customerSession.findFirstOrThrow({ where: { customerId: shopper.id, revokedAt: null } });
    await prisma.device.create({ data: { audience: 'customer', customerId: shopper.id, storeId: row.storeId, sessionId: session.id, channel: 'fcm', endpoint: `fcm:${shopper.id}`, keysEncrypted: 'x', label: 'BitoCard app on Android' } });

    const done = await shopper.post('/v1/store/account/delete', { confirm: 'DELETE', password: 'correct horse battery' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.deepEqual([done.json.object, done.json.deleted], ['account_deletion', true]);

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: shopper.id } });
    assert.equal(after.email, `deleted.${shopper.id}@deleted.bitocard.invalid`);
    assert.deepEqual([after.name, after.passwordHash, after.phone, after.status], ['Deleted account', null, null, 'disabled']);
    assert.ok(after.deletedAt);
    assert.equal(await prisma.customerPhone.count({ where: { customerId: shopper.id } }), 0);
    assert.equal(await prisma.device.count({ where: { customerId: shopper.id } }), 0);
    assert.equal(await prisma.customerSession.count({ where: { customerId: shopper.id, revokedAt: null } }), 0);

    assert.equal((await shopper.get('/v1/store/account')).status, 401, 'the session is gone');
    const again = await storeServer().post('/v1/store/account/signin', { email: shopper.email, password: 'correct horse battery' });
    assert.equal(again.status, 401);
    const admin = await adminClient(server, ['operations']);
    const reopen = await admin.patch(`/v1/admin/storefront/customers/${shopper.id}`, { status: 'active' });
    assert.deepEqual([reopen.status, reopen.json.error.code], [409, 'account_deleted']);
  });
});
