// Udozo's stores' sandbox addresses (docs/UDOZO_SPINOFF_PLAN.md, the owner's answers): udozo.com's DNS is on Cloudflare,
// where Vercel cannot issue a wildcard certificate, so each store's <subdomain>.udozo.com is made as BitoCard's stores'
// are: a DNS-only CNAME in udozo.com's zone and the address on Udozo's stores project. Udozo's house stores get none.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, fakeService, resellerClient, startApp } from './helpers.mjs';
import { fakeDomains } from './fakes.mjs';

let server;
let vercel;
let cloudflare;
let admin;
let prisma;
const zone = { name: 'udozo.com', records: [], next: 1 };

before(async () => {
  vercel = await fakeDomains();
  cloudflare = await fakeService(({ method, url, headers, body }) => {
    if (headers.authorization !== 'Bearer cf-token') return { status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } };
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    if (method === 'GET' && path === '/zones/zone_udz') return { body: { success: true, result: { id: 'zone_udz', name: zone.name } } };
    if (method === 'GET' && path === '/zones/zone_udz/dns_records') return { body: { success: true, result: zone.records.filter(record => record.name === query.get('name')) } };
    if (method === 'POST' && path === '/zones/zone_udz/dns_records') {
      const record = { id: `rec_${zone.next++}`, ...body };
      zone.records.push(record);
      return { body: { success: true, result: record } };
    }
    return { status: 404, body: { success: false, errors: [{ message: `Fake Cloudflare has no ${method} ${path}` }] } };
  });
  server = await startApp({
    env: { ...vercel.env, APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ZONE_ID: 'zone_udz', CLOUDFLARE_API_URL: cloudflare.url, CRON_SECRET: 'cron-secret' },
  });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
  await cloudflare?.close();
  await vercel?.close();
});

describe("Udozo's store addresses", () => {
  test('a new store gets <subdomain>.udozo.com in udozo.com’s zone and on the stores project', async () => {
    const owner = await resellerClient(server);
    await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
    await prisma.featureSwitch.create({ data: { key: 'reseller_resale', resellerId: owner.resellerId, enabled: true } });
    const subdomain = `gadgets${Date.now() % 100000}`;
    const made = await owner.browser.post('/v1/stores', { name: 'Gadget Hub', subdomain });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const host = `${subdomain}.udozo.com`;
    const records = zone.records.filter(record => record.name === host);
    assert.deepEqual(
      records.map(record => ({ type: record.type, content: record.content, proxied: record.proxied, comment: record.comment })),
      [{ type: 'CNAME', content: 'cname.vercel-dns.com', proxied: false, comment: `udozo:store:${made.json.id}` }],
    );
    assert.ok(vercel.state.projectDomains[host], 'added to the stores project');
    assert.equal((await prisma.store.findUniqueOrThrow({ where: { id: made.json.id } })).hostStatus, 'ready');
    assert.ok(!zone.records.some(record => record.name.endsWith('.bitocard.com')), 'never a bitocard.com address');
  });

  test('house stores (BitoCard’s old country stores) are never given one, even waiting in the job', async () => {
    const pending = await prisma.store.count({ where: { hostStatus: { in: ['pending', 'failed'] }, reseller: { house: true } } });
    const run = await client(server.base).get('/v1/cron/domains', { authorization: 'Bearer cron-secret' });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    assert.ok(!zone.records.some(record => /^(ng|gh|ke)\.udozo\.com$/.test(record.name)), `no country store addresses (${pending} waiting)`);
  });

  test('Test connection wants udozo.com’s zone', async () => {
    const tested = await admin.post('/v1/admin/integrations/store_hosts/test');
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual([tested.json.ok, /udozo\.com zone/.test(tested.json.message)], [true, true], tested.json.message);
    zone.name = 'bitocard.com';
    const wrong = await admin.post('/v1/admin/integrations/store_hosts/test');
    assert.deepEqual([wrong.json.ok, wrong.json.message], [false, 'That zone is bitocard.com: use the udozo.com zone.']);
    zone.name = 'udozo.com';
  });
});
