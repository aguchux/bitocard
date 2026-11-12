// Udozo's app (docs/UDOZO_MOBILE_APP_PLAN.md, phase 0): native sign-in with Google, Facebook and Apple (each SDK hands
// the app a token, checked here against fakes issuing real signed tokens), the app's own sign-up journeys, and deleting
// the account (refused while money is under way; then details gone, sessions ended, Apple's access revoked).
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import { fakeService, startApp } from './helpers.mjs';

const { PrismaService } = await import('../dist/database/prisma.service.js');

const webClient = 'web.apps.googleusercontent.com';
const androidClient = 'android.apps.googleusercontent.com';
const fbApp = '1234567890';
const bundle = 'com.udozo.app';
let server;
let idp;
let prisma;
let googleKeys;
let appleKeys;
let fbKeys;
const apple = { refreshed: [], revoked: [] };
const fbTokens = new Map();

before(async () => {
  googleKeys = await generateKeyPair('RS256');
  appleKeys = await generateKeyPair('RS256');
  fbKeys = await generateKeyPair('RS256');
  const signingKey = await generateKeyPair('ES256', { extractable: true });
  const jwk = async (keys, kid) => ({ ...(await exportJWK(keys.publicKey)), kid, alg: 'RS256', use: 'sig' });
  const [g, a, f] = [await jwk(googleKeys, 'g'), await jwk(appleKeys, 'a'), await jwk(fbKeys, 'f')];
  idp = await fakeService(async call => {
    if (call.url.startsWith('/google/certs')) return { body: { keys: [g] } };
    if (call.url.startsWith('/apple/auth/keys')) return { body: { keys: [a] } };
    if (call.url.startsWith('/apple/auth/token')) {
      const form = new URLSearchParams(call.body);
      apple.refreshed.push({ code: form.get('code'), clientId: form.get('client_id'), secret: form.get('client_secret') });
      return { body: { refresh_token: `rt-${form.get('code')}`, access_token: 'at' } };
    }
    if (call.url.startsWith('/apple/auth/revoke')) {
      apple.revoked.push(new URLSearchParams(call.body).get('token'));
      return { body: {} };
    }
    if (call.url.startsWith('/fb/jwks')) return { body: { keys: [f] } };
    if (call.url.startsWith('/graph/debug_token')) {
      const url = new URL(call.url, 'http://x');
      const user = fbTokens.get(url.searchParams.get('input_token'));
      if (url.searchParams.get('access_token') !== `${fbApp}|fb-secret`) return { status: 400, body: { error: {} } };
      return { body: { data: user ? { is_valid: true, app_id: user.app } : { is_valid: false } } };
    }
    if (call.url.startsWith('/graph/me')) {
      const user = fbTokens.get(new URL(call.url, 'http://x').searchParams.get('access_token'));
      return user ? { body: { id: user.id, email: user.email, first_name: 'Ada', last_name: 'Eze' } } : { status: 400, body: {} };
    }
    return { status: 404, body: {} };
  });
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      PRODUCT_ROUTES: 'separate',
      GOOGLE_CLIENT_ID: webClient,
      GOOGLE_CLIENT_SECRET: 'g-secret',
      GOOGLE_APP_CLIENT_IDS: `${androidClient}, ios.apps.googleusercontent.com`,
      GOOGLE_JWKS_URL: `${idp.url}/google/certs`,
      FACEBOOK_APP_ID: fbApp,
      FACEBOOK_APP_SECRET: 'fb-secret',
      FACEBOOK_GRAPH_URL: `${idp.url}/graph`,
      FACEBOOK_JWKS_URL: `${idp.url}/fb/jwks`,
      APPLE_BUNDLE_IDS: bundle,
      APPLE_AUTH_URL: `${idp.url}/apple`,
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      // Pasted into a one-line field: the line breaks are gone.
      APPLE_PRIVATE_KEY: (await exportPKCS8(signingKey.privateKey)).replace(/\n/g, ' '),
    },
  });
  prisma = server.app.get(PrismaService);
});

after(async () => {
  await server?.close();
  await idp?.close();
});

/** The app: its session from the secure store, `Udozo-App` on every call. */
function app(platform = 'android') {
  let token = null;
  return async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'udozo-app': `${platform}/0.1.0`,
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
}

const sign = (keys, kid, claims, { issuer, audience, subject }) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
const nonce = () => `n-${randomUUID()}`;
const googleToken = (sub, email, n, audience = androidClient) =>
  sign(googleKeys, 'g', { email, email_verified: true, given_name: 'Chidi', family_name: 'Obi', nonce: n }, { issuer: 'https://accounts.google.com', audience, subject: sub });
const appleToken = (sub, email, n) =>
  sign(appleKeys, 'a', { email, email_verified: 'true', is_private_email: 'true', nonce: createHash('sha256').update(n).digest('hex') }, { issuer: 'https://appleid.apple.com', audience: bundle, subject: sub });

