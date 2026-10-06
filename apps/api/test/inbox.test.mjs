// The in-app notifications inbox: each notification reaches the roles it is meant for (reseller owners always, super
// admins always), once per person and subject; people read their own; reseller accounts are kept apart; personal
// security notices follow the person; old notifications are dropped.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { notificationTypes } from '../dist/notifications/inbox.js';

let server;
let admin;
let prisma;
let inbox;

before(async () => {
  server = await startApp({ env: { CRON_SECRET: 'cron-secret' } });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  inbox = server.app.get((await import('../dist/notifications/inbox.service.js')).InboxService);
});

after(() => server?.close());

/** A person added to a reseller with a role (they also own an account of their own); acts for it with the header. */
async function member(resellerId, role) {
  const person = await resellerClient(server, { name: `Staff ${role}` });
  await prisma.resellerMember.create({ data: { resellerId, userId: person.userId, role } });
  const as = { 'bitocard-reseller': resellerId };
  return {
    ...person,
    get: path => person.browser.get(path, as),
    post: (path, body = {}) => person.browser.post(path, body, as),
    own: { get: path => person.browser.get(path, { 'bitocard-reseller': person.resellerId }) },
  };
}

const types = async (get, path = '/v1/notifications') => (await get(path)).json.data.map(item => item.type);
const content = (subject, extra = {}) => ({ subject, title: `Title ${subject}`, body: `Body ${subject}`, ...extra });

describe('who sees what', () => {
  test('reseller notifications reach the owner plus the roles listed, and nobody else', async () => {
    const owner = await resellerClient(server);
    const staff = Object.fromEntries(await Promise.all(['admin', 'developer', 'finance', 'support'].map(async role => [role, await member(owner.resellerId, role)])));

    await inbox.reseller(owner.resellerId, 'payout.paid', content('payout-1', { link: '/wallet/payouts', mode: 'live' }));
    await inbox.reseller(owner.resellerId, 'webhook_endpoint.disabled', content('endpoint-1', { mode: 'test' }));
    await inbox.reseller(owner.resellerId, 'order.needs_review', content('order-1'));
    await inbox.reseller(owner.resellerId, 'verification.updated', content('check-1'));

    assert.deepEqual((await types(owner.browser.get)).sort(), ['order.needs_review', 'payout.paid', 'verification.updated', 'webhook_endpoint.disabled']);
    assert.deepEqual((await types(staff.finance.get)).sort(), ['payout.paid']);
    assert.deepEqual((await types(staff.developer.get)).sort(), ['webhook_endpoint.disabled']);
    assert.deepEqual((await types(staff.support.get)).sort(), ['order.needs_review']);
    assert.deepEqual((await types(staff.admin.get)).sort(), ['order.needs_review', 'webhook_endpoint.disabled']);

    const [payout] = (await staff.finance.get('/v1/notifications')).json.data;
    assert.deepEqual(
      { ...payout, id: undefined, created_at: undefined },
      { object: 'notification', id: undefined, type: 'payout.paid', severity: 'success', title: 'Title payout-1', body: 'Body payout-1', link: '/wallet/payouts', mode: 'live', read: false, read_at: null, created_at: undefined },
    );
    const sandbox = (await staff.developer.get('/v1/notifications')).json.data[0];
    assert.deepEqual([sandbox.mode, sandbox.severity], ['test', 'critical']);
  });

  test('every role has notifications meant for it', () => {
    const reseller = new Set(Object.values(notificationTypes).filter(t => t.realm === 'reseller').flatMap(t => t.roles));
    for (const role of ['admin', 'developer', 'finance', 'support']) assert.ok(reseller.has(role), `reseller role ${role}`);
    const admins = new Set(Object.values(notificationTypes).filter(t => t.realm === 'admin').flatMap(t => t.roles));
    for (const role of ['operations', 'finance', 'support']) assert.ok(admins.has(role), `admin role ${role}`);
  });

  test('admin notifications reach super admins plus the roles listed', async () => {
    const operations = await adminClient(server, ['operations']);
    const finance = await adminClient(server, ['finance']);
    const support = await adminClient(server, ['support']);
    const subject = `payout-${Date.now()}`;
    await inbox.admins('admin.payout.failed', content(subject, { link: '/resellers/x' }));
    const has = async browser => (await browser.get('/v1/admin/notifications')).json.data.some(item => item.title === `Title ${subject}`);
    assert.deepEqual([await has(admin), await has(finance), await has(operations), await has(support)], [true, true, false, false]);
    const orderSubject = `order-${Date.now()}`;
    await inbox.admins('admin.order.needs_review', content(orderSubject));
    const hasOrder = async browser => (await browser.get('/v1/admin/notifications')).json.data.some(item => item.title === `Title ${orderSubject}`);
    assert.deepEqual([await hasOrder(admin), await hasOrder(finance), await hasOrder(operations), await hasOrder(support)], [true, false, true, true]);
  });

  test('a person sees each reseller account’s notifications only while using it, and personal ones everywhere', async () => {
    const owner = await resellerClient(server);
    const finance = await member(owner.resellerId, 'finance');
    await inbox.reseller(owner.resellerId, 'top_up.credited', content('top-up-a'));
    await inbox.reseller(finance.resellerId, 'top_up.credited', content('top-up-b'));
    await inbox.person(finance.userId, 'security.password_changed', content('password-1'));

    const there = (await finance.get('/v1/notifications')).json.data.map(item => item.title).sort();
    const home = (await finance.own.get('/v1/notifications')).json.data.map(item => item.title).sort();
    assert.deepEqual(there, ['Title password-1', 'Title top-up-a']);
    assert.deepEqual(home, ['Title password-1', 'Title top-up-b']);
  });

  test('the same subject reaches a person once', async () => {
    const owner = await resellerClient(server);
    await inbox.reseller(owner.resellerId, 'plan.ended', content('same'));
    await inbox.reseller(owner.resellerId, 'plan.ended', content('same'));
    assert.equal((await owner.browser.get('/v1/notifications')).json.data.length, 1);
  });
});

