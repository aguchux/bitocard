// Profile photos (Udozo): a customer on udozo.com, a Seller HQ person and an admin each upload their own (a face, a
// logo or an icon) through a signed link into their own folder; the API checks the stored file before using it, shows it
// wherever the person is shown (their account, seller page, listings, team lists), deletes a replaced or removed one's
// file, never lets anyone use someone else's upload, and lets operations take a seller's photo off.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, resellerClient, startApp, testMobile } from './helpers.mjs';

/** A PNG header of the given size (the check reads the IHDR chunk). */
function png(width, height) {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** A fake Spaces bucket (path-style): PUTs, server-side copies, reads and deletes. */
async function fakeSpaces() {
  const objects = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    if (req.method === 'PUT' && req.headers['x-amz-copy-source']) {
      const source = objects.get(decodeURIComponent(String(req.headers['x-amz-copy-source']).split('/').slice(2).join('/')));
      if (!source) return res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
      objects.set(key, { body: source.body, type: req.headers['content-type'] });
      return res.writeHead(200).end('<CopyObjectResult></CopyObjectResult>');
    }
    if (req.method === 'PUT') {
      objects.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] });
      return res.writeHead(200).end();
    }
    const object = objects.get(key);
    if (req.method === 'DELETE') {
      objects.delete(key);
      return res.writeHead(204).end();
    }
    if (!object) return res.writeHead(404).end();
    if (req.method === 'HEAD') return res.writeHead(200, { 'content-length': object.body.length, 'content-type': object.type }).end();
    const range = /bytes=0-(\d+)/.exec(req.headers.range ?? '');
    res.writeHead(range ? 206 : 200, { 'content-type': object.type }).end(range ? object.body.subarray(0, Number(range[1]) + 1) : object.body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, objects, close: () => new Promise(resolve => server.close(resolve)) };
}

let server;
let spaces;
let prisma;
let admin;

