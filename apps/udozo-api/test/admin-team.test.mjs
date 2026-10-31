// The admin team (Settings > Team): super admins invite staff with roles (a set-password link by email, then the
// authenticator at their first sign-in), change roles, send a new link, reset an authenticator, suspend and restore;
// always one active super admin left, only the admin domains, nothing deleted, everything audited.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, startApp } from './helpers.mjs';

let server;
let prisma;
let owner;
let counter = 0;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  owner = await adminClient(server, ['super_admin']);
});

after(() => server?.close());

const staffEmail = () => `staff${(counter += 1)}-${Date.now()}@bitocard.com`;
const outbox = async () => server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox;

describe('the admin team', () => {
  test('a super admin invites staff with roles; they get a set-password link and appear as invited', async () => {
    const email = staffEmail();
    const invited = await owner.post('/v1/admin/team', { name: 'Ngozi Okeke', email, roles: ['support', 'operations'] });
    assert.equal(invited.status, 201, JSON.stringify(invited.json));
    assert.deepEqual([invited.json.roles, invited.json.password_set, invited.json.authenticator, invited.json.email_sent], [['support', 'operations'], false, false, 'outbox']);
    const link = (await outbox()).filter(message => message.to === email).at(-1);
    assert.match(link?.text ?? '', /\/set-password#token=/, 'the set-password link is emailed');

    const team = await owner.get('/v1/admin/team');
    assert.equal(team.status, 200);
    assert.ok(team.json.data.some(member => member.email === email && member.status === 'active' && !member.password_set));
    assert.deepEqual(team.json.roles, ['super_admin', 'operations', 'finance', 'support']);
    assert.ok(!JSON.stringify(team.json).match(/password_hash|secret|token/i), 'never a secret');
    assert.ok((await prisma.auditLog.findFirst({ where: { action: 'admin.invited', targetId: invited.json.id } })), 'audited');

    // The link sets the password; then they sign in like any admin.
    const token = /#token=([^\s"<]+)/.exec(link.text)[1];
    const set = await owner.post('/v1/admin/auth/password-link/complete', { token, password: 'a long staff passphrase' });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal((await owner.get('/v1/admin/team')).json.data.find(member => member.email === email).password_set, true);
  });

  test('only the admin domains, never twice, and roles from the list', async () => {
    const outside = await owner.post('/v1/admin/team', { name: 'Someone', email: 'someone@gmail.com', roles: ['support'] });
    assert.deepEqual([outside.status, outside.json.error.code, outside.json.error.param], [400, 'admin_domain_not_allowed', 'email']);
    const email = staffEmail();
    assert.equal((await owner.post('/v1/admin/team', { name: 'Once', email, roles: ['finance'] })).status, 201);
    const twice = await owner.post('/v1/admin/team', { name: 'Twice', email, roles: ['finance'] });
    assert.deepEqual([twice.status, twice.json.error.code], [409, 'admin_exists']);
    const badRole = await owner.post('/v1/admin/team', { name: 'Odd', email: staffEmail(), roles: ['owner'] });
    assert.deepEqual([badRole.status, badRole.json.error.param], [400, 'roles']);
  });

  test('roles change, a suspended admin is signed out and can be restored; an authenticator can be reset', async () => {
    const member = await adminClient(server, ['support']);
    const id = (await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email: member.admin.email } })).id;
    const roles = await owner.patch(`/v1/admin/team/${id}`, { roles: ['finance'] });
    assert.deepEqual([roles.status, roles.json.roles], [200, ['finance']]);

    const suspended = await owner.post(`/v1/admin/team/${id}/suspend`, { reason: 'Left the company' });
    assert.deepEqual([suspended.status, suspended.json.status], [200, 'disabled']);
    assert.equal((await member.get('/v1/admin/overview')).status, 401, 'signed out at once');
    const link = await owner.post(`/v1/admin/team/${id}/password-link`, {});
    assert.equal(link.json.error.code, 'admin_suspended');
    assert.equal((await owner.post(`/v1/admin/team/${id}/restore`, { reason: 'Came back' })).json.status, 'active');

    const reset = await owner.post(`/v1/admin/team/${id}/authenticator/reset`, { reason: 'Lost phone' });
    assert.deepEqual([reset.status, reset.json.authenticator], [200, false]);
    assert.equal(await prisma.totpCredential.count({ where: { userId: id } }), 0);
    for (const action of ['admin.roles_changed', 'admin.suspended', 'admin.restored', 'admin.authenticator_reset']) {
      assert.ok(await prisma.auditLog.findFirst({ where: { action, targetId: id } }), action);
    }
  });

  test('always one active super admin, never yourself, and only super admins see the team', async () => {
    const selfId = (await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email: owner.admin.email } })).id;
    assert.equal((await owner.post(`/v1/admin/team/${selfId}/suspend`, { reason: 'Testing' })).json.error.code, 'not_yourself');
    // Every other super admin out of the way: the last one cannot be demoted.
    await prisma.user.updateMany({ where: { realm: 'admin', adminRoles: { has: 'super_admin' }, id: { not: selfId } }, data: { status: 'disabled' } });
    const demote = await owner.patch(`/v1/admin/team/${selfId}`, { roles: ['operations'] });
    assert.deepEqual([demote.status, demote.json.error.code], [409, 'last_super_admin']);

    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.get('/v1/admin/team')).status, 403);
    assert.equal((await operations.post('/v1/admin/team', { name: 'X', email: staffEmail(), roles: ['support'] })).status, 403);
  });
});