describe('Google in the app', () => {
  test('a token for the app’s client signs up once, then signs in; another nonce or client is refused', async () => {
    const call = app();
    const n = nonce();
    const email = `g-${randomUUID()}@example.com`;
    const first = await call('POST', '/v1/store/account/google/native', { id_token: await googleToken('g-1', email, n), nonce: n });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.signed_up, true);
    assert.equal(first.json.customer.email, email);
    assert.ok(first.json.session.token);
    const again = nonce();
    const second = await app()('POST', '/v1/store/account/google/native', { id_token: await googleToken('g-1', email, again, webClient), nonce: again });
    assert.equal(second.json.signed_up, false);
    assert.equal(second.json.customer.id, first.json.customer.id);
    const wrong = await app()('POST', '/v1/store/account/google/native', { id_token: await googleToken('g-1', email, nonce()), nonce: nonce() });
    assert.equal(wrong.json.error.code, 'google_token_invalid');
    const other = nonce();
    const foreign = await app()('POST', '/v1/store/account/google/native', { id_token: await googleToken('g-1', email, other, 'someone-else'), nonce: other });
    assert.equal(foreign.json.error.code, 'google_token_invalid');
  });

  test('without a nonce (Android’s library) only a fresh token is taken', async () => {
    const email = `nn-${randomUUID()}@example.com`;
    const fresh = await new SignJWT({ email, email_verified: true, given_name: 'Uche' }).setProtectedHeader({ alg: 'RS256', kid: 'g' }).setIssuer('https://accounts.google.com').setAudience(webClient).setSubject(`g-${randomUUID()}`).setIssuedAt().setExpirationTime('1h').sign(googleKeys.privateKey);
    assert.equal((await app()('POST', '/v1/store/account/google/native', { id_token: fresh })).json.signed_up, true);
    const now = Math.floor(Date.now() / 1000);
    const stale = await new SignJWT({ email, email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'g' }).setIssuer('https://accounts.google.com').setAudience(webClient).setSubject(`g-${randomUUID()}`).setIssuedAt(now - 1800).setExpirationTime(now + 1800).sign(googleKeys.privateKey);
    assert.equal((await app()('POST', '/v1/store/account/google/native', { id_token: stale })).json.error.code, 'google_token_invalid');
  });

  test('the app’s sign-ups are the app’s journeys, labelled with the phone', async () => {
    const n = nonce();
    const email = `j-${randomUUID()}@example.com`;
    await app('ios')('POST', '/v1/store/account/google/native', { id_token: await googleToken(`g-${randomUUID()}`, email, n), nonce: n });
    const journey = await prisma.signupJourney.findFirst({ where: { email } });
    assert.equal(journey.surface, 'app');
    assert.equal(journey.method, 'google');
    assert.equal(journey.device, 'Udozo app on iPhone');
  });
});

describe('Facebook in the app', () => {
  test('an access token of this app signs up; another app’s is refused', async () => {
    const email = `f-${randomUUID()}@example.com`;
    fbTokens.set('fb-good-token-000000000', { id: `fb-${randomUUID()}`, email, app: fbApp });
    fbTokens.set('fb-other-app-000000000', { id: 'fb-x', email: 'x@example.com', app: '999' });
    const ok = await app()('POST', '/v1/store/account/facebook/native', { access_token: 'fb-good-token-000000000' });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.signed_up, true);
    // Facebook does not confirm emails: Udozo's code still does.
    assert.equal(ok.json.customer.email_verified, false);
    const other = await app()('POST', '/v1/store/account/facebook/native', { access_token: 'fb-other-app-000000000' });
    assert.equal(other.json.error.code, 'facebook_token_invalid');
  });

  test('Limited Login’s signed token, for the app’s nonce', async () => {
    const n = nonce();
    const email = `fl-${randomUUID()}@example.com`;
    const token = await sign(fbKeys, 'f', { email, given_name: 'Bisi', family_name: 'Ade', nonce: n }, { issuer: 'https://www.facebook.com', audience: fbApp, subject: `fbl-${randomUUID()}` });
    const ok = await app('ios')('POST', '/v1/store/account/facebook/native', { id_token: token, nonce: n });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.customer.email, email);
    const replayed = await app('ios')('POST', '/v1/store/account/facebook/native', { id_token: token, nonce: nonce() });
    assert.equal(replayed.json.error.code, 'facebook_token_invalid');
  });
});

