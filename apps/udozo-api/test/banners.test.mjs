// Banner ads on udozo.com (3 November 2026): Udozo's team places an image linking to a page above the account pages'
// menu (`account_rail`), for one market or every market, and switches it on and off. A market's own banners win;
// udozo.com reads them publicly (a minute in caches), never the team's note.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, startApp } from './helpers.mjs';

let server;
let operations;
let support;
let prisma;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate' } });
  operations = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  // Nigeria and Ghana open, as they are on udozo.com.
  const admin = await adminClient(server);
  for (const country of ['NG', 'GH']) assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: country, enabled: true })).status, 200);
});

after(() => server?.close());

const banner = (extra = {}) => ({ position: 'account_rail', image_url: 'https://cdn.udozo.test/platform/banners/images/a.png', href: '/ng/c/mobile-phones', alt: 'Phones from ₦50,000', ...extra });
const showing = async (country = 'NG') => {
  const res = await fetch(`${server.base}/v1/classifieds/banners?position=account_rail&country=${country}`);
  return { status: res.status, cache: res.headers.get('cache-control'), json: await res.json() };
};

describe('banner ads above the account menu', () => {
  test('operations place one for every market; udozo.com reads it publicly, without the note', async () => {
    await prisma.classifiedBanner.deleteMany();
    const made = await operations.post('/v1/admin/classifieds/banners', banner({ note: 'Launch week' }));
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.object, made.json.country, made.json.enabled, made.json.state, made.json.note], ['banner', null, true, 'showing', 'Launch week']);

    const read = await showing('NG');
    assert.equal(read.status, 200);
    assert.equal(read.cache, 'public, max-age=60');
    assert.deepEqual(read.json.data, [{ object: 'banner', id: made.json.id, image_url: banner().image_url, href: '/ng/c/mobile-phones', alt: 'Phones from ₦50,000' }]);
    assert.ok(!JSON.stringify(read.json).includes('Launch week'), 'never the note');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'banner.created', targetId: made.json.id } }));
  });

  test("a market's own banners win over every market's; switching one off (the gate) hides it", async () => {
    await prisma.classifiedBanner.deleteMany();
    const all = await operations.post('/v1/admin/classifieds/banners', banner());
    const nigeria = await operations.post('/v1/admin/classifieds/banners', banner({ country: 'ng', image_url: 'https://cdn.udozo.test/ng.png', href: 'https://partner.example.com/offer' }));
    assert.equal(nigeria.json.country, 'NG');
    assert.deepEqual((await showing('NG')).json.data.map(item => item.id), [nigeria.json.id]);
    assert.deepEqual((await showing('GH')).json.data.map(item => item.id), [all.json.id]);

    const off = await operations.patch(`/v1/admin/classifieds/banners/${nigeria.json.id}`, { enabled: false });
    assert.deepEqual([off.json.enabled, off.json.state, off.json.href], [false, 'off', 'https://partner.example.com/offer']);
    assert.deepEqual((await showing('NG')).json.data.map(item => item.id), [all.json.id], 'back to every market’s');
    await operations.patch(`/v1/admin/classifieds/banners/${all.json.id}`, { enabled: false });
    assert.deepEqual((await showing('NG')).json.data, []);
  });

  test('dates: scheduled before it starts, ended after it ends', async () => {
    await prisma.classifiedBanner.deleteMany();
    const later = await operations.post('/v1/admin/classifieds/banners', banner({ starts_at: new Date(Date.now() + 86_400_000).toISOString() }));
    assert.equal(later.json.state, 'scheduled');
    const gone = await operations.post('/v1/admin/classifieds/banners', banner({ starts_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), ends_at: new Date(Date.now() - 86_400_000).toISOString() }));
    assert.equal(gone.json.state, 'ended');
    assert.deepEqual((await showing('NG')).json.data, []);
    const backwards = await operations.post('/v1/admin/classifieds/banners', banner({ starts_at: '2027-01-02T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' }));
    assert.deepEqual([backwards.status, backwards.json.error.param], [400, 'ends_at']);
  });

  test('every field is checked: the link, the image, the description, the market and the place', async () => {
    const refused = async (body, param) => {
      const res = await operations.post('/v1/admin/classifieds/banners', body);
      assert.equal(res.status, 400, JSON.stringify(res.json));
      assert.equal(res.json.error.param, param);
    };
    await refused(banner({ href: 'javascript:alert(1)' }), 'href');
    await refused(banner({ href: '//evil.example.com' }), 'href');
    await refused(banner({ href: 'http://partner.example.com' }), 'href');
    await refused(banner({ image_url: 'http://cdn.udozo.test/a.png' }), 'image_url');
    await refused(banner({ alt: '  ' }), 'alt');
    await refused(banner({ country: 'ZZ' }), 'country');
    await refused(banner({ position: 'homepage_top' }), 'position');
    await refused({ ...banner(), position: undefined }, 'position');
  });

  test('support reads them; only operations change them; deleting is audited', async () => {
    await prisma.classifiedBanner.deleteMany();
    const made = await operations.post('/v1/admin/classifieds/banners', banner({ country: 'NG' }));
    const list = await support.get('/v1/admin/classifieds/banners?country=NG');
    assert.deepEqual(list.json.data.map(item => item.id), [made.json.id]);
    assert.deepEqual((await support.get('/v1/admin/classifieds/banners?country=global')).json.data, []);
    assert.equal((await support.post('/v1/admin/classifieds/banners', banner())).status, 403);
    assert.equal((await support.patch(`/v1/admin/classifieds/banners/${made.json.id}`, { enabled: false })).status, 403);
    assert.equal((await operations.delete(`/v1/admin/classifieds/banners/${made.json.id}`)).json.deleted, true);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'banner.deleted', targetId: made.json.id } }));
    assert.equal((await operations.delete(`/v1/admin/classifieds/banners/${made.json.id}`)).status, 404);
  });

  test("the account dashboard's three places: each read on its own, never another place's", async () => {
    await prisma.classifiedBanner.deleteMany();
    const made = {};
    for (const position of ['dashboard_top', 'dashboard_side', 'dashboard_main']) {
      const res = await operations.post('/v1/admin/classifieds/banners', banner({ position, alt: `Banner ${position}` }));
      assert.equal(res.status, 201, JSON.stringify(res.json));
      made[position] = res.json.id;
    }
    for (const position of ['dashboard_top', 'dashboard_side', 'dashboard_main']) {
      const read = await (await fetch(`${server.base}/v1/classifieds/banners?position=${position}&country=NG`)).json();
      assert.deepEqual(read.data.map(item => item.id), [made[position]]);
    }
    assert.deepEqual((await showing('NG')).json.data, [], 'the account rail keeps its own');
    assert.deepEqual((await support.get('/v1/admin/classifieds/banners?position=dashboard_side')).json.data.map(item => item.id), [made.dashboard_side]);
  });

  test('the public read needs a known place, and resellers and signed-out callers cannot reach the admin routes', async () => {
    assert.equal((await fetch(`${server.base}/v1/classifieds/banners?position=nowhere`)).status, 400);
    assert.equal((await client(server.base).get('/v1/admin/classifieds/banners')).status, 401);
  });
});
