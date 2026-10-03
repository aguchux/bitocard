// Email providers: Resend first, MailerSend as fallback, captured outbox when none is configured.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EmailService } from '../dist/notifications/email.service.js';
import { SmsService } from '../dist/notifications/sms.service.js';
import { IntegrationsService } from '../dist/integrations/integrations.service.js';
import { loadConfig } from '../dist/config/config.js';
import { fakeService } from './helpers.mjs';

/** Services read their settings through IntegrationsService; here, the environment only. */
const withSettings = env => IntegrationsService.fromConfig(loadConfig(env));

const message = { to: 'ada@example.com', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' };

function service(env) {
  return new EmailService(withSettings({ EMAIL_FROM: 'BitoCard <no-reply@bitocard.com>', ...env }));
}

describe('email delivery', () => {
  test('sends through Resend with its API shape', async () => {
    const resend = await fakeService(() => ({ body: { id: 'em_1' } }));
    try {
      const provider = await service({ RESEND_API_KEY: 're_test', RESEND_API_URL: resend.url }).send(message);
      assert.equal(provider, 'resend');
      const [call] = resend.calls;
      assert.equal(call.url, '/emails');
      assert.equal(call.headers.authorization, 'Bearer re_test');
      assert.deepEqual(call.body, { from: 'BitoCard <no-reply@bitocard.com>', to: ['ada@example.com'], subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' });
    } finally {
      await resend.close();
    }
  });

  test('falls back to MailerSend when Resend fails', async () => {
    const resend = await fakeService(() => ({ status: 500, body: { message: 'down' } }));
    const mailersend = await fakeService(() => ({ status: 202, body: {} }));
    try {
      const provider = await service({
        RESEND_API_KEY: 're_test',
        RESEND_API_URL: resend.url,
        MAILERSEND_API_KEY: 'ms_test',
        MAILERSEND_API_URL: mailersend.url,
      }).send(message);
      assert.equal(provider, 'mailersend');
      const [call] = mailersend.calls;
      assert.equal(call.url, '/v1/email');
      assert.deepEqual(call.body.from, { name: 'BitoCard', email: 'no-reply@bitocard.com' });
      assert.deepEqual(call.body.to, [{ email: 'ada@example.com' }]);
    } finally {
      await resend.close();
      await mailersend.close();
    }
  });

  test('fails only when every provider fails', async () => {
    const down = await fakeService(() => ({ status: 503, body: {} }));
    try {
      const email = service({ RESEND_API_KEY: 'a', RESEND_API_URL: down.url, MAILERSEND_API_KEY: 'b', MAILERSEND_API_URL: down.url });
      await assert.rejects(email.send(message), /Every email provider failed/);
    } finally {
      await down.close();
    }
  });

  test('without providers, messages are captured instead of sent', async () => {
    const email = service({});
    assert.equal(await email.send(message), 'outbox');
    assert.deepEqual(email.outbox, [message]);
  });
});

describe('SMS delivery (Termii)', () => {
  test('sends with the Termii API shape, number without the plus sign', async () => {
    const termii = await fakeService(() => ({ body: { message_id: '1', message: 'Successfully Sent' } }));
    try {
      const sms = new SmsService(withSettings({ TERMII_API_KEY: 'tm_test', TERMII_API_URL: termii.url, TERMII_SENDER_ID: 'BitoCard' }));
      assert.equal(await sms.send({ to: '+2348031234567', text: 'Your code is 123456' }), 'termii');
      const [call] = termii.calls;
      assert.equal(call.url, '/api/sms/send');
      assert.deepEqual(call.body, { api_key: 'tm_test', to: '2348031234567', from: 'BitoCard', sms: 'Your code is 123456', type: 'plain', channel: 'generic' });
    } finally {
      await termii.close();
    }
  });

  test('rejected messages throw', async () => {
    const termii = await fakeService(() => ({ status: 400, body: { message: 'Insufficient balance' } }));
    try {
      const sms = new SmsService(withSettings({ TERMII_API_KEY: 'tm_test', TERMII_API_URL: termii.url }));
      await assert.rejects(sms.send({ to: '+2348031234567', text: 'x' }), /Termii HTTP 400/);
    } finally {
      await termii.close();
    }
  });

  test('without a key, messages are captured instead of sent', async () => {
    const sms = new SmsService(withSettings({}));
    assert.equal(await sms.send({ to: '+2348031234567', text: 'x' }), 'outbox');
    assert.equal(sms.outbox.length, 1);
  });
});