describe('Sign in with Apple', () => {
  test('signs up with a relay address, keeps the refresh token encrypted, and never takes over an email', async () => {
    const n = nonce();
    const email = `relay-${randomUUID()}@privaterelay.appleid.com`;
    const sub = `apple-${randomUUID()}`;
    const res = await app('ios')('POST', '/v1/store/account/apple/native', { identity_token: await appleToken(sub, email, n), nonce: n, authorization_code: 'code-1', first_name: 'Tola', last_name: 'Bello' });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.signed_up, true);
    assert.equal(res.json.customer.email_verified, true);
    const row = await prisma.customer.findUnique({ where: { id: res.json.customer.id } });
    assert.equal(row.appleSubject, sub);
    assert.equal(row.firstName, 'Tola');
    assert.ok(row.appleRefreshTokenEncrypted && !row.appleRefreshTokenEncrypted.includes('rt-code-1'));
    assert.equal(apple.refreshed.at(-1).clientId, bundle);
    assert.equal(apple.refreshed.at(-1).secret.split('.').length, 3);

    // Someone else's account with that email is never linked.
    const taken = `taken-${randomUUID()}@example.com`;
    const g = nonce();
    await app()('POST', '/v1/store/account/google/native', { id_token: await googleToken(`g-${randomUUID()}`, taken, g), nonce: g });
    const m = nonce();
    const clash = await app('ios')('POST', '/v1/store/account/apple/native', { identity_token: await appleToken(`apple-${randomUUID()}`, taken, m), nonce: m });
    assert.equal(clash.json.error.code, 'account_exists_sign_in_with_password');
    const bad = nonce();
    const wrong = await app('ios')('POST', '/v1/store/account/apple/native', { identity_token: await appleToken(sub, email, bad), nonce: nonce() });
    assert.equal(wrong.json.error.code, 'apple_token_invalid');
  });
});

describe('Deleting the account', () => {
  test('refused while money is held; then details removed, signed out, Apple revoked, the email free again', async () => {
    const call = app('ios');
    const n = nonce();
    const email = `del-${randomUUID()}@privaterelay.appleid.com`;
    const signed = await call('POST', '/v1/store/account/apple/native', { identity_token: await appleToken(`apple-${randomUUID()}`, email, n), nonce: n, authorization_code: 'code-del' });
    const id = signed.json.customer.id;
    const wallet = await prisma.ledgerAccount.create({ data: { kind: 'customer_wallet', mode: 'live', currency: 'NGN', ownerKey: `customer:${id}`, customerId: id, balanceMinor: 5000n, nonNegative: true } });

    const check = await call('GET', '/v1/store/account/delete');
    assert.equal(check.json.can_delete, false);
    assert.equal(check.json.password_required, false);
    assert.deepEqual(check.json.blockers.map(item => item.code), ['account_has_money']);
    assert.equal((await call('POST', '/v1/store/account/delete', { confirm: 'DELETE' })).json.error.code, 'account_has_money');

    await prisma.ledgerAccount.update({ where: { id: wallet.id }, data: { balanceMinor: 0n } });
    assert.equal((await call('POST', '/v1/store/account/delete', { confirm: 'delete' })).status, 400);
    const done = await call('POST', '/v1/store/account/delete', { confirm: 'DELETE' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.deleted, true);

    const row = await prisma.customer.findUnique({ where: { id } });
    assert.equal(row.status, 'disabled');
    assert.ok(row.deletedAt);
    assert.equal(row.appleSubject, null);
    assert.equal(row.name, 'Deleted account');
    assert.notEqual(row.email, email);
    assert.ok(apple.revoked.includes('rt-code-del'));
    assert.equal((await call('GET', '/v1/store/account')).status, 401);

    // The same Apple ID signs up as a new account.
    const again = nonce();
    const fresh = await app('ios')('POST', '/v1/store/account/apple/native', { identity_token: await appleToken(`apple-${randomUUID()}`, email, again), nonce: again });
    assert.equal(fresh.json.signed_up, true);
    assert.notEqual(fresh.json.customer.id, id);
  });

  test('an account with a password needs it', async () => {
    const email = `pw-${randomUUID()}@example.com`;
    const customer = await prisma.customer.findFirst({ where: { email: { startsWith: 'g-' } } });
    assert.ok(customer);
    const call = app();
    const n = nonce();
    // A Google account given a password (as Forgot password would).
    const signed = await call('POST', '/v1/store/account/google/native', { id_token: await googleToken(`g-${randomUUID()}`, email, n), nonce: n });
    const { PasswordsService } = await import('../dist/auth/passwords.service.js');
    await prisma.customer.update({ where: { id: signed.json.customer.id }, data: { passwordHash: await server.app.get(PasswordsService).hash('a long password 123') } });
    assert.equal((await call('GET', '/v1/store/account/delete')).json.password_required, true);
    assert.equal((await call('POST', '/v1/store/account/delete', { confirm: 'DELETE', password: 'wrong one' })).json.error.code, 'password_incorrect');
    assert.equal((await call('POST', '/v1/store/account/delete', { confirm: 'DELETE', password: 'a long password 123' })).status, 200);
  });
});
