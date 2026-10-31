// BitoCard Shop, phase 1 step 2a: sellers' listings (drafts, feature values from the registry, submitting, the
// monthly limit, a new seller's first listings to review, renewing, selling and deleting) and the public reference data.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let admin;
let prisma;

before(async () => {
  // BitoCard Shop is Udozo's (docs/UDOZO_SPINOFF_PLAN.md).
  server = await startApp({ env: { APP_PRODUCT: 'udozo', CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
});

after(() => server?.close());

const open = async (country = 'NG', enabled = true) => assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: country, enabled })).status, 200);

function storeServer(subdomain = null) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(subdomain ? { 'bitocard-store': subdomain } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `shop-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body), delete: path => request('DELETE', path) };
}

let counter = 0;
async function seller({ country = 'NG', verify = true, terms = true } = {}) {
  const shopper = storeServer();
  const email = `seller${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chinedu Okafor', email, password: 'correct horse battery', country });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  if (verify) {
    assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
    // The BitoCard Shop terms, accepted before posting or Safe pay.
    if (terms) await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  }
  shopper.id = signup.json.customer.id;
  return shopper;
}

const ids = async () => {
  const [phones, ikeja, kano] = await Promise.all([
    prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'mobile-phones' } }),
    prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', slug: 'ikeja' } }),
    prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', slug: 'kano', kind: 'area' } }),
  ]);
  const top = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'phones-tablets' } });
  const laptops = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'laptops' } });
  return { phones: phones.id, top: top.id, laptops: laptops.id, ikeja: ikeja.id, kano: kano.id };
};

const phone = async (overrides = {}) => {
  const { phones, ikeja } = await ids();
  return {
    category_id: phones,
    area_id: ikeja,
    title: 'iPhone 13, 128 GB, Midnight',
    description: 'Used and in **good** condition.\n\n- Small scratch on the back\n- Box and cable',
    price: 36500000,
    condition: 'used',
    features: [
      { key: 'brand', value: 'Apple' },
      { key: 'storage', value: '128' },
      { key: 'colour', value: 'black' },
      { key: 'warranty', value: 'no' },
    ],
    ...overrides,
  };
};

/** Stand-ins for the photos step 2b uploads. */
const addPhotos = (listingId, count = 4) =>
  prisma.classifiedMedia.createMany({ data: Array.from({ length: count }, (_, position) => ({ listingId, kind: 'photo', position, url: `https://media.test/${listingId}/${position}.jpg`, width: 1600, height: 1200 })) });

describe('reference data', () => {
  test('closed until the switch is on for the country; the feature registry is always searchable', async () => {
    await open('NG', false);
    const closed = await fetch(`${server.base}/v1/classifieds/categories?country=NG`).then(async res => [res.status, (await res.json()).error.code]);
    assert.deepEqual(closed, [403, 'classifieds_unavailable']);
    const features = await fetch(`${server.base}/v1/classifieds/features?q=ram`).then(res => res.json());
    assert.equal(features.data[0].key, 'memory', 'typing "ram" finds Memory first');
    assert.equal((await fetch(`${server.base}/v1/classifieds/features?q=rom`).then(res => res.json())).data[0].key, 'storage');
    assert.equal((await fetch(`${server.base}/v1/classifieds/features`).then(res => res.json())).data.length, await prisma.classifiedFeature.count({ where: { enabled: true } }));
  });

  test("an open country's categories with their suggested features, and its states and areas", async () => {
    await open();
    const categories = await fetch(`${server.base}/v1/classifieds/categories?country=ng`).then(res => res.json());
    const phones = categories.data.find(c => c.slug === 'phones-tablets');
    const mobile = phones.children.find(c => c.slug === 'mobile-phones');
    assert.deepEqual(mobile.features.slice(0, 2).map(f => [f.key, f.filter, f.placeholder]), [['brand', true, 'e.g. Apple'], ['model', false, 'e.g. iPhone 13']]);
    assert.match(mobile.safety_checklist.join(' '), /IMEI/, "a subcategory shows its parent's checklist");
    const areas = await fetch(`${server.base}/v1/classifieds/areas?country=NG`).then(res => res.json());
    assert.equal(areas.data.length, 37);
    const lagos = areas.data.find(s => s.slug === 'lagos');
    assert.ok(lagos.areas.some(a => a.slug === 'ikeja' && a.latitude > 6 && a.longitude > 3));
  });
});

