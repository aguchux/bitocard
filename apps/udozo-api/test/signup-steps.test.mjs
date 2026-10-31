// Sign-up and sign-in one step at a time, on udozo.com and Seller HQ. Sign-up: the email (free, then its emailed code),
// the name and country, the mobile (its texted code), then the password: the account starts with both confirmed.
// Sign-in: the email first, then the password if an account uses it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, lastEmailCode, lastSmsCode, resellerClient, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let counter = 0;
const password = 'correct horse battery';

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', STOREFRONT_URL: 'https://udozo.com' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(() => server?.close());

/** udozo.com's server (or a store's, naming it), keeping the session as the site would. */
function site(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `steps-${Date.now()}-${Math.random()}` } : {}),
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

const unique = () => `steps${(counter += 1)}-${Date.now()}@example.com`;

describe('udozo.com: one step at a time', () => {
  test('email and its code, name and country, mobile and its code, then the password: confirmed from the start', async () => {
    const browser = site();
    const email = unique();
    assert.deepEqual((await browser.post('/v1/store/account/signin/lookup', { email })).json, { object: 'account_lookup', email, exists: false });

    assert.equal((await browser.post('/v1/store/account/signup/email', { email })).status, 202);
    const confirmed = await browser.post('/v1/store/account/signup/email/verify', { email, code: await lastEmailCode(server.app, email) });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    const token = confirmed.json.signup_token;

    const phone = testMobile('NG');
    const texted = await browser.post('/v1/store/account/signup/phone', { email, signup_token: token, country: 'NG', phone });
    assert.equal(texted.status, 202, JSON.stringify(texted.json));
    const mobile = await browser.post('/v1/store/account/signup/phone/verify', { email, signup_token: token, code: await lastSmsCode(server.app, phone) });
    assert.deepEqual([mobile.status, mobile.json.phone], [200, phone]);

    const sentBefore = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox.filter(item => item.to === email).length;
    const made = await browser.post('/v1/store/account/signup', { name: 'Amaka Eze', email, country: 'NG', phone, password, signup_token: token });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.customer.email_verified, made.json.customer.phone_verified], [true, true]);
    assert.equal(server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox.filter(item => item.to === email).length, sentBefore, 'no code sent afterwards');
    // Nothing waits: the account works at once.
    assert.notEqual((await browser.get('/v1/store/wallet')).json?.error?.code, 'phone_not_verified');

    // Sign-in's first step now finds it; sign-up's refuses it.
    assert.equal((await site().post('/v1/store/account/signin/lookup', { email: email.toUpperCase() })).json.exists, true);
    const again = await site().post('/v1/store/account/signup/email', { email });
    assert.deepEqual([again.status, again.json.error.code], [409, 'email_taken']);
    // The token is used up.
    const reused = await site().post('/v1/store/account/signup/phone', { email, signup_token: token, country: 'NG', phone: testMobile('NG') });
    assert.equal(reused.json.error.code, 'signup_token_invalid');
  });

  test('a token is only for its own store, its own email, and Seller HQ’s never works here (nor the other way)', async () => {
    const owner = await resellerClient(server);
    const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Gadget Hub', subdomain: `steps${Date.now() % 100000}`, status: 'published' } });
    // A Udozo store shares udozo.com's accounts, so its sign-up is udozo.com's too.
    const atStore = site(store.subdomain);
    const email = unique();
    assert.equal((await atStore.post('/v1/store/account/signup/email', { email })).status, 202);
    const token = (await atStore.post('/v1/store/account/signup/email/verify', { email, code: await lastEmailCode(server.app, email) })).json.signup_token;
    assert.equal((await site().post('/v1/store/account/signup/phone', { email, signup_token: token, country: 'NG', phone: testMobile('NG') })).status, 202, 'udozo.com takes it');
    assert.equal((await site().post('/v1/store/account/signup/phone', { email: unique(), signup_token: token, country: 'NG', phone: testMobile('NG') })).json.error.code, 'signup_token_invalid');

    const shq = client(server.base, { autoIdempotency: true });
    const sellerEmail = unique();
    assert.equal((await shq.post('/v1/auth/signup/email', { email: sellerEmail })).status, 202);
    const sellerToken = (await shq.post('/v1/auth/signup/email/verify', { email: sellerEmail, code: await lastEmailCode(server.app, sellerEmail) })).json.signup_token;
    assert.equal((await site().post('/v1/store/account/signup/phone', { email: sellerEmail, signup_token: sellerToken, country: 'NG', phone: testMobile('NG') })).json.error.code, 'signup_token_invalid');
    assert.equal((await shq.post('/v1/auth/signup/phone', { email, signup_token: token, country: 'NG', phone: testMobile('NG') })).json.error.code, 'signup_token_invalid');
  });

  test('a number already on an account is refused; where the country cannot text, sign-up carries on unconfirmed', async () => {
    const first = site();
    const email = unique();
    const phone = testMobile('NG');
    await first.post('/v1/store/account/signup', { name: 'Kemi Ade', email, country: 'NG', phone, password });
    const second = site();
    const other = unique();
    await second.post('/v1/store/account/signup/email', { email: other });
    const token = (await second.post('/v1/store/account/signup/email/verify', { email: other, code: await lastEmailCode(server.app, other) })).json.signup_token;
    const taken = await second.post('/v1/store/account/signup/phone', { email: other, signup_token: token, country: 'NG', phone });
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'phone_in_use']);

    await prisma.country.update({ where: { code: 'KE' }, data: { smsProvider: null } });
    try {
      const unavailable = await second.post('/v1/store/account/signup/phone', { email: other, signup_token: token, country: 'KE', phone: testMobile('KE') });
      assert.deepEqual([unavailable.status, unavailable.json.error.code], [409, 'phone_verification_unavailable']);
      const made = await second.post('/v1/store/account/signup', { name: 'Wanjiru K', email: other, country: 'KE', phone: testMobile('KE'), password, signup_token: token });
      assert.deepEqual([made.status, made.json.customer.email_verified, made.json.customer.phone_verified], [201, true, false]);
    } finally {
      await prisma.country.update({ where: { code: 'KE' }, data: { smsProvider: 'termii' } });
    }
  });
});

describe('Seller HQ: email first, then the password', () => {
  test('says whether an account signs in with the email or mobile, and whether it has a password', async () => {
    const shq = client(server.base, { autoIdempotency: true });
    const owner = await resellerClient(server);
    const found = await shq.post('/v1/auth/signin/lookup', { identifier: owner.email });
    assert.deepEqual(found.json, { object: 'account_lookup', exists: true, password: true });
    assert.deepEqual((await shq.post('/v1/auth/signin/lookup', { identifier: unique() })).json, { object: 'account_lookup', exists: false, password: false });

    await prisma.user.update({ where: { id: owner.userId }, data: { passwordHash: null } });
    assert.deepEqual((await shq.post('/v1/auth/signin/lookup', { identifier: owner.email })).json, { object: 'account_lookup', exists: true, password: false }, 'Google only');

    const phone = '+2348031119900';
    await prisma.user.update({ where: { id: owner.userId }, data: { phone, phoneVerifiedAt: new Date() } });
    assert.equal((await shq.post('/v1/auth/signin/lookup', { identifier: phone })).json.exists, true);
  });
});
