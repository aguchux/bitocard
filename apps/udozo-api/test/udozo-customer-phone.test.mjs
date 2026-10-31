// Every Udozo customer confirms their mobile number at sign-up: it is required, texted a code through the country's SMS
// provider, and until it is confirmed the account reaches only its own steps (confirming the email and phone, the
// profile, signing out). Where the country cannot text, the number is kept and nothing waits for it. BitoCard's
// customers are unchanged (their number stays optional, confirmed later from their account).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { lastEmailCode, lastSmsCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate', STOREFRONT_URL: 'https://udozo.com' } });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
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

const unique = () => `cphone${(counter += 1)}-${Date.now()}@example.com`;
const account = { name: 'Amaka Eze', password: 'correct horse battery' };

describe("Udozo's customers confirm their mobile at sign-up", () => {
  test('the number is required, texted a code at once, and the account waits for it', async () => {
    const browser = site();
    const missing = await browser.post('/v1/store/account/signup', { ...account, email: unique(), country: 'NG' });
    assert.equal(missing.status, 400);
    assert.deepEqual([missing.json.error.code, missing.json.error.param], ['parameter_missing', 'phone']);

    const email = unique();
    const phone = testMobile('NG');
    const made = await browser.post('/v1/store/account/signup', { ...account, email, country: 'NG', phone });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual([made.json.customer.phone, made.json.customer.phone_verified, made.json.customer.phone_verification_available], [phone, false, true]);
    const code = await lastSmsCode(server.app, phone);
    assert.match(code ?? '', /^\d{6}$/, 'a code is texted at sign-up');

    // The account's own steps work; nothing else does yet.
    assert.equal((await browser.get('/v1/store/account')).status, 200);
    assert.equal((await browser.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, email) })).status, 200);
    for (const path of ['/v1/store/wallet', '/v1/classifieds/conversations/unread', '/v1/classifieds/me/listings']) {
      const refused = await browser.get(path);
      assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.param], [403, 'phone_not_verified', 'phone'], path);
    }

    const confirmed = await browser.post('/v1/store/account/phone/verify', { code });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    assert.equal(confirmed.json.phone_verified, true);
    const after = await browser.get('/v1/classifieds/conversations/unread');
    assert.notEqual(after.json?.error?.code, 'phone_not_verified', JSON.stringify(after.json));
  });

  test('a wrong number can be changed before it is confirmed, and an older account without one is asked too', async () => {
    const browser = site();
    const email = unique();
    assert.equal((await browser.post('/v1/store/account/signup', { ...account, email, country: 'NG', phone: testMobile('NG') })).status, 201);
    const other = testMobile('NG');
    // Another number, a minute later as the resend rule needs.
    const customer = await prisma.customer.findFirstOrThrow({ where: { email } });
    await prisma.customerCode.updateMany({ where: { customerId: customer.id }, data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) } });
    assert.equal((await browser.post('/v1/store/account/phone', { phone: other })).status, 202);
    assert.equal((await browser.post('/v1/store/account/phone/verify', { code: await lastSmsCode(server.app, other) })).json.phone, other);

    await prisma.customer.update({ where: { id: customer.id }, data: { phone: null, phoneVerifiedAt: null } });
    assert.equal((await browser.get('/v1/store/wallet')).json.error?.code, 'phone_not_verified');
  });

  test('where the country cannot text, the number is kept and nothing waits for it', async () => {
    await prisma.country.update({ where: { code: 'KE' }, data: { smsProvider: null } });
    try {
      const browser = site();
      const made = await browser.post('/v1/store/account/signup', { ...account, email: unique(), country: 'KE', phone: testMobile('KE') });
      assert.equal(made.status, 201, JSON.stringify(made.json));
      assert.deepEqual([made.json.customer.phone_verified, made.json.customer.phone_verification_available], [false, false]);
      assert.notEqual((await browser.get('/v1/classifieds/conversations/unread')).json?.error?.code, 'phone_not_verified');
    } finally {
      await prisma.country.update({ where: { code: 'KE' }, data: { smsProvider: 'termii' } });
    }
  });
});
