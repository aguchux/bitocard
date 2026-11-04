// Udozo's customers say where they live (an area of their own country, apart from where their listings are), their date
// of birth and their sex on their profile, each optional; and an account confirming its mobile later can keep the number
// as typed (a Google sign-up's onboarding does, in one step), never replacing a confirmed one.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', STOREFRONT_URL: 'https://udozo.com' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
});

after(() => server?.close());

function site() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `udz-${Date.now()}-${Math.random()}` } : {}),
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

const unique = () => `about${(counter += 1)}-${Date.now()}@example.com`;

/** A Nigerian customer, signed up with their mobile to confirm later and their email confirmed. */
async function customer() {
  const browser = site();
  const email = unique();
  const made = await browser.post('/v1/store/account/signup', { first_name: 'Amaka', last_name: 'Eze', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG'), phone_later: true });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal((await browser.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
  return { browser, email };
}

const areaOf = async country => prisma.classifiedArea.findFirstOrThrow({ where: { country, kind: 'area', enabled: true }, select: { id: true } });

describe('where the customer lives, their date of birth and sex', () => {
  test('start empty, are saved on the profile and cleared with null', async () => {
    const { browser } = await customer();
    const before = await browser.get('/v1/store/account');
    assert.deepEqual([before.json.area_id, before.json.birth_date, before.json.sex], [null, null, null]);

    const area = await areaOf('NG');
    const saved = await browser.post('/v1/store/account/profile', { area_id: area.id, birth_date: '1994-03-21', sex: 'female' });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.area_id, saved.json.birth_date, saved.json.sex, saved.json.first_name], [area.id, '1994-03-21', 'female', 'Amaka']);

    const rather = await browser.post('/v1/store/account/profile', { sex: 'unspecified' });
    assert.deepEqual([rather.json.sex, rather.json.area_id, rather.json.birth_date], ['unspecified', area.id, '1994-03-21'], 'only what is sent changes');

    const cleared = await browser.post('/v1/store/account/profile', { area_id: null, birth_date: null, sex: null });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
    assert.deepEqual([cleared.json.area_id, cleared.json.birth_date, cleared.json.sex], [null, null, null]);
  });

  test('only an area of their own country, a real date of someone at least 13, and the three sexes', async () => {
    const { browser } = await customer();
    const ghana = await prisma.classifiedArea.findFirst({ where: { country: 'GH', kind: 'area' }, select: { id: true } });
    if (ghana) {
      const abroad = await browser.post('/v1/store/account/profile', { area_id: ghana.id });
      assert.deepEqual([abroad.status, abroad.json.error.code, abroad.json.error.param], [400, 'area_unavailable', 'area_id']);
    }
    const state = await prisma.classifiedArea.findFirstOrThrow({ where: { country: 'NG', kind: 'state' }, select: { id: true } });
    const whole = await browser.post('/v1/store/account/profile', { area_id: state.id });
    assert.deepEqual([whole.status, whole.json.error.code], [400, 'area_unavailable'], 'an area, never a whole state');

    const young = new Date();
    young.setUTCFullYear(young.getUTCFullYear() - 10);
    for (const birth_date of ['2001-02-30', young.toISOString().slice(0, 10), '1850-01-01']) {
      const refused = await browser.post('/v1/store/account/profile', { birth_date });
      assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [400, 'birth_date_invalid', 'birth_date'], birth_date);
    }
    assert.equal((await browser.post('/v1/store/account/profile', { birth_date: '21/03/1994' })).status, 400);
    assert.equal((await browser.post('/v1/store/account/profile', { sex: 'other' })).status, 400);
    const after = await browser.get('/v1/store/account');
    assert.deepEqual([after.json.area_id, after.json.birth_date, after.json.sex], [null, null, null], 'nothing refused was kept');
  });
});

describe('confirming the mobile later', () => {
  test('keeps the number as typed, unconfirmed and without a text; another account cannot take it', async () => {
    const browser = site();
    const email = unique();
    assert.equal((await browser.post('/v1/store/account/signup', { first_name: 'Ada', last_name: 'Obi', email, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') })).status, 201);
    assert.equal((await browser.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
    const number = testMobile('NG');
    const texts = await prisma.customerCode.count({ where: { target: number } });
    const later = await browser.post('/v1/store/account/phone/later', { phone: number });
    assert.equal(later.status, 200, JSON.stringify(later.json));
    assert.deepEqual([later.json.phone, later.json.phone_verified, later.json.phone_deferred], [number, false, true]);
    assert.equal(await prisma.customerCode.count({ where: { target: number } }), texts, 'nothing is texted');
    assert.notEqual((await browser.get('/v1/store/wallet')).json?.error?.code, 'phone_not_verified');

    const other = await customer();
    const taken = await other.browser.post('/v1/store/account/phone/later', { phone: number });
    assert.deepEqual([taken.status, taken.json.error.code], [409, 'phone_in_use']);
    const wrong = await other.browser.post('/v1/store/account/phone/later', { phone: '+233241234567' });
    assert.equal(wrong.status, 400, 'a mobile of their own country only');
  });

  test('never replaces a confirmed number', async () => {
    const { browser, email } = await customer();
    const confirmed = testMobile('NG');
    const row = await prisma.customer.findFirstOrThrow({ where: { email } });
    await prisma.customer.update({ where: { id: row.id }, data: { phone: confirmed, phoneVerifiedAt: new Date() } });
    const later = await browser.post('/v1/store/account/phone/later', { phone: testMobile('NG') });
    assert.deepEqual([later.status, later.json.phone, later.json.phone_verified], [200, confirmed, true]);
  });
});
