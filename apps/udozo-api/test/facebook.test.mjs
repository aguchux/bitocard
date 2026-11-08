// "Continue with Facebook" (8 November 2026, the owner's request) for udozo.com's customers and Seller HQ's people,
// against a fake Facebook (the code exchange and /me, signed with appsecret_proof). Facebook does not confirm emails, so
// a new account's email waits for Udozo's emailed code; a Facebook account never links itself to an account with the
// same email; no email shared is refused; and a Facebook round trip never finishes as a Google one or the other way round.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { appOrigin, client, fakeService, lastEmailCode, startApp, testMobile } from './helpers.mjs';

const { PrismaService } = await import('../dist/database/prisma.service.js');
const { facebookCookie } = await import('../dist/auth/facebook.service.js');

const appId = '1234567890';
const appSecret = 'udozo-facebook-secret';
let server;
let facebook;
let prisma;
let person;
let counter = 0;

before(async () => {
  facebook = await fakeService(async call => {
    const url = new URL(call.url, 'http://facebook.test');
    if (url.pathname === '/v23.0/oauth/access_token') {
      if (url.searchParams.get('client_secret') !== appSecret || url.searchParams.get('code') !== 'facebook-code') return { status: 400, body: { error: { message: 'bad code' } } };
      return { body: { access_token: `token-${person.id}`, token_type: 'bearer' } };
    }
    if (url.pathname === '/v23.0/me') {
      const token = url.searchParams.get('access_token');
      // Every Graph call is signed with the app's secret.
      if (url.searchParams.get('appsecret_proof') !== createHmac('sha256', appSecret).update(token).digest('hex')) return { status: 400, body: { error: { message: 'bad proof' } } };
      return { body: { id: person.id, ...(person.email ? { email: person.email } : {}), first_name: 'Chiamaka', last_name: 'Eze', name: 'Chiamaka Eze' } };
    }
    return { status: 404, body: {} };
  });
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      PRODUCT_ROUTES: 'separate',
      STOREFRONT_URL: 'https://udozo.com',
      DASHBOARD_URL: `${appOrigin}/dashboard`,
      FACEBOOK_APP_ID: appId,
      FACEBOOK_APP_SECRET: appSecret,
      FACEBOOK_DIALOG_URL: `${facebook.url}/v23.0/dialog/oauth`,
      FACEBOOK_GRAPH_URL: `${facebook.url}/v23.0`,
      FACEBOOK_REDIRECT_URI: 'http://localhost/v1/auth/facebook/callback',
    },
  });
  prisma = server.app.get(PrismaService);
});

after(async () => {
  await server?.close();
  await facebook?.close();
});

const who = () => ({ id: `fb-${(counter += 1)}-${Date.now()}`, email: `f${counter}-${Date.now()}@example.com` });

