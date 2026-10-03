// What SHQ needs from the API: a signed-in person changes their name, password and sign-in email; every team member
// can read pricing; the public country view gives resellers their money rules; plans are never changed in sandbox mode.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;
let outbox;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  outbox = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox;
});

after(async () => {
  await server?.close();
});

/** Signs the same person in again in another "browser", to check what happens to other sessions. */
async function secondSession(email, password = 'correct horse battery') {
  const other = client(server.base);
  assert.equal((await other.post('/v1/auth/signin', { identifier: email, password })).status, 200);
  return other;
}

describe('profile', () => {
  test('a signed-in person changes their name', async () => {
    const { browser } = await resellerClient(server);
    const res = await browser.patch('/v1/auth/profile', { name: '  Ada N. Obi ' });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.user.name, 'Ada N. Obi');
    assert.equal((await browser.patch('/v1/auth/profile', { name: 'A' })).status, 400);
  });

  test('changing the password needs the current one, signs out other sessions and keeps this one', async () => {
    const { browser, email } = await resellerClient(server);
    const other = await secondSession(email);

    const wrong = await browser.post('/v1/auth/password/change', { current_password: 'not my password', new_password: 'a brand new passphrase' });
    assert.deepEqual([wrong.status, wrong.json.error.code, wrong.json.error.param], [400, 'password_incorrect', 'current_password']);
    assert.equal((await prisma.user.findFirstOrThrow({ where: { email } })).failedSignIns, 1, 'counts towards the lockout');

    const done = await browser.post('/v1/auth/password/change', { current_password: 'correct horse battery', new_password: 'a brand new passphrase' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal((await browser.get('/v1/auth/session')).status, 200, 'this session stays signed in');
    assert.equal((await other.get('/v1/auth/session')).status, 401, 'other sessions are signed out');
    assert.equal((await prisma.user.findFirstOrThrow({ where: { email } })).failedSignIns, 0);
    assert.ok(outbox.some(message => message.to === email && /password was changed/i.test(message.subject)));
    // The new password works; the old one does not.
    assert.equal((await client(server.base).post('/v1/auth/signin', { identifier: email, password: 'correct horse battery' })).status, 401);
    await secondSession(email, 'a brand new passphrase');
  });

  test('five wrong current passwords lock the account like sign-in does', async () => {
    const { browser } = await resellerClient(server);
    for (let i = 0; i < 5; i += 1) await browser.post('/v1/auth/password/change', { current_password: `wrong ${i}`, new_password: 'a brand new passphrase' });
    const locked = await browser.post('/v1/auth/password/change', { current_password: 'correct horse battery', new_password: 'a brand new passphrase' });
    assert.deepEqual([locked.status, locked.json.error.code], [429, 'account_locked']);
  });

  test('changing the sign-in email: password, then a code sent to the new address; the old address is told', async () => {
    const { browser, email } = await resellerClient(server);
    const next = `changed-${Date.now()}@example.com`;
    assert.equal((await browser.post('/v1/auth/email/change', { email: next, password: 'wrong password' })).json.error.code, 'password_incorrect');
    const sent = await browser.post('/v1/auth/email/change', { email: next, password: 'correct horse battery' });
    assert.equal(sent.status, 202, JSON.stringify(sent.json));
    const code = await lastEmailCode(server.app, next);
    assert.match(code ?? '', /^\d{6}$/);

    // Nothing changes until the code is confirmed.
    assert.equal((await browser.get('/v1/auth/session')).json.user.email, email);
    const wrong = await browser.post('/v1/auth/email/change/verify', { code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.json.error.code, 'code_invalid');
    const confirmed = await browser.post('/v1/auth/email/change/verify', { code });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.deepEqual([confirmed.json.user.email, confirmed.json.user.email_verified], [next, true]);
    assert.ok(outbox.some(message => message.to === email && message.subject === 'Your BitoCard sign-in email was changed'));

    // The new address signs in; the old one no longer does.
    await secondSession(next);
    assert.equal((await client(server.base).post('/v1/auth/signin', { identifier: email, password: 'correct horse battery' })).status, 401);
  });

  test("another account's email cannot be taken, and the same email is refused", async () => {
    const first = await resellerClient(server);
    const second = await resellerClient(server);
    const taken = await second.browser.post('/v1/auth/email/change', { email: first.email, password: 'correct horse battery' });
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'email_in_use']);
    const same = await second.browser.post('/v1/auth/email/change', { email: second.email, password: 'correct horse battery' });
    assert.equal(same.json.error.code, 'email_unchanged');
  });

  test('an account without a password (Google only) is told to set one first', async () => {
    const { browser, email } = await resellerClient(server);
    await prisma.user.updateMany({ where: { email }, data: { passwordHash: null } });
    const res = await browser.post('/v1/auth/password/change', { current_password: 'x', new_password: 'a brand new passphrase' });
    assert.deepEqual([res.status, res.json.error.code], [409, 'password_not_set']);
  });
});

describe('what every team member can read', () => {
  /** A second person added to the reseller with a role; they act for it with the BitoCard-Reseller header. */
  async function member(resellerId, role) {
    const person = await resellerClient(server);
    await prisma.resellerMember.create({ data: { resellerId, userId: person.userId, role } });
    const as = { 'bitocard-reseller': resellerId };
    return {
      get: path => person.browser.get(path, as),
      put: (path, body) => person.browser.put(path, body, as),
      post: (path, body, headers = {}) => person.browser.post(path, body, { ...as, ...headers }),
    };
  }

  test('pricing is readable by every role; only owners and admins change markups; product markups name the product', async () => {
    const owner = await resellerClient(server);
    const product = await prisma.product.create({ data: { key: `gift_cards:US:test-${Date.now()}`, category: 'gift_cards', country: 'US', brand: 'test', name: 'Test Card US', faceCurrency: 'USD', denominationType: 'fixed', fixedValues: [1000n] } });
    const set = await owner.browser.put('/v1/pricing/markups', { category: 'gift_cards', product_id: product.id, markup_bps: 500 });
    assert.equal(set.status, 200, JSON.stringify(set.json));

    const support = await member(owner.resellerId, 'support');
    const read = await support.get('/v1/pricing');
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.equal(read.json.markup_cap_percent, 50);
    assert.deepEqual(read.json.markups.find(m => m.product_id === product.id), { category: 'gift_cards', product_id: product.id, product_name: 'Test Card US', markup_bps: 500 });
    assert.equal((await support.put('/v1/pricing/markups', { category: 'gift_cards', markup_bps: 100 })).status, 403);
  });

  test('the public country view gives resellers their money rules', async () => {
    const { json } = await client(server.base).get('/v1/countries/NG');
    assert.deepEqual(
      [typeof json.reserved_accounts, json.markup_cap_percent, typeof json.payout_hold_days, typeof json.min_withdrawal_minor],
      ['boolean', 50, 'number', 'number'],
    );
    assert.ok(json.categories.every(category => !('taxable' in category)), 'admin-only fields stay private');
  });

  test('plans are paid from the live wallet, so the sandbox refuses a plan change', async () => {
    const owner = await resellerClient(server);
    const res = await owner.browser.post('/v1/subscription', { plan: 'premium' }, { 'bitocard-mode': 'test' });
    assert.deepEqual([res.status, res.json.error.code], [409, 'live_only']);
    assert.equal((await owner.browser.get('/v1/subscription')).json.plan.code, 'standard');
  });
});
