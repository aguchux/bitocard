// Seller HQ's sign-up confirms the owner's mobile number with a texted code (through the country's SMS provider, here
// Africa's Talking), after the email and before the account exists; the account then starts with it as a confirmed
// sign-in number. Without a confirmation the number is kept unconfirmed, as before.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { client, fakeService, lastEmailCode, lastSmsCode, startApp } from './helpers.mjs';

const password = 'correct horse battery';
let server;
let prisma;
let africasTalking;
let counter = 0;

before(async () => {
  africasTalking = await fakeService(() => ({ body: { SMSMessageData: { Recipients: [{ statusCode: 101, status: 'Success' }] } } }));
  server = await startApp({ env: { AFRICASTALKING_USERNAME: 'udozo', AFRICASTALKING_API_KEY: 'test-africastalking-key', AFRICASTALKING_API_URL: africasTalking.url } });
  prisma = server.app.get(PrismaService);
  await prisma.country.update({ where: { code: 'GH' }, data: { smsProvider: 'africas_talking' } });
});

after(async () => {
  await server?.close();
  await africasTalking?.close();
});

const unique = () => `mobile${(counter += 1)}-${Date.now()}@example.com`;
// Ghanaian MTN mobiles, one per test.
const ghanaPhone = () => `+23324${String(1000000 + counter * 7919 + (Date.now() % 1000)).slice(-7)}`;

async function confirmEmail(browser, email) {
  assert.equal((await browser.post('/v1/auth/signup/email', { email })).status, 202);
  const verified = await browser.post('/v1/auth/signup/email/verify', { email, code: await lastEmailCode(server.app, email) });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  return verified.json.signup_token;
}

/** The code in the last text Africa's Talking was asked to send to a number. */
function textedCode(phone) {
  const call = africasTalking.calls.filter(item => new URLSearchParams(item.body).get('to') === phone).at(-1);
  assert.ok(call, `a text to ${phone}`);
  return { call, code: new URLSearchParams(call.body).get('message').match(/\d{6}/)[0] };
}

