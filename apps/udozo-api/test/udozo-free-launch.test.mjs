// Udozo launches free: until an admin switches paid plans on (`paid_plans`, global, off), there is no setup fee and no
// plan to choose, every store has every feature, and stores go live without paying anything.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  // Finance has set a setup fee: it still charges nobody while paid plans are off.
  assert.equal((await admin.put('/v1/admin/setup-fees/NG', { enabled: true, amount: 2_000_000 })).status, 200);
});

after(() => server?.close());

let counter = 0;
async function seller() {
  const created = await resellerClient(server);
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active', verifiedAt: new Date(), verifiedName: 'Ada Obi' } });
  await prisma.featureSwitch.create({ data: { key: 'reseller_resale', resellerId: created.resellerId, enabled: true } });
  counter += 1;
  const store = await created.browser.post('/v1/stores', { name: `Free ${counter}`, subdomain: `free${counter}x${Date.now() % 10000}` });
  assert.equal(store.status, 201, JSON.stringify(store.json));
  await prisma.store.update({ where: { id: store.json.id }, data: { status: 'published', publishedAt: new Date() } });
  return { ...created, store: store.json };
}

describe('Udozo without paid plans', () => {
  test('the switch is Udozo’s, off, and Seller HQ is told', async () => {
    const paid = (await admin.get('/v1/admin/switches')).json.definitions.paid_plans;
    assert.deepEqual([paid?.default, paid?.scopes], [false, ['global']]);
    const s = await seller();
    assert.equal((await s.browser.get('/v1/settings')).json.features.paid_plans, false);
  });

  test('no setup fee, no plans to choose, and a store goes live without paying', async () => {
    const s = await seller();
    assert.deepEqual((await s.browser.get('/v1/billing/setup-fee')).json, { object: 'setup_fee', charged: false, due: false, amount: 0, currency: 'NGN', paid_at: null });
    assert.deepEqual((await s.browser.get('/v1/plans')).json.data, []);
    const chosen = await s.browser.post(`/v1/stores/${s.store.id}/subscription`, { plan: 'premium' });
    assert.deepEqual([chosen.status, chosen.json.error?.code], [409, 'plans_unavailable']);
    await prisma.storeDomain.create({ data: { storeId: s.store.id, resellerId: s.resellerId, name: `own${Date.now()}.example`, source: 'connected', status: 'active', primary: true } });
    const live = await s.browser.patch(`/v1/stores/${s.store.id}`, { checkout_mode: 'live' });
    assert.equal(live.status, 200, JSON.stringify(live.json));
    assert.equal(await prisma.ledgerPosting.count({ where: { entry: { reference: `setup_fee:${s.resellerId}` } } }), 0, 'nothing taken');
  });

  test('every store has every feature: its own brand only, priority support, team members', async () => {
    const s = await seller();
    assert.equal((await s.browser.get('/v1/support/bitocard-chat')).status, 200, 'chat with Udozo, a Premium feature');
    const invited = await s.browser.post('/v1/team/invitations', { email: `colleague${Date.now()}@example.com`, role: 'support' });
    assert.ok([200, 201].includes(invited.status), JSON.stringify(invited.json));
    const access = server.app.get((await import('../dist/plans/plan-access.js')).PlanAccessService);
    assert.equal(await access.storeHas(s.store.id, 'white_label'), true);
    assert.equal((await access.storeLimit(s.store.id, 'free_domains')).value, 0, 'no free domains: nothing pays for them');
    assert.equal((await access.storeLimit(s.store.id, 'domains_per_store')).value, 5);
  });

  test('switched on, the fee and the plans are back', async () => {
    assert.equal((await admin.put('/v1/admin/switches/paid_plans', { enabled: true })).status, 200);
    const s = await seller();
    assert.deepEqual([(await s.browser.get('/v1/billing/setup-fee')).json.due, (await s.browser.get('/v1/settings')).json.features.paid_plans], [true, true]);
    assert.ok((await s.browser.get('/v1/plans')).json.data.length >= 1);
    const access = server.app.get((await import('../dist/plans/plan-access.js')).PlanAccessService);
    assert.equal(await access.storeHas(s.store.id, 'white_label'), false, 'Startup again lacks Premium’s features');
    assert.equal((await s.browser.get('/v1/support/bitocard-chat')).json.error?.code, 'plan_feature_required');
    assert.equal((await admin.put('/v1/admin/switches/paid_plans', { enabled: null })).status, 200);
  });
});
