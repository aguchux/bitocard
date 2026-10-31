// VPN access end to end: a reseller buys "VPN access (30 days)" and gets the prepared username and password once the
// supplier account is Active with its expiry; the password is reset (an unclear reset continues with the same password);
// access ends at expiry and after a refund, disabled with the supplier and verified; drifted expiries are put back;
// admins suspend and enable; the daily reconciliation finds stray accounts and low credit. The supplier is never named.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'node:http';
import { adminClient, adminCode, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

/** A VPNresellers v4.1 double: accounts in project 7, check_username, the lifecycle calls and the profile's credit. */
async function fakeVpnresellers() {
  // Long account IDs, so a check that a response never carries one cannot match digits in a UUID or a time by chance.
  const state = { accounts: new Map(), next: 7_300_418_100, balance: '80.00', failPasswordOnce: false, calls: [] };
  const show = account => ({ id: account.id, username: account.username, status: account.status, expired_at: account.expiry ? `${account.expiry}T00:00:00.000000Z` : null, wg_private_key: 'never-kept' });
  const reply = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, 'http://fake');
    state.calls.push({ method: req.method, path: url.pathname, body, authorization: req.headers.authorization });
    if (req.headers.authorization !== 'Bearer vpn-token') return reply(res, 401, { message: 'Unauthenticated.', code: 401 });
    if (url.pathname === '/accounts/check_username') {
      const taken = [...state.accounts.values()].some(item => item.username === url.searchParams.get('username'));
      return taken ? reply(res, 422, { message: 'The username has already been taken.', code: 422 }) : reply(res, 200, { message: 'The username checking was successfully.', code: 200 });
    }
    if (url.pathname === '/profile') return reply(res, 200, { data: { balance: state.balance }, code: 200 });
    if (url.pathname === '/projects/7/accounts' && req.method === 'GET') {
      const status = url.searchParams.get('status');
      const rows = [...state.accounts.values()].filter(item => !status || item.status === status).map(show);
      return reply(res, 200, { data: rows, meta: { current_page: 1, last_page: 1, total: rows.length }, code: 200 });
    }
    if (url.pathname === '/accounts' && req.method === 'POST') {
      if (body.customer?.project_id !== 7) return reply(res, 422, { message: 'The customer.project_id field is required.', code: 422 });
      const account = { id: state.next++, username: body.username, password: body.password, status: 'Active', expiry: null };
      state.accounts.set(String(account.id), account);
      return reply(res, 200, { data: show(account), code: 200 });
    }
    const match = url.pathname.match(/^\/accounts\/(\d+)(?:\/(enable|disable|change_password|expire))?$/);
    const account = match && state.accounts.get(match[1]);
    if (!account) return reply(res, 404, { message: 'Account not found.', code: 404 });
    if (match[2] === 'enable') account.status = 'Active';
    if (match[2] === 'disable') account.status = 'Disabled';
    if (match[2] === 'expire') account.expiry = body.expire_at ?? null;
    if (match[2] === 'change_password') {
      if (state.failPasswordOnce) {
        state.failPasswordOnce = false;
        account.password = body.password; // changed, but the reply is lost
        return reply(res, 502, { message: 'Bad Gateway', code: 502 });
      }
      account.password = body.password;
    }
    return reply(res, 200, { data: show(account), code: 200 });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

let server;
let vpn;
let admin;
let prisma;
let wallets;
let check;
const cron = job => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } }).then(async res => ({ status: res.status, json: await res.json() }));