describe("the owner's mobile at sign-up", () => {
  test("is texted a code through Africa's Talking and, confirmed, signs in from the start", async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    const phone = ghanaPhone();
    const token = await confirmEmail(browser, email);

    const sent = await browser.post('/v1/auth/signup/phone', { email, signup_token: token, country: 'GH', phone: `0${phone.slice(4)}` });
    assert.equal(sent.status, 202, JSON.stringify(sent.json));
    assert.equal(sent.json.message, `A code is on its way to ${phone}.`);
    const { call, code } = textedCode(phone);
    assert.equal(call.url, '/version1/messaging');
    assert.equal(call.headers.apikey, 'test-africastalking-key');
    assert.equal(new URLSearchParams(call.body).get('username'), 'udozo');

    const verified = await browser.post('/v1/auth/signup/phone/verify', { email, signup_token: token, code });
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    assert.deepEqual([verified.json.object, verified.json.phone], ['signup_phone_verification', phone]);

    const created = await browser.post('/v1/auth/signup', { name: 'Kofi Mensah', email, password, country: 'GH', business_name: 'Kofi Digital', phone, signup_token: token });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.deepEqual([created.json.user.phone, created.json.user.phone_verified], [phone, true]);
    const user = await prisma.user.findFirstOrThrow({ where: { realm: 'reseller', email } });
    assert.equal(await prisma.userPhone.count({ where: { userId: user.id, phone } }), 1);
    assert.equal((await prisma.reseller.findUniqueOrThrow({ where: { id: created.json.memberships[0].reseller.id } })).signupPhone, phone);

    const signIn = await client(server.base, { autoIdempotency: true }).post('/v1/auth/signin', { identifier: phone, password });
    assert.equal(signIn.status, 200, JSON.stringify(signIn.json));

    // Now someone's sign-in number: another sign-up cannot text it.
    const other = client(server.base, { autoIdempotency: true });
    const otherEmail = unique();
    const otherToken = await confirmEmail(other, otherEmail);
    const taken = await other.post('/v1/auth/signup/phone', { email: otherEmail, signup_token: otherToken, country: 'GH', phone });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.error.code, 'phone_in_use');
  });

  test('needs a confirmed email first, so nobody can send texts without an inbox', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const phone = ghanaPhone();
    const before = africasTalking.calls.length;
    const refused = await browser.post('/v1/auth/signup/phone', { email: unique(), signup_token: 'not-a-real-signup-token-000000', country: 'GH', phone });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error.code, 'signup_token_invalid');

    // Another email's token does not work either.
    const email = unique();
    const token = await confirmEmail(browser, email);
    const wrongEmail = await browser.post('/v1/auth/signup/phone', { email: unique(), signup_token: token, country: 'GH', phone });
    assert.equal(wrongEmail.json.error?.code, 'signup_token_invalid');
    assert.equal(africasTalking.calls.length, before, 'nothing texted');

    const otherCountry = await browser.post('/v1/auth/signup/phone', { email, signup_token: token, country: 'GH', phone: '+2348031234567' });
    assert.equal(otherCountry.json.error?.code, 'phone_wrong_country');
  });

  test('one text a minute; a wrong code or an unconfirmed number leaves it unconfirmed', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    const phone = ghanaPhone();
    const token = await confirmEmail(browser, email);
    assert.equal((await browser.post('/v1/auth/signup/phone', { email, signup_token: token, country: 'GH', phone })).status, 202);
    const again = await browser.post('/v1/auth/signup/phone', { email, signup_token: token, country: 'GH', phone });
    assert.equal(again.status, 429);
    assert.equal(again.json.error.code, 'code_recently_sent');

    const { code } = textedCode(phone);
    const wrong = await browser.post('/v1/auth/signup/phone/verify', { email, signup_token: token, code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error.code, 'code_invalid');

    // Never confirmed: the account keeps the number for Udozo's team only.
    const created = await browser.post('/v1/auth/signup', { name: 'Ama Owusu', email, password, country: 'GH', business_name: 'Ama Goods', phone, signup_token: token });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.deepEqual([created.json.user.phone, created.json.user.phone_verified], [null, false]);
    assert.equal((await prisma.reseller.findUniqueOrThrow({ where: { id: created.json.memberships[0].reseller.id } })).signupPhone, phone);
  });

  test('a confirmed number counts only for the number signed up with', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    const confirmed = ghanaPhone();
    const token = await confirmEmail(browser, email);
    await browser.post('/v1/auth/signup/phone', { email, signup_token: token, country: 'GH', phone: confirmed });
    assert.equal((await browser.post('/v1/auth/signup/phone/verify', { email, signup_token: token, code: textedCode(confirmed).code })).status, 200);
    const created = await browser.post('/v1/auth/signup', { name: 'Yaw Boateng', email, password, country: 'GH', business_name: 'Yaw Shop', phone: ghanaPhone(), signup_token: token });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.user.phone_verified, false);
  });

  test('where the country has no SMS provider it says so, and sign-up carries on with the number unconfirmed', async () => {
    await prisma.country.update({ where: { code: 'KE' }, data: { smsProvider: null } });
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    const token = await confirmEmail(browser, email);
    const unavailable = await browser.post('/v1/auth/signup/phone', { email, signup_token: token, country: 'KE', phone: '+254712345678' });
    assert.equal(unavailable.status, 409);
    assert.equal(unavailable.json.error.code, 'phone_verification_unavailable');
    const created = await browser.post('/v1/auth/signup', { name: 'Wanjiru Kamau', email, password, country: 'KE', business_name: 'Wanjiru Store', phone: '+254712345678', signup_token: token });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.user.phone_verified, false);
  });

  test('other providers work the same way (Termii, captured in tests)', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = unique();
    const token = await confirmEmail(browser, email);
    const phone = '+2348039876543';
    assert.equal((await browser.post('/v1/auth/signup/phone', { email, signup_token: token, country: 'NG', phone })).status, 202);
    const verified = await browser.post('/v1/auth/signup/phone/verify', { email, signup_token: token, code: await lastSmsCode(server.app, phone) });
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
  });
});
