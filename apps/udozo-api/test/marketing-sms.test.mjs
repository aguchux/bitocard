// Texting sellers from Udozo's Marketing: the admin chooses Africa's Talking or Termii, the numbers among the seller's,
// an optional sender ID and Termii's route; the SMS is logged on their timeline (an invitation when it carries their link),
// refused to someone who asked not to be contacted, once a minute at most, and a provider's refusal is told in words.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, fakeService, startApp, testMobile } from './helpers.mjs';

let server;
let support;
let africasTalking;
let termii;
let atReply;

before(async () => {
  atReply = () => ({ body: { SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_1' }] } } });
  africasTalking = await fakeService(() => atReply());
  termii = await fakeService(() => ({ body: { code: 'ok', message_id: 3017544054459493, message: 'Successfully Sent' } }));
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      PRODUCT_ROUTES: 'separate',
      STOREFRONT_URL: 'https://udozo.com',
      AFRICASTALKING_USERNAME: 'udozo',
      AFRICASTALKING_API_KEY: 'at-key',
      AFRICASTALKING_SENDER_ID: 'UDOZO',
      AFRICASTALKING_API_URL: africasTalking.url,
      TERMII_API_KEY: 'termii-key',
      TERMII_API_URL: termii.url,
    },
  });
  support = await adminClient(server, ['support']);
});

after(async () => {
  await server?.close();
  await africasTalking?.close();
  await termii?.close();
});

const seller = async (extra = {}) => {
  const phones = [testMobile('NG'), testMobile('NG')];
  const made = await support.post('/v1/admin/marketing/prospects', { name: 'Chika Gadgets', phones, source: 'Jiji', ...extra });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json;
};
const lastSms = id => support.get(`/v1/admin/marketing/prospects/${id}`).then(res => res.json.activities.find(item => item.channel === 'sms'));

describe('SMS settings', () => {
  test("both providers with their sender IDs, the market's own first when it is set up", async () => {
    const settings = await support.get('/v1/admin/marketing/sms?country=NG');
    assert.equal(settings.status, 200, JSON.stringify(settings.json));
    assert.equal(settings.json.default_provider, 'termii', "Nigeria's verification provider");
    assert.deepEqual(settings.json.providers.map(item => [item.provider, item.configured, item.sender_id]), [['africas_talking', true, 'UDOZO'], ['termii', true, 'Udozo']]);
    assert.equal(settings.json.max_length, 640);
  });
});

describe('texting a seller', () => {
  test("through Africa's Talking, with its sender ID, logged as an invitation when it carries their link", async () => {
    const prospect = await seller();
    const sent = await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'africas_talking', text: `Hi Chika, your Udozo invitation: ${prospect.invite_link}`, template: 'invitation' });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.deepEqual(sent.json.sms.sent, [{ to: prospect.phones[0], reference: 'ATXid_1' }], 'the first number by default');
    assert.equal(sent.json.sms.held, false);
    assert.deepEqual([sent.json.stage, sent.json.stage_status], ['invitation', 'waiting']);
    assert.ok(sent.json.invited_at && sent.json.last_contact_at);
    const call = africasTalking.calls.at(-1);
    assert.equal(call.url, '/version1/messaging');
    assert.equal(call.headers.apikey, 'at-key');
    const form = new URLSearchParams(call.body);
    assert.deepEqual([form.get('username'), form.get('to'), form.get('from')], ['udozo', prospect.phones[0], 'UDOZO']);
    assert.match(form.get('message'), /your Udozo invitation: https:\/\/udozo\.com\/i\//);
    const logged = await lastSms(prospect.id);
    assert.equal(logged.kind, 'invite');
    assert.match(logged.body, /Texted to \+234\d+ through Africa’s Talking\./);

    const again = await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'africas_talking', text: 'Hello again' });
    assert.equal(again.status, 429);
    assert.equal(again.json.error.code, 'sms_recently_sent');
  });

  test('through Termii to both numbers, with a sender ID and route of the admin’s choosing', async () => {
    const prospect = await seller();
    const sent = await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'termii', text: 'Hello from Udozo', to: prospect.phones, sender_id: 'UdozoNG', channel: 'dnd' });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.deepEqual(sent.json.sms.sent.map(item => item.reference), ['3017544054459493', '3017544054459493']);
    const calls = termii.calls.slice(-2);
    assert.deepEqual(calls.map(call => call.body.to), prospect.phones.map(phone => phone.slice(1)));
    assert.deepEqual([calls[0].body.from, calls[0].body.channel, calls[0].body.api_key, calls[0].body.sms], ['UdozoNG', 'dnd', 'termii-key', 'Hello from Udozo']);
    assert.equal(sent.json.stage_status, 'waiting');
    assert.equal((await lastSms(prospect.id)).kind, 'message');
  });

  test("a provider's refusal is told in words and changes nothing; only their own numbers; never to someone who said stop", async () => {
    const prospect = await seller();
    atReply = () => ({ body: { SMSMessageData: { Message: 'Sent to 0/1', Recipients: [{ statusCode: 405, status: 'InvalidSenderId' }] } } });
    const refused = await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'africas_talking', text: 'Hello' });
    atReply = () => ({ body: { SMSMessageData: { Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_2' }] } } });
    assert.equal(refused.status, 502);
    assert.equal(refused.json.error.code, 'sms_failed');
    assert.match(refused.json.error.message, /InvalidSenderId/);
    const unchanged = await support.get(`/v1/admin/marketing/prospects/${prospect.id}`);
    assert.deepEqual([unchanged.json.stage_status, unchanged.json.last_contact_at], ['not_started', null]);

    const stranger = await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'termii', text: 'Hello', to: [testMobile('NG')] });
    assert.equal(stranger.json.error.param, 'to');
    assert.equal((await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'termii', text: 'Hello', sender_id: 'Way too long a sender' })).status, 400);
    assert.equal((await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'termii', text: 'x'.repeat(641) })).json.error.param, 'text');

    await support.patch(`/v1/admin/marketing/prospects/${prospect.id}`, { do_not_contact: true });
    const stopped = await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'termii', text: 'Hello' });
    assert.equal(stopped.json.error.code, 'do_not_contact');
  });

  test('a seller with only an email has no number to text', async () => {
    const prospect = await seller({ phones: [], email: `sms-${Date.now()}@example.com` });
    const sent = await support.post(`/v1/admin/marketing/prospects/${prospect.id}/sms`, { provider: 'termii', text: 'Hello' });
    assert.equal(sent.json.error.param, 'to');
  });
});
