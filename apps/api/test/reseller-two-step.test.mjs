// Resellers' two-step sign-in: an authenticator app, emailed codes or text messages per person; required where admins
// switch `reseller_two_step` on; a pending session can only finish signing in.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { PrismaService } from '../dist/database/prisma.service.js';
import { adminClient, client, lastEmailCode, lastSmsCode, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

const password = 'correct horse battery';
let server;
let prisma;
let check;
let admin;

before(async () => {
  server = await startApp({ env: { ENCRYPTION_KEY: randomBytes(32).toString('base64') } });
  prisma = server.app.get(PrismaService);
  check = await responseChecker(server.app);
  admin = await adminClient(server, ['super_admin']);
});

after(() => server?.close());

const totp = (secret, email) => new TOTP({ issuer: 'BitoCard', label: email, secret: Secret.fromBase32(secret) });
/** A code for an adjacent 30-second step: each step can be used once. */
const codeAt = (secret, email, offsetSteps) => totp(secret, email).generate({ timestamp: Date.now() + offsetSteps * 30_000 });

/** Waits out the last seconds of a 30-second step, so a code made now is still inside the server's window when checked. */
async function awayFromStepEdge() {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 3000) await new Promise(resolve => setTimeout(resolve, left + 100));
}

/** Lets the next code be sent at once (codes are at most one a minute), as if the last one were sent two minutes ago. */
async function codeAgain(email) {
  const user = await prisma.user.findFirstOrThrow({ where: { realm: 'reseller', email } });
  await prisma.verificationCode.updateMany({ where: { userId: user.id, purpose: 'mfa_sign_in' }, data: { createdAt: new Date(Date.now() - 120_000) } });
}

async function signIn(email) {
  const browser = client(server.base, { autoIdempotency: true });
  const res = await browser.post('/v1/auth/signin', { identifier: email, password });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return { browser, session: res.json };
}

/** Sets up an authenticator for a signed-in reseller; returns its secret and recovery codes. */
async function withAuthenticator(browser, email) {
  await awayFromStepEdge();
  const setup = await browser.post('/v1/auth/two-step/setup', { method: 'authenticator' });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  const confirmed = await browser.post('/v1/auth/two-step/setup/confirm', { code: codeAt(setup.json.secret, email, -1) });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return { secret: setup.json.secret, recoveryCodes: confirmed.json.recovery_codes };
}

