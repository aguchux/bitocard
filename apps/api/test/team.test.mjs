// Staff invitations, roles and removal.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { EmailService } from '../dist/notifications/email.service.js';
import { client, startApp } from './helpers.mjs';

const password = 'correct horse battery';
let server;
let counter = 0;

before(async () => {
  server = await startApp();
});

after(() => server?.close());

const unique = label => `${label}${(counter += 1)}-${Date.now()}@example.com`;
const idem = () => ({ 'idempotency-key': `team-${(counter += 1)}-${Date.now()}` });

async function owner() {
  const browser = client(server.base);
  const { json } = await browser.post('/v1/auth/signup', { name: 'Owner', email: unique('owner'), password, country: 'KE', business_name: 'Owner Digital' });
  return { browser, resellerId: json.memberships[0].reseller.id };
}

/** The invitation token from the last email sent to an address. */
function invitationToken(to) {
  const message = server.app.get(EmailService).outbox.filter(item => item.to === to).at(-1);
  return message ? new URL(/https?:\/\/\S+/.exec(message.text)[0]).searchParams.get('token') : null;
}

async function invite(browser, email, role = 'developer') {
  return browser.post('/v1/team/invitations', { email, role }, idem());
}

describe('inviting', () => {
  test('an invitation is emailed and listed as pending', async () => {
    const { browser } = await owner();
    const email = unique('dev');
    const sent = await invite(browser, email);
    assert.equal(sent.status, 201);
    assert.deepEqual([sent.json.email, sent.json.role], [email, 'developer']);
    assert.ok(invitationToken(email), 'the email carries an accept link');
    const team = await browser.get('/v1/team');
    assert.equal(team.json.invitations.length, 1);
    assert.equal(team.json.members.length, 1);
  });

  test('a new person signs up with the token and joins the team, without a reseller of their own', async () => {
    const { browser, resellerId } = await owner();
    const email = unique('dev');
    await invite(browser, email, 'finance');
    const newcomer = client(server.base);
    const signup = await newcomer.post('/v1/auth/signup', { name: 'Chidi', email, password, invitation_token: invitationToken(email) });
    assert.equal(signup.status, 201);
    assert.equal(signup.json.memberships.length, 1);
    assert.deepEqual([signup.json.memberships[0].reseller.id, signup.json.memberships[0].role], [resellerId, 'finance']);
    assert.equal(signup.json.user.email_verified, true);
    assert.equal((await browser.get('/v1/team')).json.invitations.length, 0, 'no longer pending');
  });

  test('an existing account accepts while signed in', async () => {
    const { browser, resellerId } = await owner();
    const email = unique('dev');
    const existing = client(server.base);
    await existing.post('/v1/auth/signup', { name: 'Chidi', email, password, country: 'NG' });
    await invite(browser, email, 'support');
    const accepted = await existing.post('/v1/team/invitations/accept', { token: invitationToken(email) });
    assert.equal(accepted.status, 200);
    const session = await existing.get('/v1/auth/session');
    assert.ok(session.json.memberships.some(m => m.reseller.id === resellerId && m.role === 'support'));
  });

  test('the invitation only works for the invited email, and only once', async () => {
    const { browser } = await owner();
    const email = unique('dev');
    await invite(browser, email);
    const token = invitationToken(email);
    const someoneElse = await client(server.base).post('/v1/auth/signup', { name: 'Eve', email: unique('eve'), password, invitation_token: token });
    assert.deepEqual([someoneElse.status, someoneElse.json.error.code], [403, 'invitation_email_mismatch']);
    await client(server.base).post('/v1/auth/signup', { name: 'Chidi', email, password, invitation_token: token });
    const again = await client(server.base).post('/v1/auth/signup', { name: 'Chidi', email: unique('x'), password, invitation_token: token });
    assert.equal(again.json.error.code, 'invitation_invalid');
  });

  test('a revoked or replaced invitation no longer works', async () => {
    const { browser } = await owner();
    const email = unique('dev');
    const first = await invite(browser, email);
    const firstToken = invitationToken(email);
    await invite(browser, email, 'admin');
    const replaced = await client(server.base).post('/v1/auth/signup', { name: 'Chidi', email, password, invitation_token: firstToken });
    assert.equal(replaced.json.error.code, 'invitation_invalid');

    const team = await browser.get('/v1/team');
    const pending = team.json.invitations[0];
    assert.notEqual(pending.id, first.json.id);
    assert.equal((await browser.delete(`/v1/team/invitations/${pending.id}`)).status, 204);
    const revoked = await client(server.base).post('/v1/auth/signup', { name: 'Chidi', email, password, invitation_token: invitationToken(email) });
    assert.equal(revoked.json.error.code, 'invitation_invalid');
  });

  test('owners cannot be invited, and members cannot be invited twice', async () => {
    const { browser } = await owner();
    const asOwner = await browser.post('/v1/team/invitations', { email: unique('x'), role: 'owner' }, idem());
    assert.deepEqual([asOwner.status, asOwner.json.error.param], [400, 'role']);
    const email = unique('dev');
    await invite(browser, email);
    await client(server.base).post('/v1/auth/signup', { name: 'Chidi', email, password, invitation_token: invitationToken(email) });
    const twice = await invite(browser, email);
    assert.equal(twice.json.error.code, 'already_a_member');
  });
});

describe('managing members', () => {
  async function teamWithMember(role) {
    const team = await owner();
    const email = unique(role);
    await invite(team.browser, email, role);
    const member = client(server.base);
    const { json } = await member.post('/v1/auth/signup', { name: 'Member', email, password, invitation_token: invitationToken(email) });
    return { ...team, member, memberId: json.user.id };
  }

  test('only owners and admins can invite or change the team', async () => {
    const { member } = await teamWithMember('developer');
    assert.equal((await invite(member, unique('x'))).status, 403);
    assert.equal((await member.get('/v1/team')).status, 200, 'every member can see the team');
  });

  test('an admin can change roles, but never the owner', async () => {
    const { browser, member, memberId } = await teamWithMember('admin');
    const ownerId = (await browser.get('/v1/auth/session')).json.user.id;
    const other = await teamWithMember('developer');
    const changed = await other.browser.patch(`/v1/team/members/${other.memberId}`, { role: 'support' });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.members.find(m => m.user_id === other.memberId).role, 'support');
    const owner = await member.patch(`/v1/team/members/${ownerId}`, { role: 'support' });
    assert.deepEqual([owner.status, owner.json.error.code], [403, 'owner_protected']);
    const promote = await member.patch(`/v1/team/members/${memberId}`, { role: 'owner' });
    assert.deepEqual([promote.status, promote.json.error.param], [400, 'role']);
  });

  test('a removed member loses access to the reseller', async () => {
    const { browser, member, memberId } = await teamWithMember('developer');
    assert.equal((await member.get('/v1/account')).status, 200);
    const removed = await browser.delete(`/v1/team/members/${memberId}`);
    assert.equal(removed.status, 204);
    assert.equal((await member.get('/v1/account')).status, 403);
  });

  test('the owner cannot be removed', async () => {
    const { browser } = await owner();
    const ownerId = (await browser.get('/v1/auth/session')).json.user.id;
    const res = await browser.delete(`/v1/team/members/${ownerId}`);
    assert.deepEqual([res.status, res.json.error.code], [403, 'owner_protected']);
  });
});
