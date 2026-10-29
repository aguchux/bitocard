// Sensitive and money admin actions need the session's step-up window: 5 minutes opened by the admin's authenticator
// code, fixed (never extended by use), per session, and gone with the session.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, afrippaAdminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
});

const randomId = '00000000-0000-4000-8000-00000000f00d';

/** Every protected route, as the admin app calls it; without the window each is refused before anything else runs. */
const protectedRoutes = [
  ['post', `/v1/afrippa/admin/crypto/withdrawals/${randomId}/approve`, { note: 'ok' }],
  ['post', `/v1/afrippa/admin/crypto/freezes/${randomId}/seize`, { note: 'ok' }],
  ['post', `/v1/afrippa/admin/crypto/freezes/${randomId}/release`, { note: 'ok' }],
  ['patch', '/v1/afrippa/admin/crypto/assets/USDT', { p2p_fee_bps: 10 }],
  ['put', '/v1/afrippa/admin/crypto/market-limits', { mode: 'test', market: 'NG', currency: 'NGN', per_trade: 100 }],
  ['patch', `/v1/afrippa/admin/crypto/networks/${randomId}`, { withdrawals_enabled: false }],
  ['put', '/v1/afrippa/admin/crypto/chains/ETHEREUM/routes', { order: [], disabled: [] }],
  ['put', '/v1/afrippa/admin/two-step-methods/WW', { methods: ['email'] }],
  ['delete', '/v1/afrippa/admin/two-step-methods/NG'],
  ['post', `/v1/afrippa/admin/p2p/orders/${randomId}/decide`, { outcome: 'return', fault: 'none', note: 'Decided after review' }],
  ['put', '/v1/afrippa/admin/p2p/fee-rates', { asset: 'USDT', market: null, buyer_bps: 50, seller_bps: 100 }],
  ['delete', '/v1/afrippa/admin/p2p/fee-rates/USDT/all'],
  ['post', `/v1/afrippa/admin/traders/${randomId}/standing/clear`, { mode: 'test', reason: 'Reviewed and cleared' }],
  ['post', `/v1/afrippa/admin/traders/${randomId}/two-step/reset`, { reason: 'lost phone' }],
  ['put', '/v1/afrippa/admin/markets/switches/p2p_trading', { country_code: 'NG', enabled: true }],
  ['put', '/v1/afrippa/admin/markets/store-mode', { mode: 'live', reason: 'The pilot opens.' }],
  ['post', `/v1/admin/orders/${randomId}/refund`, { reason: 'x' }],
  ['post', `/v1/admin/classifieds/orders/${randomId}/dispute/decide`, { decision: 'release', note: 'ok' }],
  ['put', '/v1/admin/classifieds/safe-pay-settings/NG', { buyer_fee_bps: 100 }],
  ['put', '/v1/admin/classifieds/resale-settings/NG', { reseller_fee_bps: 100 }],
  ['post', `/v1/admin/classifieds/orders/${randomId}/payout-review`, { decision: 'approve', note: 'ok' }],
  ['post', `/v1/admin/vpn/subscriptions/${randomId}/enable`, { reason: 'x' }],
  ['post', `/v1/admin/resellers/${randomId}/startup-allowance`, {}],
  ['post', `/v1/admin/resellers/${randomId}/startup-allowance/revoke`, { reason: 'x' }],
  ['post', `/v1/admin/resellers/${randomId}/wallet/adjustments`, { amount: 1, reason: 'x' }],
  ['put', '/v1/admin/fee-rules', {}],
  ['delete', `/v1/admin/fee-rules/${randomId}`],
  ['post', `/v1/admin/fees/${randomId}/refund`, { reason: 'x' }],
  ['post', '/v1/admin/chargebacks', {}],
  ['post', `/v1/admin/chargebacks/${randomId}/resolve`, {}],
  ['post', `/v1/admin/chargebacks/${randomId}/clear`, {}],
  ['put', '/v1/admin/pricing-rules', {}],
  ['delete', `/v1/admin/pricing-rules/${randomId}`],
  ['put', '/v1/admin/tax-rates/NG', {}],
  ['patch', '/v1/admin/currencies/NGN', {}],
  ['put', '/v1/admin/plans/premium/limits/stores', { value: 5 }],
  ['put', `/v1/admin/stores/${randomId}/subscription`, { plan: 'premium' }],
  ['put', `/v1/admin/resellers/${randomId}/credit-limit`, { cents: 2500, reason: 'x' }],
  ['patch', '/v1/admin/plans/premium', {}],
  ['post', '/v1/admin/plans', {}],
  ['put', '/v1/admin/plans/premium/features/priority_support', { enabled: true }],
  ['delete', '/v1/admin/plans/premium'],
  ['post', `/v1/admin/resellers/${randomId}/identity-waiver`, { reason: 'x' }],
  ['post', `/v1/admin/resellers/${randomId}/identity-waiver/remove`, { reason: 'x' }],
  ['post', `/v1/admin/resellers/${randomId}/unsuspend`, { reason: 'x' }],
  ['post', `/v1/admin/resellers/${randomId}/members/${randomId}/two-step/reset`, { reason: 'x' }],
  ['post', '/v1/admin/countries', {}],
  ['patch', '/v1/admin/countries/NG', {}],
  ['put', '/v1/admin/countries/NG/categories/airtime', {}],
  ['put', '/v1/admin/countries/NG/payment-methods', {}],
  ['put', '/v1/admin/countries/NG/options/payout_destination', {}],
  ['put', '/v1/admin/switches/custom_domains', { enabled: true }],
  ['patch', `/v1/admin/supplier-products/${randomId}`, {}],
  ['put', '/v1/admin/integrations/reloadly/reseller-availability', {}],
  ['put', '/v1/admin/integrations/reloadly/reseller-access', { enabled: true }],
];

