// Udozo's marketing (Marketplace > Marketing): sellers from a Jiji list, grouped by phone into one seller with every
// advert, worked stage by stage by any admin role; invites by email to anyone, their link's click and the sign-up it
// leads to tracked (by the invite code, else the account's email or phone); and nothing of it on BitoCard's instance.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let email;
let support;
let finance;
let counter = 0;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', STOREFRONT_URL: 'https://udozo.com', CRON_SECRET: 'cron-secret' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  email = server.app.get((await import('../dist/notifications/email.service.js')).EmailService);
  // Every admin role works Marketing, not only super admins.
  support = await adminClient(server, ['support']);
  finance = await adminClient(server, ['finance']);
});

after(() => server?.close());

/** udozo.com's server, keeping the session as the site would. */
function site() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `mk-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body) };
}

const local = phone => `0${phone.slice(4)}`;
const unique = () => `mk${(counter += 1)}-${Date.now()}@example.com`;

describe('importing a Jiji list', () => {
  test('rows group by phone into one seller with every advert; a seller seen again gets the new adverts; rows without a number are skipped', async () => {
    const alpha = testMobile('NG');
    const ringaz = testMobile('NG');
    const second = testMobile('NG');
    const rows = [
      { advert_url: 'https://jiji.ng/ikeja/mobile-phones/iphone-12.html', title: 'Apple iPhone 12 256 GB Blue', price: '₦ 299,999', category: 'Mobile Phones', location: 'Lagos, Ikeja', name: 'ALPHA GADGETS NG', notes: 'Verified ID; 4.8; ENTERPRISE | Used', phone: local(alpha) },
      { advert_url: 'https://jiji.ng/ikeja/tablets/ipad-mini.html', title: 'Apple iPad mini 6', price: '₦ 469,999', category: 'Tablets', location: 'Lagos, Ikeja', name: 'ALPHA GADGETS NG', notes: 'Verified ID | Used', phone: local(alpha) },
      { advert_url: 'https://jiji.ng/ikeja/headphones/g321.html', title: 'G321 Headset PC', price: '₦ 87,000', category: 'Headphones', location: 'Lagos, Ikeja', name: '', notes: '8+ YEARS ON JIJI | Wireless', phone: `${local(ringaz)}; ${local(second)}` },
      { advert_url: 'https://jiji.ng/ikeja/mobile-phones/pixel.html', title: '-5%', price: '₦ 864,500', category: 'Mobile Phones', location: 'Lagos, Ikeja', name: '', notes: '', phone: '' },
      { advert_url: 'https://jiji.ng/ikeja/mobile-phones/odd.html', title: 'Odd', category: 'Mobile Phones', phone: '12345' },
    ];
    const imported = await support.post('/v1/admin/marketing/prospects/import', { rows, source: 'Jiji' });
    assert.equal(imported.status, 200, JSON.stringify(imported.json));
    assert.deepEqual([imported.json.created, imported.json.merged], [2, 0]);
    assert.deepEqual(imported.json.skipped, [{ row: 3, reason: 'no_contact' }, { row: 4, reason: 'phone_invalid' }]);

    const seller = await prisma.marketingProspect.findFirstOrThrow({ where: { phones: { has: alpha } } });
    assert.equal(seller.name, 'ALPHA GADGETS NG');
    assert.deepEqual(seller.categories, ['Mobile Phones', 'Tablets']);
    assert.equal(seller.adverts.length, 2);
    assert.equal(seller.sourceNotes, 'Verified ID; 4.8; ENTERPRISE', "the seller's badges, not the item's condition");
    assert.deepEqual([seller.stage, seller.stageStatus, seller.location], ['reach_out', 'not_started', 'Lagos, Ikeja']);
    const nameless = await prisma.marketingProspect.findFirstOrThrow({ where: { phones: { has: ringaz } } });
    assert.deepEqual(nameless.phones, [ringaz, second], 'both numbers on one seller');
    assert.equal(nameless.name, `Seller ${local(ringaz)}`);

    // The same list again, with one new advert from the second number: merged, not duplicated.
    const again = await finance.post('/v1/admin/marketing/prospects/import', {
      rows: [...rows.slice(0, 2), { advert_url: 'https://jiji.ng/ikeja/headphones/zone-300.html', title: 'Zone 300 Headset', category: 'Headphones', name: 'Ringaz GADGETZ', phone: local(second) }],
    });
    assert.deepEqual([again.json.created, again.json.merged], [0, 2]);
    const grown = await prisma.marketingProspect.findUniqueOrThrow({ where: { id: nameless.id } });
    assert.equal(grown.adverts.length, 2);
    assert.equal(grown.name, 'Ringaz GADGETZ', 'a found name replaces the placeholder');
    assert.equal((await prisma.marketingProspect.findUniqueOrThrow({ where: { id: seller.id } })).adverts.length, 2);
  });
});

describe('lists by market', () => {
  test("a list is one market's: its numbers read as that country's, the pipeline filters by it, and a seller can be moved", async () => {
    const accra = testMobile('GH');
    const ghLocal = `0${accra.slice(4)}`;
    // A Ghanaian number read as Nigeria's is not a mobile there.
    const asNigeria = await support.post('/v1/admin/marketing/prospects/import', { rows: [{ name: 'Accra Phones', phone: ghLocal }] });
    assert.deepEqual([asNigeria.json.country, asNigeria.json.created, asNigeria.json.skipped], ['NG', 0, [{ row: 0, reason: 'phone_invalid' }]]);
    const asGhana = await support.post('/v1/admin/marketing/prospects/import', { rows: [{ name: 'Accra Phones', phone: ghLocal, category: 'Mobile Phones' }], country: 'gh' });
    assert.equal(asGhana.status, 200, JSON.stringify(asGhana.json));
    assert.deepEqual([asGhana.json.country, asGhana.json.created], ['GH', 1]);
    const seller = await prisma.marketingProspect.findFirstOrThrow({ where: { phones: { has: accra } } });
    assert.equal(seller.country, 'GH');

    assert.equal((await support.post('/v1/admin/marketing/prospects/import', { rows: [{ name: 'X', phone: ghLocal }], country: 'ZZ' })).json.error.code, 'market_unavailable');
    assert.equal((await support.post('/v1/admin/marketing/prospects', { name: 'Nowhere', email: unique(), country: 'ZZ' })).json.error.param, 'country');

    const ghana = await support.get('/v1/admin/marketing/prospects?country=GH');
    assert.ok(ghana.json.data.length >= 1);
    assert.ok(ghana.json.data.every(item => item.country === 'GH'));
    assert.ok(!(await support.get('/v1/admin/marketing/prospects?country=NG')).json.data.some(item => item.id === seller.id));
    // Searching a Ghanaian number in Ghana's list finds them.
    assert.ok((await support.get(`/v1/admin/marketing/prospects?country=GH&q=${ghLocal}`)).json.data.some(item => item.id === seller.id));
    const summary = await support.get('/v1/admin/marketing/summary');
    assert.ok(summary.json.countries.some(item => item.country === 'GH' && item.total >= 1));

    // Filed under the wrong market: moved, and numbers sent with it are read as the new country's.
    const nairobi = testMobile('KE');
    const moved = await support.patch(`/v1/admin/marketing/prospects/${seller.id}`, { country: 'KE', phones: [`0${nairobi.slice(4)}`] });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.deepEqual([moved.json.country, moved.json.phones], ['KE', [nairobi]]);
    assert.ok(moved.json.activities.some(item => item.body === 'Market changed from GH to KE.'));
  });
});

describe('working a seller', () => {
  test('the pipeline lists, filters and counts; logging contact, stages, follow-ups, next actions and feedback are kept', async () => {
    const phone = testMobile('NG');
    const made = await support.post('/v1/admin/marketing/prospects', { name: 'Select NG', phones: [local(phone)], categories: ['Mobile Phones'], location: 'Lagos, Ikeja', source: 'Jiji' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const id = made.json.id;
    assert.match(made.json.invite_link, /^https:\/\/udozo\.com\/i\/[a-z0-9]{10}$/);
    assert.equal((await support.post('/v1/admin/marketing/prospects', { name: 'Again', phones: [phone] })).json.error.code, 'prospect_exists');

    const reached = await support.post(`/v1/admin/marketing/prospects/${id}/activities`, { kind: 'message', channel: 'whatsapp', template: 'reach_out', body: 'Hello from Udozo', replied: false, next_action: 'Follow up', next_action_at: new Date(Date.now() - 60_000).toISOString() });
    assert.equal(reached.status, 200, JSON.stringify(reached.json));
    assert.deepEqual([reached.json.stage, reached.json.stage_status], ['reach_out', 'waiting']);
    assert.ok(reached.json.last_contact_at);

    const invited = await support.post(`/v1/admin/marketing/prospects/${id}/activities`, { kind: 'invite', channel: 'whatsapp', replied: true });
    assert.deepEqual([invited.json.stage, invited.json.stage_status], ['invitation', 'in_progress']);
    assert.ok(invited.json.invited_at);
    const followed = await support.post(`/v1/admin/marketing/prospects/${id}/activities`, { kind: 'follow_up', channel: 'call' });
    assert.equal(followed.json.follow_ups, 1);

    assert.equal((await support.post(`/v1/admin/marketing/prospects/${id}/stage`, { stage: 'invitation', status: 'failed' })).json.error.param, 'reason');
    const moved = await support.post(`/v1/admin/marketing/prospects/${id}/stage`, { stage: 'follow_up', status: 'in_progress' });
    assert.deepEqual([moved.json.stage, moved.json.stage_status], ['follow_up', 'in_progress']);

    const assigned = await support.patch(`/v1/admin/marketing/prospects/${id}`, { owner_id: (await prisma.user.findFirstOrThrow({ where: { realm: 'admin', adminRoles: { has: 'finance' } } })).id });
    assert.ok(assigned.json.owner);
    const fed = await support.post(`/v1/admin/marketing/prospects/${id}/feedback`, { rating: 4, would_recommend: true, notes: 'Liked Safe pay', advocacy: 'advocate' });
    assert.deepEqual(fed.json.feedback, { rating: 4, would_recommend: true, notes: 'Liked Safe pay', advocacy: 'advocate' });
    assert.deepEqual(
      fed.json.activities.map(item => item.kind).reverse(),
      ['imported', 'message', 'invite', 'follow_up', 'stage', 'assigned', 'feedback'],
    );

    const overdue = await support.get('/v1/admin/marketing/prospects?due=overdue');
    assert.ok(overdue.json.data.some(item => item.id === id));
    const searched = await support.get(`/v1/admin/marketing/prospects?q=${encodeURIComponent(local(phone))}`);
    assert.deepEqual(searched.json.data.map(item => item.id), [id]);
    const summary = await support.get('/v1/admin/marketing/summary');
    assert.equal(summary.status, 200);
    assert.ok(summary.json.funnel.reached >= 1 && summary.json.funnel.invited >= 1 && summary.json.due.overdue >= 1);
    assert.ok(summary.json.owners.length >= 2);
    assert.equal(summary.json.stages.length, 5);
  });
});

describe('invites and tracking', () => {
  test('anyone invited by email gets a Udozo invitation; opening the link and signing up with it are tracked to onboarding', async () => {
    const to = unique();
    const invited = await support.post('/v1/admin/marketing/invites', { email: to, name: 'Chioma Obi' });
    assert.equal(invited.status, 200, JSON.stringify(invited.json));
    assert.deepEqual([invited.json.stage, invited.json.stage_status, invited.json.email, invited.json.source], ['invitation', 'waiting', to, 'Email invite']);
    const message = email.outbox.filter(item => item.to === to).at(-1);
    assert.ok(message, 'the invitation went to them');
    assert.match(message.subject, /invited you to sell on Udozo/);
    assert.ok(message.text.includes(invited.json.invite_link));
    assert.doesNotMatch(`${message.subject} ${message.text}`, /BitoCard|admin/i, "a seller's invitation, in Udozo's words");
    assert.equal((await support.post(`/v1/admin/marketing/prospects/${invited.json.id}/invite-email`, {})).json.error.code, 'invite_recently_sent');

    // udozo.com's /i/<code> tells the API it was opened (public; unknown codes change nothing).
    const code = invited.json.invite_code;
    const anyone = site();
    assert.equal((await anyone.post(`/v1/marketing/invites/${code}/open`)).status, 204);
    assert.equal((await anyone.post(`/v1/marketing/invites/${code}/open`)).status, 204);
    assert.equal((await anyone.post('/v1/marketing/invites/nosuchcode/open')).status, 204);

    // They sign up with another email, carrying the code: the account is linked by it, and they move on to onboarding.
    const phone = testMobile('NG');
    const signedUp = await anyone.post('/v1/store/account/signup', { name: 'Chioma Obi', email: unique(), password: 'correct horse battery', country: 'NG', phone, ref: code });
    assert.equal(signedUp.status, 201, JSON.stringify(signedUp.json));
    const seller = await support.get(`/v1/admin/marketing/prospects/${invited.json.id}`);
    assert.deepEqual([seller.json.clicks, Boolean(seller.json.clicked_at)], [2, true]);
    assert.equal(seller.json.customer_id, signedUp.json.customer.id);
    assert.deepEqual([seller.json.outcome, seller.json.stage, seller.json.stage_status], ['signed_up', 'onboarding', 'in_progress']);
    assert.deepEqual(seller.json.account.checks.map(item => [item.key, item.done]), [['signed_up', true], ['email_confirmed', false], ['mobile_confirmed', false], ['first_listing', false], ['seller_hq_store', false]]);
    assert.ok(seller.json.activities.some(item => item.kind === 'opened') && seller.json.activities.some(item => item.kind === 'signed_up' && /invite link/.test(item.body)));
    assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: signedUp.json.customer.id } })).signupRef, code);
    assert.equal((await anyone.post('/v1/store/account/signup', { name: 'X Y', email: unique(), password: 'correct horse battery', country: 'NG', phone: testMobile('NG'), ref: 'not a code!' })).status, 400);
  });

  test('a seller from a list is linked when they sign up with their own phone; one who asked not to be contacted gets no email', async () => {
    const phone = testMobile('NG');
    const made = await finance.post('/v1/admin/marketing/prospects', { name: 'Gizmo Stores', phones: [local(phone)], email: unique() });
    const id = made.json.id;
    await site().post('/v1/store/account/signup', { name: 'Gizmo Owner', email: unique(), password: 'correct horse battery', country: 'NG', phone });
    const linked = await finance.get(`/v1/admin/marketing/prospects?linked=yes&q=${encodeURIComponent(local(phone))}`);
    assert.deepEqual(linked.json.data.map(item => [item.id, item.outcome]), [[id, 'signed_up']]);

    await finance.patch(`/v1/admin/marketing/prospects/${id}`, { do_not_contact: true });
    assert.equal((await finance.post(`/v1/admin/marketing/prospects/${id}/invite-email`, {})).json.error.code, 'do_not_contact');
  });
});

describe('keeping no more than needed', () => {
  test('the daily job deletes sellers never brought on a year after last contact, and keeps only the contact of who asked to stop', async () => {
    const old = await support.post('/v1/admin/marketing/prospects', { name: 'Old Lead', phones: [local(testMobile('NG'))] });
    const recent = await support.post('/v1/admin/marketing/prospects', { name: 'Recent Lead', phones: [local(testMobile('NG'))] });
    const quiet = await support.post('/v1/admin/marketing/prospects', { name: 'Quiet Lead', phones: [local(testMobile('NG'))], location: 'Lagos, Ikeja', notes: 'Prefers calls', categories: ['Tablets'] });
    await prisma.marketingProspect.update({ where: { id: old.json.id }, data: { createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) } });
    await support.patch(`/v1/admin/marketing/prospects/${quiet.json.id}`, { do_not_contact: true });

    const run = await fetch(`${server.base}/v1/cron/marketing`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal(run.status, 200);
    assert.equal(await prisma.marketingProspect.count({ where: { id: old.json.id } }), 0);
    assert.equal(await prisma.marketingProspect.count({ where: { id: recent.json.id } }), 1);
    const kept = await prisma.marketingProspect.findUniqueOrThrow({ where: { id: quiet.json.id } });
    assert.deepEqual([kept.doNotContact, kept.phones.length, kept.notes, kept.location, kept.categories], [true, 1, null, null, []]);
    assert.equal(await prisma.marketingActivity.count({ where: { prospectId: quiet.json.id } }), 0);
  });
});

describe('only on Udozo', () => {
  test("BitoCard's instance has no Marketing", async () => {
    const bitocard = await startApp({ env: { APP_PRODUCT: 'bitocard', PRODUCT_ROUTES: 'separate' } });
    try {
      const admin = await adminClient(bitocard);
      assert.equal((await admin.get('/v1/admin/marketing/summary')).status, 404);
      const res = await fetch(`${bitocard.base}/v1/marketing/invites/abcdef1234/open`, { method: 'POST' });
      assert.equal(res.status, 404);
    } finally {
      await bitocard.close();
    }
  });
});
