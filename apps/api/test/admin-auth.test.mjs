// Admin sign-in: company-domain email and password, then a required authenticator code (TOTP).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { AdminAuthService } from '../dist/auth/admin-auth.service.js';
import { client, startApp } from './helpers.mjs';

const password = 'admin passphrase long';
/** The addresses the set-password links may go to in these tests (ADMIN_SETUP_EMAILS). */
const setupEmails = ['link-new@bitocard.com', 'Link-Reset@bitocard.com', 'link-other@golojan.co.uk', 'outsider@gmail.com'];
let server;
let admins;

before(async () => {
  server = await startApp({
    env: { ENCRYPTION_KEY: randomBytes(32).toString('base64'), ADMIN_SETUP_EMAILS: setupEmails.join(','), ADMIN_APP_URL: 'https://admin.example.test' },
  });
  admins = server.app.get(AdminAuthService);
});

after(() => server?.close());

let counter = 0;
async function createAdmin(domain = 'bitocard.com') {
  const email = `admin${(counter += 1)}-${Date.now()}@${domain}`;
  await admins.createAdmin({ email, name: 'Ops Lead', password, roles: ['operations'] });
  return email;
}

const totpFor = (secret, email) => new TOTP({ issuer: 'BitoCard Admin', label: email, secret: Secret.fromBase32(secret) });
/** A code for an adjacent 30-second step, so two sign-ins in one test do not reuse the same step. */
const codeAt = (secret, email, offsetSteps) => totpFor(secret, email).generate({ timestamp: Date.now() + offsetSteps * 30_000 });

/**
 * Waits out the last seconds of a 30-second step. The first sign-in uses the previous step's code (so later sign-ins can
 * use the current and next ones); made at the very end of a step it would be two steps old by the time it is checked,
 * outside the server's window of one.
 */
async function awayFromStepEdge() {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 3000) await new Promise(resolve => setTimeout(resolve, left + 100));
}

/** First sign-in: password, authenticator setup, first code. Returns the browser, secret and recovery codes. */
async function firstSignIn(email) {
  await awayFromStepEdge();
  const browser = client(server.base);
  const step1 = await browser.post('/v1/admin/auth/signin', { email, password });
  assert.equal(step1.status, 200);
  assert.equal(step1.json.mfa_setup_required, true);
  const setup = await browser.post('/v1/admin/auth/mfa/setup', { challenge_token: step1.json.challenge_token });
  assert.equal(setup.status, 200);
  const verify = await browser.post('/v1/admin/auth/mfa/verify', { challenge_token: step1.json.challenge_token, code: codeAt(setup.json.secret, email, -1) });
  assert.equal(verify.status, 200, JSON.stringify(verify.json));
  return { browser, secret: setup.json.secret, recoveryCodes: verify.json.recovery_codes, setup: setup.json };
}

describe('creating admins', () => {
  test('only company domains and known roles are accepted', async () => {
    await assert.rejects(admins.createAdmin({ email: 'someone@gmail.com', name: 'X', password, roles: ['support'] }), /Admins must use/);
    await assert.rejects(admins.createAdmin({ email: 'x@bitocard.com', name: 'X', password, roles: ['owner'] }), /Roles must be/);
    await createAdmin('golojan.co.uk');
  });
});

describe('first sign-in', () => {
  test('sets up the authenticator, returns 10 one-time recovery codes and starts an admin session', async () => {
    const email = await createAdmin();
    const { browser, recoveryCodes, setup } = await firstSignIn(email);
    assert.match(setup.otpauth_uri, /^otpauth:\/\/totp\/BitoCard%20Admin:/);
    assert.equal(recoveryCodes.length, 10);
    assert.ok(recoveryCodes.every(code => /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code)));
    const session = await browser.get('/v1/admin/auth/session');
    assert.equal(session.status, 200);
    assert.deepEqual([session.json.admin.email, session.json.admin.roles], [email, ['operations']]);
    assert.ok(browser.jar.has('bc_admin_session'));
  });

  test('the password alone never starts a session', async () => {
    const email = await createAdmin();
    const browser = client(server.base);
    await browser.post('/v1/admin/auth/signin', { email, password });
    assert.equal((await browser.get('/v1/admin/auth/session')).status, 401);
  });
});

