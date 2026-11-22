// SHQ's Developers > Overview: one environment's API keys, endpoints, deliveries, events and orders, both environments
// side by side, and whether live is open; dashboard sessions only, never an API key.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { client, startApp } from './helpers.mjs';

let server;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get(PrismaService);
});

after(() => server?.close());

const sandbox = { 'bitocard-mode': 'test' };

describe('the developers overview', () => {
  test('counts the sandbox apart from live, gives a day for every day, and says why live is closed', async () => {
    const browser = client(server.base);
    const { json } = await browser.post('/v1/auth/signup', { name: 'Ada', email: `dev-${Date.now()}@example.com`, password: 'correct horse battery', country: 'GH' });
    const resellerId = json.memberships[0].reseller.id;
    const key = await browser.post('/v1/api-keys', { name: 'Backend', mode: 'test' });
    assert.equal(key.status, 201, JSON.stringify(key.json));
    await browser.post('/v1/api-keys', { name: 'Old', mode: 'test' }).then(created => browser.delete(`/v1/api-keys/${created.json.id}`));
    await prisma.apiKey.update({ where: { id: key.json.id }, data: { lastUsedAt: new Date() } });

    const overview = await browser.get('/v1/developers/overview', sandbox);
    assert.equal(overview.status, 200, JSON.stringify(overview.json));
    const body = overview.json;
    assert.deepEqual([body.object, body.mode, body.days, body.series.length], ['developer_overview', 'test', 7, 7]);
    assert.deepEqual(body.live, { ready: false, reason: 'identity_check' });
    assert.deepEqual(body.environments, { live: { api_keys: 0, webhook_endpoints: 0 }, test: { api_keys: 1, webhook_endpoints: 0 } });
    assert.deepEqual([body.api_keys.active, body.api_keys.used_in_period, body.api_keys.last_used_by], [1, 1, 'Backend']);
    assert.equal(body.deliveries.success_rate, null);
    assert.equal(body.series.at(-1).day, new Date().toISOString().slice(0, 10));

    const month = await browser.get('/v1/developers/overview?days=30');
    assert.deepEqual([month.json.mode, month.json.series.length, month.json.api_keys.active], ['live', 30, 0]);
    assert.equal((await browser.get('/v1/developers/overview?days=12')).status, 400);

    // Activated, live is open.
    await prisma.reseller.update({ where: { id: resellerId }, data: { status: 'active', verifiedAt: new Date() } });
    assert.deepEqual((await browser.get('/v1/developers/overview')).json.live, { ready: true, reason: 'verified' });

    // An API key cannot read it.
    const refused = await fetch(`${server.base}/v1/developers/overview`, { headers: { authorization: `Bearer ${key.json.secret}` } });
    assert.equal(refused.status, 403);
  });
});
