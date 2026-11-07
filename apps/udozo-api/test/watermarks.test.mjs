// Watermarked listing photos (docs/UDOZO_WATERMARK_PLAN.md): off, every photo keeps its stored address; on, the API
// gives udozo.com's image route (a resale shop's own address on its pages) with the mark's version, new photos are
// stored private and the classifieds job makes older ones private; Udozo's text and stores' own (with refused words),
// the public mark, and the originals only udozo.com's signed server can read.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, fakeService, lastEmailCode, resellerClient, startApp, testMobile } from './helpers.mjs';

const secret = 'store-server-secret-for-watermark-tests-0123456789';
let server;
let admin;
let prisma;
let house;
let bucket;
const objects = new Map();

before(async () => {
  bucket = await fakeService(call => {
    const url = new URL(call.url, 'http://x');
    const key = decodeURIComponent(url.pathname).replace(/^\/udozo-media\//, '');
    if (call.method === 'PUT' && url.searchParams.has('acl')) {
      const object = objects.get(key);
      if (!object) return { status: 404, body: '' };
      object.acl = call.headers['x-amz-acl'];
      return { status: 200, body: '' };
    }
    if (call.method === 'PUT') {
      objects.set(key, { body: call.raw, acl: call.headers['x-amz-acl'], type: call.headers['content-type'] });
      return { status: 200, body: '' };
    }
    if (call.method === 'GET') {
      const object = objects.get(key);
      return object ? { status: 200, headers: { 'content-type': object.type }, body: object.body } : { status: 404, body: '' };
    }
    if (call.method === 'DELETE') {
      objects.delete(key);
      return { status: 204, body: '' };
    }
    return { status: 405, body: '' };
  });
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      CRON_SECRET: 'cron-secret',
      STORE_SERVER_SECRET: secret,
      SPACES_KEY: 'spaces-key',
      SPACES_SECRET: 'spaces-secret',
      SPACES_BUCKET: 'udozo-media',
      SPACES_ENDPOINT: bucket.url,
      SPACES_PUBLIC_URL: 'https://media.udozo.test',
      SPACES_ROOT: 'test',
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  house = server.app.get((await import('../dist/checkout/house.service.js')).HouseService);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_resale', 'reseller_resale']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 100, minPhotos: 1 } });
  assert.equal((await admin.put('/v1/admin/classifieds/resale-settings/NG', { reseller_fee_bps: 300, reseller_fee_cap: 500000 })).status, 200);
});

after(async () => {
  await server?.close();
  await bucket?.close();
});

const setWatermarks = async enabled => assert.equal((await admin.put('/v1/admin/switches/photo_watermarks', { enabled })).status, 200);
const get = async (path, headers = {}) => {
  const res = await fetch(`${server.base}${path}`, { headers });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, bytes: type.includes('json') ? null : Buffer.from(await res.arrayBuffer()) };
};
const sign = (id, now = Date.now()) => {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${id}`).digest('hex')}`;
};

/** A JPEG of the given size (its pixels random, so each photo is a new one). */
function jpeg({ width = 1600, height = 1200 } = {}) {
  const u16 = value => Buffer.from([value >> 8, value & 0xff]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]), u16(height), u16(width), Buffer.from([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00])]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, sos, Buffer.from(`pixels-${Math.random()}`), Buffer.from([0xff, 0xd9])]);
}

function shopper() {
  let token = null;
  const request = async (method, path, { body, form } = {}) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `wm-${Date.now()}-${Math.random()}` } : {}),
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
    upload: (path, bytes) => {
      const form = new FormData();
      form.set('file', new Blob([bytes], { type: 'image/jpeg' }), 'IMG_0001.jpg');
      return request('POST', path, { form });
    },
  };
}

