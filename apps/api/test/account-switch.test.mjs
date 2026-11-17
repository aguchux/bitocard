// Moving a person between BitoCard's two kinds of account from the admin app: a reseller's owner becomes a
// bitocard.com customer (same email and password; the reseller suspended when asked, never while money is held), and a
// bitocard.com customer becomes the owner of a new pending reseller account (the customer account stays).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let operations;
let support;
let outbox;
let prisma;

const password = 'correct horse battery';

/** bitocard.com's own store, as its server calls it (no store named). */
async function store(path, body, token) {
  const res = await fetch(`${server.base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...(token ? { 'bitocard-customer-session': token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function shopSignIn(path, body) {
  const res = await fetch(`${server.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify(body) });
  return res.status;
}

before(async () => {
  server = await startApp();
  operations = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
  const { EmailService } = await import('../dist/notifications/email.service.js');
  outbox = server.app.get(EmailService).outbox;
  const { PrismaService } = await import('../dist/database/prisma.service.js');
  prisma = server.app.get(PrismaService);
});

after(async () => {
  await server?.close();
});

describe('reseller to customer', () => {
  test('the owner gets a bitocard.com customer account with the same email and password, and the reseller can be suspended', async () => {
    const reseller = await resellerClient(server, { country: 'NG' });
    const path = `/v1/admin/resellers/${reseller.resellerId}/make-customer`;

    const preview = await support.get(path);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.deepEqual([preview.json.owner.email, preview.json.existing_customer_id, preview.json.holds_money], [reseller.email, null, false]);
    assert.equal((await support.post(path, { reason: 'Meant to buy' })).status, 403, 'support only reads');

    const made = await operations.post(path, { reason: 'Meant to buy', suspend_reseller: true });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.deepEqual([made.json.customer.created, made.json.reseller.status], [true, 'suspended']);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: made.json.customer.id } });
    assert.deepEqual([customer.email, customer.country], [reseller.email, 'NG']);
    assert.equal(await shopSignIn('/v1/store/account/signin', { email: reseller.email, password }), 200, 'the same password signs in');
    assert.equal(outbox.findLast(item => item.to === reseller.email).subject, 'Your BitoCard customer account is ready');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'reseller.made_customer', targetId: reseller.resellerId } }));

    // Again: the customer already exists, so nothing new is made.
    const again = await operations.post(path, { reason: 'Again' });
    assert.deepEqual([again.json.customer.id, again.json.customer.created], [customer.id, false]);
  });

  test('a reseller BitoCard holds money for is never suspended here', async () => {
    const reseller = await resellerClient(server, { country: 'GH' });
    await prisma.ledgerAccount.create({
      data: { kind: 'reseller_funding', mode: 'live', currency: 'GHS', ownerKey: `reseller:${reseller.resellerId}`, resellerId: reseller.resellerId, balanceMinor: 500n, nonNegative: true },
    });
    const path = `/v1/admin/resellers/${reseller.resellerId}/make-customer`;
    assert.equal((await operations.get(path)).json.holds_money, true);
    const refused = await operations.post(path, { reason: 'Meant to buy', suspend_reseller: true });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'reseller_holds_money']);
    assert.equal((await prisma.reseller.findUniqueOrThrow({ where: { id: reseller.resellerId } })).status, 'pending');
    // Without suspending, the customer account is still made.
    const made = await operations.post(path, { reason: 'Meant to buy' });
    assert.deepEqual([made.status, made.json.reseller.status], [200, 'pending']);
  });
});

describe('customer to reseller', () => {
  test('a bitocard.com customer owns a new pending reseller account, signs in to Seller HQ with the same password, and stays a customer', async () => {
    const email = `buyer-${Date.now()}@example.com`;
    const signup = await store('/v1/store/account/signup', { name: 'Chi Okafor', email, password, country: 'NG' });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    const path = `/v1/admin/storefront/customers/${signup.json.customer.id}/make-reseller`;

    const preview = await support.get(path);
    assert.deepEqual([preview.json.existing_reseller_id, preview.json.country_open, preview.json.seller_hq_person], [null, true, false]);

    assert.equal((await operations.post(path, { reason: 'Wants to sell' })).status, 400, 'a business name is needed');
    const made = await operations.post(path, { business_name: 'Chi Gifts', reason: 'Wants to sell' });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    assert.deepEqual([made.json.reseller.name, made.json.reseller.status, made.json.user.created], ['Chi Gifts', 'pending', true]);

    const owner = await prisma.resellerMember.findFirstOrThrow({ where: { resellerId: made.json.reseller.id }, include: { user: true } });
    assert.deepEqual([owner.role, owner.user.email, owner.user.realm], ['owner', email, 'reseller']);
    assert.equal(await shopSignIn('/v1/auth/signin', { identifier: email, password }), 200, 'the same password signs in to Seller HQ');
    assert.equal(await shopSignIn('/v1/store/account/signin', { email, password }), 200, 'still a customer');
    assert.equal(outbox.findLast(item => item.to === email).subject, 'Your BitoCard reseller account is ready');

    const again = await operations.post(path, { business_name: 'Chi Gifts 2', reason: 'Again' });
    assert.deepEqual([again.status, again.json.error.code], [409, 'already_reseller']);
    assert.equal((await support.get(path)).json.existing_reseller_id, made.json.reseller.id);
  });

  test("a reseller's customer is not bitocard.com's", async () => {
    assert.equal((await operations.get(`/v1/admin/storefront/customers/${randomUUID()}/make-reseller`)).status, 404);
  });
});