describe('later sign-ins', () => {
  test('need a fresh authenticator code; setup cannot be repeated', async () => {
    const email = await createAdmin();
    const { secret } = await firstSignIn(email);
    const browser = client(server.base);
    const step1 = await browser.post('/v1/admin/auth/signin', { email, password });
    assert.equal(step1.json.mfa_setup_required, false);
    const again = await browser.post('/v1/admin/auth/mfa/setup', { challenge_token: step1.json.challenge_token });
    assert.equal(again.json.error.code, 'mfa_already_set_up');
    const verify = await browser.post('/v1/admin/auth/mfa/verify', { challenge_token: step1.json.challenge_token, code: codeAt(secret, email, 0) });
    assert.equal(verify.status, 200);
    assert.equal(verify.json.recovery_codes, undefined, 'recovery codes are shown only once');
  });

  test('the same code cannot be used twice', async () => {
    const email = await createAdmin();
    const { secret } = await firstSignIn(email);
    const code = codeAt(secret, email, 0);
    const first = await client(server.base).post('/v1/admin/auth/signin', { email, password });
    assert.equal((await client(server.base).post('/v1/admin/auth/mfa/verify', { challenge_token: first.json.challenge_token, code })).status, 200);
    const second = await client(server.base).post('/v1/admin/auth/signin', { email, password });
    const replay = await client(server.base).post('/v1/admin/auth/mfa/verify', { challenge_token: second.json.challenge_token, code });
    assert.deepEqual([replay.status, replay.json.error.code], [400, 'mfa_code_invalid']);
  });

  test('a recovery code works once', async () => {
    const email = await createAdmin();
    const { recoveryCodes } = await firstSignIn(email);
    const first = await client(server.base).post('/v1/admin/auth/signin', { email, password });
    const ok = await client(server.base).post('/v1/admin/auth/mfa/verify', { challenge_token: first.json.challenge_token, code: recoveryCodes[0] });
    assert.equal(ok.status, 200);
    const second = await client(server.base).post('/v1/admin/auth/signin', { email, password });
    const reused = await client(server.base).post('/v1/admin/auth/mfa/verify', { challenge_token: second.json.challenge_token, code: recoveryCodes[0] });
    assert.equal(reused.json.error.code, 'mfa_code_invalid');
  });

  test('five wrong codes end the challenge', async () => {
    const email = await createAdmin();
    const { secret } = await firstSignIn(email);
    const step1 = await client(server.base).post('/v1/admin/auth/signin', { email, password });
    const token = step1.json.challenge_token;
    for (let n = 0; n < 5; n += 1) await client(server.base).post('/v1/admin/auth/mfa/verify', { challenge_token: token, code: '000000' });
    const late = await client(server.base).post('/v1/admin/auth/mfa/verify', { challenge_token: token, code: codeAt(secret, email, 1) });
    assert.deepEqual([late.status, late.json.error.code], [401, 'challenge_invalid']);
  });

  test('a forged challenge token is refused', async () => {
    const res = await client(server.base).post('/v1/admin/auth/mfa/verify', { challenge_token: `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.forgedtokenvalue123456`, code: '123456' });
    assert.equal(res.json.error.code, 'challenge_invalid');
  });
});

describe('separation from resellers', () => {
  test('wrong passwords, unknown and non-company emails all get the same answer', async () => {
    const email = await createAdmin();
    const wrong = await client(server.base).post('/v1/admin/auth/signin', { email, password: 'wrong password' });
    const gmail = await client(server.base).post('/v1/admin/auth/signin', { email: 'boss@gmail.com', password });
    assert.deepEqual([wrong.status, wrong.json.error.code], [401, 'invalid_credentials']);
    assert.deepEqual([gmail.status, gmail.json.error.code], [401, 'invalid_credentials']);
  });

  test('reseller accounts cannot sign in as admins, and sessions do not cross realms', async () => {
    const reseller = client(server.base);
    const email = `reseller-${Date.now()}@bitocard.com`;
    await reseller.post('/v1/auth/signup', { name: 'Ada', email, password, country: 'NG' });
    const asAdmin = await client(server.base).post('/v1/admin/auth/signin', { email, password });
    assert.equal(asAdmin.status, 401, 'reseller credentials are not admin credentials');
    assert.equal((await reseller.get('/v1/admin/auth/session')).status, 401, 'a reseller session cannot reach admin endpoints');

    const { browser: admin } = await firstSignIn(await createAdmin());
    assert.equal((await admin.get('/v1/auth/session')).status, 401, 'an admin session cannot reach reseller endpoints');
  });

  test('signing out ends the admin session', async () => {
    const { browser } = await firstSignIn(await createAdmin());
    assert.equal((await browser.post('/v1/admin/auth/signout')).status, 204);
    assert.equal((await browser.get('/v1/admin/auth/session')).status, 401);
  });
});

