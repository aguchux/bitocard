// A top category's own pictures on udozo.com (8 November 2026, the owner's request): a banner across the top of its
// pages and a spotlight image drawn on a circle beside its name, uploaded by operations on Marketplace > Categories.
// Subcategories have neither: their pages show their top category's banner.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, startApp } from './helpers.mjs';

let server;
let prisma;
let visitor;
let operations;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  operations = await adminClient(server, ['operations']);
  assert.equal((await operations.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  visitor = client(server.base);
});

after(() => server?.close());

const banner = 'https://cdn.example.com/test/platform/classifieds/categories/home-garden/banners/a.webp';
const spotlight = 'https://cdn.example.com/test/platform/classifieds/categories/home-garden/spotlights/b.png';

describe('category pictures', () => {
  test('operations set and remove a top category’s banner and spotlight image (audited); udozo.com reads them', async () => {
    const list = (await operations.get('/v1/admin/classifieds/categories?country=NG')).json.data;
    const top = list.find(row => row.slug === 'home-garden');
    assert.equal(top.banner_url, null);
    assert.equal(top.spotlight_url, null);

    const saved = await operations.patch(`/v1/admin/classifieds/categories/${top.id}`, { banner_url: banner, spotlight_url: spotlight });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.banner_url, banner);
    assert.equal(saved.json.spotlight_url, spotlight);
    assert.equal(saved.json.enabled, top.enabled, 'nothing else changes');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'classifieds.category_changed', targetId: top.id }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([audit.before.banner_url, audit.after.banner_url, audit.after.spotlight_url], [null, banner, spotlight]);

    const shop = (await visitor.get('/v1/classifieds/categories?country=NG')).json.data.find(row => row.slug === 'home-garden');
    assert.equal(shop.banner_url, banner);
    assert.equal(shop.spotlight_url, spotlight);
    assert.equal(shop.children[0].banner_url, null, 'subcategories have none of their own');

    const removed = await operations.patch(`/v1/admin/classifieds/categories/${top.id}`, { spotlight_url: null });
    assert.equal(removed.json.spotlight_url, null);
    assert.equal(removed.json.banner_url, banner, 'the banner stays');
  });

  test('only top categories, only https addresses, only operations', async () => {
    const list = (await operations.get('/v1/admin/classifieds/categories?country=NG')).json.data;
    const top = list.find(row => row.slug === 'fashion');
    const child = top.children[0];
    const refused = await operations.patch(`/v1/admin/classifieds/categories/${child.id}`, { banner_url: banner });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error.param, 'banner_url');
    assert.equal((await operations.patch(`/v1/admin/classifieds/categories/${top.id}`, { spotlight_url: 'http://cdn.example.com/x.png' })).status, 400);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.patch(`/v1/admin/classifieds/categories/${top.id}`, { banner_url: banner })).status, 403);
  });

  test('uploads are for a top category by its slug', async () => {
    const request = (purpose, target_id) => operations.post('/v1/admin/media/uploads', { purpose, target_id, filename: 'x.png', content_type: 'image/png', size: 64 });
    const fashion = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'fashion' }, include: { children: true } });
    assert.equal((await request('classified_category_banner', fashion.children[0].slug)).status, 404, 'a subcategory has none');
    assert.equal((await request('classified_category_spotlight', 'no-such-category')).status, 404);
    assert.notEqual((await request('classified_category_spotlight', 'fashion')).status, 404);
    assert.equal((await operations.post('/v1/admin/media/uploads', { purpose: 'classified_category_banner', target_id: 'fashion', filename: 'x.gif', content_type: 'image/gif', size: 64 })).json.error.code, 'unsupported_file_type');
  });
});
