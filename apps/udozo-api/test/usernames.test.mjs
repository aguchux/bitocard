// Usernames (docs/UDOZO_USERNAMES_PLAN.md): a customer who has posted the market's minimum of ads chooses a username,
// and their seller page becomes `/<cc>/seller/<username>`. Unique, never a handle, a reserved or refused word or a phone
// number; changed at most once every 30 days; an old one redirects for 90 days and nobody else takes it then.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  admin = await adminClient(server);
  assert.equal((await admin.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
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
        ...(method === 'POST' ? { 'idempotency-key': `usernames-${Date.now()}-${Math.random()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = res.status === 204 ? null : await res.json();
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json, headers: res.headers };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), put: (path, body = {}) => request('PUT', path, body) };
}

let counter = 0;
async function customer(first = 'Chinedu', last = 'Okafor') {
  const shopper = storeServer();
  const email = `named${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { first_name: first, last_name: last, email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  return shopper;
}

/** Ads posted straight into the database: published (whatever became of them since), unless said otherwise. */
async function posted(seller, count, { status = 'expired', publishedAt = new Date() } = {}) {
  const [category, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const ad = { customerId: seller.id, country: 'NG', currency: 'NGN', status, publishedAt, categoryId: category.id, areaId: area.id, stateId: area.parentId, title: 'Old TV', condition: 'used', priceMinor: 1000000n };
  await prisma.classifiedListing.createMany({ data: Array.from({ length: count }, () => ad) });
}

/** A customer who may choose a username (the market's minimum of 5 posted). */
async function eligible(first, last) {
  const seller = await customer(first, last);
  await posted(seller, 5);
  return seller;
}

async function live(seller, title) {
  const [cat, place] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'gwarinpa' } })]);
  const draft = (await seller.post('/v1/classifieds/listings', { title, price: 25000000, condition: 'used', category_id: cat.id, area_id: place.id, contact: 'both' })).json;
  await prisma.classifiedMedia.createMany({ data: [0, 1, 2, 3].map(position => ({ listingId: draft.id, kind: 'photo', position, url: `https://media.test/${draft.id}-${position}.jpg` })) });
  const submitted = (await seller.post(`/v1/classifieds/listings/${draft.id}/submit`)).json;
  assert.equal(submitted.status, 'active', JSON.stringify(submitted));
  return submitted;
}

const unique = base => `${base}${(counter += 1)}${Math.floor(Math.random() * 1000)}`.slice(0, 24);
const handleOf = async id => (await prisma.customer.findUniqueOrThrow({ where: { id }, select: { sellerHandle: true } })).sellerHandle;

describe('Usernames', () => {
  test('eligibility counts ads posted (published, not removed or deleted) against the market minimum', async () => {
    const seller = await customer('Ada', 'Nwosu');
    await posted(seller, 2);
    await posted(seller, 1, { status: 'sold' });
    await posted(seller, 1, { status: 'removed' });
    await posted(seller, 1, { status: 'deleted' });
    await posted(seller, 2, { status: 'draft', publishedAt: null });

    const status = await seller.get('/v1/store/account/username');
    assert.equal(status.status, 200, JSON.stringify(status.json));
    assert.deepEqual(status.json, { object: 'username_status', username: null, posted: 3, required: 5, eligible: false, change_after: null, prompt: false, dismissals: 0 });
    const refused = await seller.put('/v1/store/account/username', { username: unique('ada_n') });
    assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.type], [403, 'username_not_eligible', 'permission_error']);
    assert.match(refused.json.error.message, /2 more ads.*3 of the 5/);

    // The market's minimum is the admins' to set (audited).
    const set = await admin.put('/v1/admin/classifieds/market-settings/NG', { username_min_listings: 3 });
    assert.deepEqual([set.status, set.json.username_min_listings], [200, 3]);
    assert.equal((await admin.get('/v1/admin/classifieds/market-settings/NG')).json.username_min_listings, 3);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'classifieds.market_settings_changed', targetId: 'NG' }, orderBy: { createdAt: 'desc' } });
    assert.equal(audit.after.username_min_listings, 3);
    assert.equal((await admin.put('/v1/admin/classifieds/market-settings/NG', { username_min_listings: 101 })).status, 400);
    const now = await seller.get('/v1/store/account/username');
    assert.deepEqual([now.json.eligible, now.json.prompt, now.json.required], [true, true, 3]);
    assert.equal((await admin.put('/v1/admin/classifieds/market-settings/NG', { username_min_listings: 5 })).status, 200);
  });

  test('availability says why a name cannot be had and suggests free ones', async () => {
    const seller = await eligible('Kemi', 'Adeyemi');
    const other = await eligible('Bola', 'Ade');
    const otherName = unique('bola');
    assert.equal((await other.put('/v1/store/account/username', { username: otherName })).status, 200);
    // A handle may start with a letter, so it reads as a username: never anyone's.
    const otherHandle = `h${Array.from({ length: 9 }, () => 'abcdef'[Math.floor(Math.random() * 6)]).join('')}`;
    await prisma.customer.update({ where: { id: other.id }, data: { sellerHandle: otherHandle } });
    const check = async name => (await seller.get(`/v1/store/account/username/availability?username=${encodeURIComponent(name)}`)).json;

    const free = await check(unique('Kemi_Sells'));
    assert.equal(free.object, 'username_availability');
    assert.deepEqual([free.available, free.reason, free.suggestions], [true, null, []]);
    assert.equal(free.username, free.username.toLowerCase(), 'read in lower case');
    for (const [name, reason] of [
      ['ab', 'invalid'], ['1kemi', 'invalid'], ['kemi-sells', 'invalid'], ['a'.repeat(25), 'invalid'],
      ['admin', 'reserved'], ['support', 'reserved'], ['safe_pay', 'reserved'], ['myudozo_shop', 'reserved'], ['account', 'reserved'],
      ['kemi08031234567', 'refused'],
      [otherName, 'taken'], [otherName.toUpperCase(), 'taken'], [otherHandle, 'taken'],
    ]) {
      const answer = await check(name);
      assert.equal(answer.reason, reason, `${name}: ${JSON.stringify(answer)}`);
      assert.equal(answer.available, false);
    }
    // A refused word (the moderators' list) is refused in a username too.
    if (!(await prisma.classifiedProhibitedWord.findFirst({ where: { phrase: 'cocaine', country: null } }))) await prisma.classifiedProhibitedWord.create({ data: { phrase: 'cocaine', action: 'block' } });
    assert.equal((await check('cocaine_plug')).reason, 'refused');
    assert.equal((await check('kemi_cocaine')).reason, 'refused');

    const taken = await check(otherName);
    assert.ok(taken.suggestions.length > 0 && taken.suggestions.length <= 3, JSON.stringify(taken));
    for (const suggestion of taken.suggestions) {
      assert.match(suggestion, /^[a-z][a-z0-9_]{2,23}$/);
      assert.equal((await check(suggestion)).available, true, `${suggestion} is free`);
    }
    assert.ok((await check('admin')).suggestions.some(name => name.startsWith('kemi')), 'from their name too');

    const mine = unique('kemi_a');
    assert.equal((await seller.put('/v1/store/account/username', { username: mine })).status, 200);
    assert.deepEqual([(await check(mine)).reason, (await check(mine)).suggestions], ['own', []]);

    // Each refusal of PUT.
    const third = await eligible('Sade', 'Lawal');
    for (const [name, code, status] of [['ab', 'username_invalid', 400], ['admin', 'username_reserved', 400], ['kemi08031234567', 'username_refused', 400], [mine, 'username_taken', 409], [otherHandle, 'username_taken', 409]]) {
      const answer = await third.put('/v1/store/account/username', { username: name });
      assert.deepEqual([answer.status, answer.json.error.code], [status, code], name);
    }
  });

  test('availability checks are limited to 30 a minute per customer', async () => {
    const seller = await eligible('Tunde', 'Bakare');
    for (let i = 0; i < 30; i += 1) assert.equal((await seller.get('/v1/store/account/username/availability?username=tunde_b')).status, 200);
    const limited = await seller.get('/v1/store/account/username/availability?username=tunde_b');
    assert.deepEqual([limited.status, limited.json.error.code, limited.json.error.type], [429, 'username_check_limit', 'rate_limit_error']);
  });

  test('set, change too soon, change after 30 days; the old username redirects for 90 days, then is gone', async () => {
    const seller = await eligible('Musa', 'Bello');
    const first = unique('Musa_Bello');
    const set = await seller.put('/v1/store/account/username', { username: first });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.username, first.toLowerCase(), 'stored lower-case');
    assert.ok(set.json.change_after && new Date(set.json.change_after) > new Date(Date.now() + 29 * 86_400_000));
    assert.equal(set.json.prompt, false);
    assert.equal((await seller.get('/v1/store/account')).json.username, first.toLowerCase());
    // The account carries its seller page's handle, so the page knows its own seller.
    assert.match((await seller.get('/v1/store/account')).json.seller_handle, /^[a-z0-9]{6,12}$/);
    assert.equal(await prisma.auditLog.count({ where: { action: 'customer.username_set', targetId: seller.id } }), 1);
    const again = await seller.put('/v1/store/account/username', { username: first.toUpperCase() });
    assert.equal(again.status, 200, 'the same name again changes nothing');

    const second = unique('musa_shop');
    const soon = await seller.put('/v1/store/account/username', { username: second });
    assert.deepEqual([soon.status, soon.json.error.code], [409, 'username_change_too_soon']);
    assert.match(soon.json.error.message, /\d{4}/, 'with the date');

    await prisma.customer.update({ where: { id: seller.id }, data: { usernameSetAt: new Date(Date.now() - 31 * 86_400_000) } });
    const changed = await seller.put('/v1/store/account/username', { username: second });
    assert.deepEqual([changed.status, changed.json.username], [200, second]);

    const old = await storeServer().get(`/v1/classifieds/sellers/${first.toLowerCase()}`);
    assert.equal(old.status, 200, JSON.stringify(old.json));
    assert.deepEqual([old.json.username, old.json.redirect], [second, second]);
    const current = await storeServer().get(`/v1/classifieds/sellers/${second}`);
    assert.deepEqual([current.status, current.json.redirect, current.json.handle], [200, null, await handleOf(seller.id)]);
    assert.match(current.json.url, new RegExp(`/ng/seller/${second}$`));
    const byHandle = await storeServer().get(`/v1/classifieds/sellers/${await handleOf(seller.id)}`);
    assert.deepEqual([byHandle.status, byHandle.json.username], [200, second]);

    // Nobody else may take it while it is held.
    const other = await eligible('Femi', 'Ojo');
    assert.equal((await other.get(`/v1/store/account/username/availability?username=${first}`)).json.reason, 'taken');
    assert.equal((await other.put('/v1/store/account/username', { username: first })).json.error.code, 'username_taken');

    await prisma.customerUsernameHistory.update({ where: { username: first.toLowerCase() }, data: { holdUntil: new Date(Date.now() - 1000) } });
    assert.equal((await storeServer().get(`/v1/classifieds/sellers/${first.toLowerCase()}`)).status, 404, 'after 90 days');
    assert.equal((await other.put('/v1/store/account/username', { username: first })).status, 200, 'and it is free again');
  });

  test('two accounts asking for one name at once: one wins', async () => {
    const [one, two] = await Promise.all([eligible('Ngozi', 'Eze'), eligible('Ifeoma', 'Eze')]);
    const name = unique('eze_twins');
    const answers = await Promise.all([one.put('/v1/store/account/username', { username: name }), two.put('/v1/store/account/username', { username: name })]);
    assert.deepEqual(answers.map(answer => answer.status).sort(), [200, 409], JSON.stringify(answers.map(answer => answer.json)));
    assert.equal(answers.find(answer => answer.status === 409).json.error.code, 'username_taken');
    assert.equal(await prisma.customer.count({ where: { username: name } }), 1);
  });

  test('the banner stops after three "Not now"s', async () => {
    const seller = await eligible('Yemi', 'Alade');
    assert.equal((await seller.get('/v1/store/account/username')).json.prompt, true);
    for (const n of [1, 2]) {
      const answer = await seller.post('/v1/store/account/username/prompt/dismiss');
      assert.deepEqual([answer.status, answer.json.dismissals, answer.json.prompt], [200, n, true]);
    }
    const last = await seller.post('/v1/store/account/username/prompt/dismiss');
    assert.deepEqual([last.json.dismissals, last.json.prompt, last.json.eligible], [3, false, true]);
  });

  test('profiles, cards, listing pages and the sitemap carry the username; the search takes it', async () => {
    const seller = await eligible('Amaka', 'Obi');
    const name = unique('amaka_tv');
    const tv = await live(seller, 'Hisense 50 inch TV');
    assert.equal((await seller.put('/v1/store/account/username', { username: name })).status, 200);

    const profile = await storeServer().get(`/v1/classifieds/sellers/${name.toUpperCase()}`);
    assert.deepEqual([profile.status, profile.json.username], [200, name], 'any case');
    const cards = await storeServer().get(`/v1/classifieds/listings?country=NG&seller=${name}`);
    assert.equal(cards.status, 200, JSON.stringify(cards.json));
    assert.deepEqual(cards.json.data.map(card => [card.title, card.seller.username, card.seller.handle]), [['Hisense 50 inch TV', name, await handleOf(seller.id)]]);
    assert.equal((await storeServer().get(`/v1/classifieds/listings?country=NG&seller=${await handleOf(seller.id)}`)).json.data.length, 1, 'the handle still works');
    assert.equal((await storeServer().get(`/v1/classifieds/listings/${tv.ref}?country=NG`)).json.seller.username, name);
    const sitemap = await storeServer().get('/v1/classifieds/sitemap?country=NG');
    assert.equal(sitemap.status, 200, JSON.stringify(sitemap.json));
    const handle = await handleOf(seller.id);
    assert.equal(sitemap.json.sellers.find(row => row.handle === handle)?.username, name);
  });

  test('admins see the username and take it away (audited, the customer told); it is held for 90 days', async () => {
    const seller = await eligible('Obinna', 'Uche');
    const name = unique('obinna_u');
    assert.equal((await seller.put('/v1/store/account/username', { username: name })).status, 200);
    assert.equal((await admin.get(`/v1/admin/classifieds/sellers/${seller.id}`)).json.username, name);

    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/classifieds/sellers/${seller.id}/username/remove`, { reason: 'Pretends to be a brand.' })).status, 403);
    const removed = await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/username/remove`, { reason: 'Pretends to be a brand.' });
    assert.deepEqual([removed.status, removed.json.username], [200, null], JSON.stringify(removed.json));
    assert.equal((await seller.get('/v1/store/account')).json.username, null);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'classifieds.seller_username_removed', targetId: seller.id } });
    assert.deepEqual([audit.before.username, audit.after.username, audit.after.reason], [name, null, 'Pretends to be a brand.']);
    const notice = await prisma.notification.findFirst({ where: { customerId: seller.id, type: 'customer.classifieds.username_removed' } });
    assert.ok(notice, 'the customer is told');
    assert.match(notice.body, /Pretends to be a brand/);
    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${seller.id}/username/remove`, { reason: 'Again, by mistake.' })).json.error.code, 'username_not_set');

    // Their page is at the handle again; the old name redirects there while held.
    const old = await storeServer().get(`/v1/classifieds/sellers/${name}`);
    assert.deepEqual([old.status, old.json.redirect], [200, await handleOf(seller.id)]);
    const status = (await seller.get('/v1/store/account/username')).json;
    assert.deepEqual([status.username, status.change_after, status.eligible], [null, null, true]);
  });
});
