// Uploaded logos, icons and images: AWS Signature V4 (checked against AWS's published examples), image checks, and the
// signed-upload flow against a fake DigitalOcean Spaces bucket: folders, size and type locked by the signature, files
// read back and checked before use, the library, reuse checks before deleting, resellers kept to their own folder,
// and the image fields on brands, products, suppliers and categories.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, resellerClient, startApp } from './helpers.mjs';
import { fakeReloadly } from './fakes.mjs';

const { presign, signRequest, emptyPayloadHash } = await import('../dist/media/sigv4.js');
const { inspectImage, svgProblem } = await import('../dist/media/images.js');

/** A 2x3 PNG header (enough for the check, which reads the IHDR chunk). */
function png(width = 2, height = 3) {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** A minimal JPEG: SOI, an APP0 segment, then a baseline frame header with the size. */
function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(16)]);
}

const credentials = { accessKey: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };

describe('Signature V4', () => {
  test('a presigned link matches AWS’s published example', () => {
    const url = presign({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), credentials, expiresIn: 86400, now: new Date('2013-05-24T00:00:00Z') });
    assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
    assert.match(url, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/);
  });

  test('a signed request matches AWS’s published example', () => {
    const headers = signRequest({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), headers: { range: 'bytes=0-9' }, credentials, payloadHash: emptyPayloadHash, now: new Date('2013-05-24T00:00:00Z') });
    assert.equal(
      headers.authorization,
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

describe('image checks', () => {
  test('reads PNG, JPEG and WebP sizes and refuses content that is not the declared type', () => {
    assert.deepEqual(inspectImage(png(200, 100), 'image/png'), { type: 'image/png', width: 200, height: 100 });
    assert.deepEqual(inspectImage(jpeg(640, 480), 'image/jpeg'), { type: 'image/jpeg', width: 640, height: 480 });
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'latin1');
    webp.write('WEBP', 8, 'latin1');
    webp.write('VP8X', 12, 'latin1');
    webp.writeUIntLE(299, 24, 3);
    webp.writeUIntLE(149, 27, 3);
    assert.deepEqual(inspectImage(webp, 'image/webp'), { type: 'image/webp', width: 300, height: 150 });
    assert.equal(inspectImage(png(), 'image/jpeg'), null, 'a PNG declared as JPEG');
    assert.equal(inspectImage(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'), null);
  });

  test('accepts plain SVG drawings only', () => {
    const plain = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><path d="M0 0h48v24H0z" fill="url(#g)"/></svg>';
    assert.equal(svgProblem(plain), null);
    assert.deepEqual(inspectImage(Buffer.from(plain), 'image/svg+xml'), { type: 'image/svg+xml', width: 48, height: 24 });
    for (const [svg, problem] of [
      ['<svg><script>alert(1)</script></svg>', 'contains a script'],
      ['<svg onload="alert(1)"></svg>', 'contains event handlers'],
      ['<svg><foreignObject><div/></foreignObject></svg>', 'contains embedded HTML'],
      ['<svg><a href="javascript:alert(1)"/></svg>', 'contains a script link'],
      ['<svg><image href="https://tracker.example/x.png"/></svg>', 'refers to outside files'],
      ['<svg><rect style="fill:url(https://x.example/a)"/></svg>', 'refers to outside files'],
      ['<!DOCTYPE svg [<!ENTITY x "y">]><svg/>', 'not an SVG image'],
      ['<html><svg/></html>', 'not an SVG image'],
    ]) {
      assert.equal(svgProblem(svg), problem, svg);
    }
  });
});

/**
 * A fake Spaces bucket (path-style: /<bucket>/<key>). Presigned PUTs are checked by signing the request the browser
 * actually sent, so a different size or type fails just as it would at DigitalOcean.
 */
async function fakeSpaces(spacesCredentials) {
  const objects = new Map();
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    calls.push({ method: req.method, key, headers: req.headers, query: url.search, body: body.toString('utf8') });
    if (req.method === 'PUT' && url.searchParams.has('cors')) {
      res.writeHead(String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 ') && req.headers['content-md5'] ? 200 : 403).end();
      return;
    }
    if (req.method === 'PUT') {
      const given = url.searchParams.get('X-Amz-Signature');
      const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';').filter(name => name !== 'host');
      const unsigned = new URL(url);
      for (const name of [...unsigned.searchParams.keys()]) if (name.startsWith('X-Amz-')) unsigned.searchParams.delete(name);
      const date = url.searchParams.get('X-Amz-Date');
      const now = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`);
      const headers = Object.fromEntries(signed.map(name => [name, String(req.headers[name] ?? '')]));
      const expected = new URL(presign({ method: 'PUT', url: unsigned, headers, credentials: spacesCredentials, expiresIn: Number(url.searchParams.get('X-Amz-Expires')), now })).searchParams.get('X-Amz-Signature');
      if (!given || given !== expected || !signed.includes('content-length')) {
        res.writeHead(403).end('SignatureDoesNotMatch');
        return;
      }
      objects.set(key, { body, type: req.headers['content-type'], acl: req.headers['x-amz-acl'], cache: req.headers['cache-control'] });
      res.writeHead(200).end();
      return;
    }
    if (!String(req.headers.authorization ?? '').startsWith(`AWS4-HMAC-SHA256 Credential=${spacesCredentials.accessKey}/`)) {
      res.writeHead(403).end();
      return;
    }
    const object = objects.get(key);
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
      return;
    }
    if (!object) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-length': object.body.length, 'content-type': object.type }).end();
      return;
    }
    const range = /bytes=0-(\d+)/.exec(req.headers.range ?? '');
    const slice = range ? object.body.subarray(0, Number(range[1]) + 1) : object.body;
    res.writeHead(range ? 206 : 200, { 'content-type': object.type }).end(slice);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, objects, calls, close: () => new Promise(resolve => server.close(resolve)) };
}

/** Uploads like the apps do: ask for a link, PUT the bytes with the signed headers, then ask for the check. */
async function upload(api, prefix, request, bytes) {
  const created = await api.post(`${prefix}/uploads`, { filename: 'logo.png', content_type: 'image/png', size: bytes.length, ...request });
  if (created.status !== 201) return { created };
  const put = await fetch(created.json.upload.url, { method: 'PUT', headers: created.json.upload.headers, body: bytes });
  const completed = await api.post(`${prefix}/${created.json.id}/complete`);
  return { created, put, completed };
}

describe('signed uploads', () => {
  const spacesCredentials = { accessKey: 'DO00TESTKEY', secret: 'test-secret', region: 'nyc3' };
  let spaces;
  let reloadly;
  let server;
  let admin;
  let prisma;

  before(async () => {
    spaces = await fakeSpaces(spacesCredentials);
    reloadly = await fakeReloadly();
    server = await startApp({
      env: {
        ...reloadly.env,
        ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        SPACES_KEY: spacesCredentials.accessKey,
        SPACES_SECRET: spacesCredentials.secret,
        SPACES_BUCKET: 'bitocard-media',
        SPACES_REGION: 'nyc3',
        SPACES_ENDPOINT: spaces.url,
        SPACES_PUBLIC_URL: 'https://media.bitocard.test',
        SPACES_ROOT: 'test',
      },
    });
    admin = await adminClient(server);
    prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
    assert.equal((await admin.post('/v1/admin/suppliers/reloadly/sync')).status, 200);
  });

  after(async () => {
    await server?.close();
    await reloadly?.close();
    await spaces?.close();
  });

  test('admins upload a brand logo into its folder; the file is checked, public and used by the brand', async () => {
    const settings = await admin.get('/v1/admin/media/settings');
    assert.equal(settings.json.configured, true);
    assert.ok(settings.json.purposes.some(item => item.purpose === 'brand_logo' && item.content_types.includes('image/svg+xml')));
    assert.ok(!settings.json.purposes.some(item => item.purpose === 'store_logo'), 'reseller purposes are not offered to admins');

    const bytes = png(256, 256);
    const { created, put, completed } = await upload(admin, '/v1/admin/media', { purpose: 'brand_logo', target_id: 'Amazon' }, bytes);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.folder, 'test/platform/brands/amazon/logos');
    assert.equal(created.json.url, `https://media.bitocard.test/test/platform/brands/amazon/logos/${created.json.id}.png`);
    assert.equal(created.json.upload.method, 'PUT');
    assert.ok(created.json.upload.url.startsWith(`${spaces.url}/bitocard-media/test/platform/brands/amazon/logos/`));
    assert.match(created.json.upload.url, /X-Amz-SignedHeaders=cache-control%3Bcontent-length%3Bcontent-type%3Bhost%3Bx-amz-acl/);
    assert.equal(put.status, 200);
    const stored = spaces.objects.get(`test/platform/brands/amazon/logos/${created.json.id}.png`);
    assert.deepEqual([stored.acl, stored.cache, stored.type], ['public-read', 'public, max-age=31536000, immutable', 'image/png']);

    assert.equal(completed.status, 200, JSON.stringify(completed.json));
    assert.deepEqual([completed.json.status, completed.json.width, completed.json.height, completed.json.purpose, completed.json.target_id], ['ready', 256, 256, 'brand_logo', 'amazon']);
    const again = await admin.post(`/v1/admin/media/${created.json.id}/complete`);
    assert.deepEqual([again.status, again.json.status], [200, 'ready'], 'checking again is harmless');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'media.uploaded', targetId: created.json.id } }));

    const saved = await admin.put('/v1/admin/storefront/brands/amazon', { name: 'Amazon', logo_url: completed.json.url });
    assert.equal(saved.json.logo_url, completed.json.url);
    const listed = await admin.get('/v1/admin/media?purpose=brand_logo&target_id=amazon');
    assert.deepEqual(listed.json.data.find(item => item.id === created.json.id).in_use, ['brand:amazon:logo']);

    const refused = await admin.delete(`/v1/admin/media/${created.json.id}`);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'media_in_use']);
    await admin.put('/v1/admin/storefront/brands/amazon', { name: 'Amazon', logo_url: null });
    const removed = await admin.delete(`/v1/admin/media/${created.json.id}`);
    assert.deepEqual([removed.status, removed.json.deleted], [200, true]);
    assert.ok(!spaces.objects.has(`test/platform/brands/amazon/logos/${created.json.id}.png`), 'deleted from storage');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'media.deleted', targetId: created.json.id } }));
  });

  test('brand registry logos are PNG or SVG, uploaded for any registry entry, even one with no products yet', async () => {
    const logo = await upload(admin, '/v1/admin/media', { purpose: 'registry_logo', target_id: 'dstv' }, png(200, 200));
    assert.equal(logo.completed.status, 200, JSON.stringify(logo.completed.json));
    assert.equal(logo.created.json.folder, 'test/platform/brands/dstv/logos');
    const saved = await admin.put('/v1/admin/storefront/registry/dstv', { logo_url: logo.completed.json.url });
    assert.equal(saved.json.logo_source, 'upload');
    assert.deepEqual((await admin.get(`/v1/admin/media?purpose=registry_logo`)).json.data.find(item => item.id === logo.created.json.id).in_use, ['registry:dstv:logo']);
    const webp = await admin.post('/v1/admin/media/uploads', { purpose: 'registry_logo', target_id: 'dstv', filename: 'x.webp', content_type: 'image/webp', size: 64 });
    assert.equal(webp.json.error.code, 'unsupported_file_type');
    const unknown = await admin.post('/v1/admin/media/uploads', { purpose: 'registry_logo', target_id: 'not-in-registry', filename: 'x.png', content_type: 'image/png', size: 64 });
    assert.equal(unknown.status, 404);
  });

  test('requests are checked: purpose, type, size and the target must exist', async () => {
    const request = body => admin.post('/v1/admin/media/uploads', { filename: 'x.png', content_type: 'image/png', size: 100, ...body });
    const cases = [
      [{ purpose: 'store_logo' }, 400, 'parameter_invalid'],
      [{ purpose: 'brand_logo' }, 400, 'parameter_missing'],
      [{ purpose: 'brand_logo', target_id: 'no-such-brand' }, 404, 'resource_missing'],
      [{ purpose: 'brand_card', target_id: 'amazon', content_type: 'image/svg+xml' }, 400, 'unsupported_file_type'],
      [{ purpose: 'brand_card', target_id: 'amazon', content_type: 'text/html' }, 400, 'unsupported_file_type'],
      [{ purpose: 'brand_logo', target_id: 'amazon', size: 2 * 1024 * 1024 }, 400, 'file_too_large'],
      [{ purpose: 'category_icon', target_id: 'not_a_category' }, 404, 'resource_missing'],
    ];
    for (const [body, status, code] of cases) {
      const res = await request(body);
      assert.deepEqual([res.status, res.json.error?.code], [status, code], JSON.stringify(body));
    }
  });

  test('the signature locks the size, and a file that is not the declared image is thrown away', async () => {
    const created = await admin.post('/v1/admin/media/uploads', { purpose: 'storefront_image', filename: 'hero.png', content_type: 'image/png', size: 64 });
    const bigger = await fetch(created.json.upload.url, { method: 'PUT', headers: created.json.upload.headers, body: Buffer.concat([png(), Buffer.alloc(10)]) });
    assert.equal(bigger.status, 403, 'a different size does not match the signature');
    const notYet = await admin.post(`/v1/admin/media/${created.json.id}/complete`);
    assert.deepEqual([notYet.status, notYet.json.error.code], [409, 'upload_missing']);

    const fake = Buffer.alloc(64, 'a');
    const disguised = await upload(admin, '/v1/admin/media', { purpose: 'storefront_image', filename: 'evil.png' }, fake);
    assert.equal(disguised.put.status, 200);
    assert.deepEqual([disguised.completed.status, disguised.completed.json.error.code], [400, 'upload_invalid']);
    assert.ok(!spaces.objects.has(`test/platform/storefront/images/${disguised.created.json.id}.png`), 'removed from storage');
    assert.equal(await prisma.mediaAsset.count({ where: { id: disguised.created.json.id } }), 0);
  });

  test('SVG logos are accepted from admins only when they are plain drawings', async () => {
    const clean = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30"/></svg>');
    const ok = await upload(admin, '/v1/admin/media', { purpose: 'supplier_logo', target_id: 'reloadly', filename: 'reloadly.svg', content_type: 'image/svg+xml' }, clean);
    assert.equal(ok.completed.status, 200, JSON.stringify(ok.completed.json));
    assert.equal(ok.created.json.folder, 'test/platform/suppliers/reloadly/logos');
    assert.deepEqual([ok.completed.json.width, ok.completed.json.height], [64, 64]);
    const patched = await admin.patch('/v1/admin/suppliers/reloadly', { logo_url: ok.completed.json.url });
    assert.equal(patched.json.logo_url, ok.completed.json.url);

    const scripted = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>');
    const bad = await upload(admin, '/v1/admin/media', { purpose: 'supplier_logo', target_id: 'reloadly', filename: 'bad.svg', content_type: 'image/svg+xml' }, scripted);
    assert.deepEqual([bad.completed.status, bad.completed.json.error.code], [400, 'upload_invalid']);
    assert.match(bad.completed.json.error.message, /no scripts/);
  });

  test('product images and category icons are shown on the store', async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { brand: 'amazon' } });
    const image = await upload(admin, '/v1/admin/media', { purpose: 'product_image', target_id: product.key }, png(400, 250));
    assert.equal(image.completed.status, 200, JSON.stringify(image.completed.json));
    assert.equal(image.created.json.folder, `test/platform/products/${product.key.split(':').join('/').toLowerCase()}`);
    const patched = await admin.patch(`/v1/admin/products/${product.id}`, { image_url: image.completed.json.url, listed: true });
    assert.equal(patched.json.image_url, image.completed.json.url);
    const shown = await client(server.base).get(`/v1/store/products/${encodeURIComponent(product.key)}`);
    assert.equal(shown.json.logo_url, image.completed.json.url, 'the admin image replaces the supplier logo');
    const http = await admin.patch(`/v1/admin/products/${product.id}`, { image_url: 'http://insecure.example/x.png' });
    assert.equal(http.status, 400);

    const icon = await upload(admin, '/v1/admin/media', { purpose: 'category_icon', target_id: 'gift_cards' }, png(96, 96));
    assert.equal(icon.created.json.folder, 'test/platform/categories/gift_cards/icons');
    const saved = await admin.put('/v1/admin/storefront/categories/gift_cards', { icon_url: icon.completed.json.url });
    assert.deepEqual([saved.status, saved.json.icon_url], [200, icon.completed.json.url]);
    const categories = await client(server.base).get('/v1/store/categories');
    assert.equal(categories.json.data.find(item => item.category === 'gift_cards').icon_url, icon.completed.json.url);
    const admins = await admin.get('/v1/admin/storefront/categories');
    assert.equal(admins.json.data.length, 10, 'every category, on sale or not');
  });

  test('resellers upload store images into their own folder and never see anyone else’s files', async () => {
    const owner = await resellerClient(server);
    const other = await resellerClient(server, { business: 'Other Shop' });
    const settings = await owner.browser.get('/v1/media/settings');
    assert.deepEqual(settings.json.purposes.map(item => item.purpose).sort(), ['store_image', 'store_logo']);

    const logo = await upload(owner.browser, '/v1/media', { purpose: 'store_logo' }, jpeg(300, 120));
    assert.deepEqual([logo.completed.status, logo.completed.json.error.code], [400, 'upload_invalid'], 'a JPEG declared as PNG is refused');
    const declared = await upload(owner.browser, '/v1/media', { purpose: 'store_logo', filename: 'logo.jpg', content_type: 'image/jpeg' }, jpeg(300, 120));
    assert.equal(declared.completed.status, 200, JSON.stringify(declared.completed.json));
    assert.equal(declared.created.json.folder, `test/resellers/${owner.resellerId}/store/logos`);
    assert.deepEqual([declared.completed.json.width, declared.completed.json.height], [300, 120]);

    for (const purpose of ['brand_logo', 'storefront_image']) {
      const refused = await owner.browser.post('/v1/media/uploads', { purpose, target_id: 'amazon', filename: 'x.png', content_type: 'image/png', size: 64 });
      assert.deepEqual([refused.status, refused.json.error.code], [400, 'parameter_invalid'], purpose);
    }
    const svg = await owner.browser.post('/v1/media/uploads', { purpose: 'store_logo', filename: 'x.svg', content_type: 'image/svg+xml', size: 64 });
    assert.deepEqual([svg.status, svg.json.error.code], [400, 'unsupported_file_type'], 'no SVG from resellers');

    assert.deepEqual((await owner.browser.get('/v1/media')).json.data.map(item => item.id), [declared.created.json.id]);
    assert.deepEqual((await other.browser.get('/v1/media')).json.data, []);
    assert.equal((await other.browser.post(`/v1/media/${declared.created.json.id}/complete`)).status, 404);
    assert.equal((await other.browser.delete(`/v1/media/${declared.created.json.id}`)).status, 404);
    const platformAsset = await prisma.mediaAsset.findFirstOrThrow({ where: { resellerId: null, status: 'ready' } });
    assert.equal((await owner.browser.delete(`/v1/media/${platformAsset.id}`)).status, 404, 'platform files are not resellers’ to delete');

    const resellers = await admin.get('/v1/admin/media?owner=resellers');
    assert.ok(resellers.json.data.some(item => item.id === declared.created.json.id));
    assert.ok((await admin.get('/v1/admin/media?owner=platform')).json.data.every(item => !item.folder.includes('/resellers/')));
    const key = await client(server.base, { autoIdempotency: true }).post('/v1/media/uploads', { purpose: 'store_logo', filename: 'x.png', content_type: 'image/png', size: 64 });
    assert.equal(key.status, 401, 'signed-in only');
  });

  test('npm run media:cors sets the bucket’s CORS rule for the apps', async () => {
    const script = fileURLToPath(new URL('../scripts/media-cors.mjs', import.meta.url));
    const env = { ...process.env, SPACES_KEY: spacesCredentials.accessKey, SPACES_SECRET: spacesCredentials.secret, SPACES_BUCKET: 'bitocard-media', SPACES_ENDPOINT: spaces.url };
    const { stdout } = await promisify(execFile)(process.execPath, [script, 'https://admin.example', 'https://shq.example'], { env });
    assert.match(stdout, /CORS set on bitocard-media for: https:\/\/admin.example, https:\/\/shq.example/);
    const call = spaces.calls.findLast(item => item.query === '?cors=');
    assert.equal(call.method, 'PUT');
    for (const part of ['<AllowedOrigin>https://admin.example</AllowedOrigin>', '<AllowedMethod>PUT</AllowedMethod>', '<AllowedHeader>x-amz-acl</AllowedHeader>']) assert.ok(call.body.includes(part), part);
  });

  test('abandoned uploads are cleaned up by the daily job', async () => {
    const created = await admin.post('/v1/admin/media/uploads', { purpose: 'storefront_image', filename: 'never.png', content_type: 'image/png', size: 64 });
    await fetch(created.json.upload.url, { method: 'PUT', headers: created.json.upload.headers, body: png() });
    await prisma.mediaAsset.update({ where: { id: created.json.id }, data: { expiresAt: new Date(Date.now() - 2 * 3600_000) } });
    const { MediaService } = await import('../dist/media/media.service.js');
    const result = await server.app.get(MediaService).purgeAbandoned();
    assert.ok(result.removed >= 1);
    assert.equal(await prisma.mediaAsset.count({ where: { id: created.json.id } }), 0);
    assert.ok(!spaces.objects.has(`test/platform/storefront/images/${created.json.id}.png`));
  });
});

describe('without file storage', () => {
  let server;
  let admin;

  before(async () => {
    server = await startApp({ env: { ENCRYPTION_KEY: randomBytes(32).toString('base64') } });
    admin = await adminClient(server);
  });

  after(async () => {
    await server?.close();
  });

  test('uploads are switched off with a clear error, and image addresses can still be typed in', async () => {
    assert.equal((await admin.get('/v1/admin/media/settings')).json.configured, false);
    const res = await admin.post('/v1/admin/media/uploads', { purpose: 'storefront_image', filename: 'x.png', content_type: 'image/png', size: 64 });
    assert.deepEqual([res.status, res.json.error.code], [503, 'storage_not_configured']);
    const saved = await admin.put('/v1/admin/storefront/categories/airtime', { icon_url: 'https://cdn.example/airtime.svg' });
    assert.equal(saved.json.icon_url, 'https://cdn.example/airtime.svg');
  });
});
