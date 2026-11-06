// Reminders to finish posting (the `classifieds_post_reminders` switch, each market's hours on Limits and words): a
// draft with its title, category and a photo but unfinished is reminded once; a complete draft not posted up to three
// times, each the market's hours after the one before; an inbox notice and an email each, claimed so nothing is sent
// twice, never for a posted, deleted or suspended seller's ad.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let reminders;
let emails;

const hour = 60 * 60 * 1000;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  reminders = server.app.get((await import('../dist/classifieds/posting-reminders.service.js')).PostingRemindersService);
  emails = server.app.get((await import('../dist/notifications/email.service.js')).EmailService);
  admin = await adminClient(server, ['operations']);
  const root = await adminClient(server);
  assert.equal((await root.put('/v1/admin/switches/classifieds', { country_code: 'NG', enabled: true })).status, 200);
  assert.equal((await root.put('/v1/admin/switches/classifieds_post_reminders', { country_code: 'NG', enabled: true })).status, 200);
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
        ...(method === 'POST' ? { 'idempotency-key': `rem-${Date.now()}-${Math.random()}` } : {}),
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
  const shopper = storeServer();
  const email = `reminders${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Ifeoma Nwosu', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, shopper);
  assert.equal((await shopper.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  await shopper.post('/v1/classifieds/terms/accept', { version: (await shopper.get('/v1/classifieds/terms')).json.version });
  shopper.id = signup.json.customer.id;
  shopper.email = email;
  return shopper;
}

let photo = 0;
/** A draft with its title, category and `photos` photos; `complete` fills in everything else submitting needs. */
async function draft(shopper, { title = 'Standing fan, 18 inch', photos = 1, complete = false } = {}) {
  const [category, area] = await Promise.all([prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'home-appliances' } }), prisma.classifiedArea.findFirstOrThrow({ where: { slug: 'surulere' } })]);
  const made = await shopper.post('/v1/classifieds/listings', { title, category_id: category.id, ...(complete ? { description: 'Works well.', price: 4500000, condition: 'used', area_id: area.id } : {}) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  await prisma.classifiedMedia.createMany({ data: Array.from({ length: photos }, (_, position) => ({ listingId: made.json.id, kind: 'photo', position, url: `https://media.test/rem-${(photo += 1)}.jpg`, width: 1600, height: 1200, contentHash: `rem-${photo}` })) });
  return made.json;
}

/** As if the seller last changed it `hours` ago. */
const age = (id, hours) => prisma.$executeRaw`UPDATE "classified_listings" SET "updated_at" = ${new Date(Date.now() - hours * hour)} WHERE "id" = ${id}::uuid`;
const notices = customerId => prisma.notification.findMany({ where: { customerId, type: 'customer.classifieds.post_reminder' }, orderBy: { createdAt: 'asc' } });
const mailTo = address => emails.outbox.filter(item => item.to === address).map(item => item.subject);
const settle = async () => {
  await new Promise(resolve => setTimeout(resolve, 100));
  await server.app.get((await import('../dist/postings/journeys.service.js')).PostingJourneysService).idle();
};

describe('the market hours', () => {
  test('admins set them on Limits and words, 1 to 720 hours each', async () => {
    const before = (await admin.get('/v1/admin/classifieds/market-settings/NG')).json;
    assert.deepEqual([before.unfinished_reminder_hours, before.ready_reminder_1_hours, before.ready_reminder_2_hours, before.ready_reminder_3_hours], [24, 24, 72, 168]);
    const saved = await admin.put('/v1/admin/classifieds/market-settings/NG', { unfinished_reminder_hours: 12, ready_reminder_1_hours: 6, ready_reminder_2_hours: 24, ready_reminder_3_hours: 48 });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.unfinished_reminder_hours, saved.json.ready_reminder_1_hours, saved.json.ready_reminder_2_hours, saved.json.ready_reminder_3_hours], [12, 6, 24, 48]);
    assert.equal((await admin.put('/v1/admin/classifieds/market-settings/NG', { ready_reminder_2_hours: 721 })).status, 400);
    assert.equal((await admin.put('/v1/admin/classifieds/market-settings/NG', { unfinished_reminder_hours: 0 })).status, 400);
  });
});

describe('an unfinished draft', () => {
  test('is reminded once, after its hours, saying what it still lacks; never twice', async () => {
    const shopper = await seller();
    const ad = await draft(shopper);
    await age(ad.id, 11);
    await reminders.run();
    assert.equal((await notices(shopper.id)).length, 0, 'not before its hours');
    await age(ad.id, 13);
    const run = await reminders.run();
    assert.ok(run.unfinished >= 1);
    await settle();
    const [notice, ...more] = await notices(shopper.id);
    assert.equal(more.length, 0);
    assert.equal(notice.title, 'Finish your ad for “Standing fan, 18 inch”');
    assert.match(notice.body, /Add its condition, a price, where it is and 3 more photos/);
    assert.equal(notice.link, `/account/listings/${ad.id}`);
    assert.deepEqual(mailTo(shopper.email).filter(subject => subject.startsWith('Finish your ad')), ['Finish your ad for “Standing fan, 18 inch”']);
    // The seller's last change is left as it was.
    const row = await prisma.classifiedListing.findUniqueOrThrow({ where: { id: ad.id } });
    assert.ok(row.unfinishedRemindedAt && row.updatedAt < new Date(Date.now() - 12 * hour));
    await age(ad.id, 200);
    await reminders.run();
    assert.equal((await notices(shopper.id)).length, 1, 'only once');
    const journey = await prisma.postingJourney.findUnique({ where: { listingId: ad.id }, include: { events: true } });
    if (journey) assert.ok(journey.events.some(event => event.step === 'reminder_unfinished'), 'on the posting journey');
  });

  test('a draft without a photo, or without its title, is not one yet', async () => {
    const shopper = await seller();
    const ad = await draft(shopper, { photos: 0 });
    await age(ad.id, 100);
    await reminders.run();
    assert.equal((await notices(shopper.id)).length, 0);
  });
});

