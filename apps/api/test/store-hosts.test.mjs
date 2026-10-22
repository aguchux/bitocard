// Stores' addresses on bitocard.com: each store's DNS-only CNAME in Cloudflare and its domain on the storefront's Vercel
// project, set up when the store is created, moved on a rename, never over a record BitoCard did not make, and retried by
// the domains job.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { adminClient, client, fakeService, resellerClient, startApp } from './helpers.mjs';
import { fakeDomains } from './fakes.mjs';

let server;
let vercel;
let cloudflare;
let admin;
let prisma;
const zone = { name: 'bitocard.com', records: [], down: false, next: 1 };

before(async () => {
  vercel = await fakeDomains();
  cloudflare = await fakeService(({ method, url, headers, body }) => {
    if (headers.authorization !== 'Bearer cf-token') return { status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } };
    if (zone.down) return { status: 503, body: { success: false, errors: [{ code: 10001, message: 'Service unavailable' }] } };
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    if (method === 'GET' && path === '/zones/zone_bc') return { body: { success: true, result: { id: 'zone_bc', name: zone.name } } };
    if (method === 'GET' && path === '/zones/zone_bc/dns_records') return { body: { success: true, result: zone.records.filter(record => record.name === query.get('name')) } };
    if (method === 'POST' && path === '/zones/zone_bc/dns_records') {
      if (zone.records.some(record => record.name === body.name)) return { status: 400, body: { success: false, errors: [{ code: 81053, message: 'An A, AAAA, or CNAME record with that host already exists.' }] } };
      const record = { id: `rec_${zone.next++}`, ...body };
      zone.records.push(record);
      return { body: { success: true, result: record } };
    }
    const one = /^\/zones\/zone_bc\/dns_records\/([\w-]+)$/.exec(path);
    if (method === 'DELETE' && one) {
      const before = zone.records.length;
      zone.records = zone.records.filter(record => record.id !== one[1]);
      return before === zone.records.length ? { status: 404, body: { success: false, errors: [{ code: 81044, message: 'Record does not exist.' }] } } : { body: { success: true, result: { id: one[1] } } };
    }
    return { status: 404, body: { success: false, errors: [{ message: `Fake Cloudflare has no ${method} ${path}` }] } };
  });
  server = await startApp({
    env: { ...vercel.env, CLOUDFLARE_API_TOKEN: 'cf-token', CLOUDFLARE_ZONE_ID: 'zone_bc', CLOUDFLARE_API_URL: cloudflare.url, CRON_SECRET: 'cron-secret' },
  });
  admin = await adminClient(server);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(async () => {
  await server?.close();
  await cloudflare?.close();
  await vercel?.close();
});

beforeEach(() => {
  zone.down = false;
  zone.name = 'bitocard.com';
});

let counter = 0;
async function newStore(subdomain = `hoststore${++counter}${Date.now() % 10000}`) {
  const reseller = await resellerClient(server);
  const created = await reseller.browser.post('/v1/stores', { name: 'Ada Digital', subdomain });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return { reseller, store: created.json, host: `${subdomain}.bitocard.com` };
}

const cron = () => client(server.base).get('/v1/cron/domains', { authorization: 'Bearer cron-secret' });
const row = id => prisma.store.findUniqueOrThrow({ where: { id } });

describe('store addresses', () => {
  test('creating a store adds its DNS-only CNAME to Cloudflare and its address to the storefront project', async () => {
    const { store, host } = await newStore();
    const records = zone.records.filter(record => record.name === host);
    assert.equal(records.length, 1);
    assert.deepEqual(
      { type: records[0].type, content: records[0].content, proxied: records[0].proxied, comment: records[0].comment },
      { type: 'CNAME', content: 'cname.vercel-dns.com', proxied: false, comment: `bitocard:store:${store.id}` },
    );
    assert.ok(vercel.state.projectDomains[host], 'added to the storefront project');
    const saved = await row(store.id);
    assert.deepEqual([saved.hostStatus, saved.hostName, saved.hostRecordId, saved.hostError], ['ready', store.subdomain, records[0].id, null]);
  });

  test('renaming a draft store moves its address: the old record and project domain go, the new ones come', async () => {
    const { reseller, store, host } = await newStore();
    const renamed = `renamed${counter}${Date.now() % 10000}`;
    const updated = await reseller.browser.patch(`/v1/stores/${store.id}`, { subdomain: renamed });
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(zone.records.some(record => record.name === host), false);
    assert.equal(vercel.state.projectDomains[host], undefined);
    assert.equal(zone.records.filter(record => record.name === `${renamed}.bitocard.com`).length, 1);
    assert.ok(vercel.state.projectDomains[`${renamed}.bitocard.com`]);
    const saved = await row(store.id);
    assert.deepEqual([saved.hostStatus, saved.hostName], ['ready', renamed]);
  });

  test('a record BitoCard did not make is never overwritten: the store waits, admins are told, and the job finishes once it is gone', async () => {
    const subdomain = `taken${Date.now() % 100000}`;
    zone.records.push({ id: 'rec_manual', type: 'A', name: `${subdomain}.bitocard.com`, content: '203.0.113.9', proxied: true });
    const { store } = await newStore(subdomain);
    let saved = await row(store.id);
    assert.equal(saved.hostStatus, 'failed');
    assert.match(saved.hostError, /already has a A record/);
    assert.ok(zone.records.find(record => record.id === 'rec_manual'), 'left alone');
    const notices = await prisma.notification.findMany({ where: { type: 'admin.store.address_failed' } });
    assert.ok(notices.some(notice => notice.title === `${subdomain}.bitocard.com is not set up`));

    zone.records = zone.records.filter(record => record.id !== 'rec_manual');
    const run = await cron();
    assert.equal(run.status, 200, JSON.stringify(run.json));
    saved = await row(store.id);
    assert.equal(saved.hostStatus, 'ready');
    assert.equal(zone.records.filter(record => record.name === `${subdomain}.bitocard.com`).length, 1);
  });

  test('Cloudflare being down never stops the store being created; the job sets it up later, and a record already made is reused', async () => {
    zone.down = true;
    const { store, host } = await newStore();
    assert.equal((await row(store.id)).hostStatus, 'failed');
    zone.down = false;
    await cron();
    const saved = await row(store.id);
    assert.equal(saved.hostStatus, 'ready');
    // Running the set-up again (a retry after a lost reply) adopts the record instead of making another.
    await prisma.store.update({ where: { id: store.id }, data: { hostStatus: 'pending' } });
    await cron();
    assert.equal(zone.records.filter(record => record.name === host).length, 1);
    assert.equal((await row(store.id)).hostRecordId, saved.hostRecordId);
  });

  test('the single root bitocard.com store is never hosted; a market’s own country store is hosted exactly like a reseller’s', async () => {
    await cron();
    // The root house store (seeded by migration, the only house store that exists before any country store is created).
    const root = await prisma.store.findFirst({ where: { reseller: { house: true } } });
    assert.ok(root);
    assert.equal(zone.records.some(record => record.name === `${root.subdomain}.bitocard.com`), false);

    const house = server.app.get((await import('../dist/checkout/house.service.js')).HouseService);
    const ng = await house.storeFor('NG');
    assert.equal(ng.subdomain, 'ng');
    assert.equal(ng.status, 'published');
    const host = `ng.bitocard.com`;
    assert.ok(zone.records.some(record => record.name === host), 'a country store gets its own Cloudflare record');
    assert.equal((await row(ng.id)).hostStatus, 'ready');
    // Asking again returns the same store, not a second one.
    assert.equal((await house.storeFor('ng')).id, ng.id);
  });

  test('Test connection reads the zone and the storefront project, and refuses another zone', async () => {
    const cards = (await admin.get('/v1/admin/integrations')).json.data;
    assert.deepEqual(['store_hosts', 'domains'].map(id => cards.find(card => card.id === id).testable), [true, true], 'the cards show Test connection');
    const tested = await admin.post('/v1/admin/integrations/store_hosts/test');
    assert.equal(tested.status, 200, JSON.stringify(tested.json));
    assert.deepEqual([tested.json.ok, tested.json.message], [true, 'Connected to the bitocard.com zone and the bitocard-storefront project.']);
    zone.name = 'example.com';
    const wrong = await admin.post('/v1/admin/integrations/store_hosts/test');
    assert.deepEqual([wrong.json.ok, wrong.json.message], [false, 'That zone is example.com: use the bitocard.com zone.']);
  });
});