describe('reseller two-step sign-in', () => {
  test('off by default: sign-in is one step and the session says so', async () => {
    const { browser, email } = await resellerClient(server);
    const session = await browser.get('/v1/auth/session');
    check('GET /v1/auth/session', 200, session.json);
    assert.deepEqual(session.json.two_step, { pending: false, setup_required: false, method: null });
    const settings = await browser.get('/v1/auth/two-step');
    check('GET /v1/auth/two-step', 200, settings.json);
    assert.deepEqual([settings.json.method, settings.json.required, settings.json.pending], [null, false, false]);
    assert.deepEqual(
      settings.json.methods.map(item => [item.method, item.available, item.reason]),
      [['authenticator', true, null], ['email', true, null], ['sms', false, 'phone_required']],
    );
    const again = await signIn(email);
    assert.equal(again.session.two_step.pending, false);
    assert.equal((await again.browser.get('/v1/account')).status, 200);
  });

  test('an authenticator: set up with its first code, then every sign-in waits for a code', async () => {
    const { browser, email, userId } = await resellerClient(server);
    await awayFromStepEdge();
    const setup = await browser.post('/v1/auth/two-step/setup', { method: 'authenticator' });
    check('POST /v1/auth/two-step/setup', 200, setup.json);
    assert.ok(setup.json.otpauth_uri.startsWith('otpauth://totp/BitoCard:'));
    const wrong = await browser.post('/v1/auth/two-step/setup/confirm', { code: '000000' });
    assert.deepEqual([wrong.status, wrong.json.error.code], [400, 'mfa_code_invalid']);
    const confirmed = await browser.post('/v1/auth/two-step/setup/confirm', { code: codeAt(setup.json.secret, email, -1) });
    check('POST /v1/auth/two-step/setup/confirm', 200, confirmed.json);
    assert.equal(confirmed.json.recovery_codes.length, 10);
    assert.equal((await browser.get('/v1/account')).status, 200, 'the session that set it up stays signed in');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { totp: true } });
    assert.equal(stored.mfaMethod, 'authenticator');
    assert.ok(!stored.totp.secretEncrypted.includes(setup.json.secret), 'the secret is encrypted');
    assert.ok(!stored.mfaRecoveryCodeHashes.includes(confirmed.json.recovery_codes[0]), 'only hashes of recovery codes');
    assert.ok(await prisma.notification.findFirst({ where: { userId, type: 'security.two_step_changed' } }), 'the person is told');

    const { browser: next, session } = await signIn(email);
    check('POST /v1/auth/signin', 200, session);
    assert.deepEqual(session.two_step, { pending: true, setup_required: false, method: 'authenticator' });
    const blocked = await next.get('/v1/account');
    assert.deepEqual([blocked.status, blocked.json.error.code], [401, 'mfa_required']);
    assert.equal((await next.post('/v1/auth/docs-token', { mode: 'test' })).json.error.code, 'mfa_required', 'no docs tokens before the second step');
    assert.equal((await next.get('/v1/auth/session')).json.two_step.pending, true, 'the session can still be read');
    const challenge = await next.post('/v1/auth/two-step/challenge');
    check('POST /v1/auth/two-step/challenge', 200, challenge.json);
    assert.deepEqual([challenge.json.sent, challenge.json.sent_to], [false, null], 'authenticators need nothing sent');

    const used = codeAt(setup.json.secret, email, 0);
    const verified = await next.post('/v1/auth/two-step/verify', { code: used });
    check('POST /v1/auth/two-step/verify', 200, verified.json);
    assert.equal((await next.get('/v1/account')).status, 200);
    assert.equal((await next.get('/v1/auth/session')).json.two_step.pending, false);

    const { browser: third } = await signIn(email);
    const replay = await third.post('/v1/auth/two-step/verify', { code: used });
    assert.equal(replay.json.error.code, 'mfa_code_invalid', 'a code is used once');
    const recovery = await third.post('/v1/auth/two-step/verify', { code: confirmed.json.recovery_codes[0] });
    assert.deepEqual([recovery.status, recovery.json.used], [200, 'recovery']);
    const { browser: fourth } = await signIn(email);
    assert.equal((await fourth.post('/v1/auth/two-step/verify', { code: confirmed.json.recovery_codes[0] })).json.error.code, 'mfa_code_invalid', 'a recovery code works once');
    assert.equal((await browser.get('/v1/auth/two-step')).json.recovery_codes_left, 9);

    const fresh = await browser.post('/v1/auth/two-step/recovery-codes', { code: confirmed.json.recovery_codes[1] });
    check('POST /v1/auth/two-step/recovery-codes', 200, fresh.json);
    assert.equal((await fourth.post('/v1/auth/two-step/verify', { code: confirmed.json.recovery_codes[2] })).json.error.code, 'mfa_code_invalid', 'old recovery codes stop working');
    assert.equal((await fourth.post('/v1/auth/two-step/verify', { code: fresh.json.recovery_codes[0] })).status, 200);
  });

  test('emailed codes: one a minute, the sign-in code finishes it, and wrong codes lock the account', async () => {
    const { browser, email } = await resellerClient(server);
    const setup = await browser.post('/v1/auth/two-step/setup', { method: 'email' });
    assert.deepEqual([setup.status, setup.json.secret, setup.json.sent_to.endsWith('@example.com')], [200, null, true]);
    assert.equal((await browser.post('/v1/auth/two-step/setup/confirm', { code: await lastEmailCode(server.app, email) })).status, 200);
    assert.equal((await browser.get('/v1/auth/session')).json.user.email_verified, true, 'a code received at the address proves it');

    const { browser: next } = await signIn(email);
    const sent = await next.post('/v1/auth/two-step/challenge');
    assert.deepEqual([sent.json.method, sent.json.sent], ['email', true]);
    assert.equal((await next.post('/v1/auth/two-step/challenge')).json.sent, false, 'at most one a minute; the last code still works');
    const code = await lastEmailCode(server.app, email);
    assert.equal((await next.post('/v1/auth/two-step/verify', { code })).status, 200);
    assert.equal((await next.post('/v1/auth/two-step/verify', { code })).json.error.code, 'two_step_not_pending');

    const { browser: guesser } = await signIn(email);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await guesser.post('/v1/auth/two-step/verify', { code: '111111' });
      assert.equal(res.status, 400);
    }
    const lockedOut = await guesser.post('/v1/auth/two-step/verify', { code: '111111' });
    assert.deepEqual([lockedOut.status, lockedOut.json.error.code], [429, 'account_locked']);
    const signInLocked = await client(server.base).post('/v1/auth/signin', { identifier: email, password });
    assert.equal(signInLocked.json.error.code, 'account_locked', 'the same lockout as wrong passwords');
  });

  test('text messages need a confirmed mobile number, then work like emailed codes', async () => {
    const { browser, email } = await resellerClient(server);
    const phone = `+234803${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    assert.equal((await browser.post('/v1/auth/two-step/setup', { method: 'sms' })).json.error.code, 'two_step_method_unavailable');
    assert.equal((await browser.post('/v1/auth/phones', { phone })).status, 202);
    assert.equal((await browser.post('/v1/auth/phones/verify', { code: await lastSmsCode(server.app, phone) })).status, 200);
    const setup = await browser.post('/v1/auth/two-step/setup', { method: 'sms' });
    assert.deepEqual([setup.status, setup.json.sent_to], [200, `•••• ${phone.slice(-4)}`]);
    assert.equal((await browser.post('/v1/auth/two-step/setup/confirm', { code: await lastSmsCode(server.app, phone) })).status, 200);

    const { browser: next } = await signIn(email);
    assert.equal((await next.post('/v1/auth/two-step/challenge')).json.sent, true);
    assert.equal((await next.post('/v1/auth/two-step/verify', { code: await lastSmsCode(server.app, phone) })).status, 200);

    // Changing the method needs a code from the current one.
    assert.equal((await next.post('/v1/auth/two-step/setup', { method: 'email' })).json.error.code, 'parameter_missing');
    await codeAgain(email);
    assert.equal((await next.post('/v1/auth/two-step/challenge')).json.sent, true);
    const changed = await next.post('/v1/auth/two-step/setup', { method: 'email', current_code: await lastSmsCode(server.app, phone) });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal((await next.post('/v1/auth/two-step/setup/confirm', { code: await lastEmailCode(server.app, email) })).status, 200);
    assert.equal((await next.get('/v1/auth/two-step')).json.method, 'email');
  });

  test('required by the switch: set up at the next request, and it cannot be turned off', async () => {
    const { browser, email, resellerId } = await resellerClient(server, { country: 'GH' });
    assert.equal((await admin.put('/v1/admin/switches/reseller_two_step', { country_code: 'GH', enabled: true })).status, 200);
    try {
      const blocked = await browser.get('/v1/account');
      assert.deepEqual([blocked.status, blocked.json.error.code], [401, 'mfa_required'], 'a session from before must set it up too');
      assert.deepEqual((await browser.get('/v1/auth/session')).json.two_step, { pending: true, setup_required: true, method: null });
      assert.equal((await browser.get('/v1/auth/two-step')).json.required, true);
      assert.equal((await browser.post('/v1/auth/two-step/setup', { method: 'email' })).status, 200);
      assert.equal((await browser.post('/v1/auth/two-step/setup/confirm', { code: await lastEmailCode(server.app, email) })).status, 200);
      assert.equal((await browser.get('/v1/account')).status, 200);
      const off = await browser.post('/v1/auth/two-step/disable', { code: '123456' });
      assert.deepEqual([off.status, off.json.error.code], [409, 'two_step_enforced']);

      // A reseller's own switch wins over its market's.
      await admin.put('/v1/admin/switches/reseller_two_step', { reseller_id: resellerId, enabled: false });
      await codeAgain(email);
      assert.equal((await browser.post('/v1/auth/two-step/challenge')).json.sent, true);
      const disabled = await browser.post('/v1/auth/two-step/disable', { code: await lastEmailCode(server.app, email) });
      check('POST /v1/auth/two-step/disable', 200, disabled.json);
      assert.equal((await signIn(email)).session.two_step.pending, false);
    } finally {
      await admin.put('/v1/admin/switches/reseller_two_step', { country_code: 'GH', enabled: null });
    }
  });

  test('a market can limit the methods resellers based there may choose', async () => {
    const updated = await admin.patch('/v1/admin/countries/KE', { reseller_two_step_methods: ['email', 'authenticator', 'email'] });
    assert.equal(updated.status, 400, 'each method once');
    const saved = await admin.patch('/v1/admin/countries/KE', { reseller_two_step_methods: ['email', 'authenticator'] });
    assert.deepEqual(saved.json.reseller_two_step_methods, ['authenticator', 'email'], 'kept in a fixed order');
    try {
      assert.equal((await admin.patch('/v1/admin/countries/KE', { reseller_two_step_methods: ['authenticator'] })).status, 200);
      const { browser } = await resellerClient(server, { country: 'KE' });
      const settings = await browser.get('/v1/auth/two-step');
      assert.deepEqual(settings.json.methods.find(item => item.method === 'email'), { method: 'email', available: false, reason: 'not_allowed' });
      const refused = await browser.post('/v1/auth/two-step/setup', { method: 'email' });
      assert.deepEqual([refused.status, refused.json.error.code], [400, 'two_step_method_unavailable']);
    } finally {
      await admin.patch('/v1/admin/countries/KE', { reseller_two_step_methods: ['authenticator', 'email', 'sms'] });
    }
  });

  test('admins reset a member who lost their method: it is off and they are signed out everywhere', async () => {
    const { browser, email, userId, resellerId } = await resellerClient(server);
    await withAuthenticator(browser, email);
    const detail = await admin.get(`/v1/admin/resellers/${resellerId}`);
    assert.equal(detail.json.members.find(member => member.user_id === userId).two_step, 'authenticator');

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/resellers/${resellerId}/members/${userId}/two-step/reset`, { reason: 'Lost phone' })).status, 403, 'operations only');
    const stranger = (await resellerClient(server)).resellerId;
    assert.equal((await admin.post(`/v1/admin/resellers/${stranger}/members/${userId}/two-step/reset`, { reason: 'Lost phone' })).status, 404, 'only on their own team');
    const reset = await admin.post(`/v1/admin/resellers/${resellerId}/members/${userId}/two-step/reset`, { reason: 'Lost phone, called in' });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    assert.equal((await browser.get('/v1/account')).status, 401, 'signed out everywhere');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'reseller.two_step_reset', targetId: userId } }));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { totp: true } });
    assert.deepEqual([user.mfaMethod, user.totp, user.mfaRecoveryCodeHashes], [null, null, []]);
    assert.equal((await signIn(email)).session.two_step.pending, false);
  });

  test('public routes treat a pending session as signed out', async () => {
    const { browser, email } = await resellerClient(server);
    await withAuthenticator(browser, email);
    const { browser: next } = await signIn(email);
    assert.equal((await next.get('/v1/countries')).status, 200);
    assert.equal((await next.post('/v1/auth/signout')).status, 204, 'signing out still works');
    assert.equal((await next.get('/v1/auth/session')).status, 401);
  });
});