describe('storefront customers (baseline)', () => {
  test('a customer’s notifications are theirs alone, under their store, and never reach staff', async () => {
    const owner = await resellerClient(server);
    const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Ada Gifts', subdomain: `inbox${Date.now()}` } });
    const customerId = randomUUID();
    await inbox.customer({ customerId, storeId: store.id }, 'customer.order.completed', content('order-1', { link: '/account/orders/1' }));
    await inbox.customer({ customerId, storeId: store.id }, 'customer.order.completed', content('order-1', { link: '/account/orders/1' }));
    const rows = await prisma.notification.findMany({ where: { customerId } });
    assert.equal(rows.length, 1, 'once per subject');
    assert.deepEqual([rows[0].audience, rows[0].userId, rows[0].storeId, rows[0].resellerId, rows[0].severity], ['customer', null, store.id, owner.resellerId, 'success']);
    assert.equal((await owner.browser.get('/v1/notifications')).json.data.length, 0, 'the reseller does not see their customers’ inbox');

    const page = await inbox.list({ customerId }, {});
    assert.deepEqual([page.data.length, page.unread_count, page.data[0].link], [1, 1, '/account/orders/1']);
    await inbox.markRead({ customerId }, page.data[0].id);
    assert.equal(await inbox.unreadCount({ customerId }), 0);
    await assert.rejects(inbox.markRead({ customerId: randomUUID() }, page.data[0].id), /No such notification/);
    // An unknown store sends nothing.
    await inbox.customer({ customerId, storeId: randomUUID() }, 'customer.order.failed', content('nowhere'));
    assert.equal(await prisma.notification.count({ where: { customerId } }), 1);
  });

  test('the database allows exactly one recipient, and customers always have a store', async () => {
    const base = () => ({ type: 'x', title: 't', body: 'b', dedupeKey: `k${randomUUID()}` });
    await assert.rejects(prisma.notification.create({ data: { ...base(), audience: 'customer', customerId: randomUUID() } }));
    const owner = await resellerClient(server);
    await assert.rejects(prisma.notification.create({ data: { ...base(), audience: 'reseller', userId: owner.userId, customerId: randomUUID() } }));
    await assert.rejects(prisma.notification.create({ data: { ...base(), audience: 'reseller' } }));
    await prisma.notification.create({ data: { ...base(), audience: 'reseller', userId: owner.userId } });
  });

  test('customer notification types are baselined with their push defaults', () => {
    const customer = Object.entries(notificationTypes).filter(([, t]) => t.realm === 'customer');
    assert.ok(customer.length >= 9);
    for (const [type, definition] of customer) {
      assert.ok(type.startsWith('customer.'), type);
      assert.equal(typeof definition.push, 'boolean', type);
    }
  });
});

