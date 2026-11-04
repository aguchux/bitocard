// "Continue with Google" for Udozo's customers (udozo.com's accounts), against a fake Google issuing real signed ID
// tokens: udozo.com's server drives the round trip (start, then finish with the code); sign-up is deliberate, an unknown
// Google account creates nothing, a Google account never links itself to a password account, and Seller HQ's round
// trips and the customers' never finish each other's. A new account onboards before using anything else: its country,
// then its mobile confirmed by a texted code. Seller HQ's onboarding confirms the owner's mobile the same way.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { client, fakeService, lastSmsCode, startApp, testMobile } from './helpers.mjs';

const { PrismaService } = await import('../dist/database/prisma.service.js');
const { oauthCookie } = await import('../dist/auth/google.service.js');

const clientId = 'udozo.apps.googleusercontent.com';
let server;
let google;
let keys;
let prisma;
let identity;
let counter = 0;

before(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  google = await fakeService(async call => {
    if (call.url.startsWith('/certs')) return { body: { keys: [jwk] } };
    if (call.url.startsWith('/token')) {
      const form = new URLSearchParams(call.body);
      if (createHash('sha256').update(form.get('code_verifier')).digest('base64url') !== identity.challenge) return { status: 400, body: { error: 'invalid_grant' } };
      if (form.get('redirect_uri') !== identity.redirect) return { status: 400, body: { error: 'redirect_uri_mismatch' } };
      const idToken = await new SignJWT({ email: identity.email, email_verified: true, name: 'Ngozi Ada Okafor', given_name: 'Ngozi', family_name: 'Okafor', nonce: identity.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://accounts.google.com')
        .setAudience(clientId)
        .setSubject(identity.sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
      return { body: { id_token: idToken } };
    }
    return { status: 404, body: {} };
  });
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      PRODUCT_ROUTES: 'separate',
      STOREFRONT_URL: 'https://udozo.com',
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: 'udozo-secret',
      GOOGLE_AUTH_URL: `${google.url}/auth`,
      GOOGLE_TOKEN_URL: `${google.url}/token`,
      GOOGLE_JWKS_URL: `${google.url}/certs`,
    },
  });
  prisma = server.app.get(PrismaService);
});

after(async () => {
  await server?.close();
  await google?.close();
});

/** udozo.com's server, keeping the customer's session as the site would. */
function site() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `cg-${Date.now()}-${Math.random()}` } : {}),
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

const who = () => ({ sub: `google-sub-${(counter += 1)}-${Date.now()}`, email: `g${counter}-${Date.now()}@gmail.com` });

