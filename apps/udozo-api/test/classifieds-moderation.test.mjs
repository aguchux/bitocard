// BitoCard Shop, phase 1 step 2d: automatic checks (refused and doubtful words, a price far below the usual, another
// seller's photo, posting too fast), customers' reports, and the moderators' queue and decisions, audited.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let admin;
let support;
let prisma;

before(async () => {
  // BitoCard Shop is Udozo's (docs/UDOZO_SPINOFF_PLAN.md).
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
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
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Tunde Bakare', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  await confirmMobile(server.app, shopper);
  assert.equal(signup.status, 201);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  // The BitoCard Shop terms, accepted before posting or Safe pay.
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
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

  test('sellers are listed and opened with their listings, reports and Safe pay standing', async () => {
    const seller = await customer();
    const live = (await submit(seller, await draft(seller, { title: 'Standing fan, 18 inch', category: 'home-appliances' }))).json;
    await (await customer()).post('/v1/classifieds/reports', { listing_id: live.id, reason: 'duplicate' });
    await customer(); // A customer who never listed is not a seller.

    const list = await support.get(`/v1/admin/classifieds/sellers?country=NG&q=${encodeURIComponent(seller.email)}`);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.equal(list.json.total, 1);
    const row = list.json.data[0];
    assert.deepEqual([row.id, row.listings.active, row.listings.total, row.open_reports, row.suspended, row.safe_pay_sales], [seller.id, 1, 1, 1, false, 0]);

    const detail = await support.get(`/v1/admin/classifieds/sellers/${seller.id}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.deepEqual([detail.json.reports.length, detail.json.reports[0].listing.id, detail.json.safe_pay.strikes, detail.json.safe_pay.limited, detail.json.safe_pay.strike_limit], [1, live.id, 0, false, 3]);

    await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/suspend`, { reason: 'Duplicate ads again.' });
    const suspended = (await support.get('/v1/admin/classifieds/sellers?status=suspended&limit=100')).json.data;
    assert.ok(suspended.some(item => item.id === seller.id && item.suspended_reason === 'Duplicate ads again.'));
    assert.ok(suspended.every(item => item.suspended));
    await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/unsuspend`, { reason: 'Cleaned up.' });
  });

  test('categories are opened and closed per country, or switched off everywhere, by operations', async () => {
    const tree = await support.get('/v1/admin/classifieds/categories?country=NG');
    assert.equal(tree.status, 200, JSON.stringify(tree.json));
    const top = tree.json.data.find(item => item.slug === 'home-garden') ?? tree.json.data.find(item => item.children.some(child => child.slug === 'furniture'));
    const furniture = top.children.find(child => child.slug === 'furniture');
    assert.deepEqual([top.open, top.enabled, furniture.open], [true, true, true]);
    assert.equal((await support.put(`/v1/admin/classifieds/categories/${top.id}/countries/NG`, { open: false })).status, 403, 'support views, operations change');

    const seller = await customer();
    const closed = await admin.put(`/v1/admin/classifieds/categories/${top.id}/countries/ng`, { open: false });
    assert.deepEqual([closed.status, closed.json.open], [200, false]);
    const area = await prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'surulere' } });
    const refused = await seller.post('/v1/classifieds/listings', { title: 'Dining table, six seats', category_id: furniture.id, area_id: area.id });
    assert.equal(refused.json.error?.param, 'category_id', 'a closed top category closes its subcategories');
    const open = (await fetch(`${server.base}/v1/classifieds/categories?country=NG`).then(res => res.json())).data;
    assert.ok(!open.some(item => item.id === top.id));
    await admin.put(`/v1/admin/classifieds/categories/${top.id}/countries/NG`, { open: true });

    const off = await admin.patch(`/v1/admin/classifieds/categories/${furniture.id}`, { enabled: false });
    assert.deepEqual([off.status, off.json.enabled], [200, false]);
    assert.equal((await support.get('/v1/admin/classifieds/categories?country=NG')).json.data.find(item => item.id === top.id).children.find(child => child.id === furniture.id).enabled, false);
    await admin.patch(`/v1/admin/classifieds/categories/${furniture.id}`, { enabled: true });
    assert.equal((await seller.post('/v1/classifieds/listings', { title: 'Dining table, six seats', category_id: furniture.id, area_id: area.id })).status, 201);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.category_country_changed', targetId: top.id } }), 2);
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.category_changed', targetId: furniture.id } }), 2);
    assert.equal((await support.get('/v1/admin/classifieds/categories?country=ZZ')).status, 404);
  });
});

describe('reference data and the queue', () => {
  test('the queue filters by why ads are there and counts today\'s decisions', async () => {
    await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 1 } });
    try {
      const fresh = await customer();
      const first = (await submit(fresh, await draft(fresh, { title: 'Rechargeable fan, new', category: 'home-appliances' }))).json;
      const doubtful = (await submit(fresh, await draft(fresh, { title: 'Replica handbag, looks real', category: 'clothing' }))).json;
      assert.equal(first.status, 'pending_review');

      const all = (await support.get('/v1/admin/classifieds/queue?country=NG')).json;
      assert.ok(all.stats.waiting >= 2);
      assert.ok(all.stats.oldest_submitted_at);
      const newSellers = (await support.get('/v1/admin/classifieds/queue?country=NG&view=new_sellers')).json.data;
      assert.ok(newSellers.some(item => item.id === first.id) && newSellers.every(item => item.review_flags.includes('first_listings')));
      const flagged = (await support.get('/v1/admin/classifieds/queue?view=flagged')).json.data;
      assert.ok(flagged.some(item => item.id === doubtful.id) && !flagged.some(item => item.id === first.id));
      assert.equal((await support.get('/v1/admin/classifieds/queue?view=nonsense')).status, 400);

      const before = all.stats.approved_today;
      await admin.post(`/v1/admin/classifieds/listings/${first.id}/approve`, {});
      await admin.post(`/v1/admin/classifieds/listings/${doubtful.id}/reject`, { reason: 'Replicas cannot be sold.' });
      const after = (await support.get('/v1/admin/classifieds/queue?country=NG')).json.stats;
      assert.equal(after.approved_today, before + 1);
      assert.ok(after.sent_back_today >= 1);
      assert.equal((await support.get('/v1/admin/classifieds/queue?country=GH')).json.stats.approved_today, 0, 'decisions count in their own market');
    } finally {
      await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
    }
  });

  test('the feature registry: operations add and change keys, checked against their data type, audited', async () => {
    assert.equal((await support.post('/v1/admin/classifieds/features', { key: 'brightness', name: 'Brightness', icon: 'monitor', data_type: 'number' })).status, 403);
    const created = await admin.post('/v1/admin/classifieds/features', { key: 'brightness', name: 'Brightness', icon: 'monitor', data_type: 'number', unit: 'nits', min: 30, max: 500, placeholder: 'e.g. 120', synonyms: ['Nits', 'brightness'], filterable: true });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.deepEqual([created.json.key, created.json.unit, created.json.synonyms, created.json.enabled], ['brightness', 'nits', ['nits', 'brightness'], true]);
    assert.equal((await admin.post('/v1/admin/classifieds/features', { key: 'brightness', name: 'Again', icon: 'monitor', data_type: 'text' })).json.error.code, 'feature_exists');
    assert.equal((await admin.post('/v1/admin/classifieds/features', { key: 'screen_finish', name: 'Screen finish', icon: 'monitor', data_type: 'choice' })).json.error.param, 'choices');
    assert.equal((await admin.post('/v1/admin/classifieds/features', { key: 'warranty', name: 'Warranty', icon: 'shield', data_type: 'text', unit: 'months' })).json.error.param, 'unit');
    assert.equal((await admin.post('/v1/admin/classifieds/features', { key: 'ports', name: 'Ports', icon: 'plug', data_type: 'number', default_value: 'many' })).json.error.code, 'feature_value_invalid');

    const changed = await admin.patch('/v1/admin/classifieds/features/brightness', { max: 360, default_value: '60' });
    assert.deepEqual([changed.status, changed.json.max, changed.json.default_value], [200, 360, '60']);
    assert.equal((await admin.patch('/v1/admin/classifieds/features/brightness', { min: 400 })).json.error.param, 'max');
    assert.ok((await support.get('/v1/admin/classifieds/features?q=nits')).json.data.some(item => item.key === 'brightness'));

    // A choice a listing uses cannot be taken away.
    const colour = (await support.get('/v1/admin/classifieds/features?q=colour')).json.data.find(item => item.key === 'colour');
    const seller = await customer();
    const ad = await draft(seller, { title: 'Black office chair' });
    const used = colour.choices[0];
    assert.equal((await seller.patch(`/v1/classifieds/listings/${ad.id}`, { features: [{ key: 'colour', value: used }] })).status, 200);
    assert.equal((await admin.patch('/v1/admin/classifieds/features/colour', { choices: colour.choices.slice(1) })).json.error.param, 'choices');
    assert.equal((await admin.patch('/v1/admin/classifieds/features/brightness', { enabled: false })).json.enabled, false);
    assert.ok(!(await fetch(`${server.base}/v1/classifieds/features?q=brightness`).then(res => res.json())).data.some(item => item.key === 'brightness'), 'switched off keys leave the sellers\' list');
    assert.equal(await prisma.auditLog.count({ where: { action: 'classifieds.feature_changed' } }), 2);
  });

  test('sellers suggest missing keys; admins add or dismiss them', async () => {
    const one = await customer();
    const two = await customer();
    const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'mobile-phones' } });
    const asked = await one.post('/v1/classifieds/feature-suggestions', { name: 'Charging  Speed', category_id: category.id });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.equal((await one.post('/v1/classifieds/feature-suggestions', { name: 'charging speed' })).json.id, asked.json.id, 'asking again is the same suggestion');
    await two.post('/v1/classifieds/feature-suggestions', { name: 'Charging speed' });
    await two.post('/v1/classifieds/feature-suggestions', { name: 'Plot shape' });
    assert.equal((await two.post('/v1/classifieds/feature-suggestions', { name: 'Memory' })).json.error.code, 'feature_exists');
    assert.equal((await two.post('/v1/classifieds/feature-suggestions', { name: 'see www.example.com' })).json.error.param, 'name');

    const list = (await support.get('/v1/admin/classifieds/feature-suggestions')).json.data;
    const charging = list.find(item => item.name_key === 'charging speed');
    assert.deepEqual([charging.sellers, charging.categories], [2, [category.name]]);
    assert.ok(list.findIndex(item => item.name_key === 'charging speed') < list.findIndex(item => item.name_key === 'plot shape'), 'most asked first');

    const added = await admin.post('/v1/admin/classifieds/features', { key: 'charging_speed', name: 'Charging speed', icon: 'battery-charging', data_type: 'number', unit: 'W', min: 1, max: 300, suggestion: 'Charging speed' });
    assert.equal(added.status, 201);
    assert.equal(await prisma.classifiedFeatureSuggestion.count({ where: { nameKey: 'charging speed', status: 'added', featureId: added.json.id } }), 2);
    assert.equal((await admin.post('/v1/admin/classifieds/feature-suggestions/dismiss', { name_key: 'Plot  shape' })).json.dismissed, 1);
    assert.equal((await admin.post('/v1/admin/classifieds/feature-suggestions/dismiss', { name_key: 'plot shape' })).status, 404);
    assert.ok(!(await support.get('/v1/admin/classifieds/feature-suggestions')).json.data.some(item => item.name_key === 'plot shape' || item.name_key === 'charging speed'));
  });

  test('states and areas: names and centre points corrected, areas added or switched off', async () => {
    const tree = (await support.get('/v1/admin/classifieds/areas?country=NG')).json;
    const lagos = tree.data.find(state => state.slug === 'lagos');
    const surulere = lagos.areas.find(area => area.slug === 'surulere');
    assert.deepEqual([lagos.kind, surulere.kind, surulere.state_id, typeof surulere.latitude], ['state', 'area', lagos.id, 'number']);

    const added = await admin.post('/v1/admin/classifieds/areas', { country: 'ng', state_id: lagos.id, name: 'Ojodu  Berger', latitude: 6.64, longitude: 3.37 });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual([added.json.slug, added.json.name, added.json.kind], ['ojodu-berger', 'Ojodu Berger', 'area']);
    assert.equal((await admin.post('/v1/admin/classifieds/areas', { country: 'NG', state_id: lagos.id, name: 'Ojodu Berger', latitude: 6.64, longitude: 3.37 })).json.error.code, 'area_exists');
    assert.equal((await admin.post('/v1/admin/classifieds/areas', { country: 'NG', state_id: lagos.id, name: 'Nowhere', latitude: 95, longitude: 3 })).status, 400);

    const renamed = await admin.patch(`/v1/admin/classifieds/areas/${added.json.id}`, { name: 'Ojodu-Berger', latitude: 6.645 });
    assert.deepEqual([renamed.json.name, renamed.json.slug, renamed.json.latitude], ['Ojodu-Berger', 'ojodu-berger', 6.645], 'the address stays');
    await admin.patch(`/v1/admin/classifieds/areas/${added.json.id}`, { enabled: false });
    const seller = await customer();
    const refused = await seller.post('/v1/classifieds/listings', { title: 'Bicycle for sale', area_id: added.json.id });
    assert.equal(refused.json.error?.param, 'area_id', 'no new ads in a switched-off area');
    assert.equal(await prisma.auditLog.count({ where: { action: { in: ['classifieds.area_created', 'classifieds.area_changed'] }, targetId: added.json.id } }), 3);
    assert.equal((await support.patch(`/v1/admin/classifieds/areas/${added.json.id}`, { enabled: true })).status, 403);
  });
});