let counter = 0;
async function seller(name = 'Chinedu Okafor') {
  const customer = shopper();
  const email = `wm${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await customer.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, customer);
  assert.equal((await customer.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await customer.post('/v1/classifieds/terms/accept', { version: (await customer.get('/v1/classifieds/terms')).json.version });
  customer.id = signup.json.customer.id;
  return customer;
}

/** A live listing with one uploaded photo (and resale open, for the resale shop). */
async function liveListing(customer, title, extra = {}) {
  const [category, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'yaba' } })]);
  const draft = await customer.post('/v1/classifieds/listings', { title, category_id: category.id, area_id: area.id, price: 25000000, condition: 'used', description: 'Works perfectly, with its remote.', ...extra });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  const photo = await customer.upload(`/v1/classifieds/listings/${draft.json.id}/photos`, jpeg());
  assert.equal(photo.status, 201, JSON.stringify(photo.json));
  const live = await customer.post(`/v1/classifieds/listings/${draft.json.id}/submit`);
  assert.equal(live.json.status, 'active', JSON.stringify(live.json));
  return { ...live.json, photo: photo.json };
}

const imgPattern = (base, id, version, width) => new RegExp(`^${base.replace(/[.]/g, '\\.')}/img/${id}\\.jpg\\?m=${version}${width ? `&w=${width}` : ''}$`);

describe('photo addresses', () => {
  test('off: the stored public address everywhere; on: udozo.com/img with the mark version, new photos private', async () => {
    const customer = await seller();
    const listing = await liveListing(customer, 'Samsung 43 inch smart TV');
    const media = await prisma.classifiedMedia.findUniqueOrThrow({ where: { id: listing.photo.id } });
    assert.match(media.url, /^https:\/\/media\.udozo\.test\/test\/classifieds\/ng\//);
    assert.equal(objects.get(media.storageKey).acl, 'public-read', 'off: published as before');
    assert.equal(media.privateAt, null);

    // Off: today's addresses.
    assert.equal(listing.photo.url, media.url);
    assert.equal((await customer.get(`/v1/classifieds/me/listings/${listing.id}`)).json.photos[0].url, media.url);
    const page = await get(`/v1/classifieds/listings/${listing.ref}?country=NG`);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.json.photos[0].url, media.url);
    const results = await get('/v1/classifieds/listings?country=NG&q=samsung');
    assert.equal(results.json.data.find(card => card.id === listing.id).cover.url, media.url);
    const sitemap = await get('/v1/classifieds/sitemap/listings?country=NG');
    assert.deepEqual(sitemap.json.listings.find(row => row.ref === listing.ref).images, [media.url]);

    // On: udozo.com's image route, version u1.
    await setWatermarks(true);
    try {
      assert.match((await customer.get(`/v1/classifieds/me/listings/${listing.id}`)).json.photos[0].url, imgPattern('https://udozo.com', media.id, 'u1', 960));
      assert.match((await get(`/v1/classifieds/listings/${listing.ref}?country=NG`)).json.photos[0].url, imgPattern('https://udozo.com', media.id, 'u1', 1600));
      assert.match((await get('/v1/classifieds/listings?country=NG&q=samsung')).json.data.find(card => card.id === listing.id).cover.url, imgPattern('https://udozo.com', media.id, 'u1', 480));
      assert.match((await get('/v1/classifieds/sitemap/listings?country=NG')).json.listings.find(row => row.ref === listing.ref).images[0], imgPattern('https://udozo.com', media.id, 'u1', 1600));
      const covers = await get('/v1/classifieds/category-covers?country=NG');
      const tvs = covers.json.data.find(item => item.photo);
      assert.match(tvs.photo.url, /^https:\/\/udozo\.com\/img\/[0-9a-f-]+\.jpg\?m=u1&w=960$/);

      // A new photo is stored private, its row marked.
      const added = await customer.upload(`/v1/classifieds/listings/${listing.id}/photos`, jpeg());
      assert.equal(added.status, 201, JSON.stringify(added.json));
      assert.match(added.json.url, imgPattern('https://udozo.com', added.json.id, 'u1', 960));
      const stored = await prisma.classifiedMedia.findUniqueOrThrow({ where: { id: added.json.id } });
      assert.equal(objects.get(stored.storageKey).acl, 'private');
      assert.ok(stored.privateAt);

      // The classifieds job makes the older original private (PutObjectAcl) and marks it.
      const before = bucket.calls.length;
      const run = await fetch(`${server.base}/v1/cron/classifieds`, { headers: { authorization: 'Bearer cron-secret' } });
      assert.equal(run.status, 200);
      const done = (await run.json()).result;
      assert.ok(done.private_photos.made_private >= 1, JSON.stringify(done.private_photos));
      const aclCalls = bucket.calls.slice(before).filter(call => call.method === 'PUT' && call.url.includes('acl'));
      assert.ok(aclCalls.some(call => call.url.includes(encodeURI(media.storageKey).split('/').pop()) && call.headers['x-amz-acl'] === 'private'), 'asked storage to make it private');
      assert.equal(objects.get(media.storageKey).acl, 'private');
      assert.ok((await prisma.classifiedMedia.findUniqueOrThrow({ where: { id: media.id } })).privateAt);
      // Nothing left to do: the next run makes nothing private.
      const again = (await (await fetch(`${server.base}/v1/cron/classifieds`, { headers: { authorization: 'Bearer cron-secret' } })).json()).result;
      assert.equal(again.private_photos.made_private, 0);
    } finally {
      await setWatermarks(null);
    }
    assert.equal((await customer.get(`/v1/classifieds/me/listings/${listing.id}`)).json.photos[0].url, media.url, 'off again: stored addresses');
  });
});

describe('Udozo’s text', () => {
  test('admins change it (2 to 30 allowed characters), each change a new version, audited; support only reads', async () => {
    const view = await admin.get('/v1/admin/classifieds/watermark');
    assert.equal(view.status, 200, JSON.stringify(view.json));
    assert.deepEqual([view.json.object, view.json.text, view.json.version, view.json.enabled], ['watermark_settings', 'udozo.com', 1, false]);
    assert.equal((await admin.put('/v1/admin/classifieds/watermark', { text: 'x' })).status, 400);
    const bad = await admin.put('/v1/admin/classifieds/watermark', { text: 'Udozo <b>' });
    assert.deepEqual([bad.status, bad.json.error.code, bad.json.error.param], [400, 'parameter_invalid', 'text']);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.get('/v1/admin/classifieds/watermark')).status, 200);
    assert.equal((await support.put('/v1/admin/classifieds/watermark', { text: 'Not mine' })).status, 403);

    const changed = await admin.put('/v1/admin/classifieds/watermark', { text: '  Udozo   Market ' });
    assert.deepEqual([changed.status, changed.json.text, changed.json.version], [200, 'Udozo Market', 2]);
    const same = await admin.put('/v1/admin/classifieds/watermark', { text: 'Udozo Market' });
    assert.equal(same.json.version, 2, 'the same text changes nothing');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'watermark.changed' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([audit.before.text, audit.after.text, audit.after.version], ['udozo.com', 'Udozo Market', 2]);

    const mark = await get('/v1/classifieds/watermark');
    assert.deepEqual(mark.json, { object: 'watermark', text: 'Udozo Market', version: 'u2' });
    assert.equal(mark.headers.get('cache-control'), 'public, max-age=60');

    await setWatermarks(true);
    try {
      const customer = await seller();
      const listing = await liveListing(customer, 'LG 32 inch TV');
      assert.match((await get(`/v1/classifieds/listings/${listing.ref}?country=NG`)).json.photos[0].url, /\?m=u2&w=1600$/, 'new addresses with the new text');
    } finally {
      await setWatermarks(null);
    }
  });
});

/** A verified reseller's published Resale shop carrying one of a supplier's listings. */
async function resaleShop() {
  const supplier = await seller('Amaka Eze');
  const nigeria = await house.resellerFor('NG');
  await prisma.identityVerification.create({
    data: { subject: 'customer', resellerId: nigeria.id, mode: 'live', customerReference: supplier.id, method: 'document', provider: 'test', providerReference: randomUUID(), status: 'approved', country: 'NG', consentAt: new Date(), verifiedName: 'Amaka Eze' },
  });
  await prisma.customerBankAccount.create({
    data: { customerId: supplier.id, mode: 'live', country: 'NG', currency: 'NGN', bankCode: '044', bankName: 'Access Bank', accountNumberEncrypted: 'sealed', accountNumberLast4: '6789', accountName: 'Amaka Eze', payoutsFrom: new Date() },
  });
  const listing = await liveListing(supplier, 'Hisense 50 inch TV', { resale: true, resale_discount_bps: 1000, resale_markup_max_bps: 3000, stock: 2 });
  const owner = await resellerClient(server, { business: 'Ada Gadgets' });
  await prisma.reseller.update({ where: { id: owner.resellerId }, data: { status: 'active', verifiedAt: new Date() } });
  const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Ada Gadgets', subdomain: `adawm${(counter += 1)}x${Date.now() % 10000}`, status: 'published', template: 'resale_shop', variant: 'showroom', theme: 'ink_coral' } });
  const added = await owner.browser.post('/v1/resale/listings', { store_id: store.id, listing_id: listing.id, markup_bps: 1000 });
  assert.equal(added.status, 201, JSON.stringify(added.json));
  return { owner, store, listing };
}

describe('a store’s own text', () => {
  test('only where store_watermarks allows it, checked, versioned; the shop’s pages use its address and mark; admins clear it', async () => {
    const { owner, store, listing } = await resaleShop();
    const api = owner.browser;
    const listed = (await api.get('/v1/stores')).json.data.find(item => item.id === store.id);
    assert.deepEqual([listed.watermark_text, listed.watermark_allowed], [null, false]);
    const refused = await api.patch(`/v1/stores/${store.id}`, { watermark_text: 'Ada Gadgets' });
    assert.deepEqual([refused.status, refused.json.error.code], [403, 'store_watermark_unavailable']);

    assert.equal((await admin.put('/v1/admin/switches/store_watermarks', { reseller_id: owner.resellerId, enabled: true })).status, 200);
    assert.equal((await api.patch(`/v1/stores/${store.id}`, { watermark_text: 'Ada <Gadgets>' })).json.error.code, 'parameter_invalid');
    await prisma.classifiedProhibitedWord.create({ data: { phrase: 'wmbanned', action: 'block' } });
    const word = await api.patch(`/v1/stores/${store.id}`, { watermark_text: 'Wmbanned Hub' });
    assert.deepEqual([word.status, word.json.error.code, word.json.error.param], [400, 'text_refused', 'watermark_text']);
    const saved = await api.patch(`/v1/stores/${store.id}`, { watermark_text: 'adagadgets.ng' });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.watermark_text, saved.json.watermark_allowed], ['adagadgets.ng', true]);
    assert.equal((await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).watermarkVersion, 1);
    await api.patch(`/v1/stores/${store.id}`, { watermark_text: 'adagadgets.ng' });
    assert.equal((await prisma.store.findUniqueOrThrow({ where: { id: store.id } })).watermarkVersion, 1, 'the same text changes nothing');

    const udozo = (await get('/v1/classifieds/watermark')).json.version;
    const byId = await get(`/v1/classifieds/watermark?store=${store.id}`);
    assert.deepEqual(byId.json, { object: 'watermark', text: 'adagadgets.ng', version: `${udozo}s1` });
    assert.deepEqual((await get(`/v1/classifieds/watermark?store=${store.subdomain}`)).json, byId.json, 'by subdomain too');

    // The shop's pages: the store's own address and its mark, while watermarks are on.
    const media = listing.photo.id;
    const card = async () => (await get(`/v1/store/resale/listings?store=${store.subdomain}`)).json.data[0].cover.url;
    assert.match(await card(), /^https:\/\/media\.udozo\.test\//, 'off: the stored address');
    await setWatermarks(true);
    try {
      assert.match(await card(), imgPattern(`https://${store.subdomain}.udozo.com`, media, `${udozo}s1`, 480));
      const detail = await get(`/v1/store/resale/listings/${listing.ref}?store=${store.subdomain}`);
      assert.match(detail.json.photos[0].url, imgPattern(`https://${store.subdomain}.udozo.com`, media, `${udozo}s1`, 1600));
      // On udozo.com itself the same photo carries Udozo's mark.
      assert.match((await get(`/v1/classifieds/listings/${listing.ref}?country=NG`)).json.photos[0].url, imgPattern('https://udozo.com', media, udozo, 1600));
      // Seller HQ's resale catalogue shows Udozo's.
      assert.match((await api.get('/v1/resale/catalogue')).json.data.find(item => item.id === listing.id).cover.url, imgPattern('https://udozo.com', media, udozo, 480));

      // A live domain is the store's address.
      await prisma.storeDomain.create({ data: { storeId: store.id, resellerId: owner.resellerId, name: `${store.subdomain}.com`, source: 'connected', status: 'active', primary: true } });
      assert.match(await card(), imgPattern(`https://${store.subdomain}.com`, media, `${udozo}s1`, 480));

      // Switched off for the reseller: Udozo's text, so Udozo's version.
      assert.equal((await admin.put('/v1/admin/switches/store_watermarks', { reseller_id: owner.resellerId, enabled: false })).status, 200);
      assert.match(await card(), imgPattern(`https://${store.subdomain}.com`, media, udozo, 480));
      assert.deepEqual((await get(`/v1/classifieds/watermark?store=${store.id}`)).json.text, (await get('/v1/classifieds/watermark')).json.text);
      assert.equal((await api.patch(`/v1/stores/${store.id}`, { watermark_text: 'Other' })).json.error.code, 'store_watermark_unavailable');
      assert.equal((await admin.put('/v1/admin/switches/store_watermarks', { reseller_id: owner.resellerId, enabled: true })).status, 200);
    } finally {
      await setWatermarks(null);
    }

    // Admins list stores with their own text, and clear one: audited, a new version, the reseller told.
    const list = await admin.get('/v1/admin/classifieds/watermark/stores');
    const row = list.json.data.find(item => item.store_id === store.id);
    assert.deepEqual([row.text, row.version, row.allowed, row.reseller_name], ['adagadgets.ng', 1, true, 'Ada Gadgets']);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.delete(`/v1/admin/stores/${store.id}/watermark`)).status, 403);
    const cleared = await fetch(`${server.base}/v1/admin/stores/${store.id}/watermark`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3004', cookie: [...admin.jar].map(([name, value]) => `${name}=${value}`).join('; ') },
      body: JSON.stringify({ reason: 'It named another company.' }),
    });
    const body = await cleared.json();
    assert.equal(cleared.status, 200, JSON.stringify(body));
    assert.deepEqual([body.text, body.version], [null, 2]);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'store.watermark_cleared', targetId: store.id } });
    assert.equal(audit.before.watermark_text, 'adagadgets.ng');
    const notice = await prisma.notification.findFirst({ where: { type: 'store.watermark_cleared', resellerId: owner.resellerId } });
    assert.match(notice.body, /It named another company/);
    assert.equal((await get(`/v1/classifieds/watermark?store=${store.id}`)).json.version, udozo, 'Udozo’s mark again');
  });

  test('changed from Seller HQ only, never with an API key', async () => {
    const owner = await resellerClient(server, { business: 'Key Store' });
    const store = await prisma.store.create({ data: { resellerId: owner.resellerId, name: 'Key Store', subdomain: `keywm${(counter += 1)}x${Date.now() % 10000}`, template: 'resale_shop' } });
    const key = await owner.browser.post('/v1/api-keys', { name: 'Back office', mode: 'test', scopes: ['stores:manage'], store_id: store.id });
    assert.equal(key.status, 201, JSON.stringify(key.json));
    const res = await fetch(`${server.base}/v1/stores/${store.id}`, { method: 'PATCH', headers: { authorization: `Bearer ${key.json.secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ watermark_text: 'keystore' }) });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'not_permitted');
  });
});

describe('originals', () => {
  test('only for udozo.com’s signed server: the bytes of a photo of a listing still on Udozo, never cached', async () => {
    const customer = await seller();
    const listing = await liveListing(customer, 'Panasonic 40 inch TV');
    const media = await prisma.classifiedMedia.findUniqueOrThrow({ where: { id: listing.photo.id } });
    const path = `/v1/classifieds/media/${media.id}/original`;

    const good = await get(path, { 'udozo-media-signature': sign(media.id) });
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('content-type'), 'image/jpeg');
    assert.equal(good.headers.get('cache-control'), 'private, no-store');
    assert.ok(good.bytes.equals(objects.get(media.storageKey).body), 'the stored bytes');

    for (const headers of [{}, { 'udozo-media-signature': sign(randomUUID()) }, { 'udozo-media-signature': sign(media.id, Date.now() - 10 * 60_000) }, { 'udozo-media-signature': 't=1,v1=abc' }]) {
      assert.equal((await get(path, headers)).status, 404, JSON.stringify(headers));
    }
    const unknown = randomUUID();
    assert.equal((await get(`/v1/classifieds/media/${unknown}/original`, { 'udozo-media-signature': sign(unknown) })).status, 404);

    const video = await prisma.classifiedMedia.create({ data: { listingId: listing.id, kind: 'video', status: 'ready', url: 'https://media.udozo.test/v.mp4', storageKey: media.storageKey } });
    assert.equal((await get(`/v1/classifieds/media/${video.id}/original`, { 'udozo-media-signature': sign(video.id) })).status, 404, 'never a video');

    // Whose photo it is: the seller's username once chosen, for the mark across the middle.
    assert.equal(good.headers.get('udozo-photo-owner'), '', 'no username yet');
    const owner = `/v1/classifieds/media/${media.id}/owner`;
    assert.equal((await get(owner, {})).status, 404, 'signed only');
    assert.equal((await get(owner, { 'udozo-media-signature': sign(media.id) })).json.username, null);
    await prisma.customer.update({ where: { id: customer.id }, data: { username: 'tvdealer' } });
    assert.equal((await get(owner, { 'udozo-media-signature': sign(media.id) })).json.username, 'tvdealer');
    assert.equal((await get(path, { 'udozo-media-signature': sign(media.id) })).headers.get('udozo-photo-owner'), 'tvdealer');

    await prisma.classifiedListing.update({ where: { id: listing.id }, data: { status: 'removed' } });
    assert.equal((await get(path, { 'udozo-media-signature': sign(media.id) })).status, 404, 'never a removed listing’s');
    assert.equal((await get(owner, { 'udozo-media-signature': sign(media.id) })).status, 404);
  });

  test('udozo.com’s signed requests are never rate limited; unsigned ones are', async () => {
    const limited = await startApp({ env: { APP_PRODUCT: 'udozo', STORE_SERVER_SECRET: secret, RATE_LIMIT_PER_MINUTE: '2', ADDRESS_RATE_LIMIT_PER_MINUTE: '3', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }, database: 'pglite' });
    try {
      const id = randomUUID();
      const path = `${limited.base}/v1/classifieds/media/${id}/original`;
      for (let i = 0; i < 8; i++) assert.equal((await fetch(path, { headers: { 'udozo-media-signature': sign(id) } })).status, 404, `signed request ${i + 1} answered, never limited`);
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await fetch(path)).status);
      assert.ok(statuses.includes(429), `unsigned requests are limited: ${statuses.join(',')}`);
    } finally {
      await limited.close();
    }
  });
});
