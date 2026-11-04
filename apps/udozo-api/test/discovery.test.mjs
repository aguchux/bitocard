// Udozo's personalised discovery (docs/UDOZO_PERSONALISATION_PLAN.md, phases 1 and 2): what a visit records (only for
// a signed-in customer who has not turned it off and is 18 or over, or a visitor who accepted all cookies, by an HMAC of
// their visitor ID, where the `personalisation` switch is on), the rows chosen for them (personalised, or the popular
// order for people without a profile and the 10% holdout), their history and searches, the server's own events, the
// jobs and Reports > Discovery.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let support;
let recorder;
let discovery;
let jobs;
const made = {};

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  recorder = server.app.get((await import('../dist/classifieds/discovery/recorder.service.js')).DiscoveryRecorder);
  discovery = server.app.get((await import('../dist/classifieds/discovery/discovery.service.js')).DiscoveryService);
  jobs = server.app.get((await import('../dist/classifieds/discovery/discovery-admin.service.js')).DiscoveryAdminService);
  admin = await adminClient(server);
  support = await adminClient(server, ['support']);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 100 } });
  made.sellerA = await customer('Chinedu Okafor');
  made.sellerB = await customer('Ngozi Eze');
  made.tvs = [await live(made.sellerA, 'Hisense 50 inch TV', 'tvs'), await live(made.sellerA, 'Samsung 43 inch smart TV', 'tvs'), await live(made.sellerB, 'LG 55 inch OLED TV', 'tvs'), await live(made.sellerB, 'TCL 32 inch TV', 'tvs')];
  made.phones = [await live(made.sellerA, 'Tecno Spark 20', 'mobile-phones'), await live(made.sellerA, 'Infinix Hot 40', 'mobile-phones'), await live(made.sellerB, 'Itel A70', 'mobile-phones'), await live(made.sellerB, 'Nokia G21', 'mobile-phones')];
  discovery.forget();
});

after(async () => {
  await server?.close();
});

const browser = 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36';
const visitorId = () => `v_${randomBytes(24).toString('base64url')}`;
const isHeld = subject => createHash('sha256').update(subject).digest()[0] < 26;

/** udozo.com's server: the customer's session, else the visitor ID, and the shopper's browser. */
function client({ visitor = null, userAgent = browser } = {}) {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'user-agent': userAgent,
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(visitor ? { 'udozo-visitor': visitor } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `disc-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, headers: res.headers };
  };
  return { visitor, get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), put: (path, body) => request('PUT', path, body), del: path => request('DELETE', path) };
}

let counter = 0;
async function customer(name) {
  const person = client();
  const email = `disc${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await person.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, person);
  assert.equal((await person.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await person.post('/v1/classifieds/terms/accept', { version: (await person.get('/v1/classifieds/terms')).json.version });
  person.id = signup.json.customer.id;
  person.subject = `c:${person.id}`;
  return person;
}

/** A customer whose subject is (or is not) in the 10% holdout. */
async function customerOutsideHoldout(name) {
  for (let n = 0; n < 10; n += 1) {
    const person = await customer(`${name} ${n}`);
    if (!isHeld(person.subject)) return person;
  }
  throw new Error('No customer outside the holdout');
}

function visitorIn(held) {
  for (;;) {
    const id = visitorId();
    if (isHeld(recorder.visitorSubjectOf(id)) === held) return id;
  }
}

async function live(person, title, slug) {
  const [category, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug } }), prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'area', slug: 'ikeja' } })]);
  const draft = await person.post('/v1/classifieds/listings', { title, category_id: category.id, area_id: area.id, price: 25000000, condition: 'used', delivery: 'none', contact: 'both', description: `${title}. Clean, works perfectly.` });
  assert.equal(draft.status, 201, JSON.stringify(draft.json));
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.json.id, kind: 'photo', position, url: `https://media.test/${draft.json.id}/${position}.jpg`, width: 1600, height: 1200 })) });
  const submitted = await person.post(`/v1/classifieds/listings/${draft.json.id}/submit`);
  assert.equal(submitted.json.status, 'active', JSON.stringify(submitted.json));
  const row = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: draft.json.id }, select: { ref: true, categoryId: true } });
  return { id: draft.json.id, ref: Number(row.ref), categoryId: row.categoryId, title };
}

