import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { adminClient, client, lastSmsCode, resellerClient, startApp } from './helpers.mjs';

let server;

before(async () => {
  server = await startApp();
});
after(() => server?.close());

test('customer phone stays unverified until its SMS code is confirmed and is gated by country', async () => {
  const shopper = client(server.base, { autoIdempotency: true });
  const signup = await shopper.post('/v1/store/account/signup', { name: 'Chi Okafor', email: `phone-${Date.now()}@example.com`, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201);
  const headers = { 'bitocard-customer-session': signup.json.session.token };
  const phone = '+2348031234589';
  const admin = await adminClient(server);
  // Markets keep Termii by migration; with no provider, the market has no phone verification.
  assert.equal((await admin.get('/v1/admin/countries')).json.data.find(item => item.code === 'NG').sms_provider, 'termii');
  assert.equal((await admin.patch('/v1/admin/countries/NG', { sms_provider: null })).status, 200);
  const disabled = await shopper.post('/v1/store/account/phone', { phone }, headers);
  assert.deepEqual([disabled.status, disabled.json.error.code], [409, 'phone_verification_unavailable']);
  const assignment = await admin.patch('/v1/admin/countries/NG', { sms_provider: 'termii' });
  assert.equal(assignment.status, 200);
  // Only a number from the customer's own country.
  const foreign = await shopper.post('/v1/store/account/phone', { phone: '+254711123456' }, headers);
  assert.deepEqual([foreign.status, foreign.json.error.code], [400, 'phone_wrong_country']);
  const local = await shopper.post('/v1/store/account/phone', { phone: '08031234589' }, headers);
  assert.deepEqual([local.status, local.json.phone], [202, phone], 'a national number is read in the customer’s country');
  await new Promise(resolve => setTimeout(resolve, 0));
  await server.app.get((await import('../dist/database/prisma.service.js')).PrismaService).customerCode.updateMany({ where: { purpose: 'phone_verification' }, data: { createdAt: new Date(Date.now() - 120_000) } });
  const sent = await shopper.post('/v1/store/account/phone', { phone }, headers);
  assert.equal(sent.status, 202);
  assert.equal((await shopper.get('/v1/store/account', headers)).json.phone, null);
  const wrong = await shopper.post('/v1/store/account/phone/verify', { code: '000000' }, headers);
  assert.equal(wrong.json.error.code, 'code_invalid');
  const confirmed = await shopper.post('/v1/store/account/phone/verify', { code: await lastSmsCode(server.app, phone) }, headers);
  assert.deepEqual([confirmed.status, confirmed.json.phone, confirmed.json.phone_verified], [200, phone, true]);
});

test('Africa’s Talking uses its assigned country route and checks the recipient result', async () => {
  const { SmsService } = await import('../dist/notifications/sms.service.js');
  const service = new SmsService(
    { configFor: () => ({ AFRICASTALKING_USERNAME: 'sandbox', AFRICASTALKING_API_KEY: 'test-key' }) },
    { country: { findUnique: async () => ({ smsProvider: 'africas_talking' }) } },
  );
  const original = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return { ok: true, json: async () => ({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } }) };
  };
  try {
    assert.equal(await service.sendForCountry('KE', { to: '+254711123456', text: 'Code 123456' }), 'africas_talking');
    assert.match(call.url, /api\.sandbox\.africastalking\.com\/version1\/messaging$/);
    assert.equal(call.options.body.get('to'), '+254711123456');
    assert.equal(call.options.headers.apiKey, 'test-key');
  } finally {
    globalThis.fetch = original;
  }
});

test('a reseller’s numbers are from its business country; extra numbers sign in, need their code, and tell the person', async () => {
  const { browser, userId } = await resellerClient(server, { country: 'NG' });
  const foreign = await browser.post('/v1/auth/phones', { phone: '+233241234567' });
  assert.deepEqual([foreign.status, foreign.json.error.code], [400, 'phone_wrong_country']);
  const invalid = await browser.post('/v1/auth/phones', { phone: '+23412' });
  assert.deepEqual([invalid.status, invalid.json.error.code], [400, 'phone_invalid']);
  const first = '+2348031234571';
  assert.equal((await browser.post('/v1/auth/phones', { phone: first })).status, 202);
  const added = await browser.post('/v1/auth/phones/verify', { code: await lastSmsCode(server.app, first) });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  assert.deepEqual(added.json.data.map(item => [item.phone, item.primary]), [[first, true]]);
  const second = '+2348031234572';
  assert.equal((await browser.post('/v1/auth/phones', { phone: second })).status, 202);
  const both = await browser.post('/v1/auth/phones/verify', { code: await lastSmsCode(server.app, second) });
  assert.deepEqual(both.json.data.map(item => [item.phone, item.primary]), [[first, true], [second, false]]);
  const { PrismaService } = await import('../dist/database/prisma.service.js');
  const prisma = server.app.get(PrismaService);
  assert.ok(await prisma.notification.findFirst({ where: { userId, type: 'security.phone_added' } }), 'the person is told');
  const noPassword = await browser.post('/v1/auth/phones/primary', { phone: second });
  assert.deepEqual([noPassword.status, noPassword.json.error.code], [400, 'parameter_missing']);
  const primary = await browser.post('/v1/auth/phones/primary', { phone: second, password: 'correct horse battery' });
  assert.deepEqual(primary.json.data.find(item => item.primary).phone, second);
  const signedIn = await client(server.base, { autoIdempotency: true }).post('/v1/auth/signin', { identifier: first, password: 'correct horse battery' });
  assert.equal(signedIn.status, 200, 'an extra number signs in');
  assert.equal((await browser.delete(`/v1/auth/phones/${encodeURIComponent(second)}`)).json.error.code, 'primary_phone');
  assert.deepEqual((await browser.delete(`/v1/auth/phones/${encodeURIComponent(first)}`)).json.data.map(item => item.phone), [second]);
});

test('Africa’s Talking’s address can be set (tests and sandbox), and a refused recipient is an error', async () => {
  const { SmsService } = await import('../dist/notifications/sms.service.js');
  const service = new SmsService(
    { configFor: () => ({ AFRICASTALKING_USERNAME: 'live-app', AFRICASTALKING_API_KEY: 'test-key', AFRICASTALKING_API_URL: 'https://sms.example.test/' }) },
    { country: { findUnique: async () => ({ smsProvider: 'africas_talking' }) } },
  );
  const original = globalThis.fetch;
  const urls = [];
  let status = 101;
  globalThis.fetch = async url => {
    urls.push(url);
    return { ok: true, json: async () => ({ SMSMessageData: { Recipients: [{ statusCode: status }] } }) };
  };
  try {
    assert.equal(await service.sendForCountry('KE', { to: '+254711123456', text: 'Code 123456' }), 'africas_talking');
    assert.equal(urls[0], 'https://sms.example.test/version1/messaging');
    status = 403;
    await assert.rejects(service.sendForCountry('KE', { to: '+254711123456', text: 'Code 123456' }));
  } finally {
    globalThis.fetch = original;
  }
});
