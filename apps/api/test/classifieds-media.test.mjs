// BitoCard Shop, phase 1 step 2b: a listing's photos (checked, metadata removed, published) and its one video
// (re-encoded after the reply; here by a stand-in for ffmpeg), reordering, removing, and the job failing stuck videos.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, fakeService, lastEmailCode, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;
let bucket;
let media;
const objects = new Map();

before(async () => {
  bucket = await fakeService(call => {
    const key = decodeURIComponent(new URL(call.url, 'http://x').pathname).replace(/^\/bitocard-media\//, '');
    if (call.method === 'PUT') {
      objects.set(key, { body: call.raw, acl: call.headers['x-amz-acl'], type: call.headers['content-type'] });
      return { status: 200, body: '' };
    }
    if (call.method === 'DELETE') {
      objects.delete(key);
      return { status: 204, body: '' };
    }
    return { status: 405, body: '' };
  });
  server = await startApp({
    env: { CRON_SECRET: 'cron-secret', SPACES_KEY: 'spaces-key', SPACES_SECRET: 'spaces-secret', SPACES_BUCKET: 'bitocard-media', SPACES_ENDPOINT: bucket.url, SPACES_PUBLIC_URL: 'https://media.bitocard.test', SPACES_ROOT: 'test' },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  media = server.app.get((await import('../dist/classifieds/media.service.js')).ListingMediaService);
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
});

after(async () => {
  await server?.close();
  await bucket?.close();
});

/** A JPEG of the given size carrying an EXIF block with a position (which must never be published). */
function jpeg({ width = 1600, height = 1200, tag = 'GPSDATA-IKEJA' } = {}) {
  const u16 = value => Buffer.from([value >> 8, value & 0xff]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(tag)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), u16(height), u16(width), Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00])]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}
const mp4 = () => Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64, 1)]);

function storeServer() {
  let token = null;
  const request = async (method, path, { body, form } = {}) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `shop-${Date.now()}-${Math.random()}` } : {}),
      },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get: path => request('GET', path),
    post: (path, body = {}) => request('POST', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    delete: path => request('DELETE', path),
    upload: (path, bytes, type, name = 'file') => {
      const form = new FormData();
      form.set('file', new Blob([bytes], { type }), name);
      return request('POST', path, { form });
    },
  };
}

let counter = 0;
async function seller() {
  const shopper = storeServer();
  const email = `media${(counter += 1)}-${Date.now()}@example.com`;
  assert.equal((await shopper.post('/v1/store/account/signup', { name: 'Ada Bello', email, password: 'correct horse battery', country: 'NG' })).status, 201);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  return shopper;
}

async function completeDraft(shopper) {
  const [category, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'yaba' } })]);
  const draft = await shopper.post('/v1/classifieds/listings', { title: 'LG 55 inch smart TV', category_id: category.id, area_id: area.id, price: 25000000, condition: 'used' });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  return draft.json;
}