describe('who can sell', () => {
  test('a confirmed bitocard.com account in a country where the Shop is open', async () => {
    await open();
    const unconfirmed = await seller({ verify: false });
    assert.equal((await unconfirmed.post('/v1/classifieds/listings', {})).json.error.code, 'email_not_verified');
    const ghana = await seller({ country: 'GH' });
    assert.deepEqual([(await ghana.post('/v1/classifieds/listings', {})).status, (await ghana.get('/v1/classifieds/me/listings')).json.error.code], [403, 'classifieds_unavailable']);
    assert.equal((await storeServer().get('/v1/classifieds/me/listings')).status, 401);
  });
});

describe('drafts', () => {
  test('saved as the seller goes, each field checked, features against the registry', async () => {
    await open();
    const shopper = await seller();
    const { phones, top, kano } = await ids();
    const created = await shopper.post('/v1/classifieds/listings', { title: 'iPhone 13 for sale' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.deepEqual([created.json.status, created.json.price.currency, created.json.country, created.json.url], ['draft', 'NGN', 'NG', null]);
    const id = created.json.id;

    const refused = async (body, code, param) => {
      const res = await shopper.patch(`/v1/classifieds/listings/${id}`, body);
      assert.deepEqual([res.status, res.json.error.code, res.json.error.param], [400, code, param], JSON.stringify(body));
    };
    await refused({ title: 'Hi' }, 'parameter_invalid', 'title');
    await refused({ title: 'Call me on wa.me or www.example.com' }, 'listing_text_refused', 'title');
    await refused({ description: 'See https://scam.example for photos' }, 'listing_text_refused', 'description');
    await refused({ description: 'Nice phone <script>alert(1)</script>' }, 'listing_text_refused', 'description');
    await refused({ category_id: top }, 'parameter_invalid', 'category_id');
    await refused({ features: [{ key: 'flux_capacitor', value: 'yes' }] }, 'feature_unknown', 'features[0].key');
    await refused({ features: [{ key: 'memory', value: 'lots' }] }, 'feature_value_invalid', 'features[0].value');
    await refused({ features: [{ key: 'memory', value: 4096 }] }, 'feature_value_invalid', 'features[0].value');
    await refused({ features: [{ key: 'colour', value: 'Ultraviolet' }] }, 'feature_value_invalid', 'features[0].value');
    await refused({ features: [{ key: 'brand', value: 'A' }, { key: 'brand', value: 'B' }] }, 'parameter_invalid', 'features');
    await refused({ price: 0 }, 'parameter_invalid', 'price');

    const saved = await shopper.patch(`/v1/classifieds/listings/${id}`, {
      category_id: phones,
      area_id: kano,
      features: [{ key: 'memory', value: '6' }, { key: 'colour', value: 'blue' }, { key: 'warranty', value: 'yes' }, { key: 'brand', value: '  Apple  ' }],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.area.state.slug, 'kano');
    assert.deepEqual(
      Object.fromEntries(saved.json.features.map(f => [f.key, f.value])),
      { brand: 'Apple', colour: 'Blue', memory: 6, warranty: true },
      'values are stored in their type, choices in their own spelling',
    );
    const other = await seller();
    assert.equal((await other.get(`/v1/classifieds/me/listings/${id}`)).status, 404, "another seller's listing is not found");
    assert.equal((await other.patch(`/v1/classifieds/listings/${id}`, { title: 'Mine now' })).status, 404);
  });
});

describe('submitting', () => {
  test('complete, with photos; a new seller waits for review, then listings go live with an expiry', async () => {
    await open();
    const shopper = await seller();
    const draft = (await shopper.post('/v1/classifieds/listings', { title: 'iPhone 13, 128 GB' })).json;
    const incomplete = await shopper.post(`/v1/classifieds/listings/${draft.id}/submit`);
    assert.deepEqual([incomplete.status, incomplete.json.error.code, incomplete.json.error.param], [400, 'listing_incomplete', 'category_id']);

    await shopper.patch(`/v1/classifieds/listings/${draft.id}`, await phone());
    assert.equal((await shopper.post(`/v1/classifieds/listings/${draft.id}/submit`)).json.error.code, 'photos_required');
    await addPhotos(draft.id, 4);
    const first = await shopper.post(`/v1/classifieds/listings/${draft.id}/submit`);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.deepEqual([first.json.status, first.json.review_reason, first.json.expires_at], ['pending_review', 'first_listings', null]);
    assert.equal((await shopper.post(`/v1/classifieds/listings/${draft.id}/submit`)).json.error.code, 'listing_not_draft');

    // Three listings already published: the next goes live at once.
    await prisma.classifiedListing.update({ where: { id: draft.id }, data: { status: 'active', publishedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    for (let i = 0; i < 2; i += 1) {
      const more = (await shopper.post('/v1/classifieds/listings', await phone({ title: `Samsung Galaxy A${i + 10}`, category_id: (await ids()).laptops }))).json;
      await addPhotos(more.id);
      await shopper.post(`/v1/classifieds/listings/${more.id}/submit`);
      await prisma.classifiedListing.update({ where: { id: more.id }, data: { status: 'active', publishedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    }
    const next = (await shopper.post('/v1/classifieds/listings', await phone({ title: 'iPhone 12, 64 GB' }))).json;
    await addPhotos(next.id);
    const live = await shopper.post(`/v1/classifieds/listings/${next.id}/submit`);
    assert.equal(live.json.status, 'active');
    assert.ok(Math.abs(new Date(live.json.expires_at) - Date.now() - 30 * 86_400_000) < 60_000, 'live for 30 days');
    assert.match(live.json.url, new RegExp(`^https://udozo\\.com/ng/l/${live.json.ref}-iphone-12-64-gb$`));
    assert.ok(live.json.ref > 100000);
    assert.equal(await prisma.classifiedPriceHistory.count({ where: { listingId: next.id, to: null } }), 1, 'its price is recorded');

    const changed = await shopper.patch(`/v1/classifieds/listings/${next.id}`, { price: 34000000 });
    assert.deepEqual([changed.json.status, changed.json.price.amount], ['active', 34000000]);
    assert.deepEqual((await prisma.classifiedPriceHistory.findMany({ where: { listingId: next.id }, orderBy: { from: 'asc' } })).map(row => [Number(row.priceMinor), row.to === null]), [[36500000, false], [34000000, true]]);
    const emptied = await shopper.patch(`/v1/classifieds/listings/${next.id}`, { title: null });
    assert.equal(emptied.json.error.code, 'listing_incomplete', 'a live listing keeps everything a buyer needs');
  });

  test('posting needs the current Udozo terms accepted, recorded by version', async () => {
    await open();
    const shopper = await seller({ terms: false });
    const status = await shopper.get('/v1/classifieds/terms');
    assert.deepEqual(status.json, { object: 'classified_terms', version: status.json.version, path: '/legal/terms', accepted: false, accepted_at: null, previous_version: null });
    assert.match(status.json.version, /^\d{4}-\d{2}-\d{2}$/);

    const draft = (await shopper.post('/v1/classifieds/listings', await phone({ title: 'iPhone 11, 64 GB' }))).json;
    assert.ok(draft.id, 'drafts are saved before the terms are accepted');
    await addPhotos(draft.id, 4);
    const refused = await shopper.post(`/v1/classifieds/listings/${draft.id}/submit`);
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [409, 'terms_not_accepted', 'terms']);

    const stale = await shopper.post('/v1/classifieds/terms/accept', { version: '2020-01-01' });
    assert.deepEqual([stale.status, stale.json.error.code], [409, 'terms_changed'], 'only the version the customer was shown');
    const accepted = await shopper.post('/v1/classifieds/terms/accept', { version: status.json.version });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    assert.equal(accepted.json.accepted, true);
    assert.ok(accepted.json.accepted_at);
    assert.equal((await shopper.post('/v1/classifieds/terms/accept', { version: status.json.version })).json.accepted_at, accepted.json.accepted_at, 'accepting again changes nothing');
    assert.equal(await prisma.classifiedTermsAcceptance.count({ where: { customerId: shopper.id } }), 1);
    assert.equal((await shopper.post(`/v1/classifieds/listings/${draft.id}/submit`)).status, 200);

    // New terms: an earlier acceptance no longer counts, and the apps can say the terms changed.
    await prisma.classifiedTermsAcceptance.updateMany({ where: { customerId: shopper.id }, data: { version: '2026-01-01' } });
    const changed = (await shopper.get('/v1/classifieds/terms')).json;
    assert.deepEqual([changed.accepted, changed.previous_version], [false, '2026-01-01']);
    const next = (await shopper.post('/v1/classifieds/listings', await phone({ title: 'iPhone XR, 64 GB' }))).json;
    await addPhotos(next.id, 4);
    assert.equal((await shopper.post(`/v1/classifieds/listings/${next.id}/submit`)).json.error.code, 'terms_not_accepted');
  });

  test('a seller posts a limited number per top category every 30 days', async () => {
    await open();
    await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { monthlyListingLimit: 2, firstListingsReviewed: 0 } });
    try {
      const shopper = await seller();
      const submitted = [];
      for (const title of ['Tecno Spark 10', 'Infinix Hot 30', 'Itel A70']) {
        const listing = (await shopper.post('/v1/classifieds/listings', await phone({ title }))).json;
        await addPhotos(listing.id);
        submitted.push(await shopper.post(`/v1/classifieds/listings/${listing.id}/submit`));
      }
      assert.deepEqual(submitted.map(res => res.json.status ?? res.json.error.code), ['active', 'active', 'listing_limit_reached']);
      const laptop = (await shopper.post('/v1/classifieds/listings', await phone({ title: 'HP EliteBook 840', category_id: (await ids()).laptops }))).json;
      await addPhotos(laptop.id);
      assert.equal((await shopper.post(`/v1/classifieds/listings/${laptop.id}/submit`)).json.status, 'active', 'another top category has its own limit');
    } finally {
      await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { monthlyListingLimit: 10, firstListingsReviewed: 3 } });
    }
  });
});

describe('after going live', () => {
  async function liveListing(shopper, title) {
    const listing = (await shopper.post('/v1/classifieds/listings', await phone({ title }))).json;
    await addPhotos(listing.id);
    await prisma.classifiedListing.update({ where: { id: listing.id }, data: { publishedAt: new Date() } });
    await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
    try {
      return (await shopper.post(`/v1/classifieds/listings/${listing.id}/submit`)).json;
    } finally {
      await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 3 } });
    }
  }

  test('renewed from 3 days before expiry, expired by the job, renewed again; marked sold', async () => {
    await open();
    const shopper = await seller();
    const listing = await liveListing(shopper, 'Nokia G21, 128 GB');
    assert.equal(listing.status, 'active', JSON.stringify(listing));
    assert.equal((await shopper.post(`/v1/classifieds/listings/${listing.id}/renew`)).json.error.code, 'renew_not_due');
    await prisma.classifiedListing.update({ where: { id: listing.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const job = await fetch(`${server.base}/v1/cron/classifieds`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    assert.ok(job.result.listings.expired >= 1);
    assert.equal((await shopper.get(`/v1/classifieds/me/listings/${listing.id}`)).json.status, 'expired');
    const renewed = await shopper.post(`/v1/classifieds/listings/${listing.id}/renew`);
    assert.equal(renewed.json.status, 'active');
    assert.ok(new Date(renewed.json.expires_at) > new Date(Date.now() + 29 * 86_400_000));

    const sold = await shopper.post(`/v1/classifieds/listings/${listing.id}/sold`);
    assert.deepEqual([sold.json.status, Boolean(sold.json.sold_at)], ['sold', true]);
    assert.equal((await shopper.patch(`/v1/classifieds/listings/${listing.id}`, { price: 100 })).json.error.code, 'listing_closed');
    assert.equal((await shopper.post(`/v1/classifieds/listings/${listing.id}/sold`)).json.error.code, 'listing_not_active');
  });

  test('deleting: a draft is gone, anything else leaves the market and the seller’s list', async () => {
    await open();
    const shopper = await seller();
    const draft = (await shopper.post('/v1/classifieds/listings', { title: 'Old charger cable' })).json;
    assert.equal((await shopper.delete(`/v1/classifieds/listings/${draft.id}`)).status, 204);
    assert.equal(await prisma.classifiedListing.count({ where: { id: draft.id } }), 0);

    const live = await liveListing(shopper, 'Xiaomi Redmi Note 12');
    assert.equal((await shopper.delete(`/v1/classifieds/listings/${live.id}`)).status, 204);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: live.id } })).status, 'deleted');
    assert.equal((await shopper.get(`/v1/classifieds/me/listings/${live.id}`)).status, 404);
    assert.ok(!(await shopper.get('/v1/classifieds/me/listings')).json.data.some(row => row.id === live.id));
    assert.equal((await shopper.get('/v1/classifieds/me/listings?status=active')).json.data.length, 0);
  });

  test('the database keeps a live listing complete', async () => {
    const shopper = await seller();
    await open();
    const draft = (await shopper.post('/v1/classifieds/listings', { title: 'Draft only listing' })).json;
    await assert.rejects(prisma.classifiedListing.update({ where: { id: draft.id }, data: { status: 'active' } }), /classified_listings_complete_check/);
  });
});
