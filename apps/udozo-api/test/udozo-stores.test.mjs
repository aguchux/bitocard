// Udozo's stores (docs/UDOZO_SPINOFF_PLAN.md, step 3): any number of them, Resale shops only, the sandbox on their
// <store>.udozo.com address, and live payments only once they have their own domain (back to the sandbox without one).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { resellerClient, startApp } from './helpers.mjs';

let server;
let prisma;
let owner;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  owner = await resellerClient(server);
  await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
  await prisma.featureSwitch.create({ data: { key: 'reseller_resale', resellerId: owner.resellerId, enabled: true } });
});

after(() => server?.close());

const sub = name => `${name}${Date.now() % 100000}${Math.floor(Math.random() * 1000)}`;

describe("Udozo's stores", () => {
  test('as many as the seller likes, on the free plan, each a Resale shop', async () => {
    const templates = (await owner.browser.get('/v1/store-templates')).json.data.map(item => item.key);
    assert.deepEqual(templates, ['resale_shop']);
    for (let i = 0; i < 7; i += 1) {
      const made = await owner.browser.post('/v1/stores', { name: `Store ${i}`, subdomain: sub(`store${i}x`) });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      assert.equal(made.json.design?.template ?? made.json.template, 'resale_shop');
    }
    const other = await owner.browser.post('/v1/stores', { name: 'Gifts', subdomain: sub('gifts'), template: 'all_in_one' });
    assert.deepEqual([other.status, other.json.error.code], [400, 'template_unknown']);
  });

  test('live only on its own domain; back to the sandbox when the last one goes', async () => {
    const store = (await owner.browser.post('/v1/stores', { name: 'Live one', subdomain: sub('liveone') })).json;
    const refused = await owner.browser.patch(`/v1/stores/${store.id}`, { checkout_mode: 'live' });
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [409, 'domain_required', 'checkout_mode']);

    const domain = await prisma.storeDomain.create({ data: { storeId: store.id, resellerId: owner.resellerId, name: `${sub('liveone')}.example`, source: 'connected', status: 'active', primary: true } });
    const live = await owner.browser.patch(`/v1/stores/${store.id}`, { checkout_mode: 'live' });
    assert.equal(live.status, 200, JSON.stringify(live.json));
    assert.equal((await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).checkoutMode, 'live');

    // The domain lapses outside any request: the domains job finds the store and puts it back in the sandbox.
    await prisma.storeDomain.update({ where: { id: domain.id }, data: { status: 'expired', primary: false } });
    const run = await fetch(`${server.base}/v1/cron/domains`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal((await run.json()).result.live_without_domain, 1);
    assert.equal((await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).checkoutMode, 'test');
    const notice = await prisma.notification.findFirst({ where: { type: 'store.sandbox_without_domain' } });
    assert.match(notice.title, /Live one is back in the sandbox/);
    // Running it again changes nothing and tells nobody twice.
    const again = await fetch(`${server.base}/v1/cron/domains`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal((await again.json()).result.live_without_domain, 0);
  });
});
