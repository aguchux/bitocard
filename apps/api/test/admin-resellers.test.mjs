// Admin management of resellers (status, the identity waiver, the store ceiling), and BitoCard without plans: every
// reseller may use every feature, within the markets' switches and the admins' ceilings.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
});

after(() => server?.close());

async function apiKey(browser, scopes) {
  return (await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test', ...(scopes ? { scopes } : {}) })).json.secret;
}
const withKey = (secret, path) => fetch(`${server.base}${path}`, { headers: { authorization: `Bearer ${secret}` } });
const subdomain = () => `shop${Math.random().toString(36).slice(2, 10)}`;
const newStore = browser => browser.post('/v1/stores', { name: 'Ada Store', subdomain: subdomain() });

describe('admin: resellers', () => {
  test('lists and shows resellers with members, settings, features and their store ceiling', async () => {
    const { resellerId } = await resellerClient(server, { country: 'GH', business: 'Kofi Cards' });
    const listed = await admin.get('/v1/admin/resellers?country=gh');
    assert.ok(listed.json.data.some(r => r.id === resellerId));
    const detail = await admin.get(`/v1/admin/resellers/${resellerId}`);
    assert.deepEqual([detail.json.name, detail.json.status, detail.json.members[0].role, detail.json.max_stores, detail.json.stores_allowed], ['Kofi Cards', 'pending', 'owner', null, 1]);
    assert.equal(detail.json.plan, undefined, 'BitoCard has no plans');
    assert.equal(detail.json.options.gift_card_payout.value, 'wallet');
  });

  test('activating and suspending are audited; suspension stops API keys at once', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const secret = await apiKey(browser);
    const unverified = await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' });
    assert.deepEqual([unverified.status, unverified.json.error.code], [409, 'verification_required'], 'never live before the identity check');
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    await server.app.get(PrismaService).reseller.update({ where: { id: resellerId }, data: { verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
    const activated = await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' });
    assert.equal(activated.json.status, 'active');
    assert.deepEqual([activated.json.verified_name, typeof activated.json.verified_at], ['Ada Obi', 'string']);
    assert.equal((await browser.post('/v1/api-keys', { name: 'Live', mode: 'live' })).status, 201, 'live keys once active');

    await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'suspended' });
    assert.equal((await withKey(secret, '/v1/account')).status, 401);

    const history = await admin.get(`/v1/admin/resellers/${resellerId}/history`);
    assert.equal(history.json.data.length, 2);
    assert.equal(history.json.data[0].after.status, 'suspended');
  });

  test('operations lift a suspension: verified resellers are active again, unverified ones go back to pending; the team is told', async () => {
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    const prisma = server.app.get(PrismaService);
    const verified = await resellerClient(server);
    await prisma.reseller.update({ where: { id: verified.resellerId }, data: { verifiedAt: new Date(), verifiedName: 'Ada Obi', status: 'active' } });
    assert.equal((await admin.post(`/v1/admin/resellers/${verified.resellerId}/unsuspend`, { reason: 'Not suspended yet' })).json.error.code, 'not_suspended');
    await admin.patch(`/v1/admin/resellers/${verified.resellerId}`, { status: 'suspended' });
    assert.ok(await prisma.notification.findFirst({ where: { resellerId: verified.resellerId, type: 'account.suspended' } }), 'the team is told it is suspended');
    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/resellers/${verified.resellerId}/unsuspend`, { reason: 'Cleared after review' })).status, 403);
    assert.equal((await admin.post(`/v1/admin/resellers/${verified.resellerId}/unsuspend`, { reason: 'no' })).status, 400, 'a reason is required');
    const lifted = await admin.post(`/v1/admin/resellers/${verified.resellerId}/unsuspend`, { reason: 'Cleared after review' });
    assert.equal(lifted.status, 200, JSON.stringify(lifted.json));
    assert.equal(lifted.json.status, 'active');
    assert.ok(await prisma.notification.findFirst({ where: { resellerId: verified.resellerId, type: 'account.reinstated' } }), 'and when it is lifted');
    const history = (await admin.get(`/v1/admin/resellers/${verified.resellerId}/history`)).json.data;
    assert.deepEqual([history[0].action, history[0].after.reason], ['reseller.unsuspended', 'Cleared after review']);

    // Suspended before the identity check: it can be lifted, but not straight to live.
    const unverified = await resellerClient(server);
    await admin.patch(`/v1/admin/resellers/${unverified.resellerId}`, { status: 'suspended' });
    const pending = await admin.post(`/v1/admin/resellers/${unverified.resellerId}/unsuspend`, { reason: 'Cleared after review' });
    assert.equal(pending.json.status, 'pending');
  });

  test('invalid statuses, fields and ids are refused', async () => {
    const { resellerId } = await resellerClient(server);
    assert.equal((await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'deleted' })).json.error.param, 'status');
    assert.equal((await admin.patch(`/v1/admin/resellers/${resellerId}`, { plan: 'premium' })).status, 400, 'plans are gone');
    assert.equal((await admin.get('/v1/admin/resellers/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await admin.get('/v1/admin/resellers/not-a-uuid')).status, 400);
  });

  test('operations can waive the identity check to go live; payouts and the allowance still need it; withdrawing it stops live selling', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const short = await admin.post(`/v1/admin/resellers/${resellerId}/identity-waiver`, { reason: 'no' });
    assert.equal(short.status, 400, 'a reason is required');
    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/resellers/${resellerId}/identity-waiver`, { reason: 'Known partner, met in person' })).status, 403);

    const waived = await admin.post(`/v1/admin/resellers/${resellerId}/identity-waiver`, { reason: 'Known partner, met in person', activate: true });
    assert.equal(waived.status, 200, JSON.stringify(waived.json));
    assert.deepEqual([waived.json.status, waived.json.verified_at, waived.json.identity_waiver.reason, typeof waived.json.identity_waiver.waived_by.name], ['active', null, 'Known partner, met in person', 'string']);
    assert.equal((await browser.post('/v1/api-keys', { name: 'Live', mode: 'live' })).status, 201, 'live keys once active');
    const bank = await browser.post('/v1/bank-accounts', { bank_code: '058', account_number: '0123456789' });
    assert.equal(bank.json.error.code, 'reseller_not_verified', 'payout accounts still need the identity check');
    assert.equal((await adminClient(server, ['finance']).then(finance => finance.post(`/v1/admin/resellers/${resellerId}/startup-allowance`))).json.error.code, 'verification_required');

    const removed = await admin.post(`/v1/admin/resellers/${resellerId}/identity-waiver/remove`, { reason: 'Partnership ended' });
    assert.deepEqual([removed.json.status, removed.json.identity_waiver], ['pending', null], 'back to pending until verified');
    assert.equal((await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' })).json.error.code, 'verification_required');
    assert.equal((await admin.post(`/v1/admin/resellers/${resellerId}/identity-waiver/remove`, { reason: 'Again please' })).json.error.code, 'not_waived');

    // Waived without activating: Activate then works.
    await admin.post(`/v1/admin/resellers/${resellerId}/identity-waiver`, { reason: 'Known partner, met in person' });
    assert.equal((await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' })).json.status, 'active');
    const actions = (await admin.get(`/v1/admin/resellers/${resellerId}/history`)).json.data.map(entry => entry.action);
    assert.deepEqual(actions.slice(0, 4), ['reseller.updated', 'reseller.identity_waived', 'reseller.identity_waiver_removed', 'reseller.identity_waived']);
    assert.equal((await admin.get(`/v1/admin/resellers/${resellerId}/history`)).json.data[2].after.reason, 'Partnership ended');

    const { PrismaService } = await import('../dist/database/prisma.service.js');
    await server.app.get(PrismaService).reseller.update({ where: { id: resellerId }, data: { verifiedAt: new Date() } });
    assert.equal((await admin.post(`/v1/admin/resellers/${resellerId}/identity-waiver`, { reason: 'Known partner, met in person' })).json.error.code, 'already_verified');
  });

  test('support admins can look but not change', async () => {
    const support = await adminClient(server, ['support']);
    const { resellerId } = await resellerClient(server);
    assert.equal((await support.get(`/v1/admin/resellers/${resellerId}`)).status, 200);
    assert.equal((await support.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' })).status, 403);
  });
});

describe('stores per reseller', () => {
  test('one store by default; operations raise or lower a reseller’s own ceiling (step-up, audited); open stores are never closed', async () => {
    const { browser, resellerId } = await resellerClient(server);
    assert.equal((await newStore(browser)).status, 201);
    const second = await newStore(browser);
    assert.deepEqual([second.status, second.json.error.code], [409, 'store_limit_reached']);
    assert.match(second.json.error.message, /1 store\b/);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.put(`/v1/admin/resellers/${resellerId}/store-limit`, { max_stores: 3, reason: 'Growing business' })).status, 403);
    assert.equal((await admin.put(`/v1/admin/resellers/${resellerId}/store-limit`, { max_stores: 0, reason: 'Growing business' })).status, 400);
    const raised = await admin.put(`/v1/admin/resellers/${resellerId}/store-limit`, { max_stores: 3, reason: 'Growing business' });
    assert.equal(raised.status, 200, JSON.stringify(raised.json));
    assert.deepEqual([raised.json.max_stores, raised.json.stores_allowed], [3, 3]);
    assert.equal((await newStore(browser)).status, 201);
    assert.equal((await newStore(browser)).status, 201);
    assert.equal((await newStore(browser)).json.error.code, 'store_limit_reached');

    const back = await admin.put(`/v1/admin/resellers/${resellerId}/store-limit`, { max_stores: null, reason: 'Back to the default' });
    assert.deepEqual([back.json.max_stores, back.json.stores_allowed], [null, 1]);
    assert.equal((await browser.get('/v1/stores')).json.data.length, 3, 'lowering it closes nothing');
    const history = (await admin.get(`/v1/admin/resellers/${resellerId}/history`)).json.data;
    assert.deepEqual([history[0].action, history[0].after.max_stores, history[1].after.reason], ['reseller.store_limit_set', null, 'Growing business']);
  });
});

describe('no plans', () => {
  test('the plan routes are gone and the account carries no plan', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await client(server.base).get('/v1/plans')).status, 404);
    assert.equal((await browser.get('/v1/subscription')).status, 404);
    assert.equal((await browser.get('/v1/subscriptions')).status, 404);
    assert.equal((await admin.get('/v1/admin/plans')).status, 404);
    const account = (await browser.get('/v1/account')).json;
    assert.equal(account.plan, undefined);
  });

  test('every reseller has what plans used to gate: team members, chat with BitoCard, store traffic, AI and every API scope', async () => {
    const { browser } = await resellerClient(server);
    const invited = await browser.post('/v1/team/invitations', { email: `colleague${Date.now()}@example.com`, role: 'support' });
    assert.equal(invited.status, 201, JSON.stringify(invited.json));
    assert.equal((await browser.get('/v1/support/bitocard-chat')).status, 200);
    const store = (await newStore(browser)).json;
    assert.equal((await browser.get(`/v1/stores/${store.id}/traffic`)).status, 200);
    const ai = (await browser.get('/v1/support/ai')).json;
    assert.equal(ai.premium, undefined);
    assert.equal(ai.allowance.stores[0].replies_allowed, 2000, 'every store has the free allowance');
    const secret = await apiKey(browser);
    assert.equal((await withKey(secret, '/v1/catalogue/products')).status, 200);
  });

  test('a store chooses Your brand only itself, and pays for AI past its allowance by default', async () => {
    const { browser } = await resellerClient(server);
    const store = (await newStore(browser)).json;
    assert.deepEqual([store.white_label, store.ai_overage], [false, 'pay']);
    const changed = await browser.patch(`/v1/stores/${store.id}`, { white_label: true });
    assert.equal(changed.json.white_label, true);
  });
});