describe('admin step-up window', () => {
  test('every protected route refuses without the window, before validation or lookups', async () => {
    const bitocard = await adminClient(server, ['super_admin'], { stepUp: false });
    // Afrippa's admin routes are its own admins' (their own realm), with their own step-up.
    const afrippa = await afrippaAdminClient(server, ['super_admin'], { stepUp: false });
    for (const [method, path, body] of protectedRoutes) {
      const admin = path.startsWith('/v1/afrippa/admin/') ? afrippa : bitocard;
      const res = method === 'delete' ? await admin.delete(path) : await admin[method](path, body);
      assert.deepEqual([res.status, res.json?.error?.code], [403, 'step_up_required'], `${method.toUpperCase()} ${path}`);
    }
  });

  test('every @StepUp route in the source is in the list above', () => {
    const marked = [];
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) marked.push(...(readFileSync(path, 'utf8').match(/@StepUp\(\)/g) ?? []));
      }
    };
    walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    assert.equal(marked.length, protectedRoutes.length, 'a new protected route needs its line in this test');
  });

  test('the code opens 5 minutes on that session only; a wrong code counts towards the lockout; the window expires', async () => {
    const admin = await adminClient(server, ['super_admin'], { stepUp: false });
    const switchOn = () => admin.put('/v1/admin/switches/spin_rewards', { enabled: null });
    assert.equal((await switchOn()).json.error.code, 'step_up_required');
    assert.equal((await admin.get('/v1/admin/auth/session')).json.step_up_until, null);

    const user = await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email: admin.admin.email } });
    const wrong = await admin.post('/v1/admin/auth/step-up', { code: '000000' });
    assert.deepEqual([wrong.status, wrong.json.error.code], [400, 'mfa_code_invalid']);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedSignIns, 1, 'wrong codes count towards the lockout');

    const opened = await admin.post('/v1/admin/auth/step-up', { code: await adminCode(server, admin) });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    const until = new Date(opened.json.step_up_until).getTime();
    assert.ok(until > Date.now() + 4.5 * 60_000 && until <= Date.now() + 5 * 60_000 + 1000, 'five minutes');
    assert.equal((await admin.get('/v1/admin/auth/session')).json.step_up_until, opened.json.step_up_until);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'admin.step_up', actorId: user.id } }), 'audited');
    assert.equal((await switchOn()).status, 200, 'allowed inside the window');
    assert.equal((await switchOn()).status, 200, 'more than one action in the window');
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id, revokedAt: null, stepUpUntil: { not: null } } });
    assert.equal(session.stepUpUntil.getTime(), until, 'using the window never extends it');

    // The same admin signed in elsewhere has no window there.
    const reused = await adminClient(server, ['super_admin'], { stepUp: false });
    assert.equal((await reused.put('/v1/admin/switches/spin_rewards', { enabled: null })).json.error.code, 'step_up_required');

    await prisma.session.update({ where: { id: session.id }, data: { stepUpUntil: new Date(Date.now() - 1000) } });
    assert.equal((await switchOn()).json.error.code, 'step_up_required', 'closed once the five minutes pass');
  });

  test('protective and routine actions need no window; activating a reseller or changing its plan does', async () => {
    const admin = await adminClient(server, ['super_admin'], { stepUp: false });
    const { resellerId } = await resellerClient(server);
    const suspended = await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'suspended' });
    assert.equal(suspended.status, 200, 'suspending stays one click');
    const activate = await admin.patch(`/v1/admin/resellers/${resellerId}`, { status: 'active' });
    assert.equal(activate.json.error.code, 'step_up_required');
    const plan = await admin.patch(`/v1/admin/resellers/${resellerId}`, { plan: 'premium' });
    assert.equal(plan.json.error.code, 'step_up_required');
    assert.notEqual((await admin.get('/v1/admin/overview')).status, 403, 'reading needs no window');
    // A dispute rejection is not a money decision; a refund is.
    const reject = await admin.post(`/v1/admin/disputes/${randomId}/execute`, { action: 'reject', note: 'No' });
    assert.notEqual(reject.json?.error?.code, 'step_up_required');
    const refund = await admin.post(`/v1/admin/disputes/${randomId}/execute`, { action: 'refund_customer', note: 'Yes' });
    assert.equal(refund.json.error.code, 'step_up_required');
  });

  test('resellers are never asked: the window is an admin session rule', async () => {
    const { browser } = await resellerClient(server);
    const changed = await browser.put('/v1/pricing/markups', { markup_bps: 500 });
    assert.notEqual(changed.json?.error?.code, 'step_up_required');
  });
});