const photo = (shopper, id, options) => shopper.upload(`/v1/classifieds/listings/${id}/photos`, jpeg(options), 'image/jpeg', 'IMG_0001.jpg');
const waitFor = async (check, label) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for ${label}`);
};

describe('photos', () => {
  test('checked from their bytes, published without their metadata, each once, up to the market limit', async () => {
    const shopper = await seller();
    const listing = await completeDraft(shopper);
    const bytes = jpeg();
    const added = await shopper.upload(`/v1/classifieds/listings/${listing.id}/photos`, bytes, 'image/jpeg', 'IMG_0001.jpg');
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual([added.json.kind, added.json.status, added.json.width, added.json.height, added.json.position], ['photo', 'ready', 1600, 1200, 0]);
    assert.match(added.json.url, new RegExp(`^https://media\\.bitocard\\.test/test/classifieds/ng/${listing.id}/[0-9a-f-]+\\.jpg$`));
    const stored = objects.get(new URL(added.json.url).pathname.slice(1));
    assert.ok(stored, 'published to the media bucket');
    assert.equal(stored.acl, 'public-read');
    assert.ok(!stored.body.includes(Buffer.from('GPSDATA')), 'the position in its metadata is gone');

    const again = await shopper.upload(`/v1/classifieds/listings/${listing.id}/photos`, bytes, 'image/jpeg', 'IMG_0001.jpg');
    assert.deepEqual([again.status, again.json.id], [201, added.json.id], 'the same photo sent twice is one photo');

    const small = await photo(shopper, listing.id, { width: 300, height: 200 });
    assert.deepEqual([small.status, small.json.error.code], [400, 'photo_too_small']);
    const fake = await shopper.upload(`/v1/classifieds/listings/${listing.id}/photos`, Buffer.from('<html>not a photo</html>'), 'image/jpeg');
    assert.deepEqual([fake.status, fake.json.error.code], [400, 'file_invalid']);
    const pdf = await shopper.upload(`/v1/classifieds/listings/${listing.id}/photos`, Buffer.from('%PDF-1.7\n%%EOF'), 'application/pdf');
    assert.equal(pdf.json.error.code, 'file_invalid', 'photos only');

    await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { maxPhotos: 4 } });
    try {
      for (let i = 0; i < 3; i += 1) assert.equal((await photo(shopper, listing.id)).status, 201);
      assert.equal((await photo(shopper, listing.id)).json.error.code, 'too_many_photos');
    } finally {
      await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { maxPhotos: 12 } });
    }
    const other = await seller();
    assert.equal((await photo(other, listing.id)).status, 404, "nobody adds photos to another's listing");
  });

  test('reordered (the first is the cover) and removed, never below the minimum once submitted', async () => {
    const shopper = await seller();
    const listing = await completeDraft(shopper);
    const photos = [];
    for (let i = 0; i < 4; i += 1) photos.push((await photo(shopper, listing.id)).json);
    const reversed = photos.map(p => p.id).reverse();
    assert.equal((await shopper.patch(`/v1/classifieds/listings/${listing.id}/photos`, { order: reversed.slice(1) })).json.error.code, 'parameter_invalid');
    const reordered = await shopper.patch(`/v1/classifieds/listings/${listing.id}/photos`, { order: reversed });
    assert.deepEqual(reordered.json.photos.map(p => p.id), reversed);

    const submitted = await shopper.post(`/v1/classifieds/listings/${listing.id}/submit`);
    assert.equal(submitted.json.status, 'pending_review', JSON.stringify(submitted.json));
    const below = await shopper.delete(`/v1/classifieds/listings/${listing.id}/media/${photos[0].id}`);
    assert.deepEqual([below.status, below.json.error.code], [400, 'photos_required']);
    assert.equal((await photo(shopper, listing.id)).status, 201);
    const key = new URL(photos[0].url).pathname.slice(1);
    assert.ok(objects.has(key));
    assert.equal((await shopper.delete(`/v1/classifieds/listings/${listing.id}/media/${photos[0].id}`)).status, 204);
    assert.ok(!objects.has(key), 'its file is removed from the bucket');
  });

  test("deleting a draft removes its photos' files", async () => {
    const shopper = await seller();
    const listing = await completeDraft(shopper);
    const added = (await photo(shopper, listing.id)).json;
    const key = new URL(added.url).pathname.slice(1);
    assert.ok(objects.has(key));
    assert.equal((await shopper.delete(`/v1/classifieds/listings/${listing.id}`)).status, 204);
    assert.ok(!objects.has(key));
  });
});