describe('a complete draft not posted', () => {
  test('is reminded three times, each the market’s hours after the one before, then never again', async () => {
    const shopper = await seller();
    const ad = await draft(shopper, { title: 'Chest freezer, 200 litres', photos: 4, complete: true });
    await age(ad.id, 7);
    await reminders.run();
    let sent = await notices(shopper.id);
    assert.deepEqual(sent.map(n => n.title), ['Your ad for “Chest freezer, 200 litres” is ready to post'], 'complete drafts are never told to finish');
    await reminders.run();
    assert.equal((await notices(shopper.id)).length, 1, 'the second waits its hours');
    const back = hours => prisma.$executeRaw`UPDATE "classified_listings" SET "ready_reminded_at" = ${new Date(Date.now() - hours * hour)} WHERE "id" = ${ad.id}::uuid`;
    await back(23);
    await reminders.run();
    assert.equal((await notices(shopper.id)).length, 1);
    await back(25);
    await reminders.run();
    await back(49);
    await reminders.run();
    await back(500);
    await reminders.run();
    await settle();
    sent = await notices(shopper.id);
    assert.deepEqual(sent.map(n => n.title), [
      'Your ad for “Chest freezer, 200 litres” is ready to post',
      'Post “Chest freezer, 200 litres” so buyers can find it',
      'Last reminder: “Chest freezer, 200 litres” is not posted yet',
    ]);
    assert.ok(sent.every(n => /Delete the draft and we will stop reminding you/.test(n.body)));
    assert.equal(mailTo(shopper.email).filter(subject => /ready to post|so buyers can find it|Last reminder/.test(subject)).length, 3);
    assert.equal((await prisma.classifiedListing.findUniqueOrThrow({ where: { id: ad.id } })).readyReminders, 3);
  });

  test('posted, deleted, a suspended seller or the switch off: nothing', async () => {
    const posted = await seller();
    const live = await draft(posted, { title: 'Washing machine, 7 kg', photos: 4, complete: true });
    assert.equal((await posted.post(`/v1/classifieds/listings/${live.id}/submit`)).status, 200);
    await age(live.id, 100);

    const deleting = await seller();
    const gone = await draft(deleting, { title: 'Deep freezer', photos: 4, complete: true });
    assert.ok([200, 204].includes((await deleting.delete(`/v1/classifieds/listings/${gone.id}`)).status));
    await age(gone.id, 100);

    const suspended = await seller();
    const held = await draft(suspended, { title: 'Air conditioner, 1.5 HP', photos: 4, complete: true });
    await age(held.id, 100);
    assert.equal((await admin.post(`/v1/admin/classifieds/sellers/${suspended.id}/suspend`, { reason: 'Scam reports.' })).status, 200);

    await reminders.run();
    for (const who of [posted, deleting, suspended]) assert.equal((await notices(who.id)).length, 0, who.email);

    const root = await adminClient(server);
    assert.equal((await root.put('/v1/admin/switches/classifieds_post_reminders', { country_code: 'NG', enabled: false })).status, 200);
    const quiet = await seller();
    const waiting = await draft(quiet, { photos: 4, complete: true });
    await age(waiting.id, 100);
    assert.deepEqual(await reminders.run(), { unfinished: 0, ready: 0, markets: 0 });
    assert.equal((await notices(quiet.id)).length, 0);
    assert.equal((await root.put('/v1/admin/switches/classifieds_post_reminders', { country_code: 'NG', enabled: true })).status, 200);
  });
});

describe('the words', () => {
  test('lists read as people write them, and a long title is shortened', async () => {
    const { listText, reminderWords, stillToAdd } = await import('../dist/classifieds/posting-reminders.service.js');
    assert.equal(listText(['a', 'b', 'c']), 'a, b and c');
    assert.equal(listText(['a']), 'a');
    assert.deepEqual(stillToAdd({ title: 'x', category_id: 'c', area_id: 'a', condition: 'used', price_kind: 'fixed', price_minor: 100n, photos: 3 }, 4), ['one more photo']);
    assert.deepEqual(stillToAdd({ title: 'x', category_id: 'c', area_id: null, condition: 'used', price_kind: 'on_request', price_minor: null, photos: 4 }, 4), ['where it is']);
    assert.match(reminderWords(1, 'A'.repeat(80)).title, /A{57}…/);
  });

  test('the switch is listed to Udozo’s admins', async () => {
    const switches = (await admin.get('/v1/admin/switches')).json;
    const keys = (switches.data ?? switches.switches ?? []).map(row => row.key);
    assert.ok(keys.includes('classifieds_post_reminders'), JSON.stringify(keys).slice(0, 200));
  });
});
