// First and last names apart, for matching people to their identity documents: Udozo's customers, Seller HQ's sellers
// and the admin team give both at sign-up and change them on their profile (which confirms them). An older client
// sending one whole name still works: it is split (the first word, then the rest) and left for the person to confirm,
// as the migration split everyone's existing name.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, client, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', STOREFRONT_URL: 'https://udozo.com' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(() => server?.close());

const unique = () => `names${(counter += 1)}-${Date.now()}@example.com`;
const password = 'correct horse battery';

/** udozo.com's server, keeping the customer's session as the site would. */
function site() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `nm-${Date.now()}-${Math.random()}` } : {}),
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

describe("Udozo's customers", () => {
  test('sign up with a first and last name, confirmed; names in letters only; the profile changes both', async () => {
    const browser = site();
    const base = { email: unique(), password, country: 'NG', phone: testMobile('NG') };
    const missing = await browser.post('/v1/store/account/signup', { ...base, first_name: 'Amaka' });
    assert.deepEqual([missing.status, missing.json.error.param], [400, 'last_name']);
    const digits = await browser.post('/v1/store/account/signup', { ...base, first_name: 'Amaka2', last_name: 'Eze' });
    assert.deepEqual([digits.status, digits.json.error.param], [400, 'first_name']);

    const made = await browser.post('/v1/store/account/signup', { ...base, first_name: '  Mary-Jane ', last_name: "O'Neil  Eze" });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.customer.first_name, made.json.customer.last_name, made.json.customer.name, made.json.customer.name_confirmed], ['Mary-Jane', "O'Neil Eze", "Mary-Jane O'Neil Eze", true]);
    const row = await prisma.customer.findFirstOrThrow({ where: { email: base.email } });
    assert.deepEqual([row.firstName, row.lastName], ['Mary-Jane', "O'Neil Eze"]);

    const half = await browser.post('/v1/store/account/profile', { first_name: 'Amaka' });
    assert.deepEqual([half.status, half.json.error.param], [400, 'last_name'], 'both together');
    const renamed = await browser.post('/v1/store/account/profile', { first_name: 'Amaka', last_name: 'Okafor' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.deepEqual([renamed.json.first_name, renamed.json.last_name, renamed.json.name], ['Amaka', 'Okafor', 'Amaka Okafor']);
  });

  test('an older client sending one name: split for the customer to confirm on their profile', async () => {
    const browser = site();
    const made = await browser.post('/v1/store/account/signup', { name: 'Chukwuemeka  Ade Bello', email: unique(), password, country: 'NG', phone: testMobile('NG') });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.customer.first_name, made.json.customer.last_name, made.json.customer.name_confirmed], ['Chukwuemeka', 'Ade Bello', false]);
    const confirmed = await browser.post('/v1/store/account/profile', { first_name: 'Chukwuemeka Ade', last_name: 'Bello' });
    assert.deepEqual([confirmed.json.first_name, confirmed.json.last_name, confirmed.json.name_confirmed], ['Chukwuemeka Ade', 'Bello', true]);
  });

  test('a one-word name has no last name until it is added', async () => {
    const browser = site();
    const made = await browser.post('/v1/store/account/signup', { name: 'Madonna', email: unique(), password, country: 'NG', phone: testMobile('NG') });
    assert.deepEqual([made.json.customer.first_name, made.json.customer.last_name, made.json.customer.name_confirmed], ['Madonna', null, false]);
  });
});

