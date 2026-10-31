// Google sign-in for Afrippa's traders (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 5b), with Afrippa's own Google client,
// against a fake Google issuing real signed ID tokens. Afrippa's server drives the round trip (start, then finish with
// the code); sign-up is deliberate, an unknown Google account creates nothing, a Google account never links itself to a
// password account, and neither BitoCard's round trips nor Afrippa's finish the other's.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { adminCode, afrippaAdminClient, fakeService, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { afrippaStoreId } = await import('../dist/afrippa/ids.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-google-secret-afrippa-google-sec';
const afrippaClientId = 'afrippa.apps.googleusercontent.com';
const bitocardClientId = 'bitocard.apps.googleusercontent.com';
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
      if (form.get('client_id') !== afrippaClientId || form.get('client_secret') !== 'afrippa-secret') return { status: 401, body: { error: 'invalid_client' } };
      const idToken = await new SignJWT({ email: identity.email, email_verified: true, name: 'Grace Trader', nonce: identity.nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://accounts.google.com')
        .setAudience(identity.audience ?? afrippaClientId)
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
      CRYPTO_ROUTES: 'closed',
      AFRIPPA_SERVER_SECRET: secret,
      // BitoCard's own Google client, from the environment: never Afrippa's.
      GOOGLE_CLIENT_ID: bitocardClientId,
      GOOGLE_CLIENT_SECRET: 'bitocard-secret',
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

async function afrippa(method, path, body, { signed = true } = {}) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers: {
      ...(signed ? { 'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }) } : {}),
      ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method === 'POST' ? { 'idempotency-key': `g-${Date.now()}-${Math.random()}` } : {}),
    },
    body: raw,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Afrippa's server starts a round trip; the (pretend) trader consents as `who`; returns the state to finish with. */
async function consent(intent, who) {
  const started = await afrippa('POST', '/v1/afrippa/account/google/start', { intent });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const url = new URL(started.json.url);
  identity = { ...who, nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge') };
  return { state: started.json.state, url };
}

const newIdentity = () => ({ sub: `google-${(counter += 1)}-${Date.now()}`, email: `grace${counter}-${Date.now()}@gmail.com` });

describe("Afrippa's traders sign in with Google", () => {
  test("not offered until Afrippa sets its own Google client: BitoCard's is never used", async () => {
    const refused = await afrippa('POST', '/v1/afrippa/account/google/start', { intent: 'signup' });
    assert.deepEqual([refused.status, refused.json.error.code], [503, 'google_not_configured']);
    const admin = await afrippaAdminClient(server);
    const saved = await admin.put('/v1/afrippa/admin/integrations/google', { values: { GOOGLE_CLIENT_ID: afrippaClientId, GOOGLE_CLIENT_SECRET: 'afrippa-secret' }, code: await adminCode(server, admin) });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    // Unsigned, the routes are unknown.
    assert.equal((await afrippa('POST', '/v1/afrippa/account/google/start', { intent: 'signin' }, { signed: false })).status, 404);
  });

  test("signing up: Afrippa's client and address, the email confirmed by Google, no password, two-step still to set up", async () => {
    const who = newIdentity();
    const { state, url } = await consent('signup', who);
    assert.deepEqual([url.searchParams.get('client_id'), url.searchParams.get('redirect_uri')], [afrippaClientId, 'https://afrippa.com/auth/google/callback']);
    assert.equal((await afrippa('POST', '/v1/afrippa/account/google/finish', { state, code: 'google-code' })).json.error.param, 'country', 'a country first, the state kept');
    const done = await afrippa('POST', '/v1/afrippa/account/google/finish', { state, code: 'google-code', country: 'NG' });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.signed_up, true);
    assert.deepEqual([done.json.two_step.pending, done.json.two_step.setup_required], [true, true]);
    assert.ok(done.json.session.token);
    const trader = await prisma.customer.findUniqueOrThrow({ where: { id: done.json.customer.id } });
    assert.deepEqual([trader.storeId, trader.googleSubject, trader.passwordHash, trader.country, trader.emailVerifiedAt !== null], [afrippaStoreId, who.sub, null, 'NG', true]);
    // The state works once.
    assert.equal((await afrippa('POST', '/v1/afrippa/account/google/finish', { state, code: 'google-code', country: 'NG' })).json.error.code, 'google_state_invalid');

    // Signing in again with Google finds the same trader, who still owes the two-step code.
    const again = await consent('signin', who);
    const signedIn = await afrippa('POST', '/v1/afrippa/account/google/finish', { state: again.state, code: 'google-code' });
    assert.deepEqual([signedIn.json.customer.id, signedIn.json.signed_up, signedIn.json.two_step.pending], [trader.id, false, true]);
  });

  test('signing in with a Google account that never signed up creates nothing', async () => {
    const who = newIdentity();
    const { state } = await consent('signin', who);
    const refused = await afrippa('POST', '/v1/afrippa/account/google/finish', { state, code: 'google-code' });
    assert.deepEqual([refused.status, refused.json.error.code], [404, 'google_account_not_found']);
    assert.equal(await prisma.customer.count({ where: { email: who.email } }), 0);
  });

  test('a Google account never links itself to a password account with the same email', async () => {
    const who = newIdentity();
    assert.equal((await afrippa('POST', '/v1/afrippa/account/signup', { name: 'Grace Password', email: who.email, password: 'correct horse battery', country: 'NG' })).status, 201);
    for (const intent of ['signin', 'signup']) {
      const { state } = await consent(intent, who);
      const refused = await afrippa('POST', '/v1/afrippa/account/google/finish', { state, code: 'google-code', country: 'NG' });
      assert.deepEqual([refused.status, refused.json.error.code], [409, 'account_exists_sign_in_with_password'], intent);
    }
    const account = await prisma.customer.findFirstOrThrow({ where: { storeId: afrippaStoreId, email: who.email } });
    assert.equal(account.googleSubject, null);
  });

  test('an ID token for another client is refused', async () => {
    const who = { ...newIdentity(), audience: bitocardClientId };
    const { state } = await consent('signup', who);
    const refused = await afrippa('POST', '/v1/afrippa/account/google/finish', { state, code: 'google-code', country: 'NG' });
    assert.equal(refused.json.error.code, 'google_token_invalid');
  });

  test("neither product finishes the other's round trip", async () => {
    // A BitoCard reseller round trip's state is unknown to Afrippa's finish.
    const bitocardStart = await fetch(`${server.base}/v1/auth/google/start?intent=signup`, { redirect: 'manual' });
    const bitocardState = new URL(bitocardStart.headers.get('location')).searchParams.get('state');
    assert.equal((await afrippa('POST', '/v1/afrippa/account/google/finish', { state: bitocardState, code: 'google-code', country: 'NG' })).json.error.code, 'google_state_invalid');
    // And an Afrippa state at BitoCard's callback goes back with an error, signing no one in.
    const { state } = await consent('signup', newIdentity());
    const callback = await fetch(`${server.base}/v1/auth/google/callback?state=${state}&code=google-code`, { redirect: 'manual', headers: { cookie: `bc_oauth_state=${state}` } });
    assert.match(callback.headers.get('location'), /auth_error=google_state_invalid/);
    assert.equal((callback.headers.getSetCookie?.() ?? []).some(line => line.startsWith('bc_session=')), false);
  });

  test('a Google-only trader adds a password with Forgot password, then both ways work', async () => {
    const who = newIdentity();
    const { state } = await consent('signup', who);
    await afrippa('POST', '/v1/afrippa/account/google/finish', { state, code: 'google-code', country: 'NG' });
    assert.equal((await afrippa('POST', '/v1/afrippa/account/signin', { email: who.email, password: 'any password at all' })).json.error.code, 'invalid_credentials');
    const trader = await prisma.customer.findFirstOrThrow({ where: { storeId: afrippaStoreId, email: who.email } });
    const { CustomersService } = await import('../dist/customers/customers.service.js');
    await assert.rejects(server.app.get(CustomersService).changePassword(trader, 'none', { current_password: 'guess', password: 'a new long passphrase' }), { code: 'password_not_set' });
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: trader.id } })).failedSignIns, trader.failedSignIns, 'never counted towards the lockout');
    await afrippa('POST', '/v1/afrippa/account/password/forgot', { email: who.email });
    const code = /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === who.email).at(-1).subject)[1];
    assert.equal((await afrippa('POST', '/v1/afrippa/account/password/reset', { email: who.email, code, password: 'a new long passphrase' })).status, 200);
    assert.equal((await afrippa('POST', '/v1/afrippa/account/signin', { email: who.email, password: 'a new long passphrase' })).status, 200);
    const again = await consent('signin', who);
    assert.equal((await afrippa('POST', '/v1/afrippa/account/google/finish', { state: again.state, code: 'google-code' })).status, 200);
  });
});
