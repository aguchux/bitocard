// Admin sign-in: company-domain email and password, then a required authenticator code (TOTP).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { AdminAuthService } from '../dist/auth/admin-auth.service.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { client, dockerUrl, startApp } from './helpers.mjs';

const password = 'admin passphrase long';
let server;
let admins;

before(async () => {
  server = await startApp({ env: { ENCRYPTION_KEY: randomBytes(32).toString('base64') } });
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

/** First sign-in: password, authenticator setup, first code. Returns the browser, secret and recovery codes. */
async function firstSignIn(email) {
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

describe('admin:create script', () => {
  test('creates an admin with a one-time password that can sign in', { skip: !dockerUrl && 'needs the Docker database' }, async () => {
    const email = `script-${Date.now()}@bitocard.com`;
    const { stdout } = await promisify(execFile)(process.execPath, ['scripts/create-admin.mjs', '--email', email, '--name', 'Script Admin', '--roles', 'support'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, DATABASE_URL: dockerUrl, PASSWORD_BREACH_CHECK: 'off' },
    });
    const temporary = /Temporary password \(shown once\): (\S+)/.exec(stdout)?.[1];
    assert.ok(temporary, stdout);
    const signin = await client(server.base).post('/v1/admin/auth/signin', { email, password: temporary });
    assert.equal(signin.status, 200);
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