describe('reading', () => {
  test('unread counts, marking one or all read, filtering and paging', async () => {
    const owner = await resellerClient(server);
    for (let i = 0; i < 5; i += 1) await inbox.reseller(owner.resellerId, 'top_up.credited', content(`n${i}`));
    assert.deepEqual((await owner.browser.get('/v1/notifications/unread-count')).json, { object: 'unread_count', count: 5 });

    const first = await owner.browser.get('/v1/notifications?limit=2');
    assert.deepEqual([first.json.data.length, first.json.has_more, first.json.unread_count], [2, true, 5]);
    assert.equal(first.json.data[0].title, 'Title n4', 'newest first');
    const rest = await owner.browser.get(`/v1/notifications?limit=10&starting_after=${first.json.data[1].id}`);
    assert.deepEqual(rest.json.data.map(item => item.title), ['Title n2', 'Title n1', 'Title n0']);

    const read = await owner.browser.post(`/v1/notifications/${first.json.data[0].id}/read`);
    assert.equal(read.status, 200, JSON.stringify(read.json));
    assert.equal(read.json.read, true);
    assert.equal((await owner.browser.get('/v1/notifications?unread=true')).json.data.length, 4);
    assert.deepEqual((await owner.browser.post('/v1/notifications/read-all')).json, { object: 'notifications_read', updated: 4 });
    assert.equal((await owner.browser.get('/v1/notifications/unread-count')).json.count, 0);
  });

  test('nobody reads or marks another person’s notifications', async () => {
    const owner = await resellerClient(server);
    const stranger = await resellerClient(server);
    await inbox.reseller(owner.resellerId, 'top_up.credited', content('private'));
    const [mine] = (await owner.browser.get('/v1/notifications')).json.data;
    assert.equal((await stranger.browser.post(`/v1/notifications/${mine.id}/read`)).status, 404);
    assert.equal((await stranger.browser.get('/v1/notifications')).json.data.length, 0);
    // A different reseller account the person is not using hides it too.
    assert.equal((await owner.browser.get('/v1/notifications', { 'bitocard-reseller': stranger.resellerId })).status, 403);
  });

  test('realms and API keys are kept apart', async () => {
    const owner = await resellerClient(server);
    assert.equal((await owner.browser.get('/v1/admin/notifications')).status, 401);
    assert.equal((await admin.get('/v1/notifications')).status, 401);
    const key = (await owner.browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' })).json.secret;
    const viaKey = await client(server.base).get('/v1/notifications', { authorization: `Bearer ${key}` });
    assert.equal(viaKey.status, 403);
  });

  test('notifications older than 90 days are dropped by the daily job', async () => {
    const owner = await resellerClient(server);
    await inbox.reseller(owner.resellerId, 'top_up.credited', content('old'));
    await inbox.reseller(owner.resellerId, 'top_up.credited', content('new'));
    await prisma.notification.updateMany({ where: { resellerId: owner.resellerId, title: 'Title old' }, data: { createdAt: new Date(Date.now() - 91 * 24 * 3600_000) } });
    const run = await fetch(`${server.base}/v1/cron/notifications-cleanup`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    assert.ok(run.result.removed >= 1);
    assert.deepEqual((await owner.browser.get('/v1/notifications')).json.data.map(item => item.title), ['Title new']);
  });
});

describe('real events', () => {
  test('a new reseller tells operations and support; a password change is a personal notice', async () => {
    const operations = await adminClient(server, ['operations']);
    const owner = await resellerClient(server, { business: 'Brand New Digital' });
    const opened = (await operations.get('/v1/admin/notifications')).json.data.find(item => item.type === 'admin.reseller.signed_up' && item.title === 'New reseller: Brand New Digital');
    assert.ok(opened);
    assert.equal(opened.link, `/resellers/${owner.resellerId}`);

    const changed = await owner.browser.post('/v1/auth/password/change', { current_password: 'correct horse battery', new_password: 'a brand new passphrase' });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    const [notice] = (await owner.browser.get('/v1/notifications')).json.data;
    assert.deepEqual([notice.type, notice.severity, notice.link], ['security.password_changed', 'warning', '/settings/profile']);
  });

  test('an invited person joining tells the owner and admins', async () => {
    const owner = await resellerClient(server);
    const teamAdmin = await member(owner.resellerId, 'admin');
    const finance = await member(owner.resellerId, 'finance');
    const email = `joiner-${Date.now()}@example.com`;
    await owner.browser.post('/v1/team/invitations', { email, role: 'developer' });
    const { EmailService } = await import('../dist/notifications/email.service.js');
    const message = server.app.get(EmailService).outbox.filter(item => item.to === email).at(-1);
    const token = new URL(/https?:\/\/\S+/.exec(message.text)[0]).searchParams.get('token');
    const joined = await client(server.base).post('/v1/auth/signup', { name: 'Joiner', email, password: 'correct horse battery', invitation_token: token }, { 'idempotency-key': `join-${Date.now()}` });
    assert.equal(joined.status, 201, JSON.stringify(joined.json));
    assert.ok((await types(owner.browser.get)).includes('team.member_joined'));
    assert.ok((await types(teamAdmin.get)).includes('team.member_joined'));
    assert.equal((await types(finance.get)).includes('team.member_joined'), false);
  });

  test('connection reviews and decisions reach operations and the reseller', async () => {
    await admin.put('/v1/admin/integrations/vtpass/reseller-access', { enabled: true });
    await admin.put('/v1/admin/integrations/vtpass/reseller-availability', { global: true, countries: [], approval: 'review' });
    const owner = await resellerClient(server);
    await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', planCode: 'premium', verifiedAt: new Date() } });
    await admin.put('/v1/admin/switches/own_integrations', { reseller_id: owner.resellerId, enabled: true });
    const operations = await adminClient(server, ['operations']);
    // Sandbox connections are never reviewed; live ones here would call VTpass, so the review is created directly.
    const connection = await prisma.resellerConnection.create({
      data: { resellerId: owner.resellerId, integrationId: 'vtpass', mode: 'live', status: 'pending_review', credentialsEncrypted: null },
    });
    const decided = await operations.post(`/v1/admin/connections/${connection.id}/decide`, { decision: 'reject', reason: 'Wrong account' });
    assert.equal(decided.status, 200, JSON.stringify(decided.json));
    const [rejected] = (await owner.browser.get('/v1/notifications')).json.data.filter(item => item.type === 'connection.rejected');
    assert.match(rejected.body, /Reason: Wrong account/);
    assert.deepEqual([rejected.severity, rejected.link, rejected.mode], ['warning', '/integrations', 'live']);
  });
});