before(async () => {
  vpn = await fakeVpnresellers();
  server = await startApp({ env: { CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  wallets = server.app.get((await import('../dist/ledger/wallet.service.js')).WalletService);
  check = await responseChecker(server.app);
  for (const source of ['open_exchange_rates', 'flutterwave']) {
    await prisma.exchangeRate.create({ data: { currency: 'NGN', source, unitsPerUsd: 1500, fetchedAt: new Date(Date.now() + 3600_000) } });
  }
  await prisma.countryCategory.update({ where: { countryCode_category: { countryCode: 'NG', category: 'vpn' } }, data: { enabled: true, taxable: false, customerVerification: false } });
  const saved = await admin.put('/v1/admin/integrations/vpnresellers', {
    values: { VPNRESELLERS_API_TOKEN: 'vpn-token', VPNRESELLERS_PROJECT_ID: '7', VPNRESELLERS_MONTHLY_COST_USD: '1.99', VPNRESELLERS_API_URL: vpn.url, VPNRESELLERS_LOW_BALANCE_USD: '50' },
    code: await adminCode(server, admin),
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal((await admin.patch('/v1/admin/suppliers/vpnresellers', { enabled: true })).status, 200);
  assert.equal((await admin.put('/v1/admin/suppliers/vpnresellers/markets/NG/vpn', { enabled: true })).status, 200);
  const sync = await admin.post('/v1/admin/suppliers/vpnresellers/sync');
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
});

after(async () => {
  await server?.close();
  await vpn?.close();
});

async function reseller() {
  const created = await resellerClient(server);
  await prisma.reseller.update({ where: { id: created.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
  await wallets.adjust(null, { resellerId: created.resellerId, mode: 'live', balance: 'funding', amount: 50_000_000, reason: 'Test funding' });
  return created;
}

async function buy(browser) {
  const product = await prisma.product.findUniqueOrThrow({ where: { key: 'vpn:WW:bitocard:vpn-access-30d' } });
  const quote = await browser.post('/v1/quotes', { product_id: product.id, face_value: Number(product.fixedValues[0]) });
  assert.equal(quote.status, 201, JSON.stringify(quote.json));
  const order = await browser.post('/v1/orders', { quote_id: quote.json.id });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  return order.json;
}

const subscriptionOf = orderId => prisma.vpnSubscription.findUniqueOrThrow({ where: { orderId } });
const supplierAccount = sub => vpn.state.accounts.get(sub.supplierAccountId);
const named = value => /vpn ?resellers/i.test(JSON.stringify(value));

describe('VPN orders', () => {
  test('the product is one fixed 30-day offer that never names the supplier', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { key: 'vpn:WW:bitocard:vpn-access-30d' }, include: { supplierProducts: true } });
    assert.deepEqual([product.category, product.country, product.fixedValues.map(Number), product.supplierProducts[0].sku], ['vpn', 'WW', [199], 'vpn-30-day']);
    assert.ok(!named([product.name, product.description, product.redeemInstructions]));
  });

  test('an order creates one Active account with its expiry and delivers the prepared credentials', async () => {
    const { browser } = await reseller();
    const order = await buy(browser);
    assert.equal(order.status, 'completed', JSON.stringify(order));
    const [delivery] = order.deliveries;
    assert.equal(delivery.kind, 'vpn_account');
    const sub = await subscriptionOf(order.id);
    const account = supplierAccount(sub);
    assert.deepEqual([account.username, account.password, account.status], [delivery.serial, delivery.code, 'Active']);
    assert.equal(account.expiry, sub.expiresAt.toISOString().slice(0, 10), 'the supplier ends access on our date, never auto-renewal');
    assert.ok(sub.expiresAt.getTime() >= Date.now() + 30 * 24 * 60 * 60 * 1000 - 60_000, 'at least 30 full days');
    assert.equal(sub.status, 'active');
    const stored = await prisma.orderDelivery.findUniqueOrThrow({ where: { id: sub.deliveryId } });
    assert.ok(!stored.codeEncrypted.includes(delivery.code), 'encrypted at rest');
    assert.ok(!named(order));

    const listed = await browser.get(`/v1/vpn-subscriptions?order_id=${order.id}`);
    check('GET /v1/vpn-subscriptions', 200, listed.json);
    assert.deepEqual(listed.json.data.map(item => [item.status, item.renews_automatically, item.term_days, item.devices]), [['active', false, 30, 10]]);
    assert.ok(!JSON.stringify(listed.json).includes(delivery.code), 'never the password');
    assert.ok(!JSON.stringify(listed.json).includes(sub.supplierAccountId), 'never the supplier account');
    check('GET /v1/vpn-subscriptions/{id}', 200, (await browser.get(`/v1/vpn-subscriptions/${listed.json.data[0].id}`)).json);

    const events = await prisma.event.findMany({ where: { type: 'vpn_subscription.updated' } });
    assert.ok(events.some(event => JSON.parse(event.payload).data.object.order_id === order.id && JSON.parse(event.payload).data.object.status === 'active'));
    assert.ok(!events.some(event => event.payload.includes(delivery.code)), 'webhooks never carry the password');
  });

  test('a password reset changes it with the supplier and the order shows the new one; an unclear reset continues', async () => {
    const { browser } = await reseller();
    const order = await buy(browser);
    const sub = await subscriptionOf(order.id);
    const reset = await browser.post(`/v1/vpn-subscriptions/${sub.id}/password-reset`, {}, { 'idempotency-key': `reset-${sub.id}` });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    check('POST /v1/vpn-subscriptions/{id}/password-reset', 200, reset.json);
    assert.notEqual(reset.json.credentials.password, order.deliveries[0].code);
    assert.equal(supplierAccount(sub).password, reset.json.credentials.password);
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.deliveries[0].code, reset.json.credentials.password);

    const again = await browser.post(`/v1/vpn-subscriptions/${sub.id}/password-reset`, {}, { 'idempotency-key': `reset-again-${sub.id}` });
    assert.deepEqual([again.status, again.json.error.code], [429, 'password_recently_reset']);

    await prisma.vpnSubscription.update({ where: { id: sub.id }, data: { passwordChangedAt: new Date(Date.now() - 120_000) } });
    vpn.state.failPasswordOnce = true;
    const unclear = await browser.post(`/v1/vpn-subscriptions/${sub.id}/password-reset`, {}, { 'idempotency-key': `reset-unclear-${sub.id}` });
    assert.deepEqual([unclear.status, unclear.json.error.code], [503, 'vpn_password_reset_pending']);
    const pending = supplierAccount(sub).password;
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.deliveries[0].code, reset.json.credentials.password, 'the old one is shown until confirmed');
    assert.equal((await cron('vpn')).status, 200);
    assert.equal((await browser.get(`/v1/orders/${order.id}`)).json.deliveries[0].code, pending, 'the job confirmed the same new password');
    assert.equal((await subscriptionOf(order.id)).pendingPasswordEncrypted, null);
  });

  test('access ends at its expiry: disabled with the supplier, verified, and reported', async () => {
    const { browser } = await reseller();
    const order = await buy(browser);
    const sub = await subscriptionOf(order.id);
    await prisma.vpnSubscription.update({ where: { id: sub.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await cron('vpn')).status, 200);
    const ended = await subscriptionOf(order.id);
    assert.deepEqual([ended.status, ended.supplierStatus, supplierAccount(sub).status], ['expired', 'Disabled', 'Disabled']);
    assert.ok(ended.disabledAt);
    const shown = await browser.get(`/v1/vpn-subscriptions/${sub.id}`);
    assert.deepEqual([shown.json.status, Boolean(shown.json.ended_at)], ['expired', true]);
    const reset = await browser.post(`/v1/vpn-subscriptions/${sub.id}/password-reset`, {}, { 'idempotency-key': `reset-expired-${sub.id}` });
    assert.equal(reset.json.error.code, 'vpn_not_active');
  });

  test('a refunded order’s access is revoked and disabled with the supplier', async () => {
    const { browser } = await reseller();
    const order = await buy(browser);
    const sub = await subscriptionOf(order.id);
    const refunded = await admin.post(`/v1/admin/orders/${order.id}/refund`, { reason: 'Customer changed their mind', supplier_refunded: false });
    assert.equal(refunded.status, 200, JSON.stringify(refunded.json));
    assert.equal((await cron('vpn')).status, 200);
    assert.deepEqual([(await subscriptionOf(order.id)).status, supplierAccount(sub).status], ['revoked', 'Disabled']);
  });

  test('a supplier expiry that drifted (or became auto-renewal) is set back to ours and admins are told', async () => {
    const { browser } = await reseller();
    const order = await buy(browser);
    const sub = await subscriptionOf(order.id);
    supplierAccount(sub).expiry = null;
    await prisma.vpnSubscription.update({ where: { id: sub.id }, data: { nextSyncAt: new Date(Date.now() - 1000) } });
    assert.equal((await cron('vpn')).status, 200);
    assert.equal(supplierAccount(sub).expiry, sub.expiresAt.toISOString().slice(0, 10));
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.vpn.attention', title: 'VPN expiry drift corrected' } }));
  });

  test('an account the supplier disabled during its term goes to review; admins suspend and enable access', async () => {
    const { browser } = await reseller();
    const order = await buy(browser);
    const sub = await subscriptionOf(order.id);
    supplierAccount(sub).status = 'Disabled';
    const synced = await admin.post(`/v1/admin/vpn/subscriptions/${sub.id}/sync`);
    assert.equal(synced.json.status, 'needs_review', JSON.stringify(synced.json));
    assert.equal(supplierAccount(sub).status, 'Disabled', 'never re-enabled blindly');

    const enabled = await admin.post(`/v1/admin/vpn/subscriptions/${sub.id}/enable`, { reason: 'Supplier confirmed it was a mistake' });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.json));
    assert.deepEqual([enabled.json.status, supplierAccount(sub).status], ['active', 'Active']);

    const suspended = await admin.post(`/v1/admin/vpn/subscriptions/${sub.id}/suspend`, { reason: 'Abuse report' });
    assert.deepEqual([suspended.json.status, supplierAccount(sub).status], ['suspended', 'Disabled']);
    assert.equal((await browser.get(`/v1/vpn-subscriptions/${sub.id}`)).json.status, 'suspended');
    const audits = await prisma.auditLog.findMany({ where: { targetId: sub.id }, select: { action: true } });
    assert.deepEqual(audits.map(item => item.action).sort(), ['vpn.enabled', 'vpn.suspended', 'vpn.synced']);

    const resetByAdmin = await admin.post(`/v1/admin/vpn/subscriptions/${sub.id}/password-reset`, { reason: 'x'.repeat(5) });
    assert.equal(resetByAdmin.json.error.code, 'vpn_not_active');

    // Its term ends while suspended: closed as expired, and still disabled.
    await prisma.vpnSubscription.update({ where: { id: sub.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await cron('vpn')).status, 200);
    assert.deepEqual([(await subscriptionOf(order.id)).status, supplierAccount(sub).status], ['expired', 'Disabled']);
  });

  test('the daily reconciliation finds accounts billing unexpectedly and low credit', async () => {
    vpn.state.accounts.set('999', { id: 999, username: 'someone-else', password: 'x', status: 'Active', expiry: null });
    vpn.state.balance = '1.50';
    const run = await admin.post('/v1/admin/vpn/reconciliations/run');
    assert.equal(run.status, 200, JSON.stringify(run.json));
    assert.equal(run.json.complete, true);
    assert.ok(run.json.unexpected.some(item => item.username === 'someone-else'));
    assert.equal(run.json.balance_usd_cents, 150);
    assert.equal(run.json.supplier_active, run.json.expected_active + 1);
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.vpn.credit_low' } }));
    assert.ok(await prisma.notification.findFirst({ where: { type: 'admin.vpn.attention', title: { contains: 'billing unexpectedly' } } }));

    const health = await admin.get('/v1/admin/vpn/health');
    assert.equal(health.status, 200);
    assert.ok(health.json.live.active >= 1);
    assert.equal(health.json.reconciliation.id, run.json.id);
    const list = await admin.get('/v1/admin/vpn/subscriptions?status=expired');
    assert.ok(list.json.data.every(item => item.status === 'expired' && item.supplier === 'vpnresellers'));
  });
});
