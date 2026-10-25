// BitoCard Shop, phase 1 step 2d: automatic checks (refused and doubtful words, a price far below the usual, another
// seller's photo, posting too fast), customers' reports, and the moderators' queue and decisions, audited.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, lastEmailCode, startApp } from './helpers.mjs';

let server;
let admin;
let support;
let prisma;

before(async () => {
  server = await startApp();
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server, ['operations']);
  support = await adminClient(server, ['support']);
  const root = await adminClient(server);
  assert.equal((await root.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0, monthlyListingLimit: 1000 } });
});

after(() => server?.close());

function storeServer() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `shop-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function customer() {
  const shopper = storeServer();
  const email = `moderation${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Tunde Bakare', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  shopper.id = signup.json.customer.id;
  shopper.email = email;
  return shopper;
}

let photoHash = 0;
async function draft(shopper, { title = 'Generator for sale, 3.5 kVA', description = 'Works well.', price = 48000000, category = 'generators-solar', hashes } = {}) {
  const [cat, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: category } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'surulere' } })]);
  const created = await shopper.post('/v1/classifieds/listings', { title, description, price, condition: 'used', category_id: cat.id, area_id: area.id });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const own = hashes ?? [0, 1, 2, 3].map(() => `hash-${(photoHash += 1)}`);
  await prisma.classifiedMedia.createMany({ data: own.map((contentHash, position) => ({ listingId: created.json.id, kind: 'photo', position, url: `https://media.test/${contentHash}.jpg`, width: 1600, height: 1200, contentHash })) });
  return created.json;
}
const submit = (shopper, listing) => shopper.post(`/v1/classifieds/listings/${listing.id}/submit`);

describe('automatic checks', () => {
  test('refused words stop a listing; doubtful words send it to a moderator', async () => {
    const shopper = await customer();
    const gun = await draft(shopper, { title: 'Pistol with bullets, clean' });
    const refused = await submit(shopper, gun);
    assert.deepEqual([refused.status, refused.json.error.code], [400, 'listing_prohibited']);
    const replica = await draft(shopper, { title: 'Rolex watch', description: 'Very good replica, looks real.', category: 'jewellery-watches' });
    const flagged = await submit(shopper, replica);
    assert.deepEqual([flagged.json.status, flagged.json.review_flags], ['pending_review', ['prohibited_words']]);
    const clean = await submit(shopper, await draft(shopper, { title: 'Glue gun and sticks' }));
    assert.deepEqual(clean.json.review_flags, ['prohibited_words'], '"gun" alone is only doubtful');
    assert.equal((await submit(shopper, await draft(shopper, { title: 'Gunmetal grey sofa', category: 'furniture' }))).json.status, 'active', 'whole words only');
  });

  test("a price far below the category's usual, another seller's photo, and posting too fast", async () => {
    // Eight live listings make a usual price (two sellers, so neither posts too fast).
    const sellers = [await customer(), await customer()];
    for (let i = 0; i < 8; i += 1) {
      const market = sellers[i % 2];
      assert.equal((await submit(market, await draft(market, { title: `Solar panel 400 W number ${i + 1}`, price: 30000000 + i * 100000 }))).json.status, 'active');
    }
    const cheap = await customer();
    const bait = await submit(cheap, await draft(cheap, { title: 'Solar panel 400 W, almost free', price: 5000000 }));
    assert.deepEqual(bait.json.review_flags, ['price_low']);

    const thief = await customer();
    const theirs = await prisma.classifiedMedia.findFirstOrThrow({ where: { listing: { customerId: sellers[0].id, status: 'active' } } });
    const copied = await submit(thief, await draft(thief, { title: 'Generator 5 kVA, like new', hashes: [theirs.contentHash, 'mine-1', 'mine-2', 'mine-3'] }));
    assert.ok(copied.json.review_flags.includes('photo_reused'), JSON.stringify(copied.json.review_flags));
    const sameSeller = await customer();
    const first = await draft(sameSeller, { title: 'Inverter battery 200 Ah', hashes: ['own-1', 'own-2', 'own-3', 'own-4'] });
    await submit(sameSeller, first);
    const repost = await submit(sameSeller, await draft(sameSeller, { title: 'Inverter battery 200 Ah again', hashes: ['own-1', 'own-5', 'own-6', 'own-7'] }));
    assert.ok(!repost.json.review_flags.includes('photo_reused'), "a seller's own photos are theirs to reuse");

    const busy = await customer();
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await submit(busy, await draft(busy, { title: `Stabiliser 5000 VA, unit ${i + 1}` }))).json.review_flags);
    assert.deepEqual(statuses.at(-1), ['posting_fast']);
    assert.ok(statuses.slice(0, 5).every(flags => !flags.includes('posting_fast')));
  });

  test('a live listing edited to say something doubtful goes back to review', async () => {
    const shopper = await customer();
    const live = await submit(shopper, await draft(shopper, { title: 'Generator, Sumec Firman 2.8 kVA' }));
    assert.equal(live.json.status, 'active');
    const edited = await shopper.patch(`/v1/classifieds/listings/${live.json.id}`, { description: 'Pay inspection fee before viewing.' });
    assert.deepEqual([edited.json.status, edited.json.review_flags], ['pending_review', ['prohibited_words']]);
  });
});

