// Afrippa's traders' accounts (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 5): customers of Afrippa's own store, reached
// only through its signed server, with two-step sign-in required from day one. Admins choose the methods allowed (all of
// Afrippa and per market); a method switched off is replaced at the next sign-in; operations reset a trader who lost
// every method (signed out, withdrawals held 24 hours).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { adminClient, afrippaAdminClient, startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { afrippaStoreId } = await import('../dist/afrippa/ids.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-accounts-secret-afrippa-accounts';
let server;
let prisma;
let afrippaAdmin;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret, CHECKOUT_SANDBOX: 'on' } });
  prisma = server.app.get(PrismaService);
  afrippaAdmin = await afrippaAdminClient(server);
});

after(async () => {
  await server?.close();
});

/** Requests as Afrippa's server sends them: signed, the trader's session in its header. */
function afrippaServer() {
  let token = null;
  const request = async (method, path, body, { signed = true } = {}) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(signed ? { 'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }) } : {}),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `t-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body = {}, options) => request('POST', path, body, options),
    forget: () => (token = null),
  };
}

const outbox = () => server.app.get(EmailService).outbox;
const lastCodeTo = (email, pattern = /\b(\d{6})\b/) => pattern.exec(outbox().filter(item => item.to === email).at(-1).subject)?.[1];
const totp = (email, base32) => new TOTP({ issuer: 'Afrippa', label: email, secret: Secret.fromBase32(base32) });

/** A new trader with emailed two-step codes set up: signed in. */
async function trader() {
  const client = afrippaServer();
  const email = `trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
  const confirmed = await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return { client, email, id: signup.json.customer.id, recovery: confirmed.json.recovery_codes };
}

/** Signs a trader in again: password, then (as asked) the code. */
async function signIn(client, email) {
  client.forget();
  const signed = await client.post('/v1/afrippa/account/signin', { email, password: 'correct horse battery' });
  assert.equal(signed.status, 200, JSON.stringify(signed.json));
  return signed.json;
}

describe("Afrippa's traders sign up on Afrippa's own store", () => {
  test('a new account is Afrippa’s, emailed in Afrippa’s name, and unrelated to a bitocard.com account with the same email', async () => {
    const client = afrippaServer();
    const email = `new-${Date.now()}@example.com`;
    const signup = await client.post('/v1/afrippa/account/signup', { name: 'Ngozi Trader', email, password: 'correct horse battery', country: 'NG' });
    assert.equal(signup.status, 201, JSON.stringify(signup.json));
    assert.deepEqual(signup.json.two_step, { object: 'two_step_state', pending: true, setup_required: true, method: null, method_not_allowed: false });
    const account = await prisma.customer.findUniqueOrThrow({ where: { id: signup.json.customer.id } });
    assert.deepEqual([account.storeId, account.country], [afrippaStoreId, 'NG']);
    const message = outbox().filter(item => item.to === email).at(-1);
    assert.match(message.subject, /is your Afrippa verification code$/);
    assert.equal(message.from, 'afrippa:outbox', 'through Afrippa’s own email account');
    // The same address signs up at bitocard.com as a separate account.
    const bitocard = await fetch(`${server.base}/v1/store/account/signup`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `b-${Date.now()}` }, body: JSON.stringify({ name: 'Ngozi Shopper', email, password: 'correct horse battery', country: 'NG' }) });
    assert.equal(bitocard.status, 201);
    assert.equal(await prisma.customer.count({ where: { email } }), 2);
    // Unsigned, Afrippa's account routes are unknown.
    assert.equal((await client.post('/v1/afrippa/account/signin', { email, password: 'correct horse battery' }, { signed: false })).status, 404);
  });

  test('until two-step is set up the session can only finish signing in', async () => {
    const client = afrippaServer();
    const email = `pending-${Date.now()}@example.com`;
    await client.post('/v1/afrippa/account/signup', { name: 'Pending Trader', email, password: 'correct horse battery', country: 'NG' });
    assert.equal((await client.get('/v1/afrippa/account')).json.two_step.pending, true);
    for (const [method, path] of [['get', '/v1/afrippa/crypto'], ['post', '/v1/afrippa/account/password/change']]) {
      const res = await client[method](path, method === 'post' ? { current_password: 'correct horse battery', password: 'another long passphrase' } : undefined);
      assert.deepEqual([res.status, res.json.error.code], [401, 'mfa_required'], path);
    }
    const settings = (await client.get('/v1/afrippa/account/two-step')).json;
    assert.equal(settings.required, true);
    assert.deepEqual(settings.methods.find(item => item.method === 'sms'), { method: 'sms', available: false, reason: 'phone_required' });
  });
});

describe('two-step sign-in', () => {
  test('set up by email: recovery codes once, the session signed in, the change emailed, noticed and audited as Afrippa’s', async () => {
    const { client, email, id, recovery } = await trader();
    assert.equal(recovery.length, 10);
    const state = (await client.get('/v1/afrippa/account')).json.two_step;
    assert.deepEqual([state.pending, state.method], [false, 'email']);
    assert.notEqual((await client.get('/v1/afrippa/crypto')).json?.error?.code, 'mfa_required');
    assert.match(outbox().filter(item => item.to === email).at(-1).subject, /Your two-step sign-in changed/);
    assert.ok(await prisma.notification.findFirst({ where: { customerId: id, type: 'customer.security.two_step_changed' } }));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'trader.two_step_enabled', targetId: id } });
    assert.equal(audit.platform, 'afrippa');
  });

  test('every sign-in asks for the code; a recovery code works once; wrong codes count towards the lockout', async () => {
    const { client, email, recovery } = await trader();
    const signed = await signIn(client, email);
    assert.deepEqual([signed.two_step.pending, signed.two_step.method], [true, 'email']);
    await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
    const sent = await client.post('/v1/afrippa/account/two-step/challenge');
    assert.deepEqual([sent.json.sent, sent.json.sent_to], [true, `${email[0]}•••@example.com`]);
    const verified = await client.post('/v1/afrippa/account/two-step/verify', { code: lastCodeTo(email, /^(\d{6}) is your Afrippa sign-in code/) });
    assert.deepEqual([verified.status, verified.json.signed_in], [200, true]);

    await signIn(client, email);
    assert.equal((await client.post('/v1/afrippa/account/two-step/verify', { code: recovery[0] })).json.used, 'recovery');
    await signIn(client, email);
    assert.equal((await client.post('/v1/afrippa/account/two-step/verify', { code: recovery[0] })).json.error.code, 'mfa_code_invalid', 'used once');
    for (let i = 0; i < 4; i += 1) await client.post('/v1/afrippa/account/two-step/verify', { code: '000000' });
    assert.equal((await client.post('/v1/afrippa/account/two-step/verify', { code: recovery[1] })).json.error.code, 'account_locked');
  });

  test('admins choose the methods: one switched off is proved once more at the next sign-in, then replaced', async () => {
    const { client, email } = await trader();
    const bitocard = await adminClient(server);
    assert.equal((await bitocard.put('/v1/afrippa/admin/two-step-methods/NG', { methods: ['authenticator'] })).status, 401, 'BitoCard’s admins cannot');
    assert.equal((await afrippaAdmin.put('/v1/afrippa/admin/two-step-methods/NG', { methods: [] })).status, 400, 'at least one method');
    assert.equal((await afrippaAdmin.put('/v1/afrippa/admin/two-step-methods/NG', { methods: ['authenticator'] })).status, 200);
    try {
      const signed = await signIn(client, email);
      assert.deepEqual([signed.two_step.pending, signed.two_step.method_not_allowed, signed.two_step.setup_required], [true, true, false]);
      // Not straight to a new method: the current one first.
      assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'authenticator' })).json.error.code, 'mfa_required');
      await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
      await client.post('/v1/afrippa/account/two-step/challenge');
      const proved = await client.post('/v1/afrippa/account/two-step/verify', { code: lastCodeTo(email, /^(\d{6}) is your Afrippa sign-in code/) });
      assert.deepEqual([proved.json.signed_in, proved.json.setup_required], [false, true]);
      assert.equal((await client.get('/v1/afrippa/crypto')).json.error.code, 'mfa_required', 'still not signed in');
      const settings = (await client.get('/v1/afrippa/account/two-step')).json;
      assert.deepEqual(settings.methods.map(item => [item.method, item.available]), [['authenticator', true], ['email', false], ['sms', false]]);
      const setup = await client.post('/v1/afrippa/account/two-step/setup', { method: 'authenticator' });
      assert.match(setup.json.otpauth_uri, /^otpauth:\/\/totp\/Afrippa:/);
      const done = await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: totp(email, setup.json.secret).generate() });
      assert.equal(done.status, 200, JSON.stringify(done.json));
      const state = (await client.get('/v1/afrippa/account')).json.two_step;
      assert.deepEqual([state.pending, state.method], [false, 'authenticator']);
      const policyAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'trader.two_step_methods_changed', targetId: 'NG' }, orderBy: { createdAt: 'desc' } });
      assert.equal(policyAudit.platform, 'afrippa');
    } finally {
      await afrippaAdmin.delete('/v1/afrippa/admin/two-step-methods/NG');
    }
  });

  test('changing the method outside signing in needs a code from the current one', async () => {
    const { client, email, recovery } = await trader();
    assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'authenticator' })).json.error.param, 'current_code');
    const setup = await client.post('/v1/afrippa/account/two-step/setup', { method: 'authenticator', current_code: recovery[0] });
    assert.equal(setup.status, 200, JSON.stringify(setup.json));
    assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: totp(email, setup.json.secret).generate() })).json.method, 'authenticator');
  });
});

describe("Afrippa's operations reset a trader who lost every method", () => {
  test('signed out everywhere, set up again at the next sign-in, withdrawals held 24 hours, audited as Afrippa’s', async () => {
    const { client, email, id } = await trader();
    const reset = await afrippaAdmin.post(`/v1/afrippa/admin/traders/${id}/two-step/reset`, { reason: 'lost phone; identity checked' });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    const held = new Date(reset.json.withdrawals_held_until).getTime();
    assert.ok(held > Date.now() + 23.9 * 3600_000 && held <= Date.now() + 24 * 3600_000 + 5000);
    assert.equal((await client.get('/v1/afrippa/account')).status, 401, 'signed out');
    const account = await prisma.customer.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([account.mfaMethod, account.mfaRecoveryCodeHashes.length], [null, 0]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'trader.two_step_reset', targetId: id } });
    assert.equal(audit.platform, 'afrippa');
    assert.equal((await signIn(client, email)).two_step.setup_required, true);
    // Only Afrippa's traders: a bitocard.com customer is unknown here.
    const shopper = await prisma.customer.findFirstOrThrow({ where: { storeId: { not: afrippaStoreId } } });
    assert.equal((await afrippaAdmin.post(`/v1/afrippa/admin/traders/${shopper.id}/two-step/reset`, { reason: 'not ours' })).status, 404);
  });
});
