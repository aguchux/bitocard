// The owner's mobile number given when opening a reseller account: from the business country, kept unconfirmed (it
// never signs in), and shown to BitoCard's admins on the reseller's page.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaService } from '../dist/database/prisma.service.js';
import { adminClient, client, startApp } from './helpers.mjs';

const password = 'correct horse battery';
let server;
let prisma;
let admin;
let counter = 0;

before(async () => {
  server = await startApp();
  prisma = server.app.get(PrismaService);
  admin = await adminClient(server, ['operations']);
});

after(() => server?.close());

const uniqueEmail = () => `phone${(counter += 1)}-${Date.now()}@example.com`;

describe('the phone given at sign-up', () => {
  test('is kept in E.164 on the reseller, unconfirmed, and admins see it', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = uniqueEmail();
    const signed = await browser.post('/v1/auth/signup', { name: 'Ada Obi', email, password, country: 'NG', business_name: 'Ada Digital', phone: '0803 123 4567' });
    assert.equal(signed.status, 201, JSON.stringify(signed.json));
    const resellerId = signed.json.memberships[0].reseller.id;
    assert.equal((await prisma.reseller.findUniqueOrThrow({ where: { id: resellerId } })).signupPhone, '+2348031234567');

    // Never confirmed and never a sign-in number.
    const user = await prisma.user.findFirstOrThrow({ where: { realm: 'reseller', email } });
    assert.equal(user.phone, null);
    assert.equal(await prisma.userPhone.count({ where: { userId: user.id } }), 0);
    const signIn = await client(server.base, { autoIdempotency: true }).post('/v1/auth/signin', { identifier: '+2348031234567', password });
    assert.equal(signIn.status, 401);

    const detail = await admin.get(`/v1/admin/resellers/${resellerId}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.equal(detail.json.signup_phone, '+2348031234567');
    assert.equal(detail.json.members[0].phone, null, 'no confirmed number yet');
  });

  test('a number from another country is refused and nothing is created', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = uniqueEmail();
    const refused = await browser.post('/v1/auth/signup', { name: 'Ada Obi', email, password, country: 'NG', business_name: 'Ada Digital', phone: '+233241234567' });
    assert.equal(refused.status, 400);
    assert.deepEqual([refused.json.error.code, refused.json.error.param], ['phone_wrong_country', 'phone']);
    assert.equal(await prisma.user.count({ where: { realm: 'reseller', email } }), 0);

    const invalid = await browser.post('/v1/auth/signup', { name: 'Ada Obi', email, password, country: 'NG', business_name: 'Ada Digital', phone: '12345' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error.code, 'phone_invalid');
  });

  test('is optional in the API: without one the reseller has none', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const signed = await browser.post('/v1/auth/signup', { name: 'Ada Obi', email: uniqueEmail(), password, country: 'GH', business_name: 'Ada Ghana' });
    assert.equal(signed.status, 201, JSON.stringify(signed.json));
    const detail = await admin.get(`/v1/admin/resellers/${signed.json.memberships[0].reseller.id}`);
    assert.equal(detail.json.signup_phone, null);
  });

  test('onboarding (a person without a reseller account) takes it too', async () => {
    const browser = client(server.base, { autoIdempotency: true });
    const email = uniqueEmail();
    const signed = await browser.post('/v1/auth/signup', { name: 'Kofi Mensah', email, password, country: 'GH', business_name: 'First' });
    assert.equal(signed.status, 201);
    // As after leaving a team (or a Google sign-up): confirmed, and owning no reseller account.
    const user = await prisma.user.findFirstOrThrow({ where: { realm: 'reseller', email } });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await prisma.resellerMember.deleteMany({ where: { userId: user.id } });

    const wrong = await browser.post('/v1/auth/reseller-account', { business_name: 'Kofi Digital', country: 'GH', phone: '+2348031234567' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error.code, 'phone_wrong_country');

    const opened = await browser.post('/v1/auth/reseller-account', { business_name: 'Kofi Digital', country: 'GH', phone: '024 123 4567' });
    assert.equal(opened.status, 201, JSON.stringify(opened.json));
    const reseller = await prisma.reseller.findUniqueOrThrow({ where: { id: opened.json.memberships[0].reseller.id } });
    assert.equal(reseller.signupPhone, '+233241234567');
  });
});
