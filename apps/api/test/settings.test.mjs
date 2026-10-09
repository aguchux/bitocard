// Settings chain (country allows, reseller chooses) and admin feature switches.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;

before(async () => {
  server = await startApp();
  admin = await adminClient(server);
});

after(() => server?.close());

describe('settings chain', () => {
  test("a reseller sees their country's options and defaults", async () => {
    const { browser } = await resellerClient(server, { country: 'NG' });
    const { status, json } = await browser.get('/v1/settings');
    assert.equal(status, 200);
    assert.deepEqual(json.options.gift_card_payout, { value: 'wallet', allowed: ['wallet', 'bank'], source: 'country_default' });
    assert.equal(json.options.fixed_price_earning, undefined, 'discount products always sell at face value at most');
    assert.deepEqual(json.features, { startup_allowance: false, welcome_bonus: false, reserved_accounts: false, own_integrations: false, customer_app_bottom_bar_desktop: false, manual_reseller_approval: false });
  });

  test('a reseller can choose only what their country allows', async () => {
    const ng = await resellerClient(server, { country: 'NG' });
    const chosen = await ng.browser.put('/v1/settings/options/gift_card_payout', { value: 'bank' });
    assert.equal(chosen.status, 200);
    assert.deepEqual([chosen.json.options.gift_card_payout.value, chosen.json.options.gift_card_payout.source], ['bank', 'reseller']);

    const ke = await resellerClient(server, { country: 'KE' });
    const refused = await ke.browser.put('/v1/settings/options/gift_card_payout', { value: 'wallet' });
    assert.deepEqual([refused.status, refused.json.error.code], [400, 'option_not_allowed'], 'Kenya has no reserved accounts, so no wallet payouts');
    assert.equal((await ke.browser.put('/v1/settings/options/made_up', { value: 'x' })).status, 404);
  });

  test("an admin can allow more, and a reseller's choice falls back when it is withdrawn", async () => {
    const ke = await resellerClient(server, { country: 'KE' });
    const before = await ke.browser.put('/v1/settings/options/gift_card_payout', { value: 'wallet' });
    assert.equal(before.json.error.code, 'option_not_allowed');

    const allowed = await admin.put('/v1/admin/countries/KE/options/gift_card_payout', { allowed: ['bank', 'wallet'], default: 'bank' });
    assert.equal(allowed.status, 200);
    const chosen = await ke.browser.put('/v1/settings/options/gift_card_payout', { value: 'wallet' });
    assert.equal(chosen.json.options.gift_card_payout.value, 'wallet');

    await admin.put('/v1/admin/countries/KE/options/gift_card_payout', { allowed: ['bank'], default: 'bank' });
    const after = await ke.browser.get('/v1/settings');
    assert.deepEqual([after.json.options.gift_card_payout.value, after.json.options.gift_card_payout.source], ['bank', 'country_default']);
  });

  test('admins cannot allow unknown values or a default outside the list', async () => {
    const unknown = await admin.put('/v1/admin/countries/NG/options/gift_card_payout', { allowed: ['crypto'], default: 'crypto' });
    assert.equal(unknown.json.error.param, 'allowed');
    const badDefault = await admin.put('/v1/admin/countries/NG/options/gift_card_payout', { allowed: ['bank'], default: 'wallet' });
    assert.equal(badDefault.json.error.param, 'default');
  });

  test('only owners and admins can change settings; every member can read them', async () => {
    const owner = await resellerClient(server);
    assert.equal((await owner.browser.put('/v1/settings/options/gift_card_payout', { value: 'bank' })).status, 200, 'owner');
    const staff = await resellerClient(server);
    const prisma = server.app.get(PrismaService);
    await prisma.resellerMember.deleteMany({ where: { userId: staff.userId } });
    await prisma.resellerMember.create({ data: { resellerId: owner.resellerId, userId: staff.userId, role: 'support' } });
    assert.equal((await staff.browser.get('/v1/settings')).status, 200);
    assert.equal((await staff.browser.put('/v1/settings/options/gift_card_payout', { value: 'wallet' })).status, 403);
  });
});

describe('feature switches', () => {
  test('a reseller switch overrides the country, which overrides the global one', async () => {
    const ng = await resellerClient(server, { country: 'NG' });
    const ng2 = await resellerClient(server, { country: 'NG' });
    const gh = await resellerClient(server, { country: 'GH' });
    const features = async who => (await who.browser.get('/v1/settings')).json.features.startup_allowance;

    assert.equal((await admin.put('/v1/admin/switches/startup_allowance', { enabled: true })).status, 200);
    assert.deepEqual([await features(ng), await features(gh)], [true, true], 'global on');

    await admin.put('/v1/admin/switches/startup_allowance', { country_code: 'GH', enabled: false });
    assert.deepEqual([await features(ng), await features(gh)], [true, false], 'Ghana off');

    await admin.put('/v1/admin/switches/startup_allowance', { reseller_id: ng2.resellerId, enabled: false });
    assert.deepEqual([await features(ng), await features(ng2)], [true, false], 'one reseller revoked');

    await admin.put('/v1/admin/switches/startup_allowance', { reseller_id: ng2.resellerId, enabled: null });
    assert.equal(await features(ng2), true, 'clearing the reseller switch falls back to the global one');

    await admin.put('/v1/admin/switches/startup_allowance', { enabled: null });
    await admin.put('/v1/admin/switches/startup_allowance', { country_code: 'GH', enabled: null });
  });

  test('the welcome bonus can only be switched on per reseller, never globally', async () => {
    const global = await admin.put('/v1/admin/switches/welcome_bonus', { enabled: true });
    assert.deepEqual([global.status, global.json.error.code], [400, 'scope_not_allowed']);
    const country = await admin.put('/v1/admin/switches/welcome_bonus', { country_code: 'NG', enabled: true });
    assert.equal(country.json.error.code, 'scope_not_allowed');

    const { browser, resellerId } = await resellerClient(server);
    assert.equal((await admin.put('/v1/admin/switches/welcome_bonus', { reseller_id: resellerId, enabled: true })).status, 200);
    assert.equal((await browser.get('/v1/settings')).json.features.welcome_bonus, true);
  });

  test('switches are listed, and bad scopes or keys are refused', async () => {
    const both = await admin.put('/v1/admin/switches/startup_allowance', { country_code: 'NG', reseller_id: '00000000-0000-4000-8000-000000000000', enabled: true });
    assert.equal(both.status, 400);
    assert.equal((await admin.put('/v1/admin/switches/nonsense', { enabled: true })).status, 404);
    assert.equal((await admin.put('/v1/admin/switches/startup_allowance', { country_code: 'ZZ', enabled: true })).status, 404);
    const listed = await admin.get('/v1/admin/switches');
    assert.ok(listed.json.definitions.startup_allowance);
    assert.ok(listed.json.data.some(s => s.key === 'welcome_bonus' && s.scope === 'reseller'));
  });

  test('support admins cannot change switches', async () => {
    const support = await adminClient(server, ['support']);
    assert.equal((await support.put('/v1/admin/switches/startup_allowance', { enabled: true })).status, 403);
  });
});
