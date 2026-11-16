// Emails from BitoCard's team to a reseller's owner, from the reseller's page in the admin app: quick emails
// suggested by where the account stands, a personal note, a custom email, the history, and no repeats in 10 minutes.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, resellerClient, startApp } from './helpers.mjs';

let server;
let admin;
let outbox;

before(async () => {
  server = await startApp();
  admin = await adminClient(server, ['operations']);
  const { EmailService } = await import('../dist/notifications/email.service.js');
  outbox = server.app.get(EmailService).outbox;
});

after(async () => {
  await server?.close();
});

describe('reseller emails', () => {
  test('quick emails suggested by where the account stands, sent to the owner with a link into SHQ', async () => {
    const reseller = await resellerClient(server, { country: 'NG' });
    const overview = await admin.get(`/v1/admin/resellers/${reseller.resellerId}/emails`);
    assert.equal(overview.status, 200, JSON.stringify(overview.json));
    assert.equal(overview.json.to.email, reseller.email);
    const byKey = Object.fromEntries(overview.json.templates.map(item => [item.key, item]));
    assert.ok(byKey.start_kyc.suggested, 'not verified');
    assert.ok(byKey.setup_store.suggested, 'no store');
    assert.ok(byKey.verify_mobile.suggested, 'no mobile');
    assert.equal(byKey.publish_store.suggested, null, 'nothing to publish');

    const sent = await admin.post(`/v1/admin/resellers/${reseller.resellerId}/emails`, { template: 'start_kyc', message: 'We can help on WhatsApp too.' });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    const email = outbox.findLast(item => item.to === reseller.email);
    assert.equal(email.subject, 'Complete your identity check to go live');
    assert.match(email.text, /\/settings\/verification/);
    assert.match(email.text, /We can help on WhatsApp too\./);
    assert.ok(sent.json.templates.find(item => item.key === 'start_kyc').last_sent_at);
    assert.deepEqual([sent.json.sent[0].template, sent.json.sent[0].to], ['start_kyc', reseller.email]);

    const again = await admin.post(`/v1/admin/resellers/${reseller.resellerId}/emails`, { template: 'start_kyc' });
    assert.deepEqual([again.status, again.json.error.code], [409, 'email_recently_sent']);
  });

  test('a custom email needs a subject and a message, is escaped, and is audited', async () => {
    const reseller = await resellerClient(server, { country: 'GH' });
    const path = `/v1/admin/resellers/${reseller.resellerId}/emails`;
    assert.equal((await admin.post(path, { template: 'custom', message: 'Hello' })).json.error.code, 'parameter_missing');
    assert.equal((await admin.post(path, { template: 'custom', subject: 'Your store' })).json.error.code, 'parameter_missing');
    assert.equal((await admin.post(path, { template: 'nonsense' })).json.error.code, 'parameter_invalid');

    const sent = await admin.post(path, { template: 'custom', subject: 'About your store', message: 'First paragraph <b>bold</b>.\n\nSecond paragraph.' });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    const email = outbox.findLast(item => item.to === reseller.email);
    assert.equal(email.subject, 'About your store');
    assert.ok(!email.html.includes('<b>'), 'escaped');
    assert.match(email.text, /Second paragraph\./);
    assert.equal(sent.json.sent[0].template, 'custom');
    assert.ok(sent.json.sent[0].sent_by.name);
  });

  test('the WhatsApp group email goes only where admins set the market’s link, and the link stays admin only', async () => {
    const reseller = await resellerClient(server, { country: 'KE' });
    const path = `/v1/admin/resellers/${reseller.resellerId}/emails`;
    const off = (await admin.get(path)).json.templates.find(item => item.key === 'join_whatsapp');
    assert.equal(off.available, false);
    assert.equal((await admin.post(path, { template: 'join_whatsapp' })).json.error.code, 'whatsapp_group_missing');

    assert.equal((await admin.patch('/v1/admin/countries/KE', { whatsapp_group_url: 'https://example.com/group' })).status, 400);
    const link = 'https://chat.whatsapp.com/AbCdEf1234567890';
    const set = await admin.patch('/v1/admin/countries/KE', { whatsapp_group_url: link });
    assert.equal(set.json.whatsapp_group_url, link, JSON.stringify(set.json));
    try {
      const open = (await admin.get(path)).json.templates.find(item => item.key === 'join_whatsapp');
      assert.deepEqual([open.available, Boolean(open.suggested)], [true, true]);
      const sent = await admin.post(path, { template: 'join_whatsapp' });
      assert.equal(sent.status, 200, JSON.stringify(sent.json));
      const email = outbox.findLast(item => item.to === reseller.email);
      assert.match(email.text, /chat\.whatsapp\.com\/AbCdEf1234567890/);

      // Never on the public market list, nor sent to another market's reseller.
      const kenya = (await admin.get('/v1/countries')).json.data.find(country => country.code === 'KE');
      assert.ok(kenya && !('whatsapp_group_url' in kenya));
      const ghana = await resellerClient(server, { country: 'GH' });
      assert.equal((await admin.post(`/v1/admin/resellers/${ghana.resellerId}/emails`, { template: 'join_whatsapp' })).json.error.code, 'whatsapp_group_missing');
    } finally {
      await admin.patch('/v1/admin/countries/KE', { whatsapp_group_url: null });
    }
  });

  test('only operations and support send them', async () => {
    const reseller = await resellerClient(server, { country: 'KE' });
    const finance = await adminClient(server, ['finance']);
    assert.equal((await finance.get(`/v1/admin/resellers/${reseller.resellerId}/emails`)).status, 403);
    const support = await adminClient(server, ['support']);
    assert.equal((await support.post(`/v1/admin/resellers/${reseller.resellerId}/emails`, { template: 'welcome' })).status, 200);
    assert.equal((await reseller.browser.get(`/v1/admin/resellers/${reseller.resellerId}/emails`)).status, 401);
  });
});
