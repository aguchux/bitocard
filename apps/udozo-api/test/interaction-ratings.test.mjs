// Interaction ratings (docs/UDOZO_RATINGS_PLAN.md phase 2): after really being in touch about a listing (a chat, a
// call, a call back or contact request), a buyer privately rates how the seller dealt with them. The seller sees only
// an anonymous summary of five or more, counted up to last midnight; admins see everything and can leave one out.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let ratings;
const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  ratings = server.app.get((await import('../dist/classifieds/ratings/interaction-ratings.service.js')).InteractionRatingsService);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'classifieds_interaction_ratings']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(async () => {
  await server?.close();
});

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `rating-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function customer(name) {
  const shopper = storeServer();
  const email = `rating${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

async function live(seller, title) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: area.id })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

const scores = { responsiveness: 4, helpfulness: 5, courtesy: 3 };
const state = (buyer, listing, prompt = false) => buyer.get(`/v1/classifieds/interaction-ratings/state?listing_id=${listing.id}${prompt ? '&prompt=true' : ''}`);

/** A buyer who wrote twice and got a reply: a chat that counts. */
async function chatted(buyer, seller, listing) {
  const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: listing.id, body: 'Is it still available?' })).json;
  assert.ok(chat.id, JSON.stringify(chat));
  assert.equal((await seller.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Yes it is' })).status, 201);
  assert.equal((await buyer.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Can I see it tomorrow?' })).status, 201);
  return chat;
}

describe('Interaction ratings', () => {
  test('a chat counts once both sides wrote; one rating per listing, private, editable, a safety tag tells admins', async () => {
    const seller = await customer('Chinedu Okafor');
    const buyer = await customer('Kemi Adeyemi');
    const tv = await live(seller, 'Hisense 50 inch TV');

    const before = (await state(buyer, tv)).json;
    assert.deepEqual([before.open, before.can_rate, before.reason], [true, false, 'nothing_yet']);
    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: tv.id, ...scores })).json.error.code, 'rating_not_open');

    const chat = (await buyer.post('/v1/classifieds/conversations', { listing_id: tv.id, body: 'Is it still available?' })).json;
    assert.equal((await state(buyer, tv)).json.reason, 'nothing_yet', 'one message and no reply yet');
    await seller.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Yes it is' });
    assert.equal((await state(buyer, tv)).json.reason, 'nothing_yet', 'the buyer wrote only once');
    await buyer.post(`/v1/classifieds/conversations/${chat.id}/messages`, { body: 'Can I see it tomorrow?' });
    const ready = (await state(buyer, tv)).json;
    assert.deepEqual([ready.can_rate, ready.channels], [true, ['chat']]);
    assert.deepEqual([(await state(seller, tv)).json.can_rate, (await state(seller, tv)).json.reason], [false, 'own_listing']);

    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: tv.id, ...scores, responsiveness: 6 })).status, 400);
    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: tv.id, ...scores, tags: ['lovely'] })).status, 400);
    const made = await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: tv.id, ...scores, tags: ['answered_fast', 'pay_outside'], comment: 'Asked me to send money to 08031234567 first' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.channel, 'chat');
    assert.doesNotMatch(made.json.comment, /08031234567/, 'numbers hidden');
    assert.equal((await prisma.classifiedInteractionRating.findUniqueOrThrow({ where: { id: made.json.id } })).flagged, true);
    assert.equal(await prisma.notification.count({ where: { type: 'admin.classifieds.interaction_flagged' } }), 1);
    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: tv.id, ...scores })).json.error.code, 'rating_given');
    assert.equal((await state(buyer, tv)).json.rating.id, made.json.id);

    const changed = await buyer.patch(`/v1/classifieds/interaction-ratings/${made.json.id}`, { courtesy: 1, tags: ['rude'] });
    assert.deepEqual([changed.json.courtesy, changed.json.tags], [1, ['rude']]);
    assert.equal((await prisma.classifiedInteractionRating.findUniqueOrThrow({ where: { id: made.json.id } })).flagged, false);
    assert.equal((await seller.patch(`/v1/classifieds/interaction-ratings/${made.json.id}`, { courtesy: 5 })).status, 404, 'only its writer');
    await prisma.classifiedInteractionRating.update({ where: { id: made.json.id }, data: { createdAt: new Date(Date.now() - 31 * dayMs) } });
    assert.equal((await buyer.patch(`/v1/classifieds/interaction-ratings/${made.json.id}`, { courtesy: 2 })).json.error.code, 'rating_edit_closed');
  });

  test('calls and requests count; once per seller in 30 days, ten a day', async () => {
    const seller = await customer('Ada Eze');
    const buyer = await customer('Tunde Bello');
    const [one, two, three] = [await live(seller, 'Sony speaker'), await live(seller, 'LG fridge'), await live(seller, 'Dell laptop')];
    // A missed call that rang 5 seconds does not count; one that rang 12 does; an answered one does.
    const rang = seconds => ({ listingId: one.id, callerId: buyer.id, calleeId: seller.id, country: 'NG', status: 'missed', createdAt: new Date(Date.now() - 60_000), endedAt: new Date(Date.now() - 60_000 + seconds * 1000) });
    await prisma.classifiedCall.create({ data: rang(5) });
    assert.equal((await state(buyer, one)).json.can_rate, false);
    await prisma.classifiedCall.create({ data: rang(12) });
    assert.deepEqual((await state(buyer, one)).json.channels, ['call']);
    // A contact request counts once answered, or after two days.
    const request = await prisma.classifiedContactRequest.create({ data: { kind: 'contact', listingId: two.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG' } });
    assert.equal((await state(buyer, two)).json.can_rate, false);
    await prisma.classifiedContactRequest.update({ where: { id: request.id }, data: { createdAt: new Date(Date.now() - 49 * hourMs) } });
    assert.deepEqual((await state(buyer, two)).json.channels, ['contact']);
    await prisma.classifiedContactRequest.create({ data: { kind: 'callback', listingId: three.id, buyerId: buyer.id, sellerId: seller.id, country: 'NG', status: 'done', answeredAt: new Date() } });

    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: one.id, ...scores, channel: 'chat' })).json.error.code, 'rating_not_open', 'only a way they were in touch');
    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: one.id, ...scores })).json.channel, 'call');
    assert.equal((await state(buyer, two)).json.reason, 'seller_rated_recently');
    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: two.id, ...scores })).json.error.code, 'seller_rated_recently');
    await prisma.classifiedInteractionRating.updateMany({ where: { raterId: buyer.id }, data: { createdAt: new Date(Date.now() - 31 * dayMs) } });
    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: three.id, ...scores })).json.channel, 'callback');

    // Ten a day across sellers.
    const busy = await customer('Busy Buyer');
    for (let index = 0; index < 10; index += 1) {
      const other = await customer(`Seller ${index}`);
      const listing = await live(other, `Item ${index}`);
      await prisma.classifiedContactRequest.create({ data: { kind: 'contact', listingId: listing.id, buyerId: busy.id, sellerId: other.id, country: 'NG', status: 'accepted', answeredAt: new Date() } });
      if (index < 10) assert.equal((await busy.post('/v1/classifieds/interaction-ratings', { listing_id: listing.id, ...scores })).status, 201);
    }
    const eleventh = await customer('Seller 11');
    const item = await live(eleventh, 'Item 11');
    await prisma.classifiedContactRequest.create({ data: { kind: 'contact', listingId: item.id, buyerId: busy.id, sellerId: eleventh.id, country: 'NG', status: 'accepted', answeredAt: new Date() } });
    assert.equal((await busy.post('/v1/classifieds/interaction-ratings', { listing_id: item.id, ...scores })).json.error.code, 'rating_limit');
  });

  test('asked about one listing a day; not now is never asked again', async () => {
    const seller = await customer('Prompt Seller');
    const buyer = await customer('Prompt Buyer');
    const [first, second] = [await live(seller, 'Canon camera'), await live(seller, 'Nikon camera')];
    await chatted(buyer, seller, first);
    await chatted(buyer, seller, second);
    assert.equal((await state(buyer, first)).json.prompt, false, 'asking only when asked to');
    assert.equal((await state(buyer, first, true)).json.prompt, true);
    assert.equal((await state(buyer, first, true)).json.prompt, true, 'the same listing again today');
    assert.equal((await state(buyer, second, true)).json.prompt, false, 'another listing waits a day');
    assert.equal((await buyer.post('/v1/classifieds/interaction-ratings/prompt/dismiss', { listing_id: first.id })).json.dismissed, true);
    assert.equal((await state(buyer, first, true)).json.prompt, false);
    await prisma.classifiedInteractionPrompt.updateMany({ where: { customerId: buyer.id }, data: { shownAt: new Date(Date.now() - 2 * dayMs) } });
    assert.equal((await state(buyer, second, true)).json.prompt, true);
    assert.equal((await state(buyer, first, true)).json.prompt, false, 'not now stays');
  });

  test("the seller's summary: anonymous, from five, up to last midnight; admins see everything and can leave one out", async () => {
    const seller = await customer('Summary Seller');
    const raters = [];
    for (let index = 0; index < 5; index += 1) {
      const buyer = await customer(`Rater ${index}`);
      const listing = await live(seller, `Phone ${index}`);
      await chatted(buyer, seller, listing);
      const made = await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: listing.id, responsiveness: index === 4 ? 1 : 5, helpfulness: 4, courtesy: 4, tags: index < 3 ? ['answered_fast'] : ['pushy'], comment: 'A note for Udozo' });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      raters.push(made.json);
    }
    let summary = (await seller.get('/v1/classifieds/me/ratings')).json;
    assert.deepEqual([summary.shown, summary.count, summary.scores], [false, null, null], "today's ratings wait for midnight");
    await prisma.classifiedInteractionRating.updateMany({ where: { sellerId: seller.id }, data: { createdAt: new Date(Date.now() - 2 * dayMs) } });
    summary = (await seller.get('/v1/classifieds/me/ratings')).json;
    assert.deepEqual([summary.shown, summary.count], [true, 5]);
    assert.deepEqual(summary.scores, { responsiveness: 4.2, helpfulness: 4, courtesy: 4 });
    assert.deepEqual(summary.tags, [{ tag: 'answered_fast', count: 3 }, { tag: 'pushy', count: 2 }]);
    const text = JSON.stringify(summary);
    for (const leak of ['Rater', 'A note for Udozo', 'listing', 'channel', raters[0].id]) assert.ok(!text.includes(leak), `no ${leak} for the seller`);

    const seen = (await admin.get(`/v1/admin/classifieds/sellers/${seller.id}/ratings`)).json;
    assert.deepEqual([seen.count, seen.data.length, seen.data[0].comment, typeof seen.data[0].rater.email], [5, 5, 'A note for Udozo', 'string']);
    const excluded = await admin.post(`/v1/admin/classifieds/interaction-ratings/${raters[4].id}/exclude`, { reason: 'Rated by a rival seller' });
    assert.equal(excluded.status, 200, JSON.stringify(excluded.json));
    assert.equal(excluded.json.excluded.reason, 'Rated by a rival seller');
    assert.equal((await seller.get('/v1/classifieds/me/ratings')).json.shown, false, 'four left: hidden again');
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.interaction_rating_excluded', targetId: raters[4].id } }), 1);
    await admin.post(`/v1/admin/classifieds/interaction-ratings/${raters[4].id}/restore`, { reason: 'Checked, it was real' });
    assert.equal((await seller.get('/v1/classifieds/me/ratings')).json.count, 5);
    assert.ok((await admin.get('/v1/admin/classifieds/interaction-ratings?flagged=true')).json.counts.flagged >= 0);
  });

  test('switched off: not asked, not written; retention', async () => {
    const seller = await customer('Off Seller');
    const buyer = await customer('Off Buyer');
    const tv = await live(seller, 'Panasonic TV');
    await chatted(buyer, seller, tv);
    assert.equal((await admin.put('/v1/admin/switches/classifieds_interaction_ratings', { country_code: 'NG', enabled: false })).status, 200);
    try {
      const off = (await state(buyer, tv, true)).json;
      assert.deepEqual([off.open, off.can_rate, off.prompt], [false, false, false]);
      assert.equal((await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: tv.id, ...scores })).json.error.code, 'ratings_unavailable');
      assert.equal((await seller.get('/v1/classifieds/me/ratings')).json.open, false);
    } finally {
      assert.equal((await admin.put('/v1/admin/switches/classifieds_interaction_ratings', { country_code: 'NG', enabled: true })).status, 200);
    }
    const made = (await buyer.post('/v1/classifieds/interaction-ratings', { listing_id: tv.id, ...scores })).json;
    await prisma.classifiedInteractionRating.update({ where: { id: made.id }, data: { createdAt: new Date(Date.now() - 800 * dayMs) } });
    const purged = await ratings.purge();
    assert.ok(purged.ratings >= 1);
    assert.equal(await prisma.classifiedInteractionRating.count({ where: { id: made.id } }), 0);
  });
});