describe('configuration', () => {
  test('admin sign-in refuses to run without an encryption key', async () => {
    const app = await startApp({ env: { ENCRYPTION_KEY: '' }, database: 'pglite' });
    try {
      const email = `admin-${Date.now()}@bitocard.com`;
      await app.app.get(AdminAuthService).createAdmin({ email, name: 'Ops', password, roles: ['support'] });
      const browser = client(app.base);
      const step1 = await browser.post('/v1/admin/auth/signin', { email, password });
      const setup = await browser.post('/v1/admin/auth/mfa/setup', { challenge_token: step1.json.challenge_token });
      assert.deepEqual([setup.status, setup.json.error.code], [503, 'encryption_not_configured']);
    } finally {
      await app.close();
    }
  });
});

/** Emails sent to an address (the outbox: no email provider in tests). */
async function emailsTo(email) {
  const { EmailService } = await import('../dist/notifications/email.service.js');
  return server.app.get(EmailService).outbox.filter(item => item.to === email);
}

/** The token in the last set-password link emailed to an address. */
async function linkToken(email) {
  const message = (await emailsTo(email)).filter(item => /set-password#token=/.test(item.text)).at(-1);
  assert.ok(message, `no link emailed to ${email}`);
  assert.match(message.text, /https:\/\/admin\.example\.test\/set-password#token=/);
  return /#token=(\S+)/.exec(message.text)[1];
}

/** Lets the next link be sent at once (links are limited to one a minute per admin). */
async function pastLinkLimit(email) {
  const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  await prisma.verificationCode.updateMany({ where: { purpose: 'admin_password_link', user: { realm: 'admin', email } }, data: { createdAt: new Date(Date.now() - 2 * 60_000) } });
}

describe('the email step', () => {
  test('only an address in ADMIN_SETUP_EMAILS on an admin domain is set up; everyone else is asked for a password', async () => {
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    const browser = client(server.base);
    const existing = await createAdmin();
    for (const email of [existing, 'nobody@bitocard.com', 'someone@gmail.com', 'outsider@gmail.com']) {
      const step = await browser.post('/v1/admin/auth/start', { email });
      assert.deepEqual([step.status, step.json], [200, { object: 'admin_sign_in', next: 'password' }], email);
    }
    assert.equal(await prisma.user.count({ where: { realm: 'admin', email: { in: ['nobody@bitocard.com', 'outsider@gmail.com'] } } }), 0, 'nothing created');
    assert.equal((await emailsTo('outsider@gmail.com')).length, 0, 'listed, but not an admin domain');
    assert.equal((await browser.post('/v1/admin/auth/start', { email: 'not an email' })).status, 400);
  });

  test('a listed address with no account is set up as a super admin and emailed a link, at most once a minute', async () => {
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    const email = 'link-new@bitocard.com';
    const first = await client(server.base).post('/v1/admin/auth/start', { email: 'LINK-NEW@bitocard.com' });
    assert.deepEqual(first.json, { object: 'admin_sign_in', next: 'link_sent' });
    const admin = await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email } });
    assert.deepEqual([admin.name, admin.adminRoles, admin.passwordHash], ['Link New', ['super_admin'], null]);
    assert.match((await emailsTo(email)).at(-1).subject, /Set up your BitoCard admin account/);
    const again = await client(server.base).post('/v1/admin/auth/start', { email });
    assert.equal(again.json.next, 'link_sent', 'still no password');
    assert.equal((await emailsTo(email)).length, 1, 'no second email within a minute');
    assert.equal(await prisma.user.count({ where: { realm: 'admin', email } }), 1);
    const actions = (await prisma.auditLog.findMany({ where: { targetId: admin.id }, orderBy: { createdAt: 'asc' } })).map(entry => entry.action);
    assert.deepEqual(actions, ['admin.created', 'admin.password_link_sent']);
  });
});

