// The $500 startup allowance: granted once to a verified reseller where an admin has switched it on, kept in its own
// restricted ledger account (never cash), shown in the wallet, and revocable by finance admins.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';
import { fakeDidit } from './fakes.mjs';

let server;
let didit;
let admin;
let prisma;

before(async () => {
  didit = await fakeDidit();
  server = await startApp({ env: didit.env });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
  await didit?.close();
});

const allowanceOn = resellerId => prisma.featureSwitch.create({ data: { key: 'startup_allowance', resellerId, enabled: true } });

/** The owner passes the Didit check: started in SHQ, approved at Didit, then re-read. */
async function passIdentityCheck(browser) {
  const started = await browser.post('/v1/account/verification', { consent: true });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  const sessionId = started.json.url.split('/').at(-1);
  Object.assign(didit.state.sessions[sessionId], { status: 'Approved', first_name: 'Ada', last_name: 'Obi' });
  const service = server.app.get((await import('../dist/identity/identity.service.js')).IdentityService);
  await service.refreshByReference('didit', sessionId);
}

describe('startup allowance', () => {
  test('granted once when a reseller with the switch on passes the identity check; never counted as cash', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await allowanceOn(resellerId);
    assert.equal((await browser.get('/v1/wallet')).json.startup_allowance, null, 'nothing before verification');

    await passIdentityCheck(browser);
    const wallet = (await browser.get('/v1/wallet')).json;
    assert.deepEqual(
      [wallet.startup_allowance.currency, wallet.startup_allowance.granted, wallet.startup_allowance.remaining, wallet.startup_allowance.status],
      ['USD', 50_000, 50_000, 'active'],
    );
    assert.equal(wallet.available, 0, 'the allowance is not money the reseller can spend or withdraw');
    assert.ok((await browser.get('/v1/notifications')).json.data.some(item => item.type === 'startup_allowance.granted'));
    assert.equal((await browser.get('/v1/wallet', { 'bitocard-mode': 'test' })).json.startup_allowance, null, 'live only');

    const [entry] = (await browser.get('/v1/wallet/transactions')).json.data;
    assert.deepEqual([entry.type, entry.amount, entry.allowance_change], ['allowance_granted', 0, 50_000]);

    // Granting again does nothing: it is once only.
    const again = await admin.post(`/v1/admin/resellers/${resellerId}/startup-allowance`);
    assert.deepEqual([again.status, again.json.error.code], [409, 'allowance_already_granted']);
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });

  test('not granted while the switch is off; an admin can grant it once it is on', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await passIdentityCheck(browser);
    assert.equal((await browser.get('/v1/wallet')).json.startup_allowance, null);
    const off = await admin.post(`/v1/admin/resellers/${resellerId}/startup-allowance`);
    assert.equal(off.json.error.code, 'allowance_switched_off');

    await allowanceOn(resellerId);
    const granted = await admin.post(`/v1/admin/resellers/${resellerId}/startup-allowance`);
    assert.equal(granted.status, 201, JSON.stringify(granted.json));
    assert.equal(granted.json.remaining, 50_000);
    assert.equal(await prisma.auditLog.count({ where: { action: 'allowance.granted', targetId: resellerId } }), 1);
  });

  test('never for an unverified reseller', async () => {
    const { resellerId } = await resellerClient(server);
    await allowanceOn(resellerId);
    const res = await admin.post(`/v1/admin/resellers/${resellerId}/startup-allowance`);
    assert.deepEqual([res.status, res.json.error.code], [409, 'verification_required']);
  });

  test('finance admins revoke what remains, with a reason; it cannot be granted again', async () => {
    const { browser, resellerId } = await resellerClient(server);
    await allowanceOn(resellerId);
    await passIdentityCheck(browser);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/resellers/${resellerId}/startup-allowance/revoke`, { reason: 'Abuse suspected' })).status, 403);
    assert.equal((await admin.post(`/v1/admin/resellers/${resellerId}/startup-allowance/revoke`, { reason: 'x' })).status, 400, 'a reason is required');

    const revoked = await admin.post(`/v1/admin/resellers/${resellerId}/startup-allowance/revoke`, { reason: 'Abuse suspected' });
    assert.equal(revoked.status, 201, JSON.stringify(revoked.json));
    assert.deepEqual([revoked.json.status, revoked.json.remaining], ['revoked', 0]);
    assert.equal((await browser.get('/v1/wallet')).json.startup_allowance.status, 'revoked');
    assert.equal((await admin.post(`/v1/admin/resellers/${resellerId}/startup-allowance`)).json.error.code, 'allowance_already_granted');
    assert.equal((await admin.post(`/v1/admin/resellers/${resellerId}/startup-allowance/revoke`, { reason: 'Again please' })).json.error.code, 'allowance_already_revoked');
    assert.equal((await admin.get(`/v1/admin/resellers/${resellerId}/wallet`)).json.startup_allowance.status, 'revoked', 'admins see it too');
    assert.equal((await admin.get('/v1/admin/ledger/check')).json.ok, true);
  });
});