/** udozo.com starts a round trip; the (pretend) customer consents as `person`; returns the state to finish with. */
async function consent(browser, intent, person) {
  const started = await browser.post('/v1/store/account/google/start', { intent });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const url = new URL(started.json.url);
  identity = { ...person, nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'), redirect: url.searchParams.get('redirect_uri') };
  return { state: started.json.state, url };
}

describe("udozo.com's customers with Google", () => {
  test('Google returns to udozo.com; sign-up makes the account with its email confirmed, Google’s names unconfirmed and no password', async () => {
    const browser = site();
    const person = who();
    const { state, url } = await consent(browser, 'signup', person);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://udozo.com/auth/google/callback');
    assert.equal(url.searchParams.get('client_id'), clientId);
    const done = await browser.post('/v1/store/account/google/finish', { state, code: 'google-code' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.signed_up, true);
    assert.deepEqual(
      [done.json.customer.email, done.json.customer.email_verified, done.json.customer.first_name, done.json.customer.last_name, done.json.customer.name_confirmed, done.json.customer.country],
      [person.email, true, 'Ngozi', 'Okafor', false, null],
    );
    const row = await prisma.customer.findFirstOrThrow({ where: { email: person.email } });
    assert.deepEqual([row.googleSubject, row.passwordHash], [person.sub, null]);
    assert.equal((await browser.post('/v1/store/account/google/finish', { state, code: 'google-code' })).json.error.code, 'google_state_invalid', 'a state works once');
    assert.equal((await browser.post('/v1/store/account/signin/lookup', { email: person.email })).json.password, false, 'sign-in says to use Google');

    // Signing in again with Google: the same account.
    const again = site();
    const second = await consent(again, 'signin', person);
    const signedIn = await again.post('/v1/store/account/google/finish', { state: second.state, code: 'google-code' });
    assert.deepEqual([signedIn.status, signedIn.json.signed_up, signedIn.json.customer.id], [200, false, done.json.customer.id]);
  });

  test('onboarding: the account reaches only its own steps until its country is chosen and its mobile confirmed', async () => {
    const browser = site();
    const { state } = await consent(browser, 'signup', who());
    await browser.post('/v1/store/account/google/finish', { state, code: 'google-code' });
    const blocked = await browser.get('/v1/store/wallet');
    assert.deepEqual([blocked.status, blocked.json.error.code, blocked.json.error.param], [403, 'profile_incomplete', 'country']);

    const profile = await browser.post('/v1/store/account/profile', { first_name: 'Ngozi Ada', last_name: 'Okafor', country: 'NG' });
    assert.equal(profile.status, 200, JSON.stringify(profile.json));
    assert.deepEqual([profile.json.country, profile.json.name_confirmed], ['NG', true]);
    assert.equal((await browser.get('/v1/store/wallet')).json.error.code, 'phone_not_verified', 'then the mobile');

    const phone = testMobile('NG');
    assert.equal((await browser.post('/v1/store/account/phone', { phone })).status, 202);
    const confirmed = await browser.post('/v1/store/account/phone/verify', { code: await lastSmsCode(server.app, phone) });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal((await browser.get('/v1/store/wallet')).status, 200, 'onboarded');
  });

  test('signing in with a Google account no account uses signs up, to onboard; it never takes over an account with the same email', async () => {
    const browser = site();
    const newcomer = who();
    const stranger = await consent(browser, 'signin', newcomer);
    const joined = await browser.post('/v1/store/account/google/finish', { state: stranger.state, code: 'google-code' });
    assert.equal(joined.status, 200, JSON.stringify(joined.json));
    assert.deepEqual([joined.json.signed_up, joined.json.customer.email, joined.json.customer.email_verified, joined.json.customer.country], [true, newcomer.email, true, null]);
    const again = await consent(browser, 'signin', newcomer);
    const back = await browser.post('/v1/store/account/google/finish', { state: again.state, code: 'google-code' });
    assert.deepEqual([back.status, back.json.signed_up, back.json.customer.id], [200, false, joined.json.customer.id], 'the same account next time');

    const person = who();
    const made = await site().post('/v1/store/account/signup', { first_name: 'Ada', last_name: 'Obi', email: person.email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const taken = await consent(browser, 'signup', person);
    const refused = await browser.post('/v1/store/account/google/finish', { state: taken.state, code: 'google-code' });
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'account_exists_sign_in_with_password']);
    assert.equal((await prisma.customer.findFirstOrThrow({ where: { email: person.email } })).googleSubject, null);
  });

  test("a customer's round trip never finishes at Seller HQ's Google callback", async () => {
    const { state } = await consent(site(), 'signup', who());
    const res = await fetch(`${server.base}/v1/auth/google/callback?state=${state}&code=google-code`, { headers: { cookie: `${oauthCookie}=${state}` }, redirect: 'manual' });
    assert.match(res.headers.get('location') ?? '', /auth_error=google_state_invalid/);
    assert.ok(await prisma.oAuthState.findUnique({ where: { id: createHash('sha256').update(state).digest('hex') } }), "left for udozo.com's own finish");
  });
});

describe("Seller HQ's onboarding", () => {
  test('a person without a business confirms their mobile with a texted code before the account opens; it signs in', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = `onboard${(counter += 1)}-${Date.now()}@example.com`;
    // Someone who joined a team and left, or a Google sign-up: signed in with a confirmed email and no business.
    const made = await browser.post('/v1/auth/signup', { first_name: 'Kofi', last_name: 'Mensah', email, password: 'correct horse battery', country: 'GH' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    await prisma.user.update({ where: { id: made.json.user.id }, data: { emailVerifiedAt: new Date() } });
    await prisma.resellerMember.deleteMany({ where: { userId: made.json.user.id } });

    const token = await browser.post('/v1/auth/onboarding/signup-token', {});
    assert.equal(token.status, 200, JSON.stringify(token.json));
    const phone = testMobile('GH');
    const texted = await browser.post('/v1/auth/signup/phone', { email, signup_token: token.json.signup_token, country: 'GH', phone });
    assert.equal(texted.status, 202, JSON.stringify(texted.json));
    const verified = await browser.post('/v1/auth/signup/phone/verify', { email, signup_token: token.json.signup_token, code: await lastSmsCode(server.app, phone) });
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    const opened = await browser.post('/v1/auth/reseller-account', { business_name: 'Kofi Digital', country: 'GH', phone, signup_token: token.json.signup_token });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    assert.deepEqual([opened.json.user.phone, opened.json.user.phone_verified], [phone, true]);
    assert.ok(await prisma.userPhone.findFirst({ where: { userId: made.json.user.id, phone } }), 'a sign-in number');
    assert.equal((await browser.post('/v1/auth/onboarding/signup-token', {})).json.error.code, 'already_owner');
  });
});