describe('set-password links', () => {
  test('a new admin confirms their name and chooses a password with the link, which works once', async () => {
    const email = 'link-new@bitocard.com';
    const token = await linkToken(email);
    const browser = client(server.base);
    assert.equal((await browser.post('/v1/admin/auth/signin', { email, password })).status, 401, 'no password until the link is used');

    const described = await browser.post('/v1/admin/auth/password-link', { token });
    assert.equal(described.status, 200);
    assert.deepEqual(
      { ...described.json, expires_at: typeof described.json.expires_at },
      { object: 'admin_password_link', email, name: 'Link New', kind: 'create', authenticator_set_up: false, expires_at: 'string' },
    );
    assert.ok(Date.parse(described.json.expires_at) - Date.now() > 71 * 3600_000, 'new admins get 72 hours');

    assert.equal((await browser.post('/v1/admin/auth/password-link/complete', { token, password: 'short' })).status, 400, 'the password rules apply');
    const done = await browser.post('/v1/admin/auth/password-link/complete', { token, password: 'a chosen admin passphrase', name: ' Ngozi Link ' });
    assert.deepEqual([done.status, done.json], [200, { object: 'admin_password_set', email, authenticator_reset: false }]);
    const signin = await browser.post('/v1/admin/auth/signin', { email, password: 'a chosen admin passphrase' });
    assert.deepEqual([signin.status, signin.json.mfa_setup_required], [200, true], 'the authenticator is set up at first sign-in');
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    assert.equal((await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email } })).name, 'Ngozi Link');
    assert.equal((await browser.post('/v1/admin/auth/start', { email })).json.next, 'password', 'set up: now the password step');

    for (const [path, body] of [['/v1/admin/auth/password-link', { token }], ['/v1/admin/auth/password-link/complete', { token, password: 'yet another admin passphrase' }]]) {
      const again = await browser.post(path, body);
      assert.deepEqual([again.status, again.json.error.code], [404, 'link_invalid'], `${path} works once`);
    }
    assert.equal((await browser.post('/v1/admin/auth/password-link', { token: `${token.slice(0, -4)}AAAA` })).status, 404);
  });

  test('forgot password: the same answer for everyone, a link only to listed admins, and nothing changes until it is used', async () => {
    const browser = client(server.base);
    const unlisted = await createAdmin();
    for (const email of [unlisted, 'nobody@bitocard.com', 'someone@gmail.com']) {
      const answer = await browser.post('/v1/admin/auth/password/forgot', { email });
      assert.deepEqual([answer.status, answer.json], [200, { object: 'admin_password_reset_requested' }]);
    }
    assert.equal((await emailsTo(unlisted)).length, 0, 'admins not in ADMIN_SETUP_EMAILS are never emailed a link');

    const email = 'link-reset@bitocard.com';
    await admins.createAdmin({ email, name: 'Reset Admin', password, roles: ['operations'] });
    const { browser: signedIn } = await firstSignIn(email);
    const answer = await browser.post('/v1/admin/auth/password/forgot', { email: 'Link-Reset@bitocard.com' });
    assert.deepEqual(answer.json, { object: 'admin_password_reset_requested' });
    const first = await linkToken(email);
    assert.match((await emailsTo(email)).at(-1).subject, /Reset your BitoCard admin password/);
    assert.equal((await signedIn.get('/v1/admin/auth/session')).status, 200, 'asking changes nothing');
    assert.equal((await browser.post('/v1/admin/auth/signin', { email, password })).status, 200, 'the old password still works until the link is used');

    await browser.post('/v1/admin/auth/password/forgot', { email });
    assert.equal(await linkToken(email), first, 'at most one link a minute');
    await pastLinkLimit(email);
    await browser.post('/v1/admin/auth/password/forgot', { email });
    const token = await linkToken(email);
    assert.notEqual(token, first);
    assert.equal((await browser.post('/v1/admin/auth/password-link', { token: first })).status, 404, 'a new link replaces the last');
  });

  test('using a reset link: sessions end, the lockout clears, and the authenticator is reset only when ticked', async () => {
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    const email = 'link-reset@bitocard.com';
    await awayFromStepEdge();
    const browser = client(server.base);
    const step1 = await browser.post('/v1/admin/auth/signin', { email, password });
    const user = await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email }, include: { totp: true } });
    assert.ok(user.totp?.confirmedAt);
    const token = await linkToken(email);
    const described = await browser.post('/v1/admin/auth/password-link', { token });
    assert.deepEqual([described.json.kind, described.json.authenticator_set_up], ['reset', true]);
    await prisma.user.update({ where: { id: user.id }, data: { failedSignIns: 3, lockedUntil: new Date(Date.now() + 15 * 60_000) } });
    const sessionsBefore = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    assert.ok(sessionsBefore > 0 || step1.status === 200);

    const done = await browser.post('/v1/admin/auth/password-link/complete', { token, password: 'a fresh admin passphrase', name: 'Ignored On Reset' });
    assert.deepEqual([done.status, done.json.authenticator_reset], [200, false]);
    assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 0, 'signed out everywhere');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.deepEqual([after.lockedUntil, after.failedSignIns, after.name], [null, 0, 'Reset Admin']);
    assert.equal((await client(server.base).post('/v1/admin/auth/signin', { email, password })).status, 401, 'the old password no longer works');
    const fresh = await client(server.base).post('/v1/admin/auth/signin', { email, password: 'a fresh admin passphrase' });
    assert.deepEqual([fresh.status, fresh.json.mfa_setup_required], [200, false], 'the authenticator is kept');
    assert.match((await emailsTo(email)).at(-1).subject, /password was changed/);

    // Ticking the box: the authenticator is set up again at the next sign-in.
    await pastLinkLimit(email);
    await client(server.base).post('/v1/admin/auth/password/forgot', { email });
    const second = await client(server.base).post('/v1/admin/auth/password-link/complete', { token: await linkToken(email), password: 'another fresh passphrase', reset_authenticator: true });
    assert.deepEqual([second.status, second.json.authenticator_reset], [200, true]);
    const signin = await client(server.base).post('/v1/admin/auth/signin', { email, password: 'another fresh passphrase' });
    assert.deepEqual([signin.status, signin.json.mfa_setup_required], [200, true]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: user.id, action: 'admin.password_set' }, orderBy: { createdAt: 'desc' } });
    assert.equal(audit.after.authenticator_reset, true);

    // An expired link is refused.
    await pastLinkLimit(email);
    await client(server.base).post('/v1/admin/auth/password/forgot', { email });
    const expired = await linkToken(email);
    await prisma.verificationCode.updateMany({ where: { userId: user.id, purpose: 'admin_password_link', consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await client(server.base).post('/v1/admin/auth/password-link/complete', { token: expired, password: 'never applied passphrase' })).status, 404);
  });

  test('a link can be sent again every minute, with no daily cap', async () => {
    const email = 'link-other@golojan.co.uk';
    await admins.createAdmin({ email, name: 'Other Admin', password, roles: ['support'] });
    for (let i = 0; i < 7; i += 1) {
      await client(server.base).post('/v1/admin/auth/password/forgot', { email });
      await client(server.base).post('/v1/admin/auth/password/forgot', { email }); // within the minute: skipped
      await pastLinkLimit(email);
    }
    assert.equal((await emailsTo(email)).length, 7);
  });
});

