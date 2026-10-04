// Resellers' own integrations, phase 1: offers per country, the gates, connecting with checked and encrypted
// credentials, admin review, and isolation between resellers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, fakeService, resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;
let admin;
let provider;
let outbox;
/** What the fake providers answer: 'ok', 'refuse' or 'down'. */
let answer = 'ok';

before(async () => {
  provider = await fakeService(call => {
    if (answer === 'down') return { status: 503, body: { message: 'unavailable' } };
    const refuse = answer === 'refuse';
    if (call.url.startsWith('/oauth/token')) return refuse ? { status: 401, body: { message: 'Access denied' } } : { body: { access_token: 'token', expires_in: 3600 } };
    if (call.url.startsWith('/vtpass/balance')) return { body: refuse ? { code: 0, response_description: 'INVALID CREDENTIALS' } : { code: 1, contents: { balance: 5000 } } };
    if (call.url.startsWith('/didww/balance')) return refuse ? { status: 401, body: { errors: [] } } : { body: { data: { attributes: { balance: '10.00' } } } };
    if (call.url.startsWith('/flutterwave/balances')) return refuse ? { status: 401, body: { status: 'error', message: 'Invalid authorization key' } } : { body: { status: 'success', data: [] } };
    if (call.url.startsWith('/monnify/api/v1/auth/login')) return { body: { requestSuccessful: !refuse } };
    return { status: 404, body: {} };
  });
  server = await startApp({
    env: {
      RELOADLY_AUTH_URL: provider.url,
      RELOADLY_TOPUPS_URL: `${provider.url}/topups`,
      VTPASS_API_URL: `${provider.url}/vtpass`,
      DIDWW_API_URL: `${provider.url}/didww`,
      FLUTTERWAVE_API_URL: `${provider.url}/flutterwave`,
      MONNIFY_API_URL: `${provider.url}/monnify`,
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  outbox = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox;
  admin = await adminClient(server);
});

after(async () => {
  await server?.close();
  await provider?.close();
});

/** A verified (active) reseller on Premium with the switch on. */
async function allowedReseller(country = 'NG') {
  const reseller = await resellerClient(server, { country });
  await prisma.reseller.update({ where: { id: reseller.resellerId }, data: { status: 'active', planCode: 'premium' } });
  assert.equal((await admin.put('/v1/admin/switches/own_integrations', { reseller_id: reseller.resellerId, enabled: true })).status, 200);
  return reseller;
}

const offer = (id, body) => admin.put(`/v1/admin/integrations/${id}/reseller-availability`, body);
const reloadly = { client_id: 'my-client', client_secret: 'my-very-secret-value' };
const testMode = { 'bitocard-mode': 'test' };

describe('availability', () => {
  test('integrations are listed only where an admin offers them: globally or in selected countries', async () => {
    assert.equal((await offer('reloadly', { global: true, countries: [], approval: 'automatic' })).status, 200);
    const set = await offer('vtpass', { global: false, countries: ['ng'], approval: 'review' });
    assert.deepEqual([set.status, set.json.countries, set.json.offered], [200, ['NG'], true]);
    assert.equal((await offer('flutterwave', { global: false, countries: ['ZZ'], approval: 'review' })).json.error.code, 'country_unknown');
    assert.equal((await offer('telnyx', { global: true, countries: [], approval: 'review' })).status, 404, 'only integrations with a built adapter');

    const ng = await allowedReseller('NG');
    const gh = await allowedReseller('GH');
    const ids = async who => (await who.browser.get('/v1/integrations')).json.data.map(item => item.id).sort();
    assert.deepEqual(await ids(ng), ['reloadly', 'vtpass']);
    assert.deepEqual(await ids(gh), ['reloadly']);

    const list = await admin.get('/v1/admin/integrations/reseller-availability');
    assert.ok(list.json.data.some(item => item.integration_id === 'monnify' && item.offered === false));
  });

  test('only super admins change availability; support can read it', async () => {
    const support = await adminClient(server, ['support']);
    assert.equal((await support.get('/v1/admin/integrations/reseller-availability')).status, 200);
    assert.equal((await support.put('/v1/admin/integrations/didww/reseller-availability', { global: true, countries: [], approval: 'review' })).status, 403);
  });
});

describe('gates', () => {
  test('the switch, the plan, a country and (live) a verified account are all needed', async () => {
    await offer('reloadly', { global: true, countries: [], approval: 'automatic' });
    const { browser, resellerId } = await resellerClient(server);
    const reason = async headers => (await browser.get('/v1/integrations', headers)).json.access.reason;
    assert.equal(await reason(), 'switch_off');
    await admin.put('/v1/admin/switches/own_integrations', { reseller_id: resellerId, enabled: true });
    assert.equal(await reason(), 'plan');
    await prisma.reseller.update({ where: { id: resellerId }, data: { planCode: 'premium' } });
    assert.equal(await reason(), 'not_verified');
    assert.equal(await reason(testMode), null, 'the sandbox does not need the identity check');
    const refused = await browser.put('/v1/integrations/reloadly/connection', { values: reloadly });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'own_integrations_not_verified']);
  });

  test('API keys cannot manage integrations, and only owners and admins connect them', async () => {
    const { browser } = await allowedReseller();
    const key = await browser.post('/v1/api-keys', { name: 'k', mode: 'test', scopes: ['catalogue:read'] });
    const viaKey = await client(server.base).get('/v1/integrations', { authorization: `Bearer ${key.json.secret}` });
    assert.equal(viaKey.status, 403);
  });
});

describe('connecting', () => {
  test('live credentials are checked, stored encrypted, never returned, and active at once with automatic approval', async () => {
    answer = 'ok';
    await offer('reloadly', { global: true, countries: [], approval: 'automatic' });
    const { browser, resellerId, email } = await allowedReseller();
    const res = await browser.put('/v1/integrations/reloadly/connection', { values: reloadly });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.connection.status, 'active');
    assert.equal(res.json.connection.last_check.ok, true);
    const fields = Object.fromEntries(res.json.fields.map(item => [item.key, item]));
    assert.deepEqual([fields.client_id.value, fields.client_secret.value, fields.client_secret.hint], ['my-client', null, '…alue']);
    assert.ok(!JSON.stringify(res.json).includes('my-very-secret-value'));

    const row = await prisma.resellerConnection.findFirstOrThrow({ where: { resellerId } });
    assert.ok(row.credentialsEncrypted.startsWith('v1:') && !row.credentialsEncrypted.includes('my-very-secret-value'));
    const audit = await prisma.auditLog.findMany({ where: { targetId: row.id } });
    assert.ok(audit.length && !JSON.stringify(audit).includes('my-very-secret-value'));
    assert.ok(outbox.some(message => message.to === email && /Reloadly account is connected/.test(message.subject)));

    // The provider saw the credentials (the check), BitoCard kept them.
    const service = server.app.get((await import('../dist/reseller-integrations/reseller-integrations.service.js')).ResellerIntegrationsService);
    assert.deepEqual(await service.credentials(resellerId, 'reloadly', 'live'), reloadly);
  });

  test('refused credentials are not saved; an unreachable provider says try again', async () => {
    await offer('didww', { global: true, countries: [], approval: 'automatic' });
    const { browser, resellerId } = await allowedReseller();
    answer = 'refuse';
    const refused = await browser.put('/v1/integrations/didww/connection', { values: { api_key: 'wrong-key-1234' } });
    assert.deepEqual([refused.status, refused.json.error.code], [400, 'credentials_rejected']);
    answer = 'down';
    const down = await browser.put('/v1/integrations/didww/connection', { values: { api_key: 'some-key-1234' } });
    assert.deepEqual([down.status, down.json.error.code], [503, 'integration_unreachable']);
    assert.equal(await prisma.resellerConnection.count({ where: { resellerId } }), 0);
    answer = 'ok';
  });

  test('every provider check works, missing and unknown fields are refused, blank secrets keep the saved ones', async () => {
    answer = 'ok';
    for (const id of ['vtpass', 'flutterwave', 'monnify']) await offer(id, { global: true, countries: [], approval: 'automatic' });
    const { browser } = await allowedReseller();
    const values = {
      vtpass: { api_key: 'vt-api-key-1', public_key: 'PK_public_1', secret_key: 'SK_secret_1' },
      flutterwave: { secret_key: 'FLWSECK-abcdef' },
      monnify: { api_key: 'MK_PROD_1', secret_key: 'monnify-secret', contract_code: '123456' },
    };
    for (const [id, body] of Object.entries(values)) {
      const res = await browser.put(`/v1/integrations/${id}/connection`, { values: body });
      assert.equal(res.status, 200, `${id}: ${JSON.stringify(res.json)}`);
    }
    const missing = await browser.put('/v1/integrations/vtpass/connection', { values: { api_key: '', public_key: 'x', secret_key: 'y' } });
    assert.equal(missing.status, 200, 'a blank secret keeps the saved one');
    const unknown = await browser.put('/v1/integrations/vtpass/connection', { values: { password: 'x' } });
    assert.deepEqual([unknown.status, unknown.json.error.param], [400, 'values.password']);
    const fresh = await allowedReseller();
    const required = await fresh.browser.put('/v1/integrations/monnify/connection', { values: { api_key: 'k' } });
    assert.deepEqual([required.status, required.json.error.code], [400, 'parameter_missing']);
  });

  test('sandbox connections are never checked with the provider and need no review', async () => {
    await offer('vtpass', { global: true, countries: [], approval: 'review' });
    const { browser } = await allowedReseller();
    answer = 'refuse';
    const res = await browser.put('/v1/integrations/vtpass/connection', { values: { api_key: 'a', public_key: 'b', secret_key: 'c' } }, testMode);
    answer = 'ok';
    assert.deepEqual([res.status, res.json.connection.status, res.json.connection.mode], [200, 'active', 'test']);
    assert.equal((await browser.get('/v1/integrations')).json.data.find(item => item.id === 'vtpass').connection, null, 'live is separate');
  });

  test('disconnecting erases the credentials', async () => {
    await offer('reloadly', { global: true, countries: [], approval: 'automatic' });
    const { browser, resellerId } = await allowedReseller();
    await browser.put('/v1/integrations/reloadly/connection', { values: reloadly });
    assert.equal((await browser.delete('/v1/integrations/reloadly/connection')).status, 204);
    const row = await prisma.resellerConnection.findFirstOrThrow({ where: { resellerId } });
    assert.deepEqual([row.status, row.credentialsEncrypted], ['disconnected', null]);
    assert.equal((await browser.get('/v1/integrations')).json.data.find(item => item.id === 'reloadly').connection, null);
  });
});

