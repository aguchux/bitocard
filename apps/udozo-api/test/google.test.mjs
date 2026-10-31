// Sign in with Google, against a fake Google that issues real signed ID tokens.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { appOrigin, client, fakeService, lastEmailCode, startApp } from './helpers.mjs';

const clientId = 'test-client.apps.googleusercontent.com';
let server;
let google;
let keys;
let nextIdentity;

before(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  google = await fakeService(async call => {
    if (call.url.startsWith('/certs')) return { body: { keys: [jwk] } };
    if (call.url.startsWith('/token')) {
      const form = new URLSearchParams(call.body);
      const identity = nextIdentity;
      if (identity.tokenStatus) return { status: identity.tokenStatus, body: { error: 'invalid_grant' } };
      // The verifier must match the challenge sent at the start (PKCE).
      const challenge = createHash('sha256').update(form.get('code_verifier')).digest('base64url');
      if (challenge !== identity.challenge) return { status: 400, body: { error: 'invalid_grant' } };
      const idToken = await new SignJWT({
        email: identity.email,
        email_verified: identity.emailVerified ?? true,
        name: identity.name ?? 'Grace Hopper',
        nonce: identity.nonce,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(identity.issuer ?? 'https://accounts.google.com')
        .setAudience(identity.audience ?? clientId)
        .setSubject(identity.sub)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
      return { body: { id_token: idToken, access_token: 'unused' } };
    }
    return { status: 404, body: {} };
  });
  server = await startApp({
    env: {
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_AUTH_URL: `${google.url}/auth`,
      GOOGLE_TOKEN_URL: `${google.url}/token`,
      GOOGLE_JWKS_URL: `${google.url}/certs`,
      GOOGLE_REDIRECT_URI: 'http://localhost/v1/auth/google/callback',
      DASHBOARD_URL: `${appOrigin}/dashboard`,
    },
  });
});

after(async () => {
  await server?.close();
  await google?.close();
});

let counter = 0;
const uniqueEmail = () => `google${(counter += 1)}-${Date.now()}@gmail.com`;
const signup = '?intent=signup';

/**
 * Runs the whole browser round trip: start, (pretend) Google consent, callback. `identity` describes who Google
 * says signed in; `tamper` can alter the callback query. Returns the final redirect and the browser.
 */
async function googleSignIn(identity, { browser = client(server.base), startQuery = '', tamper } = {}) {
  const start = await fetch(`${server.base}/v1/auth/google/start${startQuery}`, {
    redirect: 'manual',
    headers: { cookie: [...browser.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  assert.equal(start.status, 302);
  const googleUrl = new URL(start.headers.get('location'));
  const stateCookie = start.headers.getSetCookie().find(line => line.startsWith('bc_oauth_state='));
  const params = googleUrl.searchParams;
  nextIdentity = { ...identity, nonce: identity.nonce ?? params.get('nonce'), challenge: params.get('code_challenge') };

  const query = new URLSearchParams({ code: 'auth-code', state: params.get('state') });
  tamper?.(query);
  const cookies = [stateCookie.split(';')[0], ...[...browser.jar].map(([k, v]) => `${k}=${v}`)].join('; ');
  const callback = await fetch(`${server.base}/v1/auth/google/callback?${query}`, { redirect: 'manual', headers: { cookie: cookies } });
  for (const line of callback.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const [name, value] = pair.split('=');
    if (name === 'bc_session' && value) browser.jar.set(name, value);
  }
  return { googleUrl, location: new URL(callback.headers.get('location')), browser };
}

describe('starting the flow', () => {
  test('redirects to Google with PKCE, state, nonce and the right scopes', async () => {
    const res = await fetch(`${server.base}/v1/auth/google/start`, { redirect: 'manual' });
    const url = new URL(res.headers.get('location'));
    assert.equal(url.origin + url.pathname, `${google.url}/auth`);
    assert.equal(url.searchParams.get('client_id'), clientId);
    assert.equal(url.searchParams.get('scope'), 'openid email profile');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('state') && url.searchParams.get('nonce'));
    const cookie = res.headers.getSetCookie().find(line => line.startsWith('bc_oauth_state='));
    assert.match(cookie, /HttpOnly/i);
  });

  test('is unavailable when Google is not configured', async () => {
    const app = await startApp({ env: { GOOGLE_CLIENT_ID: '' }, database: 'pglite' });
    try {
      const res = await fetch(`${app.base}/v1/auth/google/start`, { redirect: 'manual' });
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error.code, 'google_not_configured');
    } finally {
      await app.close();
    }
  });
});

describe('signing up and in', () => {
  test('signing up with Google gives a confirmed person and a session; the reseller account comes with onboarding', async () => {
    const email = uniqueEmail();
    const { location, browser } = await googleSignIn({ sub: `sub-${email}`, email, name: 'Grace Hopper' }, { startQuery: signup });
    assert.equal(location.toString(), `${appOrigin}/dashboard`);
    const session = await browser.get('/v1/auth/session');
    assert.equal(session.status, 200);
    assert.deepEqual([session.json.user.email, session.json.user.email_verified, session.json.user.has_password], [email, true, false]);
    assert.deepEqual(session.json.memberships, [], 'no reseller account until onboarding');

    const onboarded = await browser.post('/v1/auth/reseller-account', { business_name: 'Grace Digital', country: 'NG' });
    assert.equal(onboarded.status, 201, JSON.stringify(onboarded.json));
    assert.deepEqual([onboarded.json.memberships[0].role, onboarded.json.memberships[0].reseller.country], ['owner', 'NG']);
  });

  test('signing in with a Google account that never signed up fails and creates nothing', async () => {
    const email = uniqueEmail();
    const { location, browser } = await googleSignIn({ sub: `sub-${email}`, email });
    assert.equal(location.searchParams.get('auth_error'), 'google_account_not_found');
    assert.equal((await browser.get('/v1/auth/session')).status, 401);
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    assert.equal(await server.app.get(PrismaService).user.count({ where: { email } }), 0);
  });

  test('the same Google account signs in to the same user next time', async () => {
    const email = uniqueEmail();
    const first = await googleSignIn({ sub: `sub-${email}`, email }, { startQuery: signup });
    const second = await googleSignIn({ sub: `sub-${email}`, email });
    const a = await first.browser.get('/v1/auth/session');
    const b = await second.browser.get('/v1/auth/session');
    assert.equal(a.json.user.id, b.json.user.id);
  });

  test('returns to the requested BitoCard app, never to another site', async () => {
    const email = uniqueEmail();
    const ok = await googleSignIn({ sub: `sub-${email}`, email }, { startQuery: `${signup}&return_to=${encodeURIComponent('https://shq.bitocard.com/welcome')}` });
    assert.equal(ok.location.toString(), 'https://shq.bitocard.com/welcome');
    const other = uniqueEmail();
    const evil = await googleSignIn({ sub: `sub-${other}`, email: other }, { startQuery: `${signup}&return_to=${encodeURIComponent('https://evil.example/steal')}` });
    assert.equal(evil.location.origin, appOrigin);
  });

  test('a Google-only person signs in with Google until they set a password; then both work', async () => {
    const email = uniqueEmail();
    const sub = `sub-${email}`;
    await googleSignIn({ sub, email }, { startQuery: signup });
    const password = 'my new long passphrase';
    const before = await client(server.base).post('/v1/auth/signin', { identifier: email, password });
    assert.deepEqual([before.status, before.json.error.code], [401, 'invalid_credentials'], 'no password yet');

    assert.equal((await client(server.base).post('/v1/auth/password/forgot', { email })).status, 202);
    const reset = await client(server.base).post('/v1/auth/password/reset', { email, code: await lastEmailCode(server.app, email), password });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));

    const withPassword = client(server.base);
    assert.equal((await withPassword.post('/v1/auth/signin', { identifier: email, password })).status, 200);
    const withGoogle = await googleSignIn({ sub, email });
    assert.equal(withGoogle.location.searchParams.get('auth_error'), null);
    assert.equal((await withGoogle.browser.get('/v1/auth/session')).json.user.id, (await withPassword.get('/v1/auth/session')).json.user.id);
  });
});

describe('protections', () => {
  test('an email/password account is not taken over by a Google account with the same email', async () => {
    const email = uniqueEmail();
    await client(server.base).post('/v1/auth/signup', { name: 'Ada', email, password: 'correct horse battery', country: 'NG' });
    for (const startQuery of ['', signup]) {
      const { location, browser } = await googleSignIn({ sub: `sub-${email}`, email }, { startQuery });
      assert.equal(location.searchParams.get('auth_error'), 'account_exists_sign_in_to_link', startQuery);
      assert.equal((await browser.get('/v1/auth/session')).status, 401);
    }
  });

  test('a signed-in person can link Google, then sign in with it', async () => {
    const email = uniqueEmail();
    const browser = client(server.base);
    await browser.post('/v1/auth/signup', { name: 'Ada', email, password: 'correct horse battery', country: 'NG' });
    const userId = (await browser.get('/v1/auth/session')).json.user.id;
    const linked = await googleSignIn({ sub: `sub-${email}`, email: `other-${email}` }, { browser, startQuery: '?intent=link' });
    assert.equal(linked.location.searchParams.get('auth_error'), null);

    const later = await googleSignIn({ sub: `sub-${email}`, email: `other-${email}` });
    assert.equal((await later.browser.get('/v1/auth/session')).json.user.id, userId);
  });

  test('a forged or replayed state is refused', async () => {
    const email = uniqueEmail();
    const { location } = await googleSignIn({ sub: `sub-${email}`, email }, { tamper: query => query.set('state', 'forged') });
    assert.equal(location.searchParams.get('auth_error'), 'google_state_invalid');
  });

  test('a token for another app, with a wrong nonce, or an unconfirmed email is refused', async () => {
    for (const [identity, code] of [
      [{ audience: 'someone-else' }, 'google_token_invalid'],
      [{ nonce: 'wrong' }, 'google_token_invalid'],
      [{ issuer: 'https://evil.example' }, 'google_token_invalid'],
      [{ emailVerified: false }, 'google_email_unverified'],
    ]) {
      const email = uniqueEmail();
      const { location, browser } = await googleSignIn({ sub: `sub-${email}`, email, ...identity }, { startQuery: signup });
      assert.equal(location.searchParams.get('auth_error'), code, JSON.stringify(identity));
      assert.equal((await browser.get('/v1/auth/session')).status, 401);
    }
  });

  test('a cancelled consent or a failed code exchange returns an error, not a session', async () => {
    const email = uniqueEmail();
    const cancelled = await googleSignIn({ sub: `sub-${email}`, email }, { tamper: query => query.set('error', 'access_denied') });
    assert.equal(cancelled.location.searchParams.get('auth_error'), 'google_cancelled');
    const failed = await googleSignIn({ sub: `sub-${email}`, email, tokenStatus: 400 });
    assert.equal(failed.location.searchParams.get('auth_error'), 'google_failed');
  });
});