describe('one email, separate accounts', () => {
  test('an admin’s email can also sign up to SHQ: a separate reseller account that never changes the admin', async () => {
    const { lastEmailCode } = await import('./helpers.mjs');
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    const email = await createAdmin();
    const admin = await firstSignIn(email);

    const reseller = client(server.base);
    const resellerPassword = 'a different reseller passphrase';
    const signup = await reseller.post('/v1/auth/signup', { name: 'Same Person', email, password: resellerPassword, country: 'NG', business_name: 'Side Business' });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    const users = await prisma.user.findMany({ where: { email }, orderBy: { realm: 'asc' } });
    assert.deepEqual(users.map(user => [user.realm, user.adminRoles]), [['reseller', []], ['admin', ['operations']]]);
    assert.notEqual(users[0].id, users[1].id);

    // Each password opens only its own account; neither session reaches the other app.
    assert.equal((await client(server.base).post('/v1/auth/signin', { identifier: email, password })).status, 401);
    assert.equal((await client(server.base).post('/v1/admin/auth/signin', { email, password: resellerPassword })).status, 401);
    assert.equal((await reseller.get('/v1/admin/auth/session')).status, 401);
    assert.equal((await admin.browser.get('/v1/auth/session')).status, 401);

    // Resetting the reseller password changes nothing for the admin.
    await client(server.base).post('/v1/auth/password/forgot', { email });
    const reset = await client(server.base).post('/v1/auth/password/reset', { email, code: await lastEmailCode(server.app, email), password: 'yet another reseller passphrase' });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    assert.equal((await admin.browser.get('/v1/admin/auth/session')).status, 200, 'the admin stays signed in');
    const again = await client(server.base).post('/v1/admin/auth/signin', { email, password });
    assert.equal(again.status, 200, 'the admin password still works');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: users[1].id } });
    assert.deepEqual([after.passwordHash, after.adminRoles, after.email], [users[1].passwordHash, ['operations'], email]);
  });
});
