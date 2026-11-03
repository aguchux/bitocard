// 2-step verification is each BitoCard admin's own choice: off until they set it up, "Not now" at the first sign-in
// (email and password alone), turned on later from Your account. Once on, it is asked at every sign-in. Afrippa's admins
// must still set it up, and step-up for sensitive and money actions always needs it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { adminClient, client, startApp } from './helpers.mjs';

let server;
let auth;
let counter = 0;
const password = 'a long admin passphrase';

before(async () => {
  server = await startApp({ env: { ADMIN_SETUP_EMAILS: 'founder@bitocard.com' } });
  auth = server.app.get((await import('../dist/auth/admin-auth.service.js')).AdminAuthService);
});

after(() => server?.close());

/** A new BitoCard admin with a password and no authenticator, and a browser at the password step's challenge. */
async function signInWithoutAuthenticator(roles = ['super_admin']) {
  const email = `admin-choice${(counter += 1)}-${Date.now()}@bitocard.com`;
  await auth.createAdmin({ email, name: 'Ada Admin', password, roles });
  const browser = client(server.base, { autoIdempotency: true });
  const challenge = await browser.post('/v1/admin/auth/signin', { email, password });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.json));
  return { email, browser, challenge: challenge.json };
}

const code = (email, secret) => new TOTP({ issuer: 'BitoCard Admin', label: email, secret: Secret.fromBase32(secret) }).generate();

describe("a BitoCard admin's 2-step verification", () => {
  test('is their choice, super admins too: Not now signs them in with email and password, and step-up asks them to turn it on', async () => {
    const { browser, challenge } = await signInWithoutAuthenticator();
    assert.deepEqual([challenge.mfa_setup_required, challenge.mfa_optional], [true, true]);
    // Starting the setup and then choosing Not now still signs them in.
    assert.equal((await browser.post('/v1/admin/auth/mfa/setup', { challenge_token: challenge.challenge_token })).status, 200);
    const skipped = await browser.post('/v1/admin/auth/mfa/skip', { challenge_token: challenge.challenge_token });
    assert.equal(skipped.status, 200, JSON.stringify(skipped.json));
    assert.deepEqual([skipped.json.admin.authenticator, skipped.json.admin.authenticator_required], [false, false]);
    assert.equal((await browser.post('/v1/admin/auth/mfa/skip', { challenge_token: challenge.challenge_token })).json.error.code, 'challenge_invalid', 'once');

    const session = await browser.get('/v1/admin/auth/session');
    assert.deepEqual([session.status, session.json.admin.authenticator], [200, false]);
    assert.equal((await browser.get('/v1/admin/resellers')).status, 200, 'the console works');
    const stepUp = await browser.post('/v1/admin/auth/step-up', { code: '123456' });
    assert.deepEqual([stepUp.status, stepUp.json.error.code], [403, 'authenticator_not_set_up']);
  });

  test('they turn it on from Your account with a code, get recovery codes once, and from then on it is asked at sign-in', async () => {
    const { email, browser, challenge } = await signInWithoutAuthenticator();
    await browser.post('/v1/admin/auth/mfa/skip', { challenge_token: challenge.challenge_token });

    const setup = await browser.post('/v1/admin/auth/authenticator/setup', {});
    assert.equal(setup.status, 200, JSON.stringify(setup.json));
    assert.match(setup.json.otpauth_uri, /^otpauth:\/\/totp\//);
    assert.equal((await browser.post('/v1/admin/auth/authenticator/confirm', { code: '000000' })).json.error.code, 'mfa_code_invalid');
    const confirmed = await browser.post('/v1/admin/auth/authenticator/confirm', { code: code(email, setup.json.secret) });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.recovery_codes.length, 10);
    assert.equal((await browser.get('/v1/admin/auth/session')).json.admin.authenticator, true);
    assert.equal((await browser.post('/v1/admin/auth/authenticator/setup', {})).json.error.code, 'mfa_already_set_up');

    const again = client(server.base, { autoIdempotency: true });
    const next = (await again.post('/v1/admin/auth/signin', { email, password })).json;
    assert.deepEqual([next.mfa_setup_required, next.mfa_optional], [false, false]);
    assert.equal((await again.post('/v1/admin/auth/mfa/skip', { challenge_token: next.challenge_token })).json.error.code, 'mfa_already_set_up');
    const signedIn = await again.post('/v1/admin/auth/mfa/verify', { challenge_token: next.challenge_token, code: confirmed.json.recovery_codes[0] });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  });

  test("skipping needs the password first, and Afrippa's admins must still set it up", async () => {
    const strangers = client(server.base, { autoIdempotency: true });
    assert.equal((await strangers.post('/v1/admin/auth/mfa/skip', { challenge_token: `${'0'.repeat(36)}.${'x'.repeat(43)}` })).json.error.code, 'challenge_invalid');

    const email = `afrippa-admin${Date.now()}@afrippa.com`;
    await auth.createAdmin({ email, name: 'Afrippa Admin', password, roles: ['support'], realm: 'afrippa_admin' });
    const afrippa = client(server.base, { autoIdempotency: true, origin: 'https://admin.afrippa.com' });
    const challenge = (await afrippa.post('/v1/afrippa/admin/auth/signin', { email, password })).json;
    assert.deepEqual([challenge.mfa_setup_required, challenge.mfa_optional], [true, false]);
    const skipped = await afrippa.post('/v1/afrippa/admin/auth/mfa/skip', { challenge_token: challenge.challenge_token });
    assert.deepEqual([skipped.status, skipped.json.error.code], [403, 'mfa_required']);

    const usual = await adminClient(server, ['operations']);
    const session = (await usual.get('/v1/admin/auth/session')).json.admin;
    assert.deepEqual([session.authenticator, session.authenticator_required], [true, false]);
  });

  test("a new admin's set-password email says 2-step verification is their choice", async () => {
    const started = await client(server.base, { autoIdempotency: true }).post('/v1/admin/auth/start', { email: 'founder@bitocard.com' });
    assert.equal(started.json.next, 'link_sent', JSON.stringify(started.json));
    const outbox = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox;
    assert.match(outbox.filter(message => message.to === 'founder@bitocard.com').at(-1)?.text ?? '', /You can turn on 2-step verification/);
  });
});
