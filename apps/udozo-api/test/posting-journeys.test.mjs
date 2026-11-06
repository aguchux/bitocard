// Udozo's posting journeys (Reports > Posting journeys): each ad's way from the seller pressing Sell to the ad live and
// its first results, with the wizard's steps (never what was typed), the listing routes' refusals and moderators'
// decisions (with their reason codes); journeys are rolled into daily counts and deleted after their time.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let admin;
let support;
let prisma;
let journeys;
let views;
const day = 24 * 60 * 60 * 1000;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  journeys = server.app.get((await import('../dist/postings/journeys.service.js')).PostingJourneysService);
  views = server.app.get((await import('../dist/classifieds/home/views.service.js')).ListingViewsService);
  admin = await adminClient(server);
  support = await adminClient(server, ['support']);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
});

after(() => server?.close());

/** udozo.com's server: the seller's session, forwarding the visitor's browser as the site does. */
function site(agent = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36') {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        'bitocard-client-agent': agent,
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `posting-${Date.now()}-${Math.random()}` } : {}),
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
async function seller() {
  const browser = site();
  const email = `poster${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await browser.post('/v1/store/account/signup', { name: 'Ngozi Adeyemi', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, browser);
  assert.equal((await browser.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await browser.post('/v1/classifieds/terms/accept', { version: (await browser.get('/v1/classifieds/terms')).json.version });
  browser.id = signup.json.customer.id;
  browser.email = email;
  return browser;
}

const ids = async () => {
  const [phones, ikeja] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'mobile-phones' } }), prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', slug: 'ikeja' } })]);
  return { phones: phones.id, top: phones.parentId, ikeja: ikeja.id };
};
const fullAd = async () => {
  const { phones, ikeja } = await ids();
  return { category_id: phones, area_id: ikeja, title: 'Samsung Galaxy A54, 128 GB', description: 'Clean, with its box.', price: 25000000, condition: 'used', features: [{ key: 'brand', value: 'Samsung' }] };
};
const addPhotos = (listingId, count = 4) =>
  prisma.classifiedMedia.createMany({ data: Array.from({ length: count }, (_, position) => ({ listingId, kind: 'photo', position, url: `https://media.test/${listingId}/${position}.jpg`, width: 1600, height: 1200 })) });
const event = (browser, body) => browser.post('/v1/classifieds/posting-journeys/events', body);
const journeyOf = async listingId => {
  await journeys.idle();
  return prisma.postingJourney.findUnique({ where: { listingId }, include: { events: { orderBy: { createdAt: 'asc' } } } });
};
const open = async customerId => {
  await journeys.idle();
  return prisma.postingJourney.findFirst({ where: { customerId }, orderBy: { startedAt: 'desc' }, include: { events: { orderBy: { createdAt: 'asc' } } } });
};

describe('a journey from Sell to first results', () => {
  test('the wizard, refusals, review sent back with a reason, resubmitted, approved, then a view, a chat and sold', async () => {
    const browser = await seller();
    assert.equal((await event(browser, { type: 'sell_opened', source: 'header' })).status, 200);
    const started = await open(browser.id);
    assert.deepEqual([started.source, started.stage, started.listingId, started.device, Boolean(started.openedAt)], ['header', 'composing', null, 'Chrome on Android', true]);

    // A step refused in the browser: the step and the field only.
    await event(browser, { type: 'step_refused', step: 'basics', param: 'title' });
    const draft = await browser.post('/v1/classifieds/listings', { title: 'Samsung Galaxy A54' });
    assert.equal(draft.status, 201);
    const id = draft.json.id;
    let journey = await journeyOf(id);
    assert.equal(journey.id, started.id, 'the draft is tied to the journey Sell opened');
    assert.ok(journey.draftAt);
    assert.equal(journey.listingRef, BigInt(draft.json.ref));

    await event(browser, { type: 'step_reached', step: 'media', listing_id: id });
    await event(browser, { type: 'step_reached', step: 'media', listing_id: id });
    await event(browser, { type: 'step_reached', step: 'details', listing_id: id });
    const before = (await journeyOf(id)).eventCount;
    assert.equal((await browser.patch(`/v1/classifieds/listings/${id}`, await fullAd())).status, 200);
    journey = await journeyOf(id);
    assert.equal(journey.eventCount, before, 'a save (autosave) adds no step');
    assert.equal(journey.topCategoryId, (await ids()).top);

    const refused = await browser.post(`/v1/classifieds/listings/${id}/submit`);
    assert.equal(refused.json.error.code, 'photos_required');
    await addPhotos(id);
    const submitted = await browser.post(`/v1/classifieds/listings/${id}/submit`);
    assert.equal(submitted.json.status, 'pending_review', 'a new seller’s first ads are reviewed');
    journey = await journeyOf(id);
    assert.deepEqual([journey.stage, journey.furthestStep, journey.submitAttempts, journey.reviewFlags], ['in_review', 5, 2, ['first_listings']]);
    assert.deepEqual(
      journey.events.map(item => [item.origin, item.step, item.outcome, item.code, item.param]),
      [
        ['client', 'sell_opened', 'ok', null, null],
        ['client', 'step_basics', 'refused', 'step_incomplete', 'title'],
        ['api', 'create', 'ok', null, null],
        ['client', 'step_media', 'ok', null, null],
        ['client', 'step_details', 'ok', null, null],
        ['api', 'submit', 'refused', 'photos_required', 'photos'],
        ['api', 'submit', 'ok', null, null],
        ['system', 'review_queued', 'ok', 'first_listings', null],
      ],
    );

    // Sent back with a reason code: the seller reads the code's own sentence when no note is written.
    const sent = await admin.post(`/v1/admin/classifieds/listings/${id}/reject`, { reason_code: 'photos' });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.review_reason_code, 'photos');
    assert.ok(sent.json.reviewed_at);
    const listing = await prisma.classifiedListing.findUniqueOrThrow({ where: { id } });
    assert.match(listing.reviewReason, /photos need to show the item clearly/);
    journey = await journeyOf(id);
    assert.deepEqual([journey.stage, journey.lastRejectCode, journey.sentBackCount, journey.reviews, Boolean(journey.reviewedAt)], ['sent_back', 'photos', 1, 1, true]);

    assert.equal((await browser.post(`/v1/classifieds/listings/${id}/submit`)).json.status, 'pending_review');
    journey = await journeyOf(id);
    assert.deepEqual([journey.stage, Boolean(journey.resubmittedAt)], ['in_review', true]);
    assert.equal(journey.events.at(-2).step, 'resubmit');

    assert.equal((await admin.post(`/v1/admin/classifieds/listings/${id}/approve`, {})).status, 200);
    journey = await journeyOf(id);
    assert.deepEqual([journey.stage, journey.liveVia, journey.reviews, Boolean(journey.liveAt)], ['live', 'review', 2, true]);

    // First results: the first view, then a buyer's chat (read by the job), then sold.
    await views.record(Number(draft.json.ref), { address: '203.0.113.9', userAgent: 'Mozilla/5.0 Firefox/130.0', customerId: null });
    await views.record(Number(draft.json.ref), { address: '203.0.113.10', userAgent: 'Mozilla/5.0 Firefox/130.0', customerId: null });
    journey = await journeyOf(id);
    assert.ok(journey.firstViewAt);
    assert.equal(journey.events.filter(item => item.step === 'first_view').length, 1, 'only the first view');

    const buyer = await seller();
    assert.equal((await buyer.post('/v1/classifieds/conversations', { listing_id: id, body: 'Is it still available?' })).status, 201);
    assert.equal((await journeys.syncResults()).posting_results, 1);
    assert.equal((await journeys.syncResults()).posting_results, 0, 'nothing changes the second time');
    journey = await journeyOf(id);
    assert.ok(journey.firstChatAt && journey.firstLeadAt);

    assert.equal((await browser.post(`/v1/classifieds/listings/${id}/sold`)).status, 200);
    journey = await journeyOf(id);
    assert.ok(journey.soldAt);

    // The report: this journey's milestones, status and timeline (viewing it is audited).
    const listed = await admin.get(`/v1/admin/posting-journeys?q=${browser.email}`);
    assert.equal(listed.json.data.length, 1);
    const row = listed.json.data[0];
    assert.deepEqual([row.status, row.source, row.listing.ref, row.last_reject_code, row.live_via, row.furthest_step], ['sold', 'header', draft.json.ref, 'photos', 'review', 'post']);
    assert.equal((await admin.get(`/v1/admin/posting-journeys?q=${draft.json.ref}`)).json.data[0].id, row.id);
    const detail = await support.get(`/v1/admin/posting-journeys/${row.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.events.find(item => item.step === 'sent_back').code, 'photos');
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'posting_journey.viewed', targetId: row.id } }));
  });
});

describe('which journey a step belongs to', () => {
  test('Sell within a day carries on; a day later a new journey starts and the old one is abandoned before a draft', async () => {
    const browser = await seller();
    await event(browser, { type: 'sell_opened', source: 'my_listings' });
    await event(browser, { type: 'sell_opened', source: 'header' });
    const first = await open(browser.id);
    assert.equal(await prisma.postingJourney.count({ where: { customerId: browser.id } }), 1);
    assert.equal(first.source, 'my_listings');
    await prisma.postingJourney.update({ where: { id: first.id }, data: { lastEventAt: new Date(Date.now() - 2 * day) } });
    await event(browser, { type: 'sell_opened', source: 'pwa' });
    await journeys.idle();
    const old = await prisma.postingJourney.findUniqueOrThrow({ where: { id: first.id } });
    assert.deepEqual([old.stage, old.endedReason], ['abandoned', 'never_drafted']);
    assert.equal((await open(browser.id)).source, 'pwa');
  });

  test('a draft made without Sell starts at the draft; deleting a draft abandons it; a live ad edited is no journey', async () => {
    const browser = await seller();
    const draft = await browser.post('/v1/classifieds/listings', { title: 'Hisense 43 inch TV' });
    let journey = await journeyOf(draft.json.id);
    assert.deepEqual([journey.source, journey.openedAt, Boolean(journey.draftAt)], ['api', null, true]);
    assert.equal((await browser.delete(`/v1/classifieds/listings/${draft.json.id}`)).status, 204);
    journey = await journeyOf(draft.json.id);
    assert.deepEqual([journey.stage, journey.endedReason], ['abandoned', 'draft_deleted']);

    // An ad from before journeys were kept: reopened as a draft it starts one (`resumed`); live, editing it is not posting.
    const old = await browser.post('/v1/classifieds/listings', { title: 'Old draft from before' });
    await journeys.idle();
    await prisma.postingJourney.deleteMany({ where: { listingId: old.json.id } });
    await event(browser, { type: 'form_resumed', listing_id: old.json.id });
    assert.equal((await journeyOf(old.json.id)).source, 'resumed');
    const made = await browser.post('/v1/classifieds/listings', await fullAd());
    await journeys.idle();
    await prisma.postingJourney.deleteMany({ where: { listingId: made.json.id } });
    await prisma.classifiedListing.update({ where: { id: made.json.id }, data: { status: 'active', publishedAt: new Date() } });
    await event(browser, { type: 'form_resumed', listing_id: made.json.id });
    assert.equal((await browser.patch(`/v1/classifieds/listings/${made.json.id}`, { description: 'Clean, with its box and charger.' })).status, 200);
    assert.equal(await journeyOf(made.json.id), null);
  });

  test('the wizard can send nothing a seller typed, and another seller’s listing is ignored', async () => {
    const browser = await seller();
    for (const body of [
      { type: 'step_refused', step: 'basics', param: 'title', title: 'iPhone 15 Pro' },
      { type: 'step_reached', step: 'anything' },
      { type: 'step_refused', step: 'basics', param: 'my phone is 0803…' },
      { type: 'typed', value: 'x' },
      { type: 'sell_opened', source: 'https://example.com' },
    ]) {
      assert.equal((await event(browser, body)).status, 400, JSON.stringify(body));
    }
    const other = await seller();
    const theirs = await other.post('/v1/classifieds/listings', { title: 'Their draft' });
    await event(browser, { type: 'form_resumed', listing_id: theirs.json.id });
    assert.equal((await journeyOf(theirs.json.id)).customerId, other.id);
    assert.equal(await prisma.postingJourney.count({ where: { customerId: browser.id } }), 0);
    // Signed out: refused.
    assert.equal((await site().post('/v1/classifieds/posting-journeys/events', { type: 'post_pressed' })).status, 401);
  });
});

describe('moderators’ reasons', () => {
  test('a reason code, a note, or the old free text; Other needs a note; removing records it too', async () => {
    const browser = await seller();
    const make = async () => {
      const draft = await browser.post('/v1/classifieds/listings', await fullAd());
      await addPhotos(draft.json.id);
      assert.equal((await browser.post(`/v1/classifieds/listings/${draft.json.id}/submit`)).json.status, 'pending_review');
      return draft.json.id;
    };
    const first = await make();
    assert.equal((await admin.post(`/v1/admin/classifieds/listings/${first}/reject`, {})).json.error.code, 'parameter_missing');
    assert.equal((await admin.post(`/v1/admin/classifieds/listings/${first}/reject`, { reason_code: 'other' })).json.error.param, 'note');
    assert.equal((await admin.post(`/v1/admin/classifieds/listings/${first}/reject`, { reason_code: 'nonsense' })).status, 400);
    const legacy = await admin.post(`/v1/admin/classifieds/listings/${first}/reject`, { reason: 'Show the screen switched on.' });
    assert.deepEqual([legacy.json.review_reason_code, legacy.json.review_reason], ['other', 'Show the screen switched on.']);

    const second = await make();
    const noted = await admin.post(`/v1/admin/classifieds/listings/${second}/reject`, { reason_code: 'wrong_category', note: 'This is a tablet: choose Tablets.' });
    assert.deepEqual([noted.json.review_reason_code, noted.json.review_reason], ['wrong_category', 'This is a tablet: choose Tablets.']);

    const third = await make();
    const removed = await admin.post(`/v1/admin/classifieds/listings/${third}/remove`, { reason_code: 'prohibited_item' });
    assert.deepEqual([removed.json.status, removed.json.review_reason_code], ['removed', 'prohibited_item']);
    const journey = await journeyOf(third);
    assert.deepEqual([journey.stage, journey.endedReason, journey.lastRejectCode], ['removed', 'removed', 'prohibited_item']);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'classifieds.listing_removed', targetId: third } });
    assert.equal(audit.after.code, 'prohibited_item');

    const summary = (await admin.get('/v1/admin/posting-journeys/summary?days=7')).json;
    const reasons = Object.fromEntries(summary.review.reasons.map(item => [item.code, item.count]));
    assert.ok(reasons.other >= 1 && reasons.wrong_category >= 1 && reasons.prohibited_item >= 1, JSON.stringify(reasons));
    assert.ok(summary.review.flags.some(item => item.flag === 'first_listings'));
  });
});

describe('the report and its retention', () => {
  test('visits are counted by source, nothing else; the summary has the funnel, blockers and breakdowns', async () => {
    const visit = body => fetch(`${server.base}/v1/posting-journeys/visits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await visit({ source: 'header', signed_in: false })).status, 200);
    assert.equal((await visit({ source: 'header', signed_in: true })).status, 200);
    assert.equal((await visit({ source: 'somewhere', signed_in: true })).status, 400);
    const summary = await admin.get('/v1/admin/posting-journeys/summary?days=30');
    assert.equal(summary.status, 200);
    assert.ok(summary.json.visits.signed_out >= 1 && summary.json.visits.signed_in >= 1);
    const funnel = Object.fromEntries(summary.json.funnel.map(item => [item.milestone, item.count]));
    assert.ok(funnel.draft >= funnel.submitted && funnel.submitted >= funnel.live && funnel.live >= 1, JSON.stringify(funnel));
    assert.ok(summary.json.blockers.some(item => item.origin === 'api' && item.code === 'photos_required'));
    assert.ok(summary.json.blockers.some(item => item.origin === 'client' && item.param === 'title'));
    assert.ok(summary.json.sources.some(item => item.key === 'header'));
    assert.ok(summary.json.categories.some(item => item.label));
    assert.equal(summary.json.daily.length, 30);
    // Filtered by source: blockers and reviews count only journeys still kept.
    assert.equal((await admin.get('/v1/admin/posting-journeys/summary?source=api')).json.source, 'api');
    // Stuck: composing and quiet a day.
    const browser = await seller();
    await event(browser, { type: 'sell_opened', source: 'start_here' });
    const journey = await open(browser.id);
    await prisma.postingJourney.update({ where: { id: journey.id }, data: { lastEventAt: new Date(Date.now() - 2 * day) } });
    const stuck = await admin.get('/v1/admin/posting-journeys?stuck_at=draft&source=start_here');
    assert.ok(stuck.json.data.some(item => item.id === journey.id && item.status === 'stuck'));
  });

  test('journeys past their time are rolled into daily counts and deleted, once; the report keeps them', async () => {
    const browser = await seller();
    await event(browser, { type: 'sell_opened', source: 'invite' });
    await event(browser, { type: 'step_refused', step: 'basics', param: 'category_id' });
    const journey = await open(browser.id);
    const long = new Date(Date.now() - 5 * day);
    await prisma.postingJourney.update({ where: { id: journey.id }, data: { startedAt: long, lastEventAt: long } });
    const purgedAt = new Date(Date.now() + 40 * day);
    const before = (await admin.get('/v1/admin/posting-journeys/summary?days=7&source=invite')).json;
    const first = await journeys.purge(purgedAt);
    assert.ok(first.journeys_rolled_up >= 1);
    assert.equal(await prisma.postingJourney.count({ where: { id: journey.id } }), 0);
    const row = await prisma.postingFunnelDay.findFirst({ where: { source: 'invite' } });
    assert.ok(row.started >= 1 && row.opened >= 1);
    assert.ok(await prisma.postingBlockerDay.findFirst({ where: { origin: 'client', param: 'category_id' } }));
    const again = await journeys.purge(purgedAt);
    assert.equal(await prisma.postingFunnelDay.aggregate({ _sum: { started: true }, where: { source: 'invite' } }).then(sum => sum._sum.started), row.started, 'nothing counted twice');
    assert.ok(again.journeys_rolled_up >= 0);
    const after = (await admin.get('/v1/admin/posting-journeys/summary?days=7&source=invite')).json;
    assert.equal(after.totals.started, before.totals.started, 'the report still counts it');
  });

  test('the daily job puts right what a missed step left (a listing gone live), and support reads but the routes are Udozo admins’', async () => {
    const browser = await seller();
    const draft = await browser.post('/v1/classifieds/listings', await fullAd());
    await journeys.idle();
    await prisma.classifiedListing.update({ where: { id: draft.json.id }, data: { status: 'active', publishedAt: new Date(), submittedAt: new Date() } });
    const run = await fetch(`${server.base}/v1/cron/marketing`, { headers: { authorization: 'Bearer cron-secret' } }).then(res => res.json());
    assert.ok(run.result.posting_journeys.reconciled >= 1, JSON.stringify(run.result.posting_journeys));
    const journey = await journeyOf(draft.json.id);
    assert.deepEqual([journey.stage, journey.liveVia, journey.furthestStep], ['live', 'direct', 5]);
    assert.equal((await support.get('/v1/admin/posting-journeys/summary')).status, 200);
    assert.equal((await site().get('/v1/admin/posting-journeys/summary')).status, 401);
  });

  test('deleting a seller deletes their journeys', async () => {
    const browser = await seller();
    await event(browser, { type: 'sell_opened', source: 'header' });
    await journeys.idle();
    assert.equal(await prisma.postingJourney.count({ where: { customerId: browser.id } }), 1);
    await prisma.customer.delete({ where: { id: browser.id } });
    assert.equal(await prisma.postingJourney.count({ where: { customerId: browser.id } }), 0);
  });
});
