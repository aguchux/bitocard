// API keys: creation, scopes, use as Bearer tokens, rolling, revocation and permissions.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { FixturesModule, client, fixtureCalls, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp({ extraModules: [FixturesModule] });
  prisma = server.app.get(PrismaService);
});

after(() => server?.close());

let counter = 0;
async function reseller() {
  const browser = client(server.base);
  const email = `keys${(counter += 1)}-${Date.now()}@example.com`;
  const { json } = await browser.post('/v1/auth/signup', { name: 'Ada', email, password: 'correct horse battery', country: 'GH' });
  return { browser, resellerId: json.memberships[0].reseller.id, userId: json.user.id };
}

const withKey = (secret, path, init = {}) => fetch(`${server.base}${path}`, { ...init, headers: { authorization: `Bearer ${secret}`, ...(init.headers ?? {}) } });

describe('creating keys', () => {
  test('a test key is shown once, stored only as a hash, and works as a Bearer token', async () => {
    const { browser, resellerId } = await reseller();
    const created = await browser.post('/v1/api-keys', { name: 'Website backend', mode: 'test' });
    assert.equal(created.status, 201);
    assert.match(created.json.secret, /^bc_test_[A-Za-z0-9_-]{40,}$/);
    assert.equal(created.json.prefix, created.json.secret.slice(0, 14));
    assert.deepEqual(created.json.scopes.length, 10, 'defaults to every scope');

    const stored = await prisma.apiKey.findUnique({ where: { id: created.json.id } });
    assert.notEqual(stored.keyHash, created.json.secret);
    assert.ok(!JSON.stringify(stored).includes(created.json.secret), 'the secret is never stored');

    const listed = await browser.get('/v1/api-keys');
    assert.equal(listed.json.data[0].secret, undefined, 'never shown again');

    const account = await withKey(created.json.secret, '/v1/account');
    assert.equal(account.status, 200);
    const body = await account.json();
    assert.deepEqual([body.reseller.id, body.authenticated_as.type, body.authenticated_as.mode], [resellerId, 'api_key', 'test']);
  });

  test('scopes can be limited, and unknown scopes are refused', async () => {
    const { browser } = await reseller();
    const limited = await browser.post('/v1/api-keys', { name: 'Read only', mode: 'test', scopes: ['catalogue:read'] });
    assert.deepEqual(limited.json.scopes, ['catalogue:read']);
    const bad = await browser.post('/v1/api-keys', { name: 'Bad', mode: 'test', scopes: ['everything'] });
    assert.deepEqual([bad.status, bad.json.error.param], [400, 'scopes']);
  });

  test('live keys need a verified (active) reseller', async () => {
    const { browser, resellerId } = await reseller();
    const refused = await browser.post('/v1/api-keys', { name: 'Live', mode: 'live' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'reseller_not_verified']);
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'active' } });
    const live = await browser.post('/v1/api-keys', { name: 'Live', mode: 'live' });
    assert.equal(live.status, 201);
    assert.match(live.json.secret, /^bc_live_/);
  });
});

describe('using keys', () => {
  test('API keys cannot manage API keys or reach session endpoints', async () => {
    const { browser } = await reseller();
    const { json } = await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' });
    const create = await withKey(json.secret, '/v1/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', mode: 'test' }) });
    assert.equal(create.status, 403);
    assert.equal((await withKey(json.secret, '/v1/auth/session')).status, 403);
  });

  test('unknown, revoked and suspended-reseller keys are refused', async () => {
    assert.equal((await withKey(`bc_test_${'x'.repeat(43)}`, '/v1/account')).status, 401);

    const { browser, resellerId } = await reseller();
    const { json } = await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' });
    const revoked = await browser.delete(`/v1/api-keys/${json.id}`);
    assert.ok(revoked.json.revoked_at);
    assert.equal((await withKey(json.secret, '/v1/account')).status, 401);

    const second = await browser.post('/v1/api-keys', { name: 'Backend 2', mode: 'test' });
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'suspended' } });
    assert.equal((await withKey(second.json.secret, '/v1/account')).status, 401);
  });

  test('records when a key was last used', async () => {
    const { browser } = await reseller();
    const { json } = await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' });
    await withKey(json.secret, '/v1/account');
    const listed = await browser.get('/v1/api-keys');
    assert.ok(listed.json.data.find(key => key.id === json.id).last_used_at);
  });

  test('idempotency keys are separate for each API key', async () => {
    const { browser } = await reseller();
    const a = (await browser.post('/v1/api-keys', { name: 'A', mode: 'test' })).json.secret;
    const b = (await browser.post('/v1/api-keys', { name: 'B', mode: 'test' })).json.secret;
    const start = fixtureCalls.count;
    const send = secret =>
      withKey(secret, '/v1/fixtures/things', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'shared-key-1' },
        body: JSON.stringify({ name: 'x', quantity: 1 }),
      });
    assert.equal((await send(a)).status, 201);
    assert.equal((await send(b)).status, 201);
    assert.equal(fixtureCalls.count, start + 2, 'the same Idempotency-Key from two API keys runs twice');
  });
});

describe('rolling and revoking', () => {
  test('rolling issues a new secret and keeps the old one for the overlap period', async () => {
    const { browser } = await reseller();
    const old = (await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test', scopes: ['orders:read'] })).json;
    const rolled = await browser.post(`/v1/api-keys/${old.id}/roll`, { overlap_hours: 1 });
    assert.equal(rolled.status, 201);
    assert.notEqual(rolled.json.secret, old.secret);
    assert.deepEqual([rolled.json.name, rolled.json.scopes], ['Backend', ['orders:read']]);
    assert.equal((await withKey(old.secret, '/v1/account')).status, 200, 'old key still works during the overlap');
    const listed = (await browser.get('/v1/api-keys')).json.data.find(key => key.id === old.id);
    assert.ok(listed.expires_at);
  });

  test('rolling with no overlap revokes the old key at once', async () => {
    const { browser } = await reseller();
    const old = (await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' })).json;
    await browser.post(`/v1/api-keys/${old.id}/roll`, { overlap_hours: 0 });
    assert.equal((await withKey(old.secret, '/v1/account')).status, 401);
  });

  test("another reseller's keys are invisible", async () => {
    const owner = await reseller();
    const key = (await owner.browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' })).json;
    const stranger = await reseller();
    assert.equal((await stranger.browser.delete(`/v1/api-keys/${key.id}`)).status, 404);
    assert.equal((await stranger.browser.post(`/v1/api-keys/${key.id}/roll`, {})).status, 404);
    assert.equal((await stranger.browser.get('/v1/api-keys')).json.data.length, 0);
  });
});

describe('permissions', () => {
  test('support and finance staff cannot manage keys; developers can', async () => {
    const owner = await reseller();
    for (const [role, expected] of [['support', 403], ['finance', 403], ['developer', 201]]) {
      const staff = client(server.base);
      const email = `${role}-${Date.now()}@example.com`;
      const { json } = await staff.post('/v1/auth/signup', { name: 'Staff', email, password: 'correct horse battery', country: 'GH' });
      // Move the staff member into the owner's reseller with the role (invitations arrive in the next slice).
      await prisma.resellerMember.deleteMany({ where: { userId: json.user.id } });
      await prisma.resellerMember.create({ data: { resellerId: owner.resellerId, userId: json.user.id, role } });
      const res = await staff.post('/v1/api-keys', { name: `${role} key`, mode: 'test' });
      assert.equal(res.status, expected, role);
    }
  });
});