const send = (who, events, session = 'visit-0001') => who.post('/v1/classifieds/events', { country: 'NG', session, events });
const eventsOf = subject => prisma.discoveryEvent.findMany({ where: { subject }, orderBy: { at: 'asc' } });

describe('who is recorded', () => {
  test('nobody without a customer session or a visitor ID; never robots; never where the switch is off', async () => {
    const before = await prisma.discoveryEvent.count();
    assert.equal((await send(client(), [{ kind: 'view', listing: made.tvs[0].ref }])).status, 204);
    const robot = client({ visitor: visitorId(), userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
    assert.equal((await send(robot, [{ kind: 'view', listing: made.tvs[0].ref }])).status, 204);
    const bad = client({ visitor: 'not-a-visitor-id' });
    assert.equal((await send(bad, [{ kind: 'view', listing: made.tvs[0].ref }])).status, 204);
    assert.equal(await prisma.discoveryEvent.count(), before);

    const off = client({ visitor: visitorId() });
    assert.equal((await admin.put('/v1/admin/switches/personalisation', { country_code: 'NG', enabled: false })).status, 200);
    assert.equal((await send(off, [{ kind: 'view', listing: made.tvs[0].ref }])).status, 204);
    assert.equal(await prisma.discoveryEvent.count(), before);
    assert.equal((await admin.put('/v1/admin/switches/personalisation', { country_code: 'NG', enabled: true })).status, 200);
    const off2 = await off.get('/v1/classifieds/for-you?country=NG');
    assert.equal(off2.json.personalised, false);
  });

  test('a visitor is kept only as an HMAC of their ID, never the ID', async () => {
    const id = visitorId();
    const visitor = client({ visitor: id });
    assert.equal((await send(visitor, [{ kind: 'view', listing: made.tvs[1].ref }, { kind: 'engaged', listing: made.tvs[1].ref, seconds: 90, photos: 3, depth: 80 }])).status, 204);
    const subject = recorder.visitorSubjectOf(id);
    assert.ok(subject.startsWith('v:') && !subject.includes(id.slice(2)));
    const rows = await eventsOf(subject);
    assert.deepEqual(rows.map(row => [row.kind, row.listingId, row.categoryId]), [['view', made.tvs[1].id, made.tvs[1].categoryId], ['engaged', made.tvs[1].id, made.tvs[1].categoryId]]);
    assert.equal(await prisma.discoveryEvent.count({ where: { subject: { contains: id.slice(2) } } }), 0);
    assert.equal(rows[0].priceMinor, 25000000n);
  });

  test('a customer who turned it off, or is under 18, is never recorded; off deletes what was kept', async () => {
    const buyer = await customer('Tunde Bello');
    assert.equal((await buyer.get('/v1/store/account')).json.personalisation, true);
    await send(buyer, [{ kind: 'view', listing: made.phones[0].ref }]);
    assert.equal((await eventsOf(buyer.subject)).length, 1);
    const turned = await buyer.put('/v1/classifieds/me/personalisation', { enabled: false });
    assert.deepEqual(turned.json, { object: 'personalisation', enabled: false });
    assert.equal((await buyer.get('/v1/store/account')).json.personalisation, false);
    assert.equal((await eventsOf(buyer.subject)).length, 0);
    assert.equal(await prisma.interestProfile.count({ where: { subject: buyer.subject } }), 0);
    await send(buyer, [{ kind: 'view', listing: made.phones[0].ref }]);
    assert.equal((await eventsOf(buyer.subject)).length, 0);
    const history = await buyer.get('/v1/classifieds/history');
    assert.deepEqual([history.status, history.json.personalisation, history.json.listings], [200, false, []]);
    assert.equal((await buyer.put('/v1/classifieds/me/personalisation', { enabled: true })).json.enabled, true);

    await prisma.customer.update({ where: { id: buyer.id }, data: { birthDate: new Date(Date.UTC(new Date().getUTCFullYear() - 15, 0, 1)) } });
    await send(buyer, [{ kind: 'view', listing: made.phones[0].ref }]);
    assert.equal((await eventsOf(buyer.subject)).length, 0);
    await prisma.customer.update({ where: { id: buyer.id }, data: { birthDate: null } });
    assert.equal((await client().put('/v1/classifieds/me/personalisation', { enabled: false })).status, 401);
  });

  test("a seller's own listings are never recorded for them; queries lose phone numbers, emails and codes", async () => {
    await send(made.sellerA, [{ kind: 'view', listing: made.tvs[0].ref }, { kind: 'search', query: 'Hisense', results: 2 }]);
    const rows = await eventsOf(made.sellerA.subject);
    assert.deepEqual(rows.map(row => row.kind), ['search']);
    const visitor = client({ visitor: visitorId() });
    await send(visitor, [{ kind: 'search', query: 'Call 0803 123 4567 about  iPhone 13 mail me@x.com ref ABCD12345XY', results: 0 }]);
    const [search] = await eventsOf(recorder.visitorSubjectOf(visitor.visitor));
    assert.equal(search.query, 'call about iphone 13 mail ref');
  });

  test('saves, unsaves and chats are recorded by the API itself, after they happen', async () => {
    const buyer = await customer('Amaka Obi');
    assert.equal((await buyer.post('/v1/classifieds/favourites', { listing_id: made.phones[2].id })).status, 200);
    assert.equal((await buyer.post('/v1/classifieds/favourites', { listing_id: made.phones[2].id })).status, 200, 'saving again changes nothing');
    assert.equal((await buyer.del(`/v1/classifieds/favourites/${made.phones[2].id}`)).status, 204);
    const chat = await buyer.post('/v1/classifieds/conversations', { listing_id: made.phones[3].id, body: 'Is it still available?' });
    assert.ok(chat.status < 300, JSON.stringify(chat.json));
    const rows = await eventsOf(buyer.subject);
    assert.deepEqual(rows.map(row => [row.kind, row.listingId, row.session]), [['save', made.phones[2].id, null], ['unsave', made.phones[2].id, null], ['chat', made.phones[3].id, null]]);
  });
});

describe('what people see', () => {
  test('For you: the popular order without a profile; personalised once they show an interest; excluded once contacted', async () => {
    const anonymous = await client().get('/v1/classifieds/for-you?country=NG');
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.headers.get('cache-control'), 'no-store');
    assert.deepEqual([anonymous.json.object, anonymous.json.personalised, anonymous.json.rows.map(row => row.kind)], ['for_you', false, ['for_you']]);
    // Two sellers here, and at most two of each seller's listings in a row.
    assert.equal(anonymous.json.rows[0].items.length, 4);

    const buyer = await customerOutsideHoldout('Ifeoma Nwosu');
    await send(buyer, made.tvs.flatMap(tv => [{ kind: 'view', listing: tv.ref }, { kind: 'engaged', listing: tv.ref, seconds: 120, photos: 4 }]));
    const profile = await prisma.interestProfile.findUniqueOrThrow({ where: { subject_country: { subject: buyer.subject, country: 'NG' } } });
    assert.ok(profile.categories[made.tvs[0].categoryId] > 0);
    const mine = await buyer.get('/v1/classifieds/for-you?country=NG&limit=8');
    assert.equal(mine.json.personalised, true);
    const forYou = mine.json.rows.find(row => row.kind === 'for_you');
    assert.equal(forYou.items[0].category.slug, 'tvs');
    const sellers = forYou.items.map(card => card.seller.name);
    for (const name of new Set(sellers)) assert.ok(sellers.filter(item => item === name).length <= 2, 'at most two per seller');
    const recent = mine.json.rows.find(row => row.kind === 'recent');
    assert.deepEqual(new Set(recent.items.map(card => card.id)), new Set(made.tvs.map(tv => tv.id)));
    assert.equal(recent.title, 'Recently viewed');

    // Not interested and contacted listings are never suggested again.
    await send(buyer, [{ kind: 'not_interested', listing: made.tvs[2].ref }]);
    await buyer.post('/v1/classifieds/conversations', { listing_id: made.tvs[3].id, body: 'Still available?' });
    const after = (await buyer.get('/v1/classifieds/for-you?country=NG&kinds=for_you')).json.rows[0].items.map(card => card.id);
    assert.ok(!after.includes(made.tvs[2].id) && !after.includes(made.tvs[3].id));
    assert.equal((await buyer.get('/v1/classifieds/for-you?country=NG&kinds=nonsense')).status, 400);
  });

  test("the holdout keeps the popular order; its For you clicks are told apart", async () => {
    const held = client({ visitor: visitorIn(true) });
    await send(held, [{ kind: 'view', listing: made.tvs[0].ref }, { kind: 'rail_click', listing: made.tvs[0].ref, source: 'for_you', position: 0 }]);
    const rows = await held.get('/v1/classifieds/for-you?country=NG');
    assert.equal(rows.json.personalised, false);
    assert.ok(rows.json.rows.some(row => row.kind === 'for_you'));
    const [, click] = await eventsOf(recorder.visitorSubjectOf(held.visitor));
    assert.equal(click.source, 'for_you_holdout');
  });

  test('Because you searched and Price dropped', async () => {
    const visitor = client({ visitor: visitorIn(false) });
    await send(visitor, [{ kind: 'view', listing: made.phones[1].ref }, { kind: 'search', query: 'Hisense', results: 1 }]);
    await prisma.classifiedListing.update({ where: { id: made.phones[1].id }, data: { priceMinor: 20000000n } });
    discovery.forget();
    const rows = (await visitor.get('/v1/classifieds/for-you?country=NG&kinds=searched,price_drops')).json.rows;
    const searched = rows.find(row => row.kind === 'searched');
    assert.deepEqual([searched.title, searched.href, searched.query], ['Because you searched "hisense"', '/ng/search?q=hisense', 'hisense']);
    assert.equal(searched.items[0].id, made.tvs[0].id);
    const drops = rows.find(row => row.kind === 'price_drops');
    assert.deepEqual(drops.items.map(card => [card.id, card.was_price]), [[made.phones[1].id, 25000000]]);
    await prisma.classifiedListing.update({ where: { id: made.phones[1].id }, data: { priceMinor: 25000000n } });
  });

  test('history: listed, removed one at a time or all; a visitor folded into their account on sign-in', async () => {
    assert.equal((await client().get('/v1/classifieds/history')).json.error.code, 'subject_required');
    const id = visitorId();
    const visitor = client({ visitor: id });
    await send(visitor, [{ kind: 'view', listing: made.phones[0].ref }, { kind: 'view', listing: made.phones[1].ref }, { kind: 'search', query: 'tecno spark', results: 3 }, { kind: 'search', query: 'infinix', results: 2 }]);
    let history = (await visitor.get('/v1/classifieds/history')).json;
    assert.deepEqual([history.object, history.personalisation, history.listings.length, history.searches.map(item => item.query)], ['history', true, 2, ['infinix', 'tecno spark']]);
    assert.ok(history.listings[0].viewed_at);
    assert.equal((await visitor.del(`/v1/classifieds/history/listings/${made.phones[0].ref}`)).status, 204);
    assert.equal((await visitor.del('/v1/classifieds/history/searches?q=Infinix')).status, 204);
    history = (await visitor.get('/v1/classifieds/history')).json;
    assert.deepEqual([history.listings.map(card => card.id), history.searches.map(item => item.query)], [[made.phones[1].id], ['tecno spark']]);
    assert.deepEqual((await visitor.get('/v1/classifieds/search/recent?country=NG')).json.data, [{ query: 'tecno spark' }]);

    const buyer = await customer('Kelechi Uche');
    await send(buyer, [{ kind: 'view', listing: made.tvs[0].ref }]);
    const merged = await buyer.post('/v1/classifieds/history/merge', { visitor: id });
    assert.deepEqual(merged.json, { object: 'history_merge', merged: 2 });
    assert.equal(await prisma.discoveryEvent.count({ where: { subject: recorder.visitorSubjectOf(id) } }), 0);
    assert.equal(await prisma.interestProfile.count({ where: { subject: recorder.visitorSubjectOf(id) } }), 0);
    const profile = await prisma.interestProfile.findUniqueOrThrow({ where: { subject_country: { subject: buyer.subject, country: 'NG' } } });
    assert.ok(profile.categories[made.phones[0].categoryId] > 0 && profile.categories[made.tvs[0].categoryId] > 0);
    assert.deepEqual(profile.searches.map(item => item.query), ['tecno spark']);

    assert.equal((await buyer.del('/v1/classifieds/history')).status, 204);
    assert.equal((await eventsOf(buyer.subject)).length, 0);
    assert.equal(await prisma.interestProfile.count({ where: { subject: buyer.subject } }), 0);
  });

  test('popular searches: the market’s most searched that found something, by at least 3 people', async () => {
    for (let n = 0; n < 3; n += 1) await send(client({ visitor: visitorId() }), [{ kind: 'search', query: 'Samsung TV', results: 4 }, { kind: 'search', query: 'gold watch', results: 0 }]);
    for (let n = 0; n < 2; n += 1) await send(client({ visitor: visitorId() }), [{ kind: 'search', query: 'rare camera', results: 2 }]);
    const popular = await client().get('/v1/classifieds/search/popular?country=NG');
    assert.equal(popular.headers.get('cache-control'), 'public, max-age=600');
    const queries = popular.json.data.map(item => item.query);
    assert.ok(queries.includes('samsung tv'));
    assert.ok(!queries.includes('gold watch') && !queries.includes('rare camera'));
  });

  test('people also viewed, from listings opened in the same visits; signals refreshed', async () => {
    for (let n = 0; n < 2; n += 1) {
      await send(client({ visitor: visitorId() }), [{ kind: 'view', listing: made.phones[2].ref }, { kind: 'view', listing: made.phones[3].ref }], `visit-also-${n}`);
    }
    assert.ok((await jobs.refreshNeighbours()) > 0);
    const signals = await jobs.refreshSignals();
    assert.ok(signals.refreshed >= made.tvs.length + made.phones.length);
    const quality = await prisma.listingSignal.findUniqueOrThrow({ where: { listingId: made.tvs[0].id } });
    assert.ok(quality.quality >= 0.5 && quality.quality <= 2);
    const also = await client().get(`/v1/classifieds/listings/${made.phones[2].ref}/also-viewed`);
    assert.equal(also.headers.get('cache-control'), 'public, max-age=300');
    assert.ok(also.json.data.some(card => card.id === made.phones[3].id));
    assert.ok(!also.json.data.some(card => card.id === made.phones[2].id));
    const old = await prisma.discoveryEvent.create({ data: { subject: 'v:old', kind: 'view', country: 'NG', at: new Date(Date.now() - 91 * 86_400_000) } });
    await prisma.interestProfile.create({ data: { subject: 'v:old', country: 'NG', lastSeenAt: new Date(Date.now() - 181 * 86_400_000) } });
    const kept = await prisma.discoveryEvent.count();
    assert.deepEqual(await jobs.purge(), { events: 1, profiles: 1, search_days: 0 });
    assert.equal(await prisma.discoveryEvent.count({ where: { id: old.id } }), 0);
    assert.equal(await prisma.discoveryEvent.count(), kept - 1);
  });
});

describe('admins', () => {
  test('Reports > Discovery: searches, sources, personalised against holdout, by day and kind', async () => {
    const res = await support.get('/v1/admin/classifieds/discovery?country=NG&days=30');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const summary = res.json;
    assert.deepEqual(Object.keys(summary).sort(), ['country', 'daily', 'days', 'enabled', 'for_you', 'from', 'kinds', 'object', 'sources', 'to', 'top_queries', 'totals', 'zero_result_queries'].sort());
    assert.deepEqual([summary.object, summary.country, summary.days, summary.enabled], ['discovery_summary', 'NG', 30, true]);
    assert.deepEqual(summary.for_you.map(row => row.group), ['personalised', 'holdout']);
    assert.ok(summary.top_queries.some(row => row.query === 'samsung tv'));
    assert.ok(summary.zero_result_queries.some(row => row.query === 'gold watch'));
    assert.ok(summary.kinds.length > 0 && summary.daily.length > 0);
    assert.equal((await support.get('/v1/admin/classifieds/discovery?days=12')).status, 400);
    const finance = await adminClient(server, ['finance']);
    assert.equal((await finance.get('/v1/admin/classifieds/discovery')).status, 403);
  });

  test("a personal rail holds its place on a country's home page, never across countries", async () => {
    const block = { id: 'fy', type: 'personal_rail', span: { lg: 12, md: 6 }, title: 'Picked for you', kind: 'recent', limit: 8 };
    const saved = await admin.put('/v1/admin/classifieds/home/NG/draft', { rows: [{ id: 'r-fy', blocks: [block] }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const resolved = await admin.post('/v1/admin/classifieds/home/NG/resolve', { rows: saved.json.rows });
    assert.deepEqual(resolved.json.rows[0].blocks[0].data, { kind: 'recent' });
    const global = await admin.put('/v1/admin/classifieds/home/global/draft', { rows: [{ id: 'r-fy', blocks: [block] }] });
    assert.equal(global.json.error?.code, 'layout_invalid');
  });
});
