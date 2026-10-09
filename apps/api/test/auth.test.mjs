// Reseller sign-up, sign-in, sessions, email verification and password reset.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { appOrigin, client, fakeService, lastEmailCode, lastSmsCode, startApp } from './helpers.mjs';

let server;
let base;

before(async () => {
  server = await startApp();
  base = server.base;
});

after(() => server?.close());

const password = 'correct horse battery';
let counter = 0;
const uniqueEmail = () => `reseller${(counter += 1)}-${Date.now()}@example.com`;

async function signUp(overrides = {}) {
  const browser = client(base);
  const email = overrides.email ?? uniqueEmail();
  const result = await browser.post('/v1/auth/signup', { name: 'Ada Obi', email, password, country: 'NG', ...overrides });
  return { browser, email, ...result };
}

describe('sign-up', () => {
  test('creates the person, an owned reseller account and a session', async () => {
    const { browser, email, status, json, res } = await signUp({ business_name: 'Ada Digital' });
    assert.equal(status, 201);
    assert.equal(json.user.email, email);
    assert.equal(json.user.email_verified, false);
    assert.equal(json.memberships.length, 1);
    assert.equal(json.memberships[0].role, 'owner');
    assert.deepEqual([json.memberships[0].reseller.name, json.memberships[0].reseller.country], ['Ada Digital', 'NG']);

    const cookie = res.headers.getSetCookie().find(line => line.startsWith('bc_session='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    const session = await browser.get('/v1/auth/session');
    assert.equal(session.status, 200);
    assert.equal(session.json.user.email, email);
  });

  test('emails a 6-digit confirmation code', async () => {
    const { email } = await signUp();
    assert.match((await lastEmailCode(server.app, email)) ?? '', /^\d{6}$/);
  });

  test('normalises the email address', async () => {
    const { json } = await signUp({ email: `  MiXeD${Date.now()}@Example.COM ` });
    assert.match(json.user.email, /^mixed\d+@example\.com$/);
  });

  test('refuses countries outside the pilot', async () => {
    const { status, json } = await signUp({ country: 'GB' });
    assert.equal(status, 400);
    assert.deepEqual([json.error.code, json.error.param], ['country_not_supported', 'country']);
  });

  test('refuses an email that already has an account', async () => {
    const { email } = await signUp();
    const again = await signUp({ email });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, 'email_in_use');
  });

  test('refuses short and repetitive passwords', async () => {
    const short = await signUp({ password: 'short' });
    assert.deepEqual([short.status, short.json.error.param], [400, 'password']);
    const repetitive = await signUp({ password: 'aaaaaaaaaaaa' });
    assert.equal(repetitive.json.error.code, 'password_too_weak');
  });

  test('refuses unknown fields', async () => {
    const { status, json } = await signUp({ role: 'admin' });
    assert.deepEqual([status, json.error.param], [400, 'role']);
  });
});

describe('breached-password check', () => {
  test('refuses a password found in breaches, sending only a hash prefix', async () => {
    // SHA-1 of "correct horse battery" starts with these characters; the fake service reports the rest as breached.
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const hibp = await fakeService(() => ({ headers: { 'content-type': 'text/plain' }, body: `${digest.slice(5)}:42\r\nABCDEF:1` }));
    const app = await startApp({ env: { PASSWORD_BREACH_CHECK: 'on', HIBP_API_URL: hibp.url }, database: 'pglite' });
    try {
      const { status, json } = await client(app.base).post('/v1/auth/signup', { name: 'Ada', email: uniqueEmail(), password, country: 'NG' });
      assert.deepEqual([status, json.error.code], [400, 'password_breached']);
      assert.equal(hibp.calls[0].url, `/range/${digest.slice(0, 5)}`);
      assert.ok(!JSON.stringify(hibp.calls).includes(digest.slice(5)), 'the full hash must never be sent');
    } finally {
      await app.close();
      await hibp.close();
    }
  });

  test('allows sign-up when the breach service is unreachable', async () => {
    const app = await startApp({ env: { PASSWORD_BREACH_CHECK: 'on', HIBP_API_URL: 'http://127.0.0.1:9' }, database: 'pglite' });
    try {
      const { status } = await client(app.base).post('/v1/auth/signup', { name: 'Ada', email: uniqueEmail(), password, country: 'NG' });
      assert.equal(status, 201);
    } finally {
      await app.close();
    }
  });
});

describe('email verification', () => {
  test('a wrong code is refused; the right code confirms the email once', async () => {
    const { browser, email } = await signUp();
    const code = await lastEmailCode(server.app, email);
    const wrong = await browser.post('/v1/auth/email/verify', { code: code === '000000' ? '111111' : '000000' });
    assert.deepEqual([wrong.status, wrong.json.error.code], [400, 'code_invalid']);

    const right = await browser.post('/v1/auth/email/verify', { code });
    assert.equal(right.status, 200);
    assert.equal(right.json.user.email_verified, true);

    const reused = await browser.post('/v1/auth/email/verify', { code });
    assert.equal(reused.json.error.code, 'code_invalid');
  });

  test('five wrong attempts lock the code', async () => {
    const { browser, email } = await signUp();
    const code = await lastEmailCode(server.app, email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let n = 0; n < 5; n += 1) await browser.post('/v1/auth/email/verify', { code: wrong });
    const locked = await browser.post('/v1/auth/email/verify', { code });
    assert.equal(locked.json.error.code, 'code_attempts_exceeded');
  });

  test('parallel wrong codes never get more than five tries', async () => {
    const { browser, email } = await signUp();
    const code = await lastEmailCode(server.app, email);
    const wrong = code === '000000' ? '111111' : '000000';
    const answers = await Promise.all(Array.from({ length: 20 }, () => browser.post('/v1/auth/email/verify', { code: wrong })));
    assert.equal(answers.filter(answer => answer.json.error?.code === 'code_invalid').length, 5, 'only five guesses are ever compared');
    const right = await browser.post('/v1/auth/email/verify', { code });
    assert.equal(right.json.error.code, 'code_attempts_exceeded');
  });

  test('no more than ten codes a day', async () => {
    const { browser, json } = await signUp();
    const prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    const hourAgo = new Date(Date.now() - 3600_000);
    await prisma.verificationCode.updateMany({ where: { userId: json.user.id }, data: { createdAt: hourAgo } });
    await prisma.verificationCode.createMany({
      data: Array.from({ length: 9 }, () => ({ userId: json.user.id, purpose: 'email_verification', target: 'x', codeHash: 'x', expiresAt: hourAgo, consumedAt: hourAgo, createdAt: hourAgo })),
    });
    const resend = await browser.post('/v1/auth/email/resend');
    assert.deepEqual([resend.status, resend.json.error.code], [429, 'code_daily_limit']);
  });

  test('a new code cannot be requested within a minute', async () => {
    const { browser } = await signUp();
    const resend = await browser.post('/v1/auth/email/resend');
    assert.deepEqual([resend.status, resend.json.error.code], [429, 'code_recently_sent']);
  });

  test('codes must be 6 digits', async () => {
    const { browser } = await signUp();
    const bad = await browser.post('/v1/auth/email/verify', { code: '12ab' });
    assert.deepEqual([bad.status, bad.json.error.param], [400, 'code']);
  });
});

describe('sign-in and sessions', () => {
  test('signs in with email and password, case-insensitively', async () => {
    const { email } = await signUp();
    const browser = client(base);
    const { status, json } = await browser.post('/v1/auth/signin', { identifier: email.toUpperCase(), password });
    assert.equal(status, 200);
    assert.equal(json.user.email, email);
    assert.equal((await browser.get('/v1/auth/session')).status, 200);
  });

  test('a wrong password and an unknown account get the same answer', async () => {
    const { email } = await signUp();
    const wrong = await client(base).post('/v1/auth/signin', { identifier: email, password: 'wrong password here' });
    const unknown = await client(base).post('/v1/auth/signin', { identifier: uniqueEmail(), password });
    assert.deepEqual([wrong.status, wrong.json.error.code], [401, 'invalid_credentials']);
    assert.deepEqual([unknown.status, unknown.json.error.code, unknown.json.error.message], [401, 'invalid_credentials', wrong.json.error.message]);
  });

  test('five failures lock the account for 15 minutes', async () => {
    const { email } = await signUp();
    for (let n = 0; n < 5; n += 1) await client(base).post('/v1/auth/signin', { identifier: email, password: 'wrong password here' });
    const locked = await client(base).post('/v1/auth/signin', { identifier: email, password });
    assert.deepEqual([locked.status, locked.json.error.code], [429, 'account_locked']);
    const wrong = await client(base).post('/v1/auth/signin', { identifier: email, password: 'wrong password here' });
    assert.equal(wrong.json.error.code, 'invalid_credentials', 'a wrong password must not reveal the lock');
  });

  test('parallel wrong passwords all count towards the lock', async () => {
    const { email } = await signUp();
    await Promise.all(Array.from({ length: 6 }, () => client(base).post('/v1/auth/signin', { identifier: email, password: 'wrong password here' })));
    const locked = await client(base).post('/v1/auth/signin', { identifier: email, password });
    assert.deepEqual([locked.status, locked.json.error.code], [429, 'account_locked']);
  });

  test('without a session, protected endpoints answer 401', async () => {
    const { status, json } = await client(base).get('/v1/auth/session');
    assert.deepEqual([status, json.error.type], [401, 'authentication_error']);
  });

  test('signing out ends the session for good', async () => {
    const { browser } = await signUp();
    const token = browser.jar.get('bc_session');
    const out = await browser.post('/v1/auth/signout');
    assert.equal(out.status, 204);
    const stale = await fetch(`${base}/v1/auth/session`, { headers: { cookie: `bc_session=${token}` } });
    assert.equal(stale.status, 401);
  });

  test('cookie-authenticated changes from other sites are refused', async () => {
    const { browser } = await signUp();
    const noOrigin = await browser.post('/v1/auth/email/resend', {}, { origin: '' });
    assert.equal(noOrigin.status, 403);
    const evil = await browser.post('/v1/auth/signout', {}, { origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    const lookalike = await browser.post('/v1/auth/signout', {}, { origin: 'https://evilbitocard.com' });
    assert.equal(lookalike.status, 403);
    assert.equal((await browser.get('/v1/auth/session')).status, 200, 'the session must survive refused requests');
  });

  test('malformed API keys are refused', async () => {
    const res = await fetch(`${base}/v1/auth/session`, { headers: { authorization: 'Bearer not-a-key' } });
    assert.equal(res.status, 401);
  });
});

describe('mobile number', () => {
  let phoneCounter = 0;
  // Valid Nigerian mobile numbers (MTN 0803 range), unique per test.
  const nextPhone = () => `+234803${String(1_000_000 + (phoneCounter += 1) * 7919).slice(-7)}`;

  test('a local-format number is read in the business country and confirmed by SMS code', async () => {
    const { browser } = await signUp();
    const phone = nextPhone();
    const local = `0${phone.slice(4)}`;
    const added = await browser.post('/v1/auth/phone', { phone: local });
    assert.equal(added.status, 202);
    assert.equal(added.json.phone, phone);

    const code = await lastSmsCode(server.app, phone);
    const verified = await browser.post('/v1/auth/phone/verify', { code });
    assert.equal(verified.status, 200);
    assert.deepEqual([verified.json.user.phone, verified.json.user.phone_verified], [phone, true]);
  });

  test('a confirmed number can be used to sign in, with or without spaces', async () => {
    const { browser } = await signUp();
    const phone = nextPhone();
    await browser.post('/v1/auth/phone', { phone });
    await browser.post('/v1/auth/phone/verify', { code: await lastSmsCode(server.app, phone) });
    const spaced = `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
    const signin = await client(base).post('/v1/auth/signin', { identifier: spaced, password });
    assert.equal(signin.status, 200);
  });

  test('an unconfirmed number cannot be used to sign in', async () => {
    const { browser } = await signUp();
    const phone = nextPhone();
    await browser.post('/v1/auth/phone', { phone });
    const signin = await client(base).post('/v1/auth/signin', { identifier: phone, password });
    assert.equal(signin.status, 401);
  });

  test('invalid numbers and fixed lines are refused', async () => {
    const { browser } = await signUp();
    const invalid = await browser.post('/v1/auth/phone', { phone: '+234123' });
    assert.deepEqual([invalid.status, invalid.json.error.code], [400, 'phone_invalid']);
    const landline = await browser.post('/v1/auth/phone', { phone: '+442071838750' });
    assert.equal(landline.json.error.code, 'phone_invalid');
  });

  test('a number confirmed by another account is refused', async () => {
    const first = await signUp();
    const phone = nextPhone();
    await first.browser.post('/v1/auth/phone', { phone });
    await first.browser.post('/v1/auth/phone/verify', { code: await lastSmsCode(server.app, phone) });
    const second = await signUp();
    const taken = await second.browser.post('/v1/auth/phone', { phone });
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'phone_in_use']);
  });

  test('a failed SMS is reported and does not block an immediate retry', async () => {
    const termii = await fakeService(() => ({ status: 500, body: { message: 'down' } }));
    const app = await startApp({ env: { TERMII_API_KEY: 'tm_test', TERMII_API_URL: termii.url }, database: 'pglite' });
    try {
      const browser = client(app.base);
      await browser.post('/v1/auth/signup', { name: 'Ada', email: uniqueEmail(), password, country: 'NG' });
      const phone = nextPhone();
      const first = await browser.post('/v1/auth/phone', { phone });
      assert.deepEqual([first.status, first.json.error.code], [502, 'sms_delivery_failed']);
      const retry = await browser.post('/v1/auth/phone', { phone });
      assert.equal(retry.json.error.code, 'sms_delivery_failed', 'not blocked by the one-minute resend limit');
    } finally {
      await app.close();
      await termii.close();
    }
  });
});

describe('email delivery failures', () => {
  test('sign-up still succeeds, and a resend is allowed straight away', async () => {
    const down = await fakeService(() => ({ status: 503, body: {} }));
    const app = await startApp({ env: { RESEND_API_KEY: 're_test', RESEND_API_URL: down.url }, database: 'pglite' });
    try {
      const browser = client(app.base);
      const signup = await browser.post('/v1/auth/signup', { name: 'Ada', email: uniqueEmail(), password, country: 'NG' });
      assert.equal(signup.status, 201);
      const resend = await browser.post('/v1/auth/email/resend');
      assert.deepEqual([resend.status, resend.json.error.code], [502, 'email_delivery_failed']);
    } finally {
      await app.close();
      await down.close();
    }
  });
});

describe('password reset', () => {
  test('always answers the same, and only emails real accounts', async () => {
    const unknown = uniqueEmail();
    const { status, json } = await client(base).post('/v1/auth/password/forgot', { email: unknown });
    assert.equal(status, 202);
    assert.match(json.message, /If an account uses this email/);
    assert.equal(await lastEmailCode(server.app, unknown), null);
  });

  test('a valid code sets the new password and signs out every session', async () => {
    const { browser, email } = await signUp();
    await client(base).post('/v1/auth/password/forgot', { email });
    const code = await lastEmailCode(server.app, email);
    const newPassword = 'a brand new passphrase';

    const reset = await client(base).post('/v1/auth/password/reset', { email, code, password: newPassword });
    assert.equal(reset.status, 200);
    assert.equal((await browser.get('/v1/auth/session')).status, 401, 'old sessions are revoked');

    const old = await client(base).post('/v1/auth/signin', { identifier: email, password });
    assert.equal(old.status, 401);
    const fresh = await client(base).post('/v1/auth/signin', { identifier: email, password: newPassword });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.json.user.email_verified, true, 'receiving the code proves the email address');
  });

  test('parallel guesses at a reset code get five tries in all', async () => {
    const { email } = await signUp();
    await client(base).post('/v1/auth/password/forgot', { email });
    const code = await lastEmailCode(server.app, email);
    const guesses = Array.from({ length: 20 }, (_, n) => String((Number(code) + n + 1) % 1_000_000).padStart(6, '0'));
    const answers = await Promise.all(guesses.map(guess => client(base).post('/v1/auth/password/reset', { email, code: guess, password: 'a brand new passphrase' })));
    assert.equal(answers.filter(answer => answer.json.error?.code === 'code_invalid').length, 5);
    const right = await client(base).post('/v1/auth/password/reset', { email, code, password: 'a brand new passphrase' });
    assert.equal(right.json.error.code, 'code_attempts_exceeded', 'the real code is no use once the tries are spent');
  });

  test('a wrong code changes nothing', async () => {
    const { email } = await signUp();
    await client(base).post('/v1/auth/password/forgot', { email });
    const reset = await client(base).post('/v1/auth/password/reset', { email, code: '000000', password: 'a brand new passphrase' });
    assert.equal(reset.status, 400);
    assert.equal((await client(base).post('/v1/auth/signin', { identifier: email, password })).status, 200);
  });
});

describe('browser access (CORS)', () => {
  test('BitoCard apps may call with cookies; other sites may not', async () => {
    const allowed = await fetch(`${base}/v1/auth/session`, { method: 'OPTIONS', headers: { origin: appOrigin, 'access-control-request-method': 'GET' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), appOrigin);
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
    const subdomain = await fetch(`${base}/v1/auth/session`, { method: 'OPTIONS', headers: { origin: 'https://shq.bitocard.com', 'access-control-request-method': 'GET' } });
    assert.equal(subdomain.headers.get('access-control-allow-origin'), 'https://shq.bitocard.com');
    const other = await fetch(`${base}/v1/auth/session`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  });
});