describe('the video', () => {
  test('accepted as processing, re-encoded after the reply, published with its poster; one per listing', async () => {
    const { VideoRefused } = await import('../dist/classifieds/video.js');
    let release;
    const gate = new Promise(resolve => (release = resolve));
    media.transcoder = {
      transcode: async input => {
        assert.equal(input.subarray(4, 8).toString(), 'ftyp', 'the upload reaches the transcoder');
        await gate;
        return { video: Buffer.from('re-encoded mp4'), poster: jpeg({ tag: 'GPSDATA-POSTER' }), durationMs: 24000, width: 1280, height: 720 };
      },
    };
    const shopper = await seller();
    const listing = await completeDraft(shopper);
    for (let i = 0; i < 4; i += 1) await photo(shopper, listing.id);

    const wrong = await shopper.upload(`/v1/classifieds/listings/${listing.id}/video`, jpeg(), 'video/mp4', 'clip.mp4');
    assert.deepEqual([wrong.status, wrong.json.error.code], [400, 'file_invalid']);
    const started = await shopper.upload(`/v1/classifieds/listings/${listing.id}/video`, mp4(), 'video/mp4', 'clip.mp4');
    assert.deepEqual([started.status, started.json.status], [202, 'processing'], JSON.stringify(started.json));
    assert.equal((await shopper.upload(`/v1/classifieds/listings/${listing.id}/video`, mp4(), 'video/mp4', 'clip.mp4')).json.error.code, 'video_exists');
    assert.equal((await shopper.post(`/v1/classifieds/listings/${listing.id}/submit`)).json.error.code, 'video_processing');

    release();
    await waitFor(async () => (await shopper.get(`/v1/classifieds/me/listings/${listing.id}`)).json.video.status === 'ready', 'the video');
    const { video } = (await shopper.get(`/v1/classifieds/me/listings/${listing.id}`)).json;
    assert.match(video.url, /\.mp4$/);
    assert.match(video.poster_url, /\.jpg$/);
    assert.equal(video.duration_ms, 24000);
    assert.equal(objects.get(new URL(video.url).pathname.slice(1)).type, 'video/mp4');
    assert.ok(!objects.get(new URL(video.poster_url).pathname.slice(1)).body.includes(Buffer.from('GPSDATA')), "the poster's metadata is gone too");
    assert.equal((await shopper.post(`/v1/classifieds/listings/${listing.id}/submit`)).json.status, 'pending_review');

    media.transcoder = { transcode: async () => Promise.reject(new VideoRefused('Videos can be at most 60 seconds long.')) };
    const second = await completeDraft(shopper);
    for (let i = 0; i < 4; i += 1) await photo(shopper, second.id);
    await shopper.upload(`/v1/classifieds/listings/${second.id}/video`, mp4(), 'video/mp4', 'long.mp4');
    await waitFor(async () => (await shopper.get(`/v1/classifieds/me/listings/${second.id}`)).json.video.status === 'failed', 'the refusal');
    const failed = (await shopper.get(`/v1/classifieds/me/listings/${second.id}`)).json.video;
    assert.equal(failed.failure_reason, 'Videos can be at most 60 seconds long.');
    assert.equal((await shopper.post(`/v1/classifieds/listings/${second.id}/submit`)).json.error.code, 'media_failed');
    assert.equal((await shopper.delete(`/v1/classifieds/listings/${second.id}/media/${failed.id}`)).status, 204);
    assert.equal((await shopper.post(`/v1/classifieds/listings/${second.id}/submit`)).json.status, 'pending_review');
  });

  test("sent by the seller's browser with an upload link: from any page, without cookies, only while the session lasts", async () => {
    media.transcoder = { transcode: async () => ({ video: Buffer.from('re-encoded mp4'), poster: jpeg(), durationMs: 9000, width: 1280, height: 720 }) };
    const shopper = await seller();
    const listing = await completeDraft(shopper);
    const link = await shopper.post(`/v1/classifieds/listings/${listing.id}/video-upload`);
    assert.equal(link.status, 200, JSON.stringify(link.json));
    assert.match(link.json.path, /^\/v1\/classifieds\/video-uploads\/bcv_up_[0-9a-f-]{36}\.[0-9a-f-]{36}\.\d{13}\.[\w-]+$/);
    assert.ok(Date.parse(link.json.expires_at) - Date.now() > 14 * 60_000);
    assert.equal((await storeServer().post(`/v1/classifieds/listings/${listing.id}/video-upload`)).status, 401, 'signed in only');
    assert.equal((await (await seller()).post(`/v1/classifieds/listings/${listing.id}/video-upload`)).status, 404, "never for another's listing");

    // The browser's preflight and upload, from the store's page: no cookies, no session header, no Idempotency-Key.
    const preflight = await fetch(`${server.base}${link.json.path}`, { method: 'OPTIONS', headers: { origin: 'https://ng.bitocard.com', 'access-control-request-method': 'POST' } });
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://ng.bitocard.com');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null, 'never with cookies');
    const send = (path, bytes = mp4()) => {
      const form = new FormData();
      form.set('file', new Blob([bytes], { type: 'video/mp4' }), 'clip.mp4');
      return fetch(`${server.base}${path}`, { method: 'POST', headers: { origin: 'https://ng.bitocard.com' }, body: form });
    };
    const forged = await send(link.json.path.replace(/.$/, c => (c === 'A' ? 'B' : 'A')));
    assert.deepEqual([forged.status, (await forged.json()).error.code], [401, 'upload_link_invalid']);
    const sent = await send(link.json.path);
    assert.equal(sent.status, 202);
    assert.equal(sent.headers.get('access-control-allow-origin'), 'https://ng.bitocard.com');
    assert.equal((await sent.json()).status, 'processing');
    await waitFor(async () => (await shopper.get(`/v1/classifieds/me/listings/${listing.id}`)).json.video?.status === 'ready', 'the video');
    assert.equal((await (await send(link.json.path)).json()).error.code, 'video_exists', 'one per listing');
    assert.equal((await shopper.post(`/v1/classifieds/listings/${listing.id}/video-upload`)).json.error.code, 'video_exists');

    // Signing out ends the link.
    const other = await completeDraft(shopper);
    const second = await shopper.post(`/v1/classifieds/listings/${other.id}/video-upload`);
    assert.equal((await shopper.post('/v1/store/account/signout')).status, 200);
    assert.equal((await (await send(second.json.path)).json()).error.code, 'upload_link_invalid');
    // Other routes keep their own CORS rules.
    const elsewhere = await fetch(`${server.base}/v1/classifieds/categories?country=NG`, { headers: { origin: 'https://ng.bitocard.com' } });
    assert.equal(elsewhere.headers.get('access-control-allow-origin'), null);
  });

  test('the job fails a video stuck processing (the server restarted mid-way)', async () => {
    media.transcoder = { transcode: () => new Promise(() => {}) };
    const shopper = await seller();
    const listing = await completeDraft(shopper);
    const started = (await shopper.upload(`/v1/classifieds/listings/${listing.id}/video`, mp4(), 'video/mp4')).json;
    await prisma.classifiedMedia.update({ where: { id: started.id }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    const job = await fetch(`${server.base}/v1/cron/classifieds`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    assert.ok(job.result.stale_videos >= 1);
    const video = (await shopper.get(`/v1/classifieds/me/listings/${listing.id}`)).json.video;
    assert.deepEqual([video.status, video.failure_reason], ['failed', 'This video took too long to process. Add it again.']);
  });
});