describe('reports', () => {
  test('once per reporter; three reporters send a live listing to review; never your own', async () => {
    const seller = await customer();
    const live = (await submit(seller, await draft(seller, { title: 'Industrial blender 3 litres', category: 'kitchen' }))).json;
    assert.equal((await seller.post('/v1/classifieds/reports', { listing_id: live.id, reason: 'scam' })).json.error.param, 'listing_id');
    const reporters = [await customer(), await customer(), await customer()];
    const first = await reporters[0].post('/v1/classifieds/reports', { listing_id: live.id, reason: 'scam', details: 'Asked me to pay a deposit first.' });
    assert.deepEqual([first.status, first.json.status], [201, 'open']);
    assert.equal((await reporters[0].post('/v1/classifieds/reports', { listing_id: live.id, reason: 'scam' })).json.error.code, 'already_reported');
    await reporters[1].post('/v1/classifieds/reports', { listing_id: live.id, reason: 'duplicate' });
    assert.equal((await seller.get(`/v1/classifieds/me/listings/${live.id}`)).json.status, 'active');
    await reporters[2].post('/v1/classifieds/reports', { listing_id: live.id, reason: 'scam' });
    const now = (await seller.get(`/v1/classifieds/me/listings/${live.id}`)).json;
    assert.deepEqual([now.status, now.review_reason], ['pending_review', 'reported']);
    assert.equal((await reporters[0].post('/v1/classifieds/reports', { listing_id: live.id, reason: 'nonsense' })).status, 400);
  });
});

