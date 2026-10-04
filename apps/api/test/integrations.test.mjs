// Integration settings set by admins (Settings > Integrations) instead of the environment: admin values win over the
// environment, secrets are encrypted and never returned, changes need a fresh authenticator code, are audited without
// secret values, and take effect without a restart.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, fakeService, startApp } from './helpers.mjs';

let server;
let resend;
let admin;
let prisma;
let integrations;
let email;

before(async () => {
  resend = await fakeService(() => ({ body: { id: 'email_1' } }));
  server = await startApp({ env: { RESEND_API_URL: resend.url, TERMII_SENDER_ID: 'EnvSender' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  integrations = server.app.get((await import('../dist/integrations/integrations.service.js')).IntegrationsService);
  email = server.app.get((await import('../dist/notifications/email.service.js')).EmailService);
});

after(async () => {
  await server?.close();
  await resend?.close();
});

const fieldOf = (item, key) => item.fields.find(field => field.key === key);
const update = async (id, values, code) => admin.put(`/v1/admin/integrations/${id}`, { values, code: code ?? (await adminCode(server, admin)) });

describe('integration settings', () => {
  test('lists every integration with where each value comes from, and never a secret', async () => {
    const { status, json } = await admin.get('/v1/admin/integrations');
    assert.equal(status, 200);
    assert.deepEqual(
      json.data.filter(item => item.section === 'platform').map(item => item.id),
      ['general', 'email', 'sms', 'web_push', 'google', 'flutterwave', 'monnify', 'exchange_rates', 'didit'],
    );
    // Every supplier in the registry has a group (Flutterwave virtual cards use the Flutterwave keys).
    const registry = await prisma.supplier.findMany({ select: { code: true } });
    const suppliers = json.data.filter(item => item.section === 'suppliers');
    assert.deepEqual(new Set(suppliers.map(item => item.id)), new Set(registry.map(item => item.code).filter(code => code !== 'flutterwave_cards')));
    assert.deepEqual(suppliers.filter(item => item.adapter_ready).map(item => item.id).sort(), ['didww', 'reloadly', 'vtpass']);
    const sms = json.data.find(item => item.id === 'sms');
    assert.equal(fieldOf(sms, 'TERMII_SENDER_ID').source, 'environment');
    assert.equal(fieldOf(sms, 'TERMII_SENDER_ID').value, 'EnvSender');
    assert.equal(fieldOf(sms, 'TERMII_API_KEY').source, 'unset');
    assert.equal(sms.status, 'not_connected');
    const general = json.data.find(item => item.id === 'general');
    assert.equal(fieldOf(general, 'ALERT_EMAIL').source, 'default');
    assert.equal(json.data.find(item => item.id === 'flutterwave').webhook_url, 'https://api.bitocard.com/v1/webhooks/flutterwave');
  });

  test('only super admins can see or change integrations', async () => {
    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.get('/v1/admin/integrations')).status, 403);
    assert.equal((await operations.put('/v1/admin/integrations/email', { values: { EMAIL_FROM: 'x@example.com' }, code: '123456' })).status, 403);
  });

  test('a change needs the admin’s current authenticator code', async () => {
    const wrong = await update('sms', { TERMII_SENDER_ID: 'Nope' }, '000000');
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error.code, 'mfa_code_invalid');
    const missing = await admin.put('/v1/admin/integrations/sms', { values: { TERMII_SENDER_ID: 'Nope' } });
    assert.equal(missing.status, 400);
    assert.equal(integrations.config.TERMII_SENDER_ID, 'EnvSender');
  });

  test('an email key set by an admin is used at once, stored encrypted, shown only as a hint and audited without its value', async () => {
    const key = 're_admin_secret_key_7f3a';
    assert.equal(await email.send({ to: 'ada@example.com', subject: 'Before', text: 'Hi', html: '<p>Hi</p>' }), 'outbox');

    const { status, json } = await update('email', { RESEND_API_KEY: key });
    assert.equal(status, 200);
    const field = fieldOf(json, 'RESEND_API_KEY');
    assert.equal(field.source, 'admin');
    assert.equal(field.value, null);
    assert.equal(field.hint, '…7f3a');
    assert.equal(json.status, 'connected');
    assert.ok(!JSON.stringify(json).includes(key));

    assert.equal(await email.send({ to: 'ada@example.com', subject: 'After', text: 'Hi', html: '<p>Hi</p>' }), 'resend');
    assert.equal(resend.calls.at(-1).headers.authorization, `Bearer ${key}`);

    const row = await prisma.integrationSetting.findUniqueOrThrow({ where: { key: 'RESEND_API_KEY' } });
    assert.equal(row.encrypted, true);
    assert.ok(!row.value.includes(key));

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetType: 'integration', targetId: 'email' }, orderBy: { createdAt: 'desc' } });
    assert.equal(audit.action, 'integration.updated');
    assert.ok(!JSON.stringify(audit).includes(key));
    assert.deepEqual(audit.after.RESEND_API_KEY, { set: true, source: 'admin', hint: '…7f3a' });
    assert.deepEqual(audit.before.RESEND_API_KEY, { set: false, source: 'unset', hint: null });
    assert.ok(!JSON.stringify((await admin.get('/v1/admin/activity')).json).includes(key));
  });

  test('clearing an admin value falls back to the environment', async () => {
    const set = await update('sms', { TERMII_SENDER_ID: 'AdminSender' });
    assert.equal(fieldOf(set.json, 'TERMII_SENDER_ID').value, 'AdminSender');
    assert.equal(integrations.config.TERMII_SENDER_ID, 'AdminSender');
    const cleared = await update('sms', { TERMII_SENDER_ID: null });
    assert.equal(cleared.status, 200);
    assert.equal(fieldOf(cleared.json, 'TERMII_SENDER_ID').source, 'environment');
    assert.equal(integrations.config.TERMII_SENDER_ID, 'EnvSender');
  });

  test('values are checked with the same rules as the environment', async () => {
    const badUrl = await update('vtpass', { VTPASS_API_URL: 'not a url' });
    assert.equal(badUrl.status, 400);
    assert.equal(badUrl.json.error.code, 'invalid_value');
    assert.equal(badUrl.json.error.param, 'values.VTPASS_API_URL');
    const wrongGroup = await update('vtpass', { RESEND_API_KEY: 'x' });
    assert.equal(wrongGroup.json.error.param, 'values.RESEND_API_KEY');
    assert.equal((await update('reloadly', { RELOADLY_SANDBOX: 'yes' })).status, 400);
    assert.equal((await update('sms', { TERMII_SENDER_ID: '' })).status, 400);
    assert.equal((await update('exchange_rates', { FX_MAX_AGE_MINUTES: -5 })).status, 400);
    assert.equal((await update('nothing', { X: 'y' })).status, 404);

    const sandbox = await update('reloadly', { RELOADLY_SANDBOX: true });
    assert.equal(fieldOf(sandbox.json, 'RELOADLY_SANDBOX').value, true);
    const age = await update('exchange_rates', { FX_MAX_AGE_MINUTES: 90 });
    assert.equal(fieldOf(age.json, 'FX_MAX_AGE_MINUTES').value, 90);
    assert.equal(integrations.config.FX_MAX_AGE_MINUTES, 90);
  });

  test('payment and identity clients are rebuilt when their keys are set, and status follows the required fields', async () => {
    const { PaymentProviders } = await import('../dist/payments/payment-providers.js');
    const { IdentityService } = await import('../dist/identity/identity.service.js');
    const providers = server.app.get(PaymentProviders);
    const identity = server.app.get(IdentityService);
    assert.equal(providers.flutterwave, null);

    const partial = await update('flutterwave', { FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-abcdefgh1234' });
    assert.equal(partial.json.status, 'incomplete');
    assert.ok(providers.flutterwave);
    const complete = await update('flutterwave', { FLUTTERWAVE_WEBHOOK_HASH: 'hash-value-5678' });
    assert.equal(complete.json.status, 'connected');

    assert.equal(identity.didit, null);
    await update('didit', { DIDIT_API_KEY: 'didit-key-0001', DIDIT_WORKFLOW_ID: 'wf_123' });
    assert.ok(identity.didit);
  });

  test('other instances pick up changes on their next refresh, within 30 seconds', async () => {
    await prisma.integrationSetting.upsert({
      where: { key: 'VTPASS_CONTACT_PHONE' },
      create: { key: 'VTPASS_CONTACT_PHONE', value: '08099999999', encrypted: false },
      update: { value: '08099999999' },
    });
    assert.notEqual(integrations.config.VTPASS_CONTACT_PHONE, '08099999999');
    // As if 30 seconds had passed: the next request refreshes this instance's copy.
    integrations.loadedAt = 0;
    await admin.get('/v1/admin/overview');
    assert.equal(integrations.config.VTPASS_CONTACT_PHONE, '08099999999');
  });

  test('suppliers without an adapter yet: credentials are saved encrypted, write-only, for the adapter to read later', async () => {
    const before = (await admin.get('/v1/admin/integrations')).json.data.find(item => item.id === 'airalo');
    assert.deepEqual([before.status, before.adapter_ready, fieldOf(before, 'AIRALO_CLIENT_SECRET').source], ['not_connected', false, 'unset']);

    const key = 'airalo-live-secret-abcd1234';
    const saved = await update('airalo', { AIRALO_CLIENT_ID: 'airalo-client', AIRALO_CLIENT_SECRET: key, AIRALO_API_URL: 'https://sandbox-partners-api.airalo.com' });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.status, 'connected');
    assert.deepEqual([fieldOf(saved.json, 'AIRALO_CLIENT_SECRET').hint, fieldOf(saved.json, 'AIRALO_CLIENT_SECRET').value], ['…1234', null]);
    assert.equal(fieldOf(saved.json, 'AIRALO_API_URL').value, 'https://sandbox-partners-api.airalo.com');
    assert.ok(!JSON.stringify(saved.json).includes(key));
    assert.deepEqual(integrations.supplier('airalo'), { CLIENT_ID: 'airalo-client', CLIENT_SECRET: key, API_URL: 'https://sandbox-partners-api.airalo.com' });
    const row = await prisma.integrationSetting.findUniqueOrThrow({ where: { key: 'AIRALO_CLIENT_SECRET' } });
    assert.ok(row.encrypted && !row.value.includes(key));

    assert.equal((await update('airalo', { AIRALO_API_URL: 'not a url' })).json.error.param, 'values.AIRALO_API_URL');
    assert.equal((await update('airalo', { TWILIO_AUTH_TOKEN: 'x' })).status, 400, 'another supplier’s field');
    const cleared = await update('airalo', { AIRALO_CLIENT_SECRET: null });
    assert.equal(fieldOf(cleared.json, 'AIRALO_CLIENT_SECRET').source, 'unset');
    assert.equal(integrations.supplier('airalo').CLIENT_SECRET, undefined);
  });

  test('DIDWW has a built adapter: its settings are integration keys with environment fallback', async () => {
    const didww = (await admin.get('/v1/admin/integrations')).json.data.find(item => item.id === 'didww');
    assert.deepEqual([didww.section, didww.adapter_ready], ['suppliers', true]);
    assert.deepEqual(didww.fields.map(item => item.key), ['DIDWW_API_KEY', 'DIDWW_API_URL', 'DIDWW_COUNTRIES', 'DIDWW_CALLBACK_URL']);
    const saved = await update('didww', { DIDWW_COUNTRIES: 'GB, US,CA' });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(integrations.config.DIDWW_COUNTRIES, ['GB', 'US', 'CA']);
  });
});
