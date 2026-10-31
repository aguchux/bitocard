// Step-by-step sign-up: the email is confirmed with a code before the account exists, then the account is created.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, lastEmailCode, startApp } from './helpers.mjs';

const password = 'correct horse battery';
let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(() => server?.close());

const unique = () => `step${(counter += 1)}-${Date.now()}@example.com`;

/** Steps 1 and 2: email a code and confirm it. Returns the sign-up token. */
async function confirmEmail(email) {
  const browser = client(server.base);
  assert.equal((await browser.post('/v1/auth/signup/email', { email })).status, 202);
  const verified = await browser.post('/v1/auth/signup/email/verify', { email, code: await lastEmailCode(server.app, email) });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  return verified.json.signup_token;
}

describe('step-by-step sign-up', () => {
  test('confirming the email first creates an account whose email is already confirmed, and sends no second code', async () => {
    const email = unique();
    const token = await confirmEmail(email);
    const outbox = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox;
    const sentBefore = outbox.filter(message => message.to === email).length;

    const browser = client(server.base);
    const created = await browser.post('/v1/auth/signup', { name: 'Ada Obi', email, password, business_name: 'Ada Digital', country: 'NG', signup_token: token });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.user.email_verified, true);
    assert.deepEqual([created.json.memberships[0].role, created.json.memberships[0].reseller.name], ['owner', 'Ada Digital']);
    assert.equal(outbox.filter(message => message.to === email).length, sentBefore, 'no confirmation code after sign-up');
    assert.equal((await browser.get('/v1/auth/session')).status, 200);
  });

  test('a token works once, only for its own email, and not after it expires', async () => {
    const email = unique();
    const token = await confirmEmail(email);
    const other = await client(server.base).post('/v1/auth/signup', { name: 'Eve', email: unique(), password, country: 'NG', signup_token: token });
    assert.deepEqual([other.status, other.json.error.code, other.json.error.param], [400, 'signup_token_invalid', 'signup_token']);

    assert.equal((await client(server.base).post('/v1/auth/signup', { name: 'Ada', email, password, country: 'NG', signup_token: token })).status, 201);
    const again = await client(server.base).post('/v1/auth/signup', { name: 'Ada', email: unique(), password, country: 'NG', signup_token: token });
    assert.equal(again.json.error.code, 'signup_token_invalid');

    const late = unique();
    const lateToken = await confirmEmail(late);
    await prisma.signupVerification.updateMany({ where: { email: late }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await client(server.base).post('/v1/auth/signup', { name: 'Ada', email: late, password, country: 'NG', signup_token: lateToken });
    assert.equal(expired.json.error.code, 'signup_token_invalid');
    assert.equal(await prisma.user.count({ where: { email: late } }), 0, 'nothing is created');
  });

  test('a failed sign-up leaves the token usable, so the person can fix the password and finish', async () => {
    const email = unique();
    const token = await confirmEmail(email);
    const short = await client(server.base).post('/v1/auth/signup', { name: 'Ada', email, password: 'short', country: 'NG', signup_token: token });
    assert.equal(short.status, 400);
    const closed = await client(server.base).post('/v1/auth/signup', { name: 'Ada', email, password, country: 'US', signup_token: token });
    assert.equal(closed.json.error.code, 'country_not_supported');
    assert.equal((await client(server.base).post('/v1/auth/signup', { name: 'Ada', email, password, country: 'NG', signup_token: token })).status, 201);
  });

  test('wrong codes count, five lock the code, and a new code replaces the old one', async () => {
    const email = unique();
    const browser = client(server.base);
    await browser.post('/v1/auth/signup/email', { email });
    const code = await lastEmailCode(server.app, email);
    const wrong = code === '000000' ? '111111' : '000000';
    const first = await browser.post('/v1/auth/signup/email/verify', { email, code: wrong });
    assert.deepEqual([first.status, first.json.error.code, first.json.error.param], [400, 'code_invalid', 'code']);
    for (let i = 0; i < 4; i += 1) await browser.post('/v1/auth/signup/email/verify', { email, code: wrong });
    const locked = await browser.post('/v1/auth/signup/email/verify', { email, code });
    assert.equal(locked.json.error.code, 'code_attempts_exceeded');

    const soon = await browser.post('/v1/auth/signup/email', { email });
    assert.deepEqual([soon.status, soon.json.error.code], [429, 'code_recently_sent']);
    await prisma.signupVerification.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) } });
    assert.equal((await browser.post('/v1/auth/signup/email', { email })).status, 202);
    const fresh = await lastEmailCode(server.app, email);
    if (fresh !== code) assert.equal((await browser.post('/v1/auth/signup/email/verify', { email, code })).json.error.code, 'code_invalid', 'the old code no longer works');
    assert.equal((await browser.post('/v1/auth/signup/email/verify', { email, code: fresh })).status, 200);
  });

  test('no more than ten codes a day to one address, whoever asks', async () => {
    const email = unique();
    const minuteAgo = new Date(Date.now() - 2 * 60 * 1000);
    await prisma.signupVerification.createMany({
      data: Array.from({ length: 10 }, () => ({ email, codeHash: 'x', expiresAt: minuteAgo, consumedAt: minuteAgo, createdAt: minuteAgo })),
    });
    const capped = await client(server.base).post('/v1/auth/signup/email', { email });
    assert.deepEqual([capped.status, capped.json.error.code], [429, 'code_daily_limit']);
    assert.equal(await lastEmailCode(server.app, email), null, 'nothing sent');
  });

  test('an email already in use is refused at the first step, and only hashes are stored', async () => {
    const email = unique();
    await client(server.base).post('/v1/auth/signup', { name: 'Ada', email, password, country: 'NG' });
    const taken = await client(server.base).post('/v1/auth/signup/email', { email });
    assert.deepEqual([taken.status, taken.json.error.code, taken.json.error.param], [409, 'email_in_use', 'email']);

    const other = unique();
    const token = await confirmEmail(other);
    const row = await prisma.signupVerification.findFirstOrThrow({ where: { email: other } });
    assert.ok(row.tokenHash && row.tokenHash !== token && !JSON.stringify(row).includes(token));
    assert.equal((await client(server.base).post('/v1/auth/signup/email', { email: 'not-an-email' })).status, 400);
  });
});