/** udozo.com's server, keeping the customer's session as the site would. */
function site() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: { ...(token ? { 'bitocard-customer-session': token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method === 'POST' ? { 'idempotency-key': `fb-${Date.now()}-${Math.random()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

async function customerRoundTrip(browser, intent, who) {
  person = who;
  const started = await browser.post('/v1/store/account/facebook/start', { intent });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  return { state: started.json.state, url: new URL(started.json.url), finish: () => browser.post('/v1/store/account/facebook/finish', { state: started.json.state, code: 'facebook-code' }) };
}

describe("udozo.com's customers with Facebook", () => {
  test('Facebook returns to udozo.com; a new account is made with Facebook’s names, no password, and its email to confirm with Udozo’s code', async () => {
    const browser = site();
    const someone = who();
    const trip = await customerRoundTrip(browser, 'signup', someone);
    assert.equal(trip.url.origin + trip.url.pathname, `${facebook.url}/v23.0/dialog/oauth`);
    assert.deepEqual(
      [trip.url.searchParams.get('client_id'), trip.url.searchParams.get('redirect_uri'), trip.url.searchParams.get('scope'), trip.url.searchParams.get('response_type')],
      [appId, 'https://udozo.com/auth/facebook/callback', 'email,public_profile', 'code'],
    );
    const done = await trip.finish();
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.signed_up, true);
    assert.deepEqual(
      [done.json.customer.email, done.json.customer.email_verified, done.json.customer.first_name, done.json.customer.last_name, done.json.customer.name_confirmed],
      [someone.email, false, 'Chiamaka', 'Eze', false],
    );
    const row = await prisma.customer.findFirstOrThrow({ where: { email: someone.email } });
    assert.deepEqual([row.facebookSubject, row.googleSubject, row.passwordHash], [someone.id, null, null]);
    // The code was emailed at once; confirming it confirms the email.
    const code = await lastEmailCode(server.app, someone.email);
    assert.ok(code, 'an email confirmation code');
    const confirmed = await browser.post('/v1/store/account/email/verify', { code });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.email_verified, true);
    assert.equal((await trip.finish()).json.error.code, 'facebook_state_invalid', 'a state works once');

    // Signing in again with the same Facebook account: the same account.
    const again = await customerRoundTrip(site(), 'signin', someone);
    const back = await again.finish();
    assert.deepEqual([back.status, back.json.signed_up, back.json.customer.id], [200, false, done.json.customer.id]);
  });

  test('never takes over an account with the same email; no email shared is refused; Google and Facebook never finish each other’s', async () => {
    const owner = who();
    const made = await site().post('/v1/store/account/signup', { first_name: 'Ada', last_name: 'Obi', email: owner.email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const taken = await (await customerRoundTrip(site(), 'signin', owner)).finish();
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'account_exists_sign_in_with_password']);
    assert.equal((await prisma.customer.findFirstOrThrow({ where: { email: owner.email } })).facebookSubject, null);

    const silent = await (await customerRoundTrip(site(), 'signup', { id: `fb-silent-${Date.now()}`, email: null })).finish();
    assert.deepEqual([silent.status, silent.json.error.code], [400, 'facebook_email_missing']);

    const trip = await customerRoundTrip(site(), 'signin', who());
    const asGoogle = await site().post('/v1/store/account/google/finish', { state: trip.state, code: 'facebook-code' });
    assert.ok(['google_state_invalid', 'google_not_configured'].includes(asGoogle.json.error.code), JSON.stringify(asGoogle.json));
    assert.ok(await prisma.oAuthState.findUnique({ where: { id: createHash('sha256').update(trip.state).digest('hex') } }), 'left for its own finish');
  });

  test('is unavailable until the app ID and secret are set', async () => {
    const app = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', FACEBOOK_APP_ID: '' }, database: 'pglite' });
    try {
      const res = await fetch(`${app.base}/v1/store/account/facebook/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: 'signin' }) });
      assert.deepEqual([res.status, (await res.json()).error.code], [503, 'facebook_not_configured']);
    } finally {
      await app.close();
    }
  });
});