describe('moderators', () => {
  test('the queue shows flags, the seller and reports; approving puts it live and tells the seller', async () => {
    const seller = await customer();
    const waiting = (await submit(seller, await draft(seller, { title: 'Replica jersey, Super Eagles', category: 'clothing' }))).json;
    const queue = await support.get('/v1/admin/classifieds/queue?country=NG');
    assert.equal(queue.status, 200, JSON.stringify(queue.json));
    const row = queue.json.data.find(item => item.id === waiting.id);
    assert.deepEqual([row.review_flags, row.seller.email, row.seller.suspended], [['prohibited_words'], seller.email, false]);
    const notAllowed = await support.post(`/v1/admin/classifieds/listings/${waiting.id}/approve`, {});
    assert.equal(notAllowed.status, 403, 'support views, operations decide');

    const approved = await admin.post(`/v1/admin/classifieds/listings/${waiting.id}/approve`, { note: 'A fan jersey, not a counterfeit claim.' });
    assert.deepEqual([approved.status, approved.json.status, approved.json.review_flags], [200, 'active', []]);
    assert.ok(approved.json.expires_at);
    assert.equal((await admin.post(`/v1/admin/classifieds/listings/${waiting.id}/approve`, {})).json.error.code, 'listing_not_in_review');
    assert.equal(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.listing_live' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.listing_approved', targetId: waiting.id } }), 1);
  });

  test('rejecting sends it back to be fixed; removing takes it off for good', async () => {
    const seller = await customer();
    const waiting = (await submit(seller, await draft(seller, { title: 'Phone, whatsapp me for price', category: 'mobile-phones' }))).json;
    const rejected = await admin.post(`/v1/admin/classifieds/listings/${waiting.id}/reject`, { reason: 'Keep contact in BitoCard chat: remove the WhatsApp request.' });
    assert.deepEqual([rejected.json.status, rejected.json.review_reason], ['rejected', 'Keep contact in BitoCard chat: remove the WhatsApp request.']);
    assert.equal(await prisma.notification.count({ where: { customerId: seller.id, type: 'customer.classifieds.listing_rejected' } }), 1);
    await seller.patch(`/v1/classifieds/listings/${waiting.id}`, { title: 'Tecno Pop 7, boxed' });
    assert.equal((await submit(seller, waiting)).json.status, 'active', 'fixed and live (nothing doubtful left)');

    const removed = await admin.post(`/v1/admin/classifieds/listings/${waiting.id}/remove`, { reason: 'Reported as stolen with police report.' });
    assert.equal(removed.json.status, 'removed');
    const page = await fetch(`${server.base}/v1/classifieds/listings/${waiting.ref}?country=NG`);
    assert.equal(page.status, 410);
    assert.equal((await seller.patch(`/v1/classifieds/listings/${waiting.id}`, { title: 'Back again please' })).json.error.code, 'listing_closed');
  });

  test('reports are decided: dismissed, or the listing removed', async () => {
    const seller = await customer();
    const live = (await submit(seller, await draft(seller, { title: 'Office chair, ergonomic', category: 'office-equipment' }))).json;
    const reporter = await customer();
    const report = (await reporter.post('/v1/classifieds/reports', { listing_id: live.id, reason: 'wrong_category' })).json;
    const open = await support.get('/v1/admin/classifieds/reports');
    assert.ok(open.json.data.some(item => item.id === report.id && item.listing.id === live.id));
    const dismissed = await admin.post(`/v1/admin/classifieds/reports/${report.id}/resolve`, { action: 'dismiss', note: 'Office chairs belong there.' });
    assert.equal(dismissed.json.status, 'dismissed');
    assert.equal((await admin.post(`/v1/admin/classifieds/reports/${report.id}/resolve`, { action: 'dismiss', note: 'Again' })).json.error.code, 'report_decided');
    const second = (await (await customer()).post('/v1/classifieds/reports', { listing_id: live.id, reason: 'scam' })).json;
    await admin.post(`/v1/admin/classifieds/reports/${second.id}/resolve`, { action: 'remove_listing', note: 'Confirmed scam.' });
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: live.id } })).status, 'removed');
  });

  test('a suspended seller cannot post, and their listings leave the market until they are back', async () => {
    const seller = await customer();
    const live = (await submit(seller, await draft(seller, { title: 'Washing machine 7 kg', category: 'home-appliances' }))).json;
    const suspended = await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/suspend`, { reason: 'Repeated scam reports.' });
    assert.deepEqual([suspended.json.suspended, suspended.json.listings_removed], [true, 1]);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: live.id } })).status, 'removed');
    assert.equal((await seller.post('/v1/classifieds/listings', { title: 'Another washing machine' })).json.error.code, 'classifieds_suspended');
    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/unsuspend`, { reason: 'Appeal accepted.' })).json.suspended, false);
    assert.equal((await seller.post('/v1/classifieds/listings', { title: 'Another washing machine' })).status, 201);
    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/unsuspend`, { reason: 'Again.' })).json.error.code, 'not_suspended');
  });

  test('refused words and market rules are edited by operations, audited', async () => {
    const added = await admin.post('/v1/admin/classifieds/prohibited-words', { phrase: '  Tiger Skin ', action: 'block', country: 'ng' });
    assert.deepEqual([added.status, added.json.phrase, added.json.country], [201, 'tiger skin', 'NG']);
    assert.equal((await admin.post('/v1/admin/classifieds/prohibited-words', { phrase: 'tiger skin', action: 'review', country: 'NG' })).json.error.code, 'word_exists');
    const seller = await customer();
    assert.equal((await submit(seller, await draft(seller, { title: 'Real tiger skin rug', category: 'furniture' }))).json.error.code, 'listing_prohibited');
    assert.equal((await admin.delete(`/v1/admin/classifieds/prohibited-words/${added.json.id}`)).status, 204);
    assert.ok((await support.get('/v1/admin/classifieds/prohibited-words?country=NG')).json.data.some(word => word.phrase === 'cocaine'));

    const rules = await admin.put('/v1/admin/classifieds/market-settings/ng', { listing_days: 45, max_photos: 10 });
    assert.deepEqual([rules.status, rules.json.listing_days, rules.json.max_photos], [200, 45, 10]);
    assert.equal((await admin.put('/v1/admin/classifieds/market-settings/NG', { min_photos: 11 })).json.error.param, 'max_photos');
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.market_settings_changed' } }), 1);
    await admin.put('/v1/admin/classifieds/market-settings/NG', { listing_days: 30, max_photos: 12 });
  });
});
