// Store traffic: page views counted by the storefront's server (signed shopper address only), visitors told apart within
// the day by a salted hash and never across days, crawlers and unknown hosts ignored, and the reseller's traffic report.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, resellerClient, startApp } from './helpers.mjs';
import { responseChecker } from './openapi-docs.mjs';

const secret = 'store-server-secret-for-the-tests-0123456789';
let server;
let prisma;
let visits;
let signClient;
let check;

before(async () => {
  server = await startApp({ env: { STORE_SERVER_SECRET: secret, CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  visits = server.app.get((await import('../dist/stores/store-visits.service.js')).StoreVisitsService);
  ({ signClient } = await import('../dist/common/rate-limit/client-ip.js'));
  check = await responseChecker(server.app);
});

after(async () => {
  await server?.close();
});

const browser = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
let counter = 0;

async function publishedStore() {
  const reseller = await resellerClient(server);
  const subdomain = `visits${++counter}${Date.now() % 10000}`;
  const store = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
  assert.equal(store.status, 201, JSON.stringify(store.json));
  await prisma.store.update({ where: { id: store.json.id }, data: { status: 'published', publishedAt: new Date() } });
  return { reseller, store: store.json, host: `${subdomain}.bitocard.com` };
}

/** What the storefront's proxy sends for one page view. */
function visit(host, { ip = '203.0.113.7', userAgent = browser, signed = true } = {}) {
  return client(server.base).post('/v1/store/visits', { host, user_agent: userAgent }, signed ? { 'bitocard-client': signClient(secret, ip) } : {});
}

const today = () => new Date().toISOString().slice(0, 10);

describe('counting visits', () => {
  test('views and daily visitors per address: the same visitor once a day, crawlers, unsigned calls and unknown hosts ignored', async () => {
    const { store, host } = await publishedStore();
    for (const reply of [await visit(host), await visit(host), await visit(host, { ip: '198.51.100.4' }), await visit(`${host.toUpperCase()}:443`)]) assert.equal(reply.status, 204);
    await visit(host, { userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
    await visit(host, { signed: false });
    await visit(host, { userAgent: '' });
    await visit('nobody-here.bitocard.com');
    const rows = await prisma.storeVisitDay.findMany({ where: { storeId: store.id } });
    assert.deepEqual(rows.map(row => [row.host, row.views, row.visitors]), [[host, 4, 2]]);
    // Only hashes are kept, never the address or the browser.
    const hashes = await prisma.storeVisitor.findMany({ where: { storeId: store.id } });
    assert.equal(hashes.length, 2);
    for (const row of hashes) assert.ok(!row.hash.includes('203.0.113.7') && /^[\w-]{43}$/.test(row.hash));
  });

  test('a store’s own active domain is counted under its name; drafts and other domains are not', async () => {
    const { reseller, store } = await publishedStore();
    const name = `adashop${counter}.com`;
    await prisma.storeDomain.create({ data: { resellerId: reseller.resellerId, storeId: store.id, name, source: 'connected', status: 'active', dnsMode: 'external' } });
    await prisma.storeDomain.create({ data: { resellerId: reseller.resellerId, storeId: store.id, name: `pending${counter}.com`, source: 'connected', status: 'pending', dnsMode: 'external' } });
    await visit(name);
    await visit(`pending${counter}.com`);
    const draft = await publishedStore();
    await prisma.store.update({ where: { id: draft.store.id }, data: { status: 'draft' } });
    await visit(draft.host);
    assert.deepEqual((await prisma.storeVisitDay.findMany({ where: { storeId: store.id } })).map(row => row.host), [name]);
    assert.equal(await prisma.storeVisitDay.count({ where: { storeId: draft.store.id } }), 0);
  });

  test('past days’ salts and visitor hashes are deleted; the daily totals stay', async () => {
    const { store, host } = await publishedStore();
    const yesterday = Date.now() - 86_400_000;
    await visits.record({ host, ip: '192.0.2.1', userAgent: browser }, yesterday);
    await visit(host, { ip: '192.0.2.1' });
    const day = new Date(`${new Date(yesterday).toISOString().slice(0, 10)}T00:00:00.000Z`);
    assert.equal(await prisma.storeVisitor.count({ where: { storeId: store.id, day } }), 1);
    const run = await client(server.base).get('/v1/cron/domains', { authorization: 'Bearer cron-secret' });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    assert.equal(await prisma.storeVisitor.count({ where: { storeId: store.id, day } }), 0);
    assert.equal(await prisma.storeVisitSalt.count({ where: { day: { lt: new Date(`${today()}T00:00:00.000Z`) } } }), 0);
    assert.equal(await prisma.storeVisitor.count({ where: { storeId: store.id } }), 1, 'today’s kept');
    assert.equal(await prisma.storeVisitDay.count({ where: { storeId: store.id } }), 2);
  });
});

describe('the traffic report', () => {
  test('totals, per address and every day of the period; only the store’s own reseller', async () => {
    const { reseller, store, host } = await publishedStore();
    await visits.record({ host, ip: '192.0.2.9', userAgent: browser }, Date.now() - 2 * 86_400_000);
    await visit(host);
    await visit(host, { ip: '192.0.2.10' });
    const report = await reseller.browser.get(`/v1/stores/${store.id}/traffic?days=7`);
    assert.equal(report.status, 200, JSON.stringify(report.json));
    check('GET /v1/stores/{id}/traffic', 200, report.json);
    assert.deepEqual([report.json.days, report.json.to, report.json.views, report.json.visitors], [7, today(), 3, 3]);
    assert.deepEqual(report.json.hosts, [{ host, views: 3, visitors: 3 }]);
    assert.equal(report.json.daily.length, 7);
    assert.deepEqual(report.json.daily.at(-1), { date: today(), views: 2, visitors: 2 });
    assert.equal(report.json.daily.reduce((sum, day) => sum + day.views, 0), 3);
    assert.equal((await reseller.browser.get(`/v1/stores/${store.id}/traffic?days=500`)).json.days, 90);

    const other = await resellerClient(server);
    assert.equal((await other.browser.get(`/v1/stores/${store.id}/traffic`)).status, 404);
  });
});
