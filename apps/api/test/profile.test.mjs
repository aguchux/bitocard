// What SHQ needs from the API: a signed-in person changes their name and password and manages their email addresses; every team member
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

  /** Adds a confirmed address with the code emailed to it (lets the one-a-minute resend rule pass first). */
  async function addEmail(browser, address) {
    await prisma.verificationCode.updateMany({ where: { purpose: 'email_change' }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const sent = await browser.post('/v1/auth/emails', { email: address });
    assert.equal(sent.status, 202, JSON.stringify(sent.json));
    return browser.post('/v1/auth/emails/verify', { code: await lastEmailCode(server.app, address) });
  }

  test('more email addresses are added with a code sent to each; the primary one is told', async () => {
    const { browser, email } = await resellerClient(server);
    await prisma.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const first = await browser.get('/v1/auth/emails');
    assert.deepEqual(first.json.data.map(item => [item.email, item.primary]), [[email, true]]);

    const work = `work-${Date.now()}@example.com`;
    const sent = await browser.post('/v1/auth/emails', { email: ` ${work.toUpperCase()} ` });
    assert.equal(sent.status, 202, JSON.stringify(sent.json));
    // Nothing is added until the code is confirmed.
    assert.equal((await browser.get('/v1/auth/emails')).json.data.length, 1);
    const code = await lastEmailCode(server.app, work);
    assert.match(code ?? '', /^\d{6}$/);
    const wrong = await browser.post('/v1/auth/emails/verify', { code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.json.error.code, 'code_invalid');
    const added = await browser.post('/v1/auth/emails/verify', { code });
    assert.equal(added.status, 200, JSON.stringify(added.json));
    assert.deepEqual(added.json.data.map(item => [item.email, item.primary, item.verified]), [
      [email, true, true],
      [work, false, true],
    ]);
    assert.ok(outbox.some(message => message.to === email && message.subject === 'An email address was added to your BitoCard account'));
    assert.ok(await prisma.notification.findFirst({ where: { type: 'security.email_added' } }));

    // The session still names the primary address, and only the primary signs in.
    assert.equal((await browser.get('/v1/auth/session')).json.user.email, email);
    assert.equal((await client(server.base).post('/v1/auth/signin', { identifier: work, password: 'correct horse battery' })).status, 401);

    const again = await browser.post('/v1/auth/emails', { email: work });
    assert.deepEqual([again.status, again.json.error.code], [409, 'email_already_added']);
    const primaryAgain = await browser.post('/v1/auth/emails', { email });
    assert.equal(primaryAgain.json.error.code, 'email_already_added');
  });

  test('the primary email cannot be removed or changed except by making another address primary', async () => {
    const { browser, email } = await resellerClient(server);
    await prisma.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
    const refused = await browser.delete(`/v1/auth/emails/${encodeURIComponent(email)}`);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'primary_email']);
    const notMine = await browser.post('/v1/auth/emails/primary', { email: `never-added-${Date.now()}@example.com`, password: 'correct horse battery' });
    assert.equal(notMine.status, 404, 'only a confirmed address of yours can become primary');
    assert.equal((await browser.post('/v1/auth/email/change', { email: 'x@example.com', password: 'correct horse battery' })).status, 404, 'the old direct change is gone');

    const next = `next-${Date.now()}@example.com`;
    await addEmail(browser, next);
    const noPassword = await browser.post('/v1/auth/emails/primary', { email: next });
    assert.deepEqual([noPassword.status, noPassword.json.error.param], [400, 'password']);
    const wrong = await browser.post('/v1/auth/emails/primary', { email: next, password: 'wrong password' });
    assert.equal(wrong.json.error.code, 'password_incorrect');

    const swapped = await browser.post('/v1/auth/emails/primary', { email: next, password: 'correct horse battery' });
    assert.equal(swapped.status, 200, JSON.stringify(swapped.json));
    assert.deepEqual(swapped.json.data.map(item => [item.email, item.primary]), [
      [next, true],
      [email, false],
    ]);
    assert.equal((await browser.get('/v1/auth/session')).json.user.email, next);
    assert.ok(outbox.some(message => message.to === email && message.subject === 'Your BitoCard sign-in email was changed'));
    // The new primary signs in; the old one is kept as another address but no longer signs in.
    await secondSession(next);
    assert.equal((await client(server.base).post('/v1/auth/signin', { identifier: email, password: 'correct horse battery' })).status, 401);

    const removed = await browser.delete(`/v1/auth/emails/${encodeURIComponent(email)}`);
    assert.deepEqual(removed.json.data.map(item => item.email), [next]);
    assert.equal((await browser.delete(`/v1/auth/emails/${encodeURIComponent(email)}`)).status, 404);
  });

  test('an address belongs to one person: taken addresses are refused, and sign-up refuses other addresses too', async () => {
    const first = await resellerClient(server);
    const second = await resellerClient(server);
    const taken = await second.browser.post('/v1/auth/emails', { email: first.email });
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'email_in_use']);

    const extra = `extra-${Date.now()}@example.com`;
    await addEmail(first.browser, extra);
    assert.equal((await second.browser.post('/v1/auth/emails', { email: extra })).json.error.code, 'email_in_use');
    const signup = await client(server.base).post('/v1/auth/signup', { name: 'Someone Else', email: extra, password: 'correct horse battery', country: 'NG', business_name: 'Else' }, { 'idempotency-key': `s-${Date.now()}` });
    assert.deepEqual([signup.status, signup.json.error.code], [409, 'email_in_use']);
    const code = await client(server.base).post('/v1/auth/signup/email', { email: extra }, { 'idempotency-key': `c-${Date.now()}` });
    assert.deepEqual([code.status, code.json.error.code], [409, 'email_in_use']);
  });

  test('at most five addresses in all', async () => {
    const { browser } = await resellerClient(server);
    for (let i = 0; i < 4; i += 1) assert.equal((await addEmail(browser, `many-${i}-${Date.now()}@example.com`)).status, 200);
    await prisma.verificationCode.updateMany({ where: { purpose: 'email_change' }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const fifth = await browser.post('/v1/auth/emails', { email: `many-x-${Date.now()}@example.com` });
    assert.deepEqual([fifth.status, fifth.json.error.code], [409, 'too_many_emails']);
  });

  test('an account without a password (Google only) makes another address primary without one', async () => {
    const { browser, email } = await resellerClient(server);
    const other = `google-${Date.now()}@example.com`;
    await addEmail(browser, other);
    await prisma.user.updateMany({ where: { email }, data: { passwordHash: null } });
    const swapped = await browser.post('/v1/auth/emails/primary', { email: other });
    assert.equal(swapped.status, 200, JSON.stringify(swapped.json));
    assert.deepEqual(swapped.json.data.map(item => item.email), [other], 'an unconfirmed old primary is not kept');
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
