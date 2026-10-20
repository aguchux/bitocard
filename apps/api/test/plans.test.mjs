// Plans, plan API restrictions, and admin management of resellers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FixturesModule, adminClient, client, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
const prismaOf = () => server.app.get(prismaService);
let prismaService;

before(async () => {
  server = await startApp({ extraModules: [FixturesModule] });
  admin = await adminClient(server);
  prismaService = (await import('../dist/database/prisma.service.js')).PrismaService;
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

  test('admins rename Premium, describe it and fix its price per market currency; the free plan is never charged', async () => {
    const finance = await adminClient(server, ['finance']);
    const saved = await finance.patch('/v1/admin/plans/premium', { name: 'Premium Plus', description: 'For growing stores.', local_prices: { ngn: 4_000_000, GHS: 50_000 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.name, saved.json.description, saved.json.local_prices], ['Premium Plus', 'For growing stores.', { GHS: 50_000, NGN: 4_000_000 }]);
    assert.ok(await server.app.get((await import('../dist/database/prisma.service.js')).PrismaService).auditLog.findFirst({ where: { action: 'plan.updated', targetId: 'premium' } }));

    const overview = (await finance.get('/v1/admin/plans')).json;
    const premium = overview.plans.find(plan => plan.code === 'premium');
    assert.deepEqual(premium.local_prices.find(row => row.currency === 'NGN').fixed, 4_000_000);
    assert.equal(premium.local_prices.find(row => row.currency === 'NGN').charged, 4_000_000);
    assert.ok(premium.local_prices.find(row => row.currency === 'NGN').markets.includes('Nigeria'));
    assert.equal(overview.plans.find(plan => plan.code === 'standard').free, true);

    const publicList = (await client(server.base).get('/v1/plans?currency=GHS')).json.data;
    assert.deepEqual(publicList.find(plan => plan.code === 'premium').local_price, { amount: 50_000, currency: 'GHS', fixed: true });
    assert.equal(publicList.find(plan => plan.code === 'premium').description, 'For growing stores.');

    assert.equal((await finance.patch('/v1/admin/plans/premium', { local_prices: { EUR: 100 } })).json.error.param, 'local_prices', 'only market currencies');
    assert.equal((await finance.patch('/v1/admin/plans/premium', { local_prices: { NGN: 0 } })).json.error.param, 'local_prices');
    assert.equal((await finance.patch('/v1/admin/plans/standard', { price_cents: 500 })).json.error.param, 'price_cents', 'the free plan stays free');
    assert.equal((await finance.patch('/v1/admin/plans/premium', { price_cents: 0 })).json.error.param, 'price_cents');
    const reset = await finance.patch('/v1/admin/plans/premium', { name: 'Premium', local_prices: { NGN: null, GHS: null } });
    assert.deepEqual(reset.json.local_prices, {});
  });

  test('admins create plans with their features; hidden plans take no one new; bad plans are refused', async () => {
    const finance = await adminClient(server, ['finance']);
    const created = await finance.post('/v1/admin/plans', { code: 'business', name: 'Business', description: 'For independent sellers.', price_cents: 4900, features: ['own_payment_gateways', 'own_integrations', 'custom_domains'] });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const business = created.json.plans.find(plan => plan.code === 'business');
    assert.deepEqual([business.available, business.free, business.features], [true, false, ['own_integrations', 'own_payment_gateways', 'custom_domains']], 'features kept in the catalogue order');
    assert.ok(created.json.features.every(feature => created.json.groups.some(group => group.code === feature.group)), 'every feature has a group');
    const listed = (await client(server.base).get('/v1/plans')).json.data;
    assert.deepEqual(listed.map(plan => plan.code), ['standard', 'premium', 'business']);
    assert.deepEqual(listed[2].feature_details.map(item => item.name), ['Your own suppliers', 'Your own payment gateway', 'Your own domains']);
    assert.ok(await prismaOf().auditLog.findFirst({ where: { action: 'plan.created', targetId: 'business' } }));

    assert.equal((await finance.post('/v1/admin/plans', { code: 'business', name: 'Again', price_cents: 100 })).json.error.code, 'plan_exists');
    assert.equal((await finance.post('/v1/admin/plans', { code: 'Not OK!', name: 'Bad', price_cents: 100 })).json.error.param, 'code');
    assert.equal((await finance.post('/v1/admin/plans', { code: 'freebie', name: 'Free', price_cents: 0 })).status, 400, 'only Standard is free');
    assert.equal((await finance.post('/v1/admin/plans', { code: 'flyer', name: 'Flyer', price_cents: 100, features: ['flying'] })).json.error.param, 'features');
    assert.equal((await (await adminClient(server, ['support'])).post('/v1/admin/plans', { code: 'nope', name: 'Nope', price_cents: 100 })).status, 403);

    // Hidden: off the public list, and nobody new can choose it (those on it keep it).
    assert.equal((await finance.patch('/v1/admin/plans/business', { available: false })).json.available, false);
    assert.deepEqual((await client(server.base).get('/v1/plans')).json.data.map(plan => plan.code), ['standard', 'premium']);
    const { browser } = await resellerClient(server);
    const hidden = await browser.post('/v1/subscription', { plan: 'business' });
    assert.deepEqual([hidden.status, hidden.json.error?.code], [409, 'plan_unavailable']);
    assert.equal((await finance.patch('/v1/admin/plans/standard', { available: false })).json.error.param, 'available', 'the free plan is never hidden');
  });

  test('admins switch each feature on or off per plan; resellers on it follow at once and are told what they lose', async () => {
    const finance = await adminClient(server, ['finance']);
    const { browser } = await resellerClient(server);
    assert.equal((await browser.get('/v1/account')).json.plan.features.includes('international_selling'), false);

    const on = await finance.put('/v1/admin/plans/standard/features/international_selling', { enabled: true });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    assert.ok(on.json.plans.find(plan => plan.code === 'standard').features.includes('international_selling'));
    assert.ok((await browser.get('/v1/account')).json.plan.features.includes('international_selling'), 'Standard resellers have it now');

    const off = await finance.put('/v1/admin/plans/standard/features/international_selling', { enabled: false });
    assert.equal(off.json.plans.find(plan => plan.code === 'standard').features.includes('international_selling'), false);
    assert.ok(off.json.plans.find(plan => plan.code === 'premium').features.includes('international_selling'), 'other plans keep it');
    assert.equal((await browser.get('/v1/account')).json.plan.features.includes('international_selling'), false);
    const notices = (await browser.get('/v1/notifications')).json.data;
    assert.ok(notices.some(item => item.type === 'plan.feature_changed' && item.title === 'International selling is no longer part of Startup'), 'resellers on the plan are told');
    assert.ok(await prismaOf().auditLog.findFirst({ where: { action: 'plan.feature_changed', targetId: 'standard' } }));

    assert.equal((await finance.put('/v1/admin/plans/standard/features/flying', { enabled: true })).status, 404);
    assert.equal((await finance.put('/v1/admin/plans/nowhere/features/international_selling', { enabled: true })).status, 404);
    assert.equal((await finance.put('/v1/admin/plans/standard/features/international_selling', { enabled: 'yes' })).status, 400);
    assert.equal((await (await adminClient(server, ['support'])).put('/v1/admin/plans/standard/features/international_selling', { enabled: true })).status, 403);
  });

  test('a plan in use cannot be deleted; an empty one can; Standard never', async () => {
    const finance = await adminClient(server, ['finance']);
    await finance.post('/v1/admin/plans', { code: 'trial_gold', name: 'Gold', price_cents: 900 });
    const reseller = await resellerClient(server);
    await prismaOf().reseller.update({ where: { id: reseller.resellerId }, data: { planCode: 'trial_gold' } });
    assert.equal((await finance.delete('/v1/admin/plans/trial_gold')).json.error.code, 'plan_in_use');
    await prismaOf().reseller.update({ where: { id: reseller.resellerId }, data: { planCode: 'standard' } });
    const deleted = await finance.delete('/v1/admin/plans/trial_gold');
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    assert.ok(!deleted.json.plans.some(plan => plan.code === 'trial_gold'));
    assert.equal((await finance.delete('/v1/admin/plans/standard')).json.error.code, 'plan_in_use');
    assert.equal((await finance.delete('/v1/admin/plans/premium')).json.error.code, 'plan_in_use', "BitoCard's own store accounts are on Premium");
  });

  test('a feature the plan does not include is refused with plan_feature_required, and works once switched on', async () => {
    const finance = await adminClient(server, ['finance']);
    const reseller = await resellerClient(server);
    const { browser } = reseller;
    await prismaOf().reseller.update({ where: { id: reseller.resellerId }, data: { country: 'NG' } });
    const store = (await browser.post('/v1/stores', { name: 'First Store', subdomain: `first${Date.now().toString(36)}` })).json;
    assert.ok(store.id, JSON.stringify(store));
    const refusedWith = (res, feature) => assert.deepEqual([res.status, res.json.error?.code, res.json.error?.param], [403, 'plan_feature_required', feature], JSON.stringify(res.json));

    for (const feature of ['multiple_stores', 'store_traffic', 'team_members', 'custom_domains']) await finance.put(`/v1/admin/plans/standard/features/${feature}`, { enabled: false });
    try {
      refusedWith(await browser.post('/v1/stores', { name: 'Second Store', subdomain: `second${Date.now().toString(36)}` }), 'multiple_stores');
      refusedWith(await browser.get(`/v1/stores/${store.id}/traffic`), 'store_traffic');
      refusedWith(await browser.post('/v1/team/invitations', { email: `mate${Date.now()}@example.com`, role: 'support' }), 'team_members');
      await admin.put('/v1/admin/switches/custom_domains', { reseller_id: reseller.resellerId, enabled: true });
      refusedWith(await browser.get(`/v1/stores/${store.id}/domains`), 'custom_domains');
      refusedWith(await browser.post('/v1/support/bitocard-chat/messages', { body: 'Hello' }), 'priority_support');
      const message = (await browser.get(`/v1/stores/${store.id}/traffic`)).json.error.message;
      assert.match(message, /Store traffic is not part of your Startup plan/);
    } finally {
      for (const feature of ['multiple_stores', 'store_traffic', 'team_members', 'custom_domains']) await finance.put(`/v1/admin/plans/standard/features/${feature}`, { enabled: true });
    }
    assert.equal((await browser.get(`/v1/stores/${store.id}/traffic`)).status, 200, 'on again: allowed');
    assert.equal((await browser.post('/v1/stores', { name: 'Second Store', subdomain: `second${Date.now().toString(36)}` })).status, 201);
  });
});

describe('Startup, Premium and Enterprise', () => {
  test('the free plan is Startup; Enterprise has every feature and no limits, hidden until an admin shows it', async () => {
    const finance = await adminClient(server, ['finance']);
    const overview = (await finance.get('/v1/admin/plans')).json;
    assert.deepEqual(overview.plans.map(plan => plan.code).slice(0, 3), ['standard', 'premium', 'enterprise']);
    assert.equal(overview.plans[0].name, 'Startup');
    const enterprise = overview.plans.find(plan => plan.code === 'enterprise');
    assert.deepEqual([enterprise.available, enterprise.free], [false, false]);
    assert.deepEqual(enterprise.features, overview.features.map(feature => feature.code), 'every feature');
    assert.ok(Object.values(enterprise.limits).every(value => value === null), 'no limits');
    assert.ok(!(await client(server.base).get('/v1/plans')).json.data.some(plan => plan.code === 'enterprise'), 'hidden from resellers');
    // An admin can still put a reseller on it while hidden, and resellers see it once shown.
    assert.equal((await finance.patch('/v1/admin/plans/enterprise', { available: true })).status, 200);
    try {
      assert.ok((await client(server.base).get('/v1/plans')).json.data.some(plan => plan.code === 'enterprise'));
    } finally {
      await finance.patch('/v1/admin/plans/enterprise', { available: false });
    }
  });
});

describe('plan limits', () => {
  test('every plan starts with today’s limits, shown to admins and resellers', async () => {
    const finance = await adminClient(server, ['finance']);
    const overview = (await finance.get('/v1/admin/plans')).json;
    const standard = overview.plans.find(plan => plan.code === 'standard');
    assert.deepEqual(
      [standard.limits.stores, standard.limits.domains_per_store, standard.limits.webhook_endpoints, standard.limits.team_members, standard.limits.own_connections],
      [5, 5, 16, null, null],
    );
    assert.equal(standard.limits.ai_replies, overview.limits.find(item => item.code === 'ai_replies').default, 'AI replies default to the Support assistant setting');
    assert.deepEqual(standard.limits_set, []);
    assert.deepEqual(overview.limits.find(item => item.code === 'domains_per_store').scope, 'store');
    assert.deepEqual(overview.features.find(item => item.code === 'team_members').scope, 'account');
    const listed = (await client(server.base).get('/v1/plans')).json.data[0];
    assert.equal(listed.limits.stores, 5);
    assert.equal(listed.feature_details.find(item => item.code === 'team_members').scope, 'account');
  });

  test('a plan’s limits are enforced, unlimited means no limit, and lowering one removes nothing', async () => {
    const finance = await adminClient(server, ['finance']);
    await finance.post('/v1/admin/plans', { code: 'limited', name: 'Limited', price_cents: 1000, features: ['multiple_stores', 'team_members'] });
    const reseller = await resellerClient(server);
    const { browser } = reseller;
    await prismaOf().reseller.update({ where: { id: reseller.resellerId }, data: { country: 'NG', planCode: 'limited' } });
    const store = async name => browser.post('/v1/stores', { name, subdomain: `${name.toLowerCase()}${Date.now().toString(36)}` });
    assert.equal((await store('One')).status, 201);

    // Stores: one allowed, then refused with the plan named; unlimited lets more in.
    const set = await finance.put('/v1/admin/plans/limited/limits/stores', { value: 1 });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual(set.json.plans.find(plan => plan.code === 'limited').limits_set, ['stores']);
    const refused = await store('Two');
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'store_limit_reached']);
    assert.match(refused.json.error.message, /Your Limited plan allows 1 store/);
    await finance.put('/v1/admin/plans/limited/limits/stores', { value: null });
    assert.equal((await store('Two')).status, 201, 'unlimited');
    // Lowered below what they have: both stores stay, a third is refused.
    await finance.put('/v1/admin/plans/limited/limits/stores', { value: 1 });
    assert.equal((await browser.get('/v1/stores')).json.data.length, 2);
    assert.equal((await store('Three')).json.error.code, 'store_limit_reached');

    // Team members: invitations waiting count; replacing one to the same address does not.
    await finance.put('/v1/admin/plans/limited/limits/team_members', { value: 1 });
    const mate = `mate${Date.now()}@example.com`;
    assert.equal((await browser.post('/v1/team/invitations', { email: mate, role: 'support' })).status, 201);
    assert.equal((await browser.post('/v1/team/invitations', { email: mate, role: 'finance' })).status, 201, 'the same person again replaces it');
    const second = await browser.post('/v1/team/invitations', { email: `other${Date.now()}@example.com`, role: 'support' });
    assert.deepEqual([second.status, second.json.error.code, second.json.error.param], [409, 'plan_limit_reached', 'email']);

    // Webhook endpoints, per mode.
    await finance.put('/v1/admin/plans/limited/limits/webhook_endpoints', { value: 0 });
    const endpoint = await browser.post('/v1/webhook-endpoints', { url: 'https://hooks.example.com/bitocard' }, { 'bitocard-mode': 'test' });
    assert.deepEqual([endpoint.status, endpoint.json.error?.code], [400, 'endpoint_limit'], JSON.stringify(endpoint.json));

    // Reset goes back to the default, and every change is audited.
    const reset = await finance.put('/v1/admin/plans/limited/limits/stores', { reset: true });
    assert.equal(reset.json.plans.find(plan => plan.code === 'limited').limits.stores, 5);
    assert.ok(await prismaOf().auditLog.findFirst({ where: { action: 'plan.limit_changed', targetId: 'limited' } }));
    await prismaOf().reseller.update({ where: { id: reseller.resellerId }, data: { planCode: 'standard' } });
  });

  test('limits are checked: known, whole numbers within range, finance only', async () => {
    const finance = await adminClient(server, ['finance']);
    assert.equal((await finance.put('/v1/admin/plans/premium/limits/rockets', { value: 1 })).status, 404);
    assert.equal((await finance.put('/v1/admin/plans/nowhere/limits/stores', { value: 1 })).status, 404);
    assert.equal((await finance.put('/v1/admin/plans/premium/limits/stores', { value: -1 })).status, 400);
    assert.equal((await finance.put('/v1/admin/plans/premium/limits/stores', { value: 1.5 })).status, 400);
    assert.equal((await finance.put('/v1/admin/plans/premium/limits/stores', { value: 5000 })).json.error.param, 'value');
    assert.equal((await finance.put('/v1/admin/plans/premium/limits/stores', {})).json.error.code, 'parameter_missing');
    assert.equal((await (await adminClient(server, ['support'])).put('/v1/admin/plans/premium/limits/stores', { value: 3 })).status, 403);
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

  test('invalid statuses, plans and ids are refused', async () => {
    const { resellerId } = await resellerClient(server);
    assert.equal((await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'deleted' })).json.error.param, 'status');
    assert.equal((await admin.patch(`/v1/admin/resellers/${resellerId}`, { plan: 'gold' })).json.error.param, 'plan');
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
