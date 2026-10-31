// Afrippa's own admins (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 1): a realm of their own (`afrippa_admin`) on
// admin.afrippa.com. Their accounts, sign-in, cookie, step-up and audit trail are apart from BitoCard's, and neither
// realm's sessions, challenges or links reach the other's routes.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { adminClient, adminCode, afrippaAdminClient, afrippaAdminOrigin, appOrigin, client, startApp } from './helpers.mjs';

const { EmailService } = await import('../dist/notifications/email.service.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { AdminAuthService } = await import('../dist/auth/admin-auth.service.js');

const afrippaListed = 'ops@afrippa.com';
const bitocardListed = 'ops@bitocard.com';
let server;
let prisma;

before(async () => {
  server = await startApp({ env: { AFRIPPA_ADMIN_SETUP_EMAILS: afrippaListed, ADMIN_SETUP_EMAILS: bitocardListed, ADMIN_APP_URL: 'https://admin.bitocard.test' } });
  prisma = server.app.get(PrismaService);
});

after(async () => {
  await server?.close();
});

const emailsTo = to => server.app.get(EmailService).outbox.filter(item => item.to === to);
const linkToken = to => /#token=(\S+)/.exec(emailsTo(to).filter(item => /set-password#token=/.test(item.text)).at(-1).text)[1];
const afrippaBrowser = () => client(server.base, { autoIdempotency: true, origin: afrippaAdminOrigin });

describe("Afrippa's admins sign in on their own", () => {
  test('a listed address is set up from the sign-in page, emailed in Afrippa’s name, then signs in with its own authenticator and cookie', async () => {
    const browser = afrippaBrowser();
    assert.equal((await browser.post('/v1/afrippa/admin/auth/start', { email: afrippaListed })).json.next, 'link_sent');
    const message = emailsTo(afrippaListed).at(-1);
    assert.equal(message.subject, 'Set up your Afrippa admin account');
    assert.ok(message.text.includes(`: ${afrippaAdminOrigin}/set-password#token=`), message.text);
    assert.match(message.text, /\nAfrippa\.$/);
    assert.doesNotMatch(message.text, /BitoCard/);
    const account = await prisma.user.findUniqueOrThrow({ where: { realm_email: { realm: 'afrippa_admin', email: afrippaListed } } });
    assert.deepEqual(account.adminRoles, ['super_admin']);
    assert.equal(await prisma.user.findUnique({ where: { realm_email: { realm: 'admin', email: afrippaListed } } }), null, 'no BitoCard account is made');

    const token = linkToken(afrippaListed);
    // A BitoCard page cannot use it: the link is Afrippa's.
    assert.equal((await client(server.base).post('/v1/admin/auth/password-link', { token })).json.error.code, 'link_invalid');
    assert.equal((await browser.post('/v1/afrippa/admin/auth/password-link', { token })).json.kind, 'create');
    assert.equal((await browser.post('/v1/afrippa/admin/auth/password-link/complete', { token, password: 'an afrippa admin passphrase', name: 'Ops Afrippa' })).status, 200);

    const challenge = (await browser.post('/v1/afrippa/admin/auth/signin', { email: afrippaListed, password: 'an afrippa admin passphrase' })).json;
    assert.equal(challenge.mfa_setup_required, true);
    const setup = (await browser.post('/v1/afrippa/admin/auth/mfa/setup', { challenge_token: challenge.challenge_token })).json;
    assert.match(setup.otpauth_uri, /^otpauth:\/\/totp\/Afrippa%20Admin:/);
    const code = new TOTP({ issuer: 'Afrippa Admin', label: afrippaListed, secret: Secret.fromBase32(setup.secret) }).generate();
    const verified = await browser.post('/v1/afrippa/admin/auth/mfa/verify', { challenge_token: challenge.challenge_token, code });
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    assert.equal(verified.json.recovery_codes.length, 10);
    assert.equal(browser.jar.has('afr_admin_session'), true);
    assert.equal(browser.jar.has('bc_admin_session'), false);
    const cookie = verified.res.headers.getSetCookie().find(line => line.startsWith('afr_admin_session='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.doesNotMatch(cookie, /Domain=/i, 'host-only');
    assert.equal((await browser.get('/v1/afrippa/admin/auth/session')).json.admin.email, afrippaListed);
    assert.equal((await browser.post('/v1/afrippa/admin/auth/signout')).status, 204);
    assert.equal(browser.jar.has('afr_admin_session'), false);
  });

  test("each realm's set-up list and domains are its own", async () => {
    const browser = afrippaBrowser();
    // BitoCard's listed address is not on Afrippa's list (and not on its domain): it goes on to a password, nothing made.
    assert.equal((await browser.post('/v1/afrippa/admin/auth/start', { email: bitocardListed })).json.next, 'password');
    assert.equal((await client(server.base).post('/v1/admin/auth/start', { email: afrippaListed })).json.next, 'password');
    assert.equal(await prisma.user.findUnique({ where: { realm_email: { realm: 'afrippa_admin', email: bitocardListed } } }), null);
    // A BitoCard admin's own password does not sign in to Afrippa, nor an Afrippa admin's to BitoCard.
    const bitocard = await adminClient(server);
    const refused = await browser.post('/v1/afrippa/admin/auth/signin', { email: bitocard.admin.email, password: 'admin passphrase long' });
    assert.equal(refused.json.error.code, 'invalid_credentials');
    const afrippa = await afrippaAdminClient(server);
    assert.equal((await client(server.base).post('/v1/admin/auth/signin', { email: afrippa.admin.email, password: 'admin passphrase long' })).json.error.code, 'invalid_credentials');
    await assert.rejects(server.app.get(AdminAuthService).createAdmin({ email: 'someone@bitocard.com', name: 'X', roles: ['support'], realm: 'afrippa_admin' }), /afrippa\.com/);
  });

  test("a sign-in challenge of one realm cannot be finished in the other", async () => {
    const bitocard = await adminClient(server);
    await prisma.user.updateMany({ where: { realm: 'admin', email: bitocard.admin.email }, data: { failedSignIns: 0 } });
    const challenge = (await client(server.base).post('/v1/admin/auth/signin', { email: bitocard.admin.email, password: 'admin passphrase long' })).json;
    const used = await afrippaBrowser().post('/v1/afrippa/admin/auth/mfa/verify', { challenge_token: challenge.challenge_token, code: await adminCode(server, bitocard) });
    assert.equal(used.json.error.code, 'challenge_invalid');
    assert.equal(await prisma.session.count({ where: { realm: 'afrippa_admin', user: { email: bitocard.admin.email } } }), 0);
  });
});

describe('neither realm reaches the other', () => {
  test("BitoCard's admins cannot use Afrippa's admin routes, nor Afrippa's admins BitoCard's, even with the other's cookie", async () => {
    const bitocard = await adminClient(server);
    const afrippa = await afrippaAdminClient(server);
    assert.equal((await afrippa.get('/v1/afrippa/admin/crypto/assets')).status, 200);
    assert.equal((await bitocard.get('/v1/afrippa/admin/crypto/assets')).status, 401);
    assert.equal((await bitocard.get('/v1/afrippa/admin/activity')).status, 401);
    assert.equal((await afrippa.get('/v1/admin/overview')).status, 401);
    assert.equal((await afrippa.get('/v1/admin/resellers')).status, 401);
    // A session token presented under the other realm's cookie name is no session there.
    const afrippaToken = afrippa.jar.get('afr_admin_session');
    const bitocardToken = bitocard.jar.get('bc_admin_session');
    assert.equal((await fetch(`${server.base}/v1/admin/overview`, { headers: { cookie: `bc_admin_session=${afrippaToken}` } })).status, 401);
    assert.equal((await fetch(`${server.base}/v1/afrippa/admin/crypto/assets`, { headers: { cookie: `afr_admin_session=${bitocardToken}` } })).status, 401);
  });

  test("Afrippa's admins change things only from their own app, and BitoCard's never from it", async () => {
    const afrippa = await afrippaAdminClient(server);
    const fromBitocard = await afrippa.post('/v1/afrippa/admin/auth/step-up', { code: '123456' }, { origin: appOrigin });
    assert.deepEqual([fromBitocard.status, fromBitocard.json.error.code], [403, 'not_permitted']);
    const bitocard = await adminClient(server);
    const fromAfrippa = await bitocard.post('/v1/admin/auth/step-up', { code: '123456' }, { origin: afrippaAdminOrigin });
    assert.deepEqual([fromAfrippa.status, fromAfrippa.json.error.code], [403, 'not_permitted']);
    // CORS lets Afrippa's admin app read the API's answers.
    const preflight = await fetch(`${server.base}/v1/afrippa/admin/auth/session`, { method: 'OPTIONS', headers: { origin: afrippaAdminOrigin, 'access-control-request-method': 'GET' } });
    assert.equal(preflight.headers.get('access-control-allow-origin'), afrippaAdminOrigin);
  });

  test("step-up is Afrippa's own: its money and rule changes need its admin's authenticator code", async () => {
    const afrippa = await afrippaAdminClient(server, ['super_admin'], { stepUp: false });
    const change = () => afrippa.patch('/v1/afrippa/admin/crypto/assets/USDT', { p2p_fee_bps: 25 });
    assert.equal((await change()).json.error.code, 'step_up_required');
    const opened = await afrippa.post('/v1/afrippa/admin/auth/step-up', { code: await adminCode(server, afrippa) });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    assert.equal((await afrippa.get('/v1/afrippa/admin/auth/session')).json.step_up_until, opened.json.step_up_until);
    assert.equal((await change()).status, 200);
  });

  test("each realm reads only its own audit trail", async () => {
    const afrippa = await afrippaAdminClient(server);
    const bitocard = await adminClient(server);
    const afrippaUser = await prisma.user.findFirstOrThrow({ where: { realm: 'afrippa_admin', email: afrippa.admin.email } });
    const bitocardUser = await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email: bitocard.admin.email } });
    await afrippa.post('/v1/afrippa/admin/auth/step-up', { code: await adminCode(server, afrippa) });
    await bitocard.post('/v1/admin/auth/step-up', { code: await adminCode(server, bitocard) });

    const afrippaTrail = (await afrippa.get('/v1/afrippa/admin/activity?limit=100')).json.data;
    const bitocardTrail = (await bitocard.get('/v1/admin/activity?limit=100')).json.data;
    assert.ok(afrippaTrail.some(entry => entry.actor?.id === afrippaUser.id && entry.action === 'admin.step_up'));
    assert.equal(afrippaTrail.some(entry => entry.actor?.id === bitocardUser.id), false);
    assert.ok(bitocardTrail.some(entry => entry.actor?.id === bitocardUser.id && entry.action === 'admin.step_up'));
    assert.equal(bitocardTrail.some(entry => entry.actor?.id === afrippaUser.id), false);
    // The set-up of a listed Afrippa admin (no actor) is Afrippa's too.
    assert.equal(bitocardTrail.some(entry => entry.action === 'admin.created' && entry.after?.by === 'AFRIPPA_ADMIN_SETUP_EMAILS'), false);
  });
});
