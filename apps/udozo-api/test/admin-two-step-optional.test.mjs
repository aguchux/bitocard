// 2-step verification is a team member's choice on Udozo's admin: off until they set it up, "Not now" at the first
// sign-in, turned on later from their account. Super admins (and Afrippa's admins) must still set it up, and step-up
// always needs it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { adminClient, client, startApp } from './helpers.mjs';

let server;
let auth;
let counter = 0;
const password = 'a long staff passphrase';

before(async () => {
  server = await startApp();
  auth = server.app.get((await import('../dist/auth/admin-auth.service.js')).AdminAuthService);
});

after(() => server?.close());

/** A new admin with a password and no authenticator, and a browser at the password step's challenge. */
async function signInWithoutAuthenticator(roles) {
  const email = `member${(counter += 1)}-${Date.now()}@bitocard.com`;
  await auth.createAdmin({ email, name: 'Team Member', password, roles });
  const browser = client(server.base, { autoIdempotency: true });
  const challenge = await browser.post('/v1/admin/auth/signin', { email, password });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.json));
  return { email, browser, challenge: challenge.json };
}

const code = (email, secret) => new TOTP({ issuer: 'BitoCard Admin', label: email, secret: Secret.fromBase32(secret) }).generate();

describe("a team member's 2-step verification", () => {
  test('is off by default: they may skip it at sign-in, and step-up asks them to turn it on', async () => {
    const { browser, challenge } = await signInWithoutAuthenticator(['support']);
    assert.deepEqual([challenge.mfa_setup_required, challenge.mfa_optional], [true, true]);
    // Starting the setup and then choosing Not now still signs them in.
    assert.equal((await browser.post('/v1/admin/auth/mfa/setup', { challenge_token: challenge.challenge_token })).status, 200);
    const skipped = await browser.post('/v1/admin/auth/mfa/skip', { challenge_token: challenge.challenge_token });
    assert.equal(skipped.status, 200, JSON.stringify(skipped.json));
    assert.deepEqual([skipped.json.admin.authenticator, skipped.json.admin.authenticator_required], [false, false]);
    assert.equal((await browser.post('/v1/admin/auth/mfa/skip', { challenge_token: challenge.challenge_token })).json.error.code, 'challenge_invalid', 'once');

    const session = await browser.get('/v1/admin/auth/session');
    assert.deepEqual([session.status, session.json.admin.authenticator], [200, false]);
    const stepUp = await browser.post('/v1/admin/auth/step-up', { code: '123456' });
    assert.deepEqual([stepUp.status, stepUp.json.error.code], [403, 'authenticator_not_set_up']);
  });

  test('they turn it on from their account with a code, get recovery codes once, and then sign in with it', async () => {
    const { email, browser, challenge } = await signInWithoutAuthenticator(['finance']);
    await browser.post('/v1/admin/auth/mfa/skip', { challenge_token: challenge.challenge_token });

    const setup = await browser.post('/v1/admin/auth/authenticator/setup', {});
    assert.equal(setup.status, 200, JSON.stringify(setup.json));
    assert.match(setup.json.otpauth_uri, /^otpauth:\/\/totp\//);
    const wrong = await browser.post('/v1/admin/auth/authenticator/confirm', { code: '000000' });
    assert.equal(wrong.json.error.code, 'mfa_code_invalid');
    const confirmed = await browser.post('/v1/admin/auth/authenticator/confirm', { code: code(email, setup.json.secret) });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.recovery_codes.length, 10);
    assert.equal((await browser.get('/v1/admin/auth/session')).json.admin.authenticator, true);
    assert.equal((await browser.post('/v1/admin/auth/authenticator/setup', {})).json.error.code, 'mfa_already_set_up');

    // Now it is asked at every sign-in and cannot be skipped.
    const again = client(server.base, { autoIdempotency: true });
    const next = (await again.post('/v1/admin/auth/signin', { email, password })).json;
    assert.deepEqual([next.mfa_setup_required, next.mfa_optional], [false, false]);
    assert.equal((await again.post('/v1/admin/auth/mfa/skip', { challenge_token: next.challenge_token })).json.error.code, 'mfa_already_set_up');
    const signedIn = await again.post('/v1/admin/auth/mfa/verify', { challenge_token: next.challenge_token, code: confirmed.json.recovery_codes[0] });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  });

  test('super admins must set it up, and those who set it up at sign-in are as before', async () => {
    const { browser, challenge } = await signInWithoutAuthenticator(['super_admin', 'operations']);
    assert.deepEqual([challenge.mfa_setup_required, challenge.mfa_optional], [true, false]);
    const skipped = await browser.post('/v1/admin/auth/mfa/skip', { challenge_token: challenge.challenge_token });
    assert.deepEqual([skipped.status, skipped.json.error.code], [403, 'mfa_required']);
    assert.equal((await browser.get('/v1/admin/auth/session')).status, 401, 'not signed in');

    const member = await adminClient(server, ['support']);
    const session = (await member.get('/v1/admin/auth/session')).json.admin;
    assert.deepEqual([session.authenticator, session.authenticator_required], [true, false]);
  });

  test("an invited member's email says 2-step verification is their choice", async () => {
    const owner = await adminClient(server, ['super_admin']);
    const email = `invited${Date.now()}@bitocard.com`;
    assert.equal((await owner.post('/v1/admin/team', { name: 'Kemi Ade', email, roles: ['support'] })).status, 201);
    const outbox = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox;
    assert.match(outbox.filter(message => message.to === email).at(-1)?.text ?? '', /You can turn on 2-step verification/);
  });
});