/** Seller HQ's round trip in a browser: start, (pretend) consent as `who`, callback. */
async function shqRoundTrip(who, { intent = 'signin', tamper } = {}) {
  person = who;
  const browser = client(server.base);
  const start = await fetch(`${server.base}/v1/auth/facebook/start?intent=${intent}&return_to=${encodeURIComponent(`${appOrigin}/signin`)}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const url = new URL(start.headers.get('location'));
  const cookie = start.headers.getSetCookie().find(line => line.startsWith(`${facebookCookie}=`));
  const query = new URLSearchParams({ code: 'facebook-code', state: url.searchParams.get('state') });
  tamper?.(query);
  const callback = await fetch(`${server.base}/v1/auth/facebook/callback?${query}`, { redirect: 'manual', headers: { cookie: cookie.split(';')[0] } });
  for (const line of callback.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const [name, value] = pair.split('=');
    // Udozo's own session cookie.
    if (name === 'udz_session' && value) browser.jar.set(name, value);
  }
  return { url, cookie, location: new URL(callback.headers.get('location')), browser };
}

describe("Seller HQ's people with Facebook", () => {
  test('a new person is made with their email to confirm, then onboards; the same Facebook account signs in again', async () => {
    const someone = who();
    const { url, cookie, location, browser } = await shqRoundTrip(someone, { intent: 'signup' });
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost/v1/auth/facebook/callback');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Path=\/v1\/auth\/facebook/i);
    assert.equal(location.toString(), `${appOrigin}/signin`);
    const session = await browser.get('/v1/auth/session');
    assert.equal(session.status, 200, JSON.stringify(session.json));
    assert.deepEqual([session.json.user.email, session.json.user.email_verified, session.json.user.has_password], [someone.email, false, false]);
    assert.ok(await prisma.oAuthAccount.findFirst({ where: { provider: 'facebook', providerUserId: someone.id } }));
    assert.ok(await lastEmailCode(server.app, someone.email), 'its email confirmation code was sent');

    const again = await shqRoundTrip(someone);
    assert.equal((await again.browser.get('/v1/auth/session')).json.user.id, session.json.user.id);
  });

  test('refusals come back to Seller HQ as auth_error: a taken email, a cancelled consent, a state from elsewhere', async () => {
    const owner = who();
    const made = await client(server.base, { autoIdempotency: true }).post('/v1/auth/signup', { first_name: 'Kofi', last_name: 'Mensah', email: owner.email, password: 'correct horse battery', country: 'GH' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal((await shqRoundTrip(owner)).location.searchParams.get('auth_error'), 'account_exists_sign_in_to_link');
    assert.equal((await shqRoundTrip(who(), { tamper: query => query.set('error', 'access_denied') })).location.searchParams.get('auth_error'), 'facebook_cancelled');
    assert.equal((await shqRoundTrip(who(), { tamper: query => query.set('state', 'not-the-state') })).location.searchParams.get('auth_error'), 'facebook_state_invalid');

    // A customer's round trip never finishes at Seller HQ's callback.
    const trip = await customerRoundTrip(site(), 'signin', who());
    const res = await fetch(`${server.base}/v1/auth/facebook/callback?state=${trip.state}&code=facebook-code`, { headers: { cookie: `${facebookCookie}=${trip.state}` }, redirect: 'manual' });
    assert.match(res.headers.get('location') ?? '', /auth_error=facebook_state_invalid/);
  });
});

describe("Meta's deauthorize and data deletion callbacks", () => {
  const sign = (payload, secret = appSecret) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${createHmac('sha256', secret).update(body).digest('base64url')}.${body}`;
  };
  const post = (path, signed) =>
    fetch(`${server.base}/v1/webhooks/facebook/${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ signed_request: signed }).toString() });

  test('a request not signed with the app secret changes nothing', async () => {
    const customer = await prisma.customer.findFirstOrThrow({ where: { facebookSubject: { not: null } } });
    for (const signed of [sign({ algorithm: 'HMAC-SHA256', user_id: customer.facebookSubject }, 'someone-else'), 'not.signed', sign({ algorithm: 'RS256', user_id: customer.facebookSubject })]) {
      assert.equal((await post('data-deletion', signed)).status, 401);
    }
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).facebookSubject, customer.facebookSubject);
  });

  test('deauthorizing unlinks the Facebook account from udozo.com and Seller HQ, keeping the Udozo accounts', async () => {
    const customer = await prisma.customer.findFirstOrThrow({ where: { facebookSubject: { not: null } } });
    const subject = customer.facebookSubject;
    const account = await prisma.oAuthAccount.findFirstOrThrow({ where: { provider: 'facebook' } });
    await prisma.oAuthAccount.update({ where: { id: account.id }, data: { providerUserId: subject } });
    const res = await post('deauthorize', sign({ algorithm: 'HMAC-SHA256', user_id: subject, issued_at: Math.floor(Date.now() / 1000) }));
    assert.equal(res.status, 200);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).facebookSubject, null);
    assert.equal(await prisma.oAuthAccount.count({ where: { id: account.id } }), 0);
    assert.ok(await prisma.user.findUnique({ where: { id: account.userId } }), 'the person is kept');
  });

  test('a deletion request answers a status page and a confirmation code, readable afterwards', async () => {
    const someone = await prisma.customer.findFirstOrThrow({ where: { facebookSubject: null } });
    const customer = await prisma.customer.update({ where: { id: someone.id }, data: { facebookSubject: `fb-delete-${Date.now()}` } });
    const res = await post('data-deletion', sign({ algorithm: 'HMAC-SHA256', user_id: customer.facebookSubject }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.confirmation_code, /^[A-Z0-9]{12}$/);
    assert.equal(body.url, `https://udozo.com/legal/facebook-deletion?code=${body.confirmation_code}`);
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).facebookSubject, null);
    const status = await (await fetch(`${server.base}/v1/facebook/data-deletion/${body.confirmation_code}`)).json();
    assert.equal(status.status, 'completed');
    assert.equal(status.confirmation_code, body.confirmation_code);
    assert.equal((await fetch(`${server.base}/v1/facebook/data-deletion/NOSUCHCODE00`)).status, 404);
  });
});
