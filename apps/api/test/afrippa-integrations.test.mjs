// Integration settings per product (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 8): BitoCard's admin sets BitoCard's,
// Afrippa's admin Afrippa's. Crypto settings are Afrippa's alone; the services both use (email, SMS, Google, AI, files,
// push, GitHub) have a separate value for each; and no Afrippa call reads a BitoCard credential, nor the reverse.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, afrippaAdminClient, fakeService, startApp } from './helpers.mjs';

const { afrippaOnlyKeys, groupsFor, integrationGroups, sharedKeys } = await import('../dist/integrations/definitions.js');

const bitocardKey = 're_bitocard_env_key_0001';
let server;
let resend;
let bitocard;
let afrippa;
let prisma;
let integrations;
let email;

before(async () => {
  resend = await fakeService(() => ({ body: { id: 'email_1' } }));
  // BitoCard's email account comes from the environment, as it does on the droplet.
  server = await startApp({ env: { RESEND_API_URL: resend.url, RESEND_API_KEY: bitocardKey, AFRIPPA_ADMIN_SETUP_EMAILS: 'ops@afrippa.com' } });
  bitocard = await adminClient(server);
  afrippa = await afrippaAdminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  integrations = server.app.get((await import('../dist/integrations/integrations.service.js')).IntegrationsService);
  email = server.app.get((await import('../dist/notifications/email.service.js')).EmailService);
});

after(async () => {
  await server?.close();
  await resend?.close();
});

const fieldOf = (item, key) => item.fields.find(field => field.key === key);

describe('each product sets its own integrations', () => {
  test('crypto is Afrippa’s alone, payments and suppliers BitoCard’s, the shared services each’s own', async () => {
    const bitocardList = (await bitocard.get('/v1/admin/integrations')).json.data;
    const afrippaList = (await afrippa.get('/v1/afrippa/admin/integrations')).json.data;
    const ids = list => new Set(list.map(item => item.id));
    assert.equal(bitocardList.some(item => item.section === 'blockchain'), false);
    for (const id of ['crypto_keys', 'crypto_signer', 'crypto_prices', 'chainalysis', 'alchemy']) assert.ok(ids(afrippaList).has(id), id);
    for (const id of ['stripe', 'paystack', 'reloadly', 'domains', 'store_hosts', 'general', 'telnyx']) assert.equal(ids(afrippaList).has(id), false, id);
    for (const id of ['email', 'sms', 'google', 'anthropic', 'openai', 'file_storage', 'kyc_storage', 'web_push', 'github']) {
      assert.ok(ids(afrippaList).has(id) && ids(bitocardList).has(id), `${id} is both's`);
    }
    // Each list is exactly that product's groups.
    assert.deepEqual([...ids(afrippaList)].sort(), groupsFor('afrippa').map(group => group.id).sort());
    assert.equal(afrippaList.every(item => item.reseller_access.available === false), true, 'resellers are BitoCard’s');
  });

  test("neither admin can change the other's settings: another product's group is unknown", async () => {
    const intoAfrippa = await bitocard.put('/v1/admin/integrations/crypto_keys', { values: { CRYPTO_TEST_XPUB_EVM: 'x' }, code: await adminCode(server, bitocard) });
    assert.deepEqual([intoAfrippa.status, intoAfrippa.json.error.code], [404, 'resource_missing']);
    const intoBitocard = await afrippa.put('/v1/afrippa/admin/integrations/stripe', { values: { STRIPE_SECRET_KEY: 'sk_live_x' }, code: await adminCode(server, afrippa) });
    assert.deepEqual([intoBitocard.status, intoBitocard.json.error.code], [404, 'resource_missing']);
    assert.equal((await bitocard.get('/v1/afrippa/admin/integrations')).status, 401);
    assert.equal((await afrippa.get('/v1/admin/integrations')).status, 401);
  });
});