before(async () => {
  spaces = await fakeSpaces();
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      SPACES_KEY: 'DO00TESTKEY',
      SPACES_SECRET: 'test-secret',
      SPACES_BUCKET: 'udozo-media',
      SPACES_REGION: 'nyc3',
      SPACES_ENDPOINT: spaces.url,
      SPACES_PUBLIC_URL: 'https://media.udozo.test',
      SPACES_ROOT: 'test',
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(async () => {
  await server?.close();
  await spaces?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `avatar-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `avatar${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** Uploads like the apps do: ask for a link, PUT the bytes with its headers, then set it. */
async function upload(api, prefix, bytes = png(400, 400)) {
  const created = await api.post(`${prefix}/uploads`, { filename: 'me.png', content_type: 'image/png', size: bytes.length });
  if (created.status !== 201) return { created };
  await fetch(created.json.upload.url, { method: 'PUT', headers: created.json.upload.headers, body: bytes });
  const set = await api.post(prefix, { media_id: created.json.id });
  return { created, set };
}

describe('profile photos', () => {
  test('a customer uploads one into their own folder; it is checked, shown on their account, seller page and listings', async () => {
    const seller = await customer('Chinedu Okafor');
    assert.equal((await seller.get('/v1/store/account')).json.avatar_url, null, 'initials until they add one');
    const settings = await seller.get('/v1/store/account/avatar/settings');
    assert.deepEqual([settings.json.configured, settings.json.purposes.map(item => item.purpose)], [true, ['avatar', 'profile_banner']]);

    const refused = await seller.post('/v1/store/account/avatar/uploads', { filename: 'me.svg', content_type: 'image/svg+xml', size: 100 });
    assert.equal(refused.json.error.code, 'unsupported_file_type', 'never an SVG');
    assert.equal((await seller.post('/v1/store/account/avatar/uploads', { filename: 'me.png', content_type: 'image/png', size: 3 * 1024 * 1024 })).json.error.code, 'file_too_large');

    const first = await upload(seller, '/v1/store/account/avatar');
    assert.equal(first.created.status, 201, JSON.stringify(first.created.json));
    assert.equal(first.created.json.folder, `test/people/customers/${seller.id}/avatars`);
    assert.deepEqual([first.set.status, first.set.json.avatar_url], [200, first.created.json.url]);
    assert.equal((await seller.get('/v1/store/account')).json.avatar_url, first.created.json.url);

    // Shown wherever they are shown as a seller.
    const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
    const draft = (await seller.post('/v1/classifieds/listings', { title: 'Hisense 50 inch TV', price: 25000000, condition: 'used', category_id: cat.id, area_id: area.id, contact: 'both' })).json;
    await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
    const listing = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
    const { sellerHandle } = await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } });
    assert.equal((await storeServer().get(`/v1/classifieds/sellers/${sellerHandle}`)).json.avatar_url, first.created.json.url);
    assert.equal((await storeServer().get(`/v1/classifieds/listings/${listing.ref}?country=NG`)).json.seller.avatar_url, first.created.json.url);

    // A new one replaces it, and the old file is deleted.
    const firstKey = `test/people/customers/${seller.id}/avatars/${first.created.json.id}.png`;
    assert.ok(spaces.objects.has(firstKey));
    const second = await upload(seller, '/v1/store/account/avatar');
    assert.equal(second.set.json.avatar_url, second.created.json.url);
    assert.ok(!spaces.objects.has(firstKey), 'the old photo is gone from storage');
    assert.equal(await prisma.mediaAsset.count({ where: { id: first.created.json.id } }), 0);

    // Removing it shows their initials again and deletes the file.
    const removed = await seller.del('/v1/store/account/avatar');
    assert.deepEqual([removed.status, removed.json.avatar_url], [200, null]);
    assert.equal((await seller.get('/v1/store/account')).json.avatar_url, null);
    assert.equal(await prisma.mediaAsset.count({ where: { purpose: 'avatar', uploadedById: seller.id } }), 0);
  });

  test("never someone else's upload; a file that is not the image it claims, or too small, is refused", async () => {
    const ada = await customer('Ada Obi');
    const bola = await customer('Bola Ade');
    const created = await ada.post('/v1/store/account/avatar/uploads', { filename: 'me.png', content_type: 'image/png', size: 64 });
    await fetch(created.json.upload.url, { method: 'PUT', headers: created.json.upload.headers, body: png(400, 400) });
    assert.equal((await bola.post('/v1/store/account/avatar', { media_id: created.json.id })).status, 404, "another customer's upload is unknown");
    assert.equal((await storeServer().post('/v1/store/account/avatar/uploads', { filename: 'me.png', content_type: 'image/png', size: 64 })).status, 401);

    const fake = await upload(ada, '/v1/store/account/avatar', Buffer.concat([Buffer.from('<html>'), Buffer.alloc(58)]));
    assert.equal(fake.set.json.error.code, 'upload_invalid');
    const tiny = await upload(ada, '/v1/store/account/avatar', png(20, 20));
    assert.equal(tiny.set.json.error.code, 'avatar_too_small');
    assert.equal((await ada.get('/v1/store/account')).json.avatar_url, null);
  });

  test("Seller HQ's people and admins have their own, shown on their session and team lists", async () => {
    const owner = await resellerClient(server);
    const shq = await upload(owner.browser, '/v1/auth/avatar');
    assert.equal(shq.set.status, 200, JSON.stringify(shq.set.json));
    assert.match(shq.created.json.folder, new RegExp(`people/users/${owner.userId}/avatars$`));
    assert.equal((await owner.browser.get('/v1/auth/session')).json.user.avatar_url, shq.set.json.avatar_url);
    const team = await owner.browser.get('/v1/team', undefined, { 'bitocard-reseller': owner.resellerId });
    assert.equal(team.json.members[0].avatar_url, shq.set.json.avatar_url);

    const mine = await upload(admin, '/v1/admin/auth/avatar');
    assert.equal(mine.set.status, 200, JSON.stringify(mine.set.json));
    assert.equal((await admin.get('/v1/admin/auth/session')).json.admin.avatar_url, mine.set.json.avatar_url);
    assert.equal((await admin.delete('/v1/admin/auth/avatar')).json.avatar_url, null);
    assert.equal((await admin.get('/v1/admin/auth/session')).json.admin.avatar_url, null);
    // An admin's photo upload is not a reseller's to use.
    assert.equal((await owner.browser.post('/v1/auth/avatar', { media_id: mine.created.json.id })).status, 404);
  });

  test('a customer puts a cover across their seller page: 4:1, at least 600 by 150, replaced and removed like their photo', async () => {
    const seller = await customer('Kemi Adeyemi');
    const { sellerHandle } = await prisma.customer.findUniqueOrThrow({ where: { id: seller.id } });
    assert.equal((await storeServer().get(`/v1/classifieds/sellers/${sellerHandle}`)).json.banner_url, null, "Udozo's own banner until they add one");

    const first = await upload(seller, '/v1/store/account/banner', png(1600, 400));
    assert.equal(first.created.status, 201, JSON.stringify(first.created.json));
    assert.equal(first.created.json.folder, `test/people/customers/${seller.id}/banners`);
    assert.deepEqual([first.set.status, first.set.json.banner_url], [200, first.created.json.url]);
    assert.equal((await seller.get('/v1/store/account')).json.banner_url, first.created.json.url);
    assert.equal((await storeServer().get(`/v1/classifieds/sellers/${sellerHandle}`)).json.banner_url, first.created.json.url);
    assert.equal((await seller.get('/v1/store/account')).json.avatar_url, null, 'the photo is untouched');

    // Too small, or a profile photo's upload, is never a cover; a cover's upload is never a photo.
    assert.equal((await upload(seller, '/v1/store/account/banner', png(500, 120))).set.json.error.code, 'banner_too_small');
    assert.equal((await seller.post('/v1/store/account/banner/uploads', { filename: 'c.png', content_type: 'image/png', size: 4 * 1024 * 1024 })).json.error.code, 'file_too_large');
    const photo = await seller.post('/v1/store/account/avatar/uploads', { filename: 'me.png', content_type: 'image/png', size: 64 });
    await fetch(photo.json.upload.url, { method: 'PUT', headers: photo.json.upload.headers, body: png(1600, 400) });
    assert.equal((await seller.post('/v1/store/account/banner', { media_id: photo.json.id })).status, 404);
    assert.equal((await seller.post('/v1/store/account/avatar', { media_id: first.created.json.id })).status, 404);

    // A new one replaces it (the old file deleted); removing it brings Udozo's banner back.
    const firstKey = `test/people/customers/${seller.id}/banners/${first.created.json.id}.png`;
    assert.ok(spaces.objects.has(firstKey));
    const second = await upload(seller, '/v1/store/account/banner', png(2000, 500));
    assert.equal(second.set.json.banner_url, second.created.json.url);
    assert.ok(!spaces.objects.has(firstKey), 'the old cover is gone from storage');
    const removed = await seller.del('/v1/store/account/banner');
    assert.deepEqual([removed.status, removed.json.banner_url], [200, null]);
    assert.equal(await prisma.mediaAsset.count({ where: { purpose: 'profile_banner', uploadedById: seller.id } }), 0);

    // Seller HQ's people have no cover.
    const owner = await resellerClient(server);
    assert.equal((await owner.browser.post('/v1/auth/banner/uploads', { filename: 'c.png', content_type: 'image/png', size: 64 })).status, 404);
  });

  test('operations take a seller’s cover off, audited, and the seller is told', async () => {
    const seller = await customer('Tunde Bakare');
    const { set } = await upload(seller, '/v1/store/account/banner', png(1600, 400));
    assert.equal((await admin.get(`/v1/admin/classifieds/sellers/${seller.id}`)).json.banner_url, set.json.banner_url);
    const removed = await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/banner/remove`, { reason: 'Shows a phone number' });
    assert.deepEqual([removed.status, removed.json.banner_url], [200, null]);
    assert.equal((await seller.get('/v1/store/account')).json.banner_url, null);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.seller_banner_removed', targetId: seller.id } }), 1);
    assert.equal(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.banner_removed' } }), 1);
  });

  test('operations take a seller’s photo off, audited', async () => {
    const seller = await customer('Musa Bello');
    const { set } = await upload(seller, '/v1/store/account/avatar');
    const view = await admin.get(`/v1/admin/classifieds/sellers/${seller.id}`);
    assert.equal(view.json.avatar_url, set.json.avatar_url);
    assert.match(view.json.handle, /^[a-z0-9]{10}$/);
    const removed = await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/avatar/remove`, { reason: 'Not a photo of the seller' });
    assert.deepEqual([removed.status, removed.json.avatar_url], [200, null]);
    assert.equal((await seller.get('/v1/store/account')).json.avatar_url, null);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.seller_avatar_removed', targetId: seller.id } }), 1);
  });
});
