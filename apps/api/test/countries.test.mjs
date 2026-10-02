// Countries (markets): public listing, admin management, audit trail and sign-up rules.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
});

after(() => server?.close());

describe('public listing', () => {
  test('lists the pilot countries with currency and the categories sold', async () => {
    const { status, json } = await client(server.base).get('/v1/countries');
    assert.equal(status, 200);
    assert.deepEqual(json.data.map(c => c.code).sort(), ['GH', 'KE', 'NG']);
    const ng = json.data.find(c => c.code === 'NG');
    assert.equal(ng.currency, 'NGN');
    assert.deepEqual(ng.categories.map(c => c.category).sort(), ['airtime', 'bills', 'data', 'gift_cards', 'pay_tv']);
    assert.equal(ng.categories.find(c => c.category === 'gift_cards').customer_verification, true);
    assert.equal(ng.categories.find(c => c.category === 'airtime').customer_verification, false);
    assert.equal(ng.markup_cap_percent, undefined, 'money rules are admin-only');
  });

  test('a single country, case-insensitively; unknown codes are 404', async () => {
    assert.equal((await client(server.base).get('/v1/countries/gh')).json.currency, 'GHS');
    assert.equal((await client(server.base).get('/v1/countries/ZZ')).status, 404);
  });
});

describe('admin management', () => {
  test('admins see every setting, including money rules', async () => {
    const { json } = await admin.get('/v1/admin/countries');
    const ng = json.data.find(c => c.code === 'NG');
    assert.deepEqual([ng.markup_cap_percent, ng.payout_hold_days, ng.min_withdrawal_minor, ng.reserved_accounts], [50, 15, 1500000, true]);
    assert.equal(ng.categories.length, 9, 'every category, on or off');
  });

  test('opening a new country makes sign-up possible there, and is audited', async () => {
    const before = await client(server.base).post('/v1/auth/signup', { name: 'Kofi', email: `za-${Date.now()}@example.com`, password: 'correct horse battery', country: 'ZA' });
    assert.equal(before.json.error.code, 'country_not_supported');

    const created = await admin.post('/v1/admin/countries', { code: 'za', name: 'South Africa', currency: 'zar', min_withdrawal_minor: 18000 });
    assert.equal(created.status, 201);
    assert.deepEqual([created.json.reseller_signup, created.json.categories.every(c => !c.enabled)], [false, true], 'new countries start closed');

    const opened = await admin.patch('/v1/admin/countries/ZA', { reseller_signup: true });
    assert.equal(opened.json.reseller_signup, true);
    const signup = await client(server.base).post('/v1/auth/signup', { name: 'Thandi', email: `za2-${Date.now()}@example.com`, password: 'correct horse battery', country: 'ZA' });
    assert.equal(signup.status, 201);

    const logs = await server.app.get(PrismaService).auditLog.findMany({ where: { targetType: 'country', targetId: 'ZA' }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(logs.map(l => l.action), ['country.created', 'country.updated']);
    assert.equal(logs[1].before.resellerSignup, false);
    assert.equal(logs[1].after.resellerSignup, true);
    assert.ok(logs[1].actorId, 'records who made the change');
  });

  test('categories can be switched on and need verification set per country', async () => {
    const updated = await admin.put('/v1/admin/countries/KE/categories/esim', { enabled: true });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.categories.find(c => c.category === 'esim').enabled, true);
    const pub = await client(server.base).get('/v1/countries/KE');
    assert.ok(pub.json.categories.some(c => c.category === 'esim'));
  });

  test('unknown categories and invalid values are refused', async () => {
    const bad = await admin.put('/v1/admin/countries/NG/categories/spaceships', { enabled: true });
    assert.deepEqual([bad.status, bad.json.error.param], [400, 'category']);
    const cap = await admin.patch('/v1/admin/countries/NG', { markup_cap_percent: -5 });
    assert.deepEqual([cap.status, cap.json.error.param], [400, 'markup_cap_percent']);
    const duplicate = await admin.post('/v1/admin/countries', { code: 'NG', name: 'Nigeria', currency: 'NGN', min_withdrawal_minor: 1 });
    assert.equal(duplicate.json.error.code, 'country_exists');
  });
});

describe('access', () => {
  test('resellers and admins without the operations role cannot manage countries', async () => {
    const { browser } = await resellerClient(server);
    assert.equal((await browser.get('/v1/admin/countries')).status, 401);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.get('/v1/admin/countries')).status, 403);
    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.get('/v1/admin/countries')).status, 200);
  });
});