describe('review', () => {
  test('connections needing review wait for an admin; changed credentials are reviewed again', async () => {
    answer = 'ok';
    await offer('monnify', { global: true, countries: [], approval: 'review' });
    const { browser, resellerId, email } = await allowedReseller();
    const values = { api_key: 'MK_PROD_1', secret_key: 'monnify-secret', contract_code: '123456' };
    const pending = await browser.put('/v1/integrations/monnify/connection', { values });
    assert.equal(pending.json.connection.status, 'pending_review');
    const service = server.app.get((await import('../dist/reseller-integrations/reseller-integrations.service.js')).ResellerIntegrationsService);
    assert.equal(await service.credentials(resellerId, 'monnify', 'live'), null, 'not usable until approved');

    const queue = await admin.get('/v1/admin/connections?status=pending_review');
    const item = queue.json.data.find(row => row.reseller.id === resellerId);
    assert.deepEqual([item.integration.name, item.public_values.contract_code], ['Monnify', '123456']);
    assert.ok(!JSON.stringify(queue.json).includes('monnify-secret'));

    const noReason = await admin.post(`/v1/admin/connections/${item.id}/decide`, { decision: 'reject' });
    assert.equal(noReason.json.error.code, 'parameter_missing');
    const approved = await admin.post(`/v1/admin/connections/${item.id}/decide`, { decision: 'approve' });
    assert.equal(approved.json.status, 'active');
    assert.ok(outbox.some(message => message.to === email && /approved/.test(message.subject)));
    assert.equal((await admin.post(`/v1/admin/connections/${item.id}/decide`, { decision: 'approve' })).json.error.code, 'connection_state_changed');

    // The same credentials stay active; different ones go back for review.
    assert.equal((await browser.put('/v1/integrations/monnify/connection', { values })).json.connection.status, 'active');
    assert.equal((await browser.put('/v1/integrations/monnify/connection', { values: { ...values, contract_code: '999999' } })).json.connection.status, 'pending_review');
  });

  test('suspending blocks the connection until reinstated; rejecting erases the credentials', async () => {
    answer = 'ok';
    await offer('flutterwave', { global: true, countries: [], approval: 'review' });
    const first = await allowedReseller();
    await first.browser.put('/v1/integrations/flutterwave/connection', { values: { secret_key: 'FLWSECK-one' } });
    const id = (await prisma.resellerConnection.findFirstOrThrow({ where: { resellerId: first.resellerId } })).id;
    await admin.post(`/v1/admin/connections/${id}/decide`, { decision: 'approve' });
    const suspended = await admin.post(`/v1/admin/connections/${id}/decide`, { decision: 'suspend', reason: 'Chargebacks' });
    assert.equal(suspended.json.status, 'suspended');
    const view = (await first.browser.get('/v1/integrations')).json.data.find(item => item.id === 'flutterwave').connection;
    assert.deepEqual([view.status, view.decision_note], ['suspended', 'Chargebacks']);
    const blocked = await first.browser.put('/v1/integrations/flutterwave/connection', { values: { secret_key: 'FLWSECK-two' } });
    assert.equal(blocked.json.error.code, 'connection_suspended');
    assert.equal((await admin.post(`/v1/admin/connections/${id}/decide`, { decision: 'reinstate' })).json.status, 'active');

    const second = await allowedReseller();
    await second.browser.put('/v1/integrations/flutterwave/connection', { values: { secret_key: 'FLWSECK-three' } });
    const otherId = (await prisma.resellerConnection.findFirstOrThrow({ where: { resellerId: second.resellerId } })).id;
    await admin.post(`/v1/admin/connections/${otherId}/decide`, { decision: 'reject', reason: 'Not your account' });
    const rejected = await prisma.resellerConnection.findUniqueOrThrow({ where: { id: otherId } });
    assert.deepEqual([rejected.status, rejected.credentialsEncrypted], ['rejected', null]);
    const operations = await adminClient(server, ['support']);
    assert.equal((await operations.post(`/v1/admin/connections/${id}/decide`, { decision: 'suspend', reason: 'x' })).status, 403, 'support cannot decide');
  });
});

describe('isolation', () => {
  test("one reseller never sees or uses another's connection", async () => {
    answer = 'ok';
    await offer('reloadly', { global: true, countries: [], approval: 'automatic' });
    const owner = await allowedReseller();
    await owner.browser.put('/v1/integrations/reloadly/connection', { values: reloadly });
    const other = await allowedReseller();
    assert.equal((await other.browser.get('/v1/integrations')).json.data.find(item => item.id === 'reloadly').connection, null);
    const service = server.app.get((await import('../dist/reseller-integrations/reseller-integrations.service.js')).ResellerIntegrationsService);
    assert.equal(await service.credentials(other.resellerId, 'reloadly', 'live'), null);
    assert.equal((await other.browser.post('/v1/integrations/reloadly/connection/check')).status, 404);
  });
});