describe("Seller HQ's sellers", () => {
  test('sign up with a first and last name, see them on the session, and change them on their profile', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    const missing = await browser.post('/v1/auth/signup', { email, password, country: 'NG', business_name: 'Ada Digital', first_name: 'Ada' });
    assert.deepEqual([missing.status, missing.json.error.param], [400, 'last_name']);
    const made = await browser.post('/v1/auth/signup', { first_name: 'Ada', last_name: 'Obi', email, password, country: 'NG', business_name: 'Ada Digital' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.user.first_name, made.json.user.last_name, made.json.user.name, made.json.user.name_confirmed], ['Ada', 'Obi', 'Ada Obi', true]);

    const renamed = await browser.patch('/v1/auth/profile', { first_name: 'Adaeze', last_name: 'Obi-Nwosu' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    const session = await browser.get('/v1/auth/session');
    assert.deepEqual([session.json.user.first_name, session.json.user.last_name, session.json.user.name], ['Adaeze', 'Obi-Nwosu', 'Adaeze Obi-Nwosu']);
  });

  test('without a business name, the business is named after the person', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const made = await browser.post('/v1/auth/signup', { first_name: 'Bola', last_name: 'Ade', email: unique(), password, country: 'NG' });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.memberships[0].reseller.name, 'Bola Ade');
  });

  test('an older client sending one name is split, unconfirmed', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const made = await browser.post('/v1/auth/signup', { name: 'Tunde Bakare', email: unique(), password, country: 'NG' });
    assert.deepEqual([made.json.user.first_name, made.json.user.last_name, made.json.user.name_confirmed], ['Tunde', 'Bakare', false]);
  });
});

describe("Udozo's admin team", () => {
  test('staff are invited by first and last name, set them with their password, and change them on Your account', async () => {
    const owner = await adminClient(server, ['super_admin']);
    const email = `staff${(counter += 1)}-${Date.now()}@bitocard.com`;
    const invited = await owner.post('/v1/admin/team', { first_name: 'Ngozi', last_name: 'Okeke', email, roles: ['support'] });
    assert.equal(invited.status, 201, JSON.stringify(invited.json));
    assert.deepEqual([invited.json.first_name, invited.json.last_name, invited.json.name], ['Ngozi', 'Okeke', 'Ngozi Okeke']);

    const outbox = server.app.get((await import('../dist/notifications/email.service.js')).EmailService).outbox;
    const token = /#token=([^\s"<]+)/.exec(outbox.filter(message => message.to === email).at(-1).text)[1];
    const link = await owner.post('/v1/admin/auth/password-link', { token });
    assert.deepEqual([link.json.first_name, link.json.last_name], ['Ngozi', 'Okeke']);
    const set = await owner.post('/v1/admin/auth/password-link/complete', { token, password: 'a long staff passphrase', first_name: 'Ngozi Ada', last_name: 'Okeke' });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    const staff = await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email } });
    assert.deepEqual([staff.firstName, staff.lastName, staff.name, Boolean(staff.nameConfirmedAt)], ['Ngozi Ada', 'Okeke', 'Ngozi Ada Okeke', true]);

    const renamed = await owner.patch('/v1/admin/auth/profile', { first_name: 'Test', last_name: 'Admin-Person' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.deepEqual([renamed.json.admin.first_name, renamed.json.admin.last_name, renamed.json.admin.name_confirmed], ['Test', 'Admin-Person', true]);
    assert.equal((await owner.get('/v1/admin/auth/session')).json.admin.last_name, 'Admin-Person');
    assert.equal((await owner.patch('/v1/admin/auth/profile', { first_name: 'Test' })).status, 400);
  });
});

describe('the migration', () => {
  test("splits a whole name as the API does: the first word, then the rest; one word has no last name", async () => {
    const sql = await import('node:fs').then(fs => fs.readFileSync(new URL('../prisma/migrations/20270202000000_first_last_names/migration.sql', import.meta.url), 'utf8'));
    const update = /UPDATE "customers" SET([\s\S]*?);/.exec(sql)[1];
    const rows = await prisma.$queryRawUnsafe(
      `SELECT ${update.replace(/"first_name" =/, '').replace(/,\s*"last_name" =/, ' AS first_name,')} AS last_name FROM (VALUES ('  Ada   Obi Eze '), ('Madonna')) AS t("name")`,
    );
    assert.deepEqual(rows, [{ first_name: 'Ada', last_name: 'Obi Eze' }, { first_name: 'Madonna', last_name: null }]);
  });
});
