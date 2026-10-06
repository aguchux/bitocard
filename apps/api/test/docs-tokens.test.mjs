// "Try it" tokens for the API documentation: issued to signed-in resellers, scoped to one account and mode, tied to
// the dashboard session, read-only on request or for staff who cannot create API keys, never usable on dashboard routes.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { issueDocsToken, readDocsToken } from '../dist/auth/docs-tokens.js';
import { client, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get(PrismaService);
});

after(() => server?.close());

let counter = 0;
async function reseller(country = 'GH') {
  const browser = client(server.base);
  const email = `docs${(counter += 1)}-${Date.now()}@example.com`;
  const { json } = await browser.post('/v1/auth/signup', { name: 'Ada', email, password: 'correct horse battery', country });
  return { browser, resellerId: json.memberships[0].reseller.id, userId: json.user.id };
}

const withToken = (token, path, init = {}) => fetch(`${server.base}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
const post = (token, path, body) => withToken(token, path, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `k-${Math.random()}` }, body: JSON.stringify(body) });

describe('issuing', () => {
  test('a sandbox token works like a test key for 15 minutes and says what it is', async () => {
    const { browser, resellerId } = await reseller();
    const issued = await browser.post('/v1/auth/docs-token', { mode: 'test' });
    assert.equal(issued.status, 200);
    assert.match(issued.json.token, /^bc_docs_/);
    assert.deepEqual([issued.json.mode, issued.json.read_only, issued.json.reseller.id], ['test', false, resellerId]);
    assert.equal(issued.json.scopes.length, 10);
    const minutes = (Date.parse(issued.json.expires_at) - Date.now()) / 60_000;
    assert.ok(minutes > 14 && minutes <= 15, `valid for 15 minutes, got ${minutes}`);

    const account = await (await withToken(issued.json.token, '/v1/account')).json();
    assert.deepEqual([account.reseller.id, account.authenticated_as.type, account.authenticated_as.mode], [resellerId, 'docs_token', 'test']);
    assert.ok(!('api_key_id' in account.authenticated_as));
    assert.equal((await withToken(issued.json.token, '/v1/wallet')).status, 200);
  });

  test('only a signed-in person can get one; API keys and strangers cannot', async () => {
    const stranger = client(server.base);
    assert.equal((await stranger.post('/v1/auth/docs-token', { mode: 'test' })).status, 401);
    const { browser } = await reseller();
    const key = await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' });
    assert.equal((await post(key.json.secret, '/v1/auth/docs-token', { mode: 'test' })).status, 403);
    const bad = await browser.post('/v1/auth/docs-token', { mode: 'production' });
    assert.deepEqual([bad.status, bad.json.error.param], [400, 'mode']);
  });

  test('live needs a verified business, and then acts on live data', async () => {
    const { browser, resellerId } = await reseller();
    const refused = await browser.post('/v1/auth/docs-token', { mode: 'live' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'reseller_not_verified']);
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'active' } });
    const live = await browser.post('/v1/auth/docs-token', { mode: 'live' });
    assert.equal(live.status, 200);
    const wallet = await (await withToken(live.json.token, '/v1/wallet')).json();
    assert.equal(wallet.mode, 'live');
    // A token cannot be pointed at the other mode.
    assert.equal((await withToken(live.json.token, '/v1/wallet', { headers: { 'bitocard-mode': 'test' } })).status, 400);
  });

  test('cookie requests for a token must come from an allowed origin', async () => {
    const { browser } = await reseller();
    const forged = await browser.post('/v1/auth/docs-token', { mode: 'test' }, { origin: 'https://evil.example' });
    assert.equal(forged.status, 403);
  });
});

describe('what a token may do', () => {
  test('read-only tokens can read but not change anything', async () => {
    const { browser } = await reseller();
    const issued = await browser.post('/v1/auth/docs-token', { mode: 'test', read_only: true });
    assert.equal(issued.json.read_only, true);
    assert.ok(issued.json.scopes.every(scope => scope.endsWith(':read')));
    assert.equal((await withToken(issued.json.token, '/v1/catalogue/products')).status, 200);
    const write = await post(issued.json.token, '/v1/webhook-endpoints', { url: 'https://example.com/hooks' });
    assert.equal(write.status, 403);
  });

  test('staff who cannot create API keys always get read-only tokens', async () => {
    const { resellerId } = await reseller();
    const staff = await reseller();
    await prisma.resellerMember.create({ data: { resellerId, userId: staff.userId, role: 'support' } });
    const issued = await staff.browser.post('/v1/auth/docs-token', { mode: 'test' }, { 'bitocard-reseller': resellerId });
    assert.equal(issued.status, 200);
    assert.deepEqual([issued.json.read_only, issued.json.reseller.id], [true, resellerId]);
  });

  test('dashboard-only routes refuse a token, as they refuse API keys', async () => {
    const { browser } = await reseller();
    const { json } = await browser.post('/v1/auth/docs-token', { mode: 'test' });
    assert.equal((await withToken(json.token, '/v1/auth/session')).status, 403);
    assert.equal((await post(json.token, '/v1/api-keys', { name: 'x', mode: 'test' })).status, 403);
    assert.equal((await post(json.token, '/v1/auth/docs-token', { mode: 'test' })).status, 403);
  });
});

describe('ending', () => {
  test('signing out of the dashboard ends the token at once', async () => {
    const { browser } = await reseller();
    const { json } = await browser.post('/v1/auth/docs-token', { mode: 'test' });
    assert.equal((await withToken(json.token, '/v1/account')).status, 200);
    await browser.post('/v1/auth/signout');
    assert.equal((await withToken(json.token, '/v1/account')).status, 401);
  });

  test('leaving the reseller account, or its suspension, ends the token', async () => {
    const owner = await reseller();
    const staff = await reseller();
    await prisma.resellerMember.create({ data: { resellerId: owner.resellerId, userId: staff.userId, role: 'developer' } });
    const { json } = await staff.browser.post('/v1/auth/docs-token', { mode: 'test' }, { 'bitocard-reseller': owner.resellerId });
    assert.equal((await withToken(json.token, '/v1/account')).status, 200);
    await prisma.resellerMember.deleteMany({ where: { resellerId: owner.resellerId, userId: staff.userId } });
    assert.equal((await withToken(json.token, '/v1/account')).status, 401);

    const fresh = await owner.browser.post('/v1/auth/docs-token', { mode: 'test' });
    await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'suspended' } });
    assert.equal((await withToken(fresh.json.token, '/v1/account')).status, 401);
  });

  test('expired, altered or foreign-signed tokens are refused', () => {
    const key = 'a'.repeat(44);
    const claims = { sid: 's1', rid: 'r1', mode: 'test', ro: false, exp: Date.now() + 60_000 };
    const token = issueDocsToken(key, claims);
    assert.deepEqual(readDocsToken(key, token), claims);
    assert.equal(readDocsToken(key, token, claims.exp + 1), null, 'expired');
    assert.equal(readDocsToken('b'.repeat(44), token), null, 'another key');
    const [body, signature] = token.slice('bc_docs_'.length).split('.');
    const tampered = Buffer.from(JSON.stringify({ ...claims, mode: 'live' })).toString('base64url');
    assert.equal(readDocsToken(key, `bc_docs_${tampered}.${signature}`), null, 'changed claims');
    assert.equal(readDocsToken(key, `bc_docs_${body}.${'x'.repeat(43)}`), null, 'wrong signature');
  });

  test('a token that is not genuine gets a plain 401 over HTTP', async () => {
    const fake = issueDocsToken('c'.repeat(44), { sid: 'nope', rid: 'nope', mode: 'test', ro: false, exp: Date.now() + 60_000 });
    assert.equal((await withToken(fake, '/v1/account')).status, 401);
  });
});
