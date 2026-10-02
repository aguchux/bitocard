// Plans, plan API restrictions, and admin management of resellers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FixturesModule, adminClient, client, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;

before(async () => {
  server = await startApp({ extraModules: [FixturesModule] });
  admin = await adminClient(server);
});

after(() => server?.close());

async function apiKey(browser, scopes) {
  return (await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test', ...(scopes ? { scopes } : {}) })).json.secret;
}
const withKey = (secret, path) => fetch(`${server.base}${path}`, { headers: { authorization: `Bearer ${secret}` } });

describe('plans', () => {
  test('Standard and Premium are listed publicly with prices in USD', async () => {
    const { json } = await client(server.base).get('/v1/plans');
    assert.deepEqual(json.data.map(p => p.code), ['standard', 'premium']);
    assert.deepEqual(json.data[0].price, { amount: 0, currency: 'USD', interval: 'month' });
    assert.ok(json.data[1].features.includes('chargeback_protection'));
  });

  test('new resellers are on Standard, shown on their account', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.get('/v1/account')).json.plan.code, 'standard');
  });

  test('finance admins set the Premium price; others cannot', async () => {
    const finance = await adminClient(server, ['finance']);
    const updated = await finance.patch('/v1/admin/plans/premium', { price_cents: 3000 });
    assert.equal(updated.status, 200);
    assert.equal((await client(server.base).get('/v1/plans')).json.data[1].price.amount, 3000);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.patch('/v1/admin/plans/premium', { price_cents: 1 })).status, 403);
    assert.equal((await admin.patch('/v1/admin/plans/premium', { features: ['flying'] })).json.error.param, 'features');
  });
});

describe('plan API restrictions', () => {
  test('every API feature is on by default; a plan restriction blocks it until lifted', async () => {
    const { browser } = await resellerClient(server);
    const secret = await apiKey(browser);
    assert.equal((await withKey(secret, '/v1/fixtures/scoped')).status, 200);

    await admin.patch('/v1/admin/plans/standard', { api_restrictions: ['orders:write'] });
    const blocked = await withKey(secret, '/v1/fixtures/scoped');
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error.code, 'plan_restricted');

    await admin.patch('/v1/admin/plans/standard', { api_restrictions: [] });
    assert.equal((await withKey(secret, '/v1/fixtures/scoped')).status, 200);
  });

  test('a key without the scope is refused regardless of plan', async () => {
    const { browser } = await resellerClient(server);
    const secret = await apiKey(browser, ['catalogue:read']);
    const res = await withKey(secret, '/v1/fixtures/scoped');
    assert.equal(res.status, 403);
    assert.match((await res.json()).error.message, /orders:write/);
  });

  test('unknown scopes cannot be restricted', async () => {
    assert.equal((await admin.patch('/v1/admin/plans/standard', { api_restrictions: ['everything'] })).json.error.param, 'api_restrictions');
  });
});

describe('admin: resellers', () => {
  test('lists and shows resellers with members, plan, settings and features', async () => {
    const { resellerId } = await resellerClient(server, { country: 'GH', business: 'Kofi Cards' });
    const listed = await admin.get('/v1/admin/resellers?country=gh');
    assert.ok(listed.json.data.some(r => r.id === resellerId));
    const detail = await admin.get(`/v1/admin/resellers/${resellerId}`);
    assert.deepEqual([detail.json.name, detail.json.status, detail.json.plan.code, detail.json.members[0].role], ['Kofi Cards', 'pending', 'standard', 'owner']);
    assert.equal(detail.json.options.gift_card_payout.value, 'wallet');
  });

  test('activating, upgrading and suspending are audited; suspension stops API keys at once', async () => {
    const { browser, resellerId } = await resellerClient(server);
    const secret = await apiKey(browser);
    const unverified = await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' });
    assert.deepEqual([unverified.status, unverified.json.error.code], [409, 'verification_required'], 'never live before the identity check');
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    await server.app.get(PrismaService).reseller.update({ where: { id: resellerId }, data: { verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
    const activated = await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active', plan: 'premium' });
    assert.deepEqual([activated.json.status, activated.json.plan.code], ['active', 'premium']);
    assert.equal((await browser.post('/v1/api-keys', { name: 'Live', mode: 'live' })).status, 201, 'live keys once active');

    await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'suspended' });
    assert.equal((await withKey(secret, '/v1/account')).status, 401);

    const history = await admin.get(`/v1/admin/resellers/${resellerId}/history`);
    assert.equal(history.json.data.length, 2);
    assert.equal(history.json.data[0].after.status, 'suspended');
  });

  test('invalid statuses, plans and ids are refused', async () => {
    const { resellerId } = await resellerClient(server);
    assert.equal((await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'deleted' })).json.error.param, 'status');
    assert.equal((await admin.patch(`/v1/admin/resellers/${resellerId}`, { plan: 'gold' })).json.error.param, 'plan');
    assert.equal((await admin.get('/v1/admin/resellers/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await admin.get('/v1/admin/resellers/not-a-uuid')).status, 400);
  });

  test('support admins can look but not change', async () => {
    const support = await adminClient(server, ['support']);
    const { resellerId } = await resellerClient(server);
    assert.equal((await support.get(`/v1/admin/resellers/${resellerId}`)).status, 200);
    assert.equal((await support.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' })).status, 403);
  });
});