describe('the services both use never share a value', () => {
  test("Afrippa's email starts unset, never BitoCard's environment key, and its admins' emails are held until it has its own", async () => {
    const afrippaEmail = (await afrippa.get('/v1/afrippa/admin/integrations')).json.data.find(item => item.id === 'email');
    assert.deepEqual([fieldOf(afrippaEmail, 'RESEND_API_KEY').source, fieldOf(afrippaEmail, 'RESEND_API_KEY').hint], ['unset', null]);
    assert.equal(fieldOf((await bitocard.get('/v1/admin/integrations')).json.data.find(item => item.id === 'email'), 'RESEND_API_KEY').source, 'environment');
    assert.equal(integrations.configFor('afrippa').RESEND_API_KEY, undefined);
    assert.equal(integrations.config.RESEND_API_KEY, bitocardKey);

    const before = resend.calls.length;
    assert.equal(await email.sendFor('afrippa', { to: 'ops@afrippa.com', subject: 'Held', text: 'Hi', html: '<p>Hi</p>' }), 'outbox');
    assert.equal(resend.calls.length, before, 'never sent with BitoCard’s account');
    // An Afrippa admin's set-up link goes the same way.
    await fetch(`${server.base}/v1/afrippa/admin/auth/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ops@afrippa.com' }) });
    assert.equal(resend.calls.length, before);
    assert.equal(email.outbox.at(-1).from, 'afrippa:outbox');
  });

  test("once Afrippa sets its own key, its email uses it, and BitoCard's keeps its own", async () => {
    const afrippaKey = 're_afrippa_admin_key_9a9a';
    const saved = await afrippa.put('/v1/afrippa/admin/integrations/email', { values: { RESEND_API_KEY: afrippaKey, EMAIL_FROM: 'Afrippa <no-reply@afrippa.com>' }, code: await adminCode(server, afrippa) });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([fieldOf(saved.json, 'RESEND_API_KEY').source, fieldOf(saved.json, 'RESEND_API_KEY').hint], ['admin', '…9a9a']);

    assert.equal(await email.sendFor('afrippa', { to: 'ops@afrippa.com', subject: 'Afrippa', text: 'Hi', html: '<p>Hi</p>' }), 'resend');
    assert.equal(resend.calls.at(-1).headers.authorization, `Bearer ${afrippaKey}`);
    assert.equal(resend.calls.at(-1).body.from, 'Afrippa <no-reply@afrippa.com>');
    assert.equal(await email.send({ to: 'ada@example.com', subject: 'BitoCard', text: 'Hi', html: '<p>Hi</p>' }), 'resend');
    assert.equal(resend.calls.at(-1).headers.authorization, `Bearer ${bitocardKey}`);
    assert.equal(integrations.config.RESEND_API_KEY, bitocardKey, 'BitoCard’s setting is untouched');

    const rows = await prisma.integrationSetting.findMany({ where: { key: 'RESEND_API_KEY' } });
    assert.deepEqual(rows.map(row => row.platform), ['afrippa']);
    assert.ok(rows[0].encrypted && !rows[0].value.includes(afrippaKey));
    // Changed in Afrippa's admin: in Afrippa's audit trail, not BitoCard's.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'integration.updated', targetId: 'email' }, orderBy: { createdAt: 'desc' } });
    assert.equal(audit.platform, 'afrippa');
    assert.ok(!JSON.stringify(audit).includes(afrippaKey));
  });
});

describe("Afrippa's crypto settings", () => {
  test('are read from Afrippa’s values whoever reads them; a stray BitoCard row is ignored', async () => {
    const { HDKey } = await import('@scure/bip32');
    const xpub = HDKey.fromMasterSeed(Buffer.alloc(32, 7), { private: 0x04358394, public: 0x043587cf }).derive("m/44'/60'/0'").publicExtendedKey;
    assert.equal((await afrippa.put('/v1/afrippa/admin/integrations/crypto_keys', { values: { CRYPTO_TEST_XPUB_EVM: xpub }, code: await adminCode(server, afrippa) })).status, 200);
    assert.equal(integrations.values(['CRYPTO_TEST_XPUB_EVM']).CRYPTO_TEST_XPUB_EVM, xpub);
    // A BitoCard value for a crypto setting (written before the move, say) is never read.
    await prisma.integrationSetting.create({ data: { platform: 'bitocard', key: 'CRYPTO_SIGNER_URL', value: 'https://bitocard-signer.example.com', encrypted: false } });
    await integrations.refresh(true);
    assert.equal(integrations.values(['CRYPTO_SIGNER_URL']).CRYPTO_SIGNER_URL, undefined);
  });

  test('the migration moved exactly crypto settings to Afrippa', () => {
    const sql = readFileSync(new URL('../prisma/migrations/20270129200000_integrations_per_platform/migration.sql', import.meta.url), 'utf8');
    const moved = [...sql.matchAll(/'([A-Z0-9_]+)'/g)].map(match => match[1]);
    assert.ok(moved.length > 50);
    for (const key of moved) assert.ok(afrippaOnlyKeys.has(key), `${key} is an Afrippa crypto setting`);
    assert.ok(moved.includes('CRYPTO_XPUB_EVM') && moved.includes('CRYPTO_SIGNER_SECRET') && moved.includes('COINGECKO_API_KEY'));
  });

  test('every group belongs to at least one product, and the shared keys are exactly the shared groups’', () => {
    for (const group of integrationGroups) assert.ok(group.platforms.length >= 1, group.id);
    for (const group of integrationGroups.filter(item => item.section === 'blockchain')) assert.deepEqual(group.platforms, ['afrippa'], group.id);
    for (const key of sharedKeys) assert.equal(afrippaOnlyKeys.has(key), false, key);
  });
});
