// A market's SMS providers (3 November 2026): codes go through its first provider; a second, when an admin sets one,
// takes a code the first could not send, and a resend goes through it first (alternating after that), so a code that
// did not arrive one way is tried the other.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, startApp } from './helpers.mjs';

const { SmsService, providerOrder } = await import('../dist/notifications/sms.service.js');

const settings = {
  AFRICASTALKING_USERNAME: 'udozo',
  AFRICASTALKING_API_KEY: 'at-key',
  AFRICASTALKING_API_URL: 'https://at.example.test',
  TERMII_API_KEY: 'tm-key',
  TERMII_API_URL: 'https://termii.example.test',
};

/** An SmsService over a market with the providers given, and a fetch that answers each provider as told. */
function harness({ first = 'africas_talking', second = 'termii', config = settings } = {}) {
  const service = new SmsService({ config: { APP_PRODUCT: 'udozo' }, configFor: () => config }, { country: { findUnique: async () => ({ smsProvider: first, smsFallbackProvider: second }) } });
  const calls = [];
  const answers = { at: 101, termii: 200 };
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const provider = String(url).startsWith('https://at.') ? 'at' : 'termii';
    calls.push(provider);
    if (provider === 'at') return { ok: true, text: async () => JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: answers.at, status: answers.at === 101 ? 'Success' : 'InvalidPhoneNumber' }] } }) };
    return { ok: answers.termii === 200, status: answers.termii, text: async () => JSON.stringify({ message_id: 'tm1' }) };
  };
  return { service, calls, answers, restore: () => (globalThis.fetch = original) };
}

const message = { to: '+2348031234567', text: 'Your code is 123456.' };

describe('providerOrder', () => {
  test('first then second for a first text, second first for a resend, alternating after', () => {
    assert.deepEqual(providerOrder('africas_talking', 'termii', 0), ['africas_talking', 'termii']);
    assert.deepEqual(providerOrder('africas_talking', 'termii', 1), ['termii', 'africas_talking']);
    assert.deepEqual(providerOrder('africas_talking', 'termii', 2), ['africas_talking', 'termii']);
    assert.deepEqual(providerOrder('termii', null, 3), ['termii']);
    assert.deepEqual(providerOrder('termii', 'termii', 1), ['termii'], 'the same provider twice is one');
    assert.deepEqual(providerOrder(null, null, 0), []);
    assert.deepEqual(providerOrder('carrier-pigeon', 'termii', 0), ['termii'], 'unknown names are left out');
  });
});

describe("sending through a market's providers", () => {
  test('the first provider sends a first code', async () => {
    const h = harness();
    try {
      assert.equal(await h.service.sendForCountry('NG', message, 'bitocard'), 'africas_talking');
      assert.deepEqual(h.calls, ['at']);
    } finally {
      h.restore();
    }
  });

  test('a code the first provider refuses goes through the second', async () => {
    const h = harness();
    h.answers.at = 403;
    try {
      assert.equal(await h.service.sendForCountry('NG', message, 'bitocard'), 'termii');
      assert.deepEqual(h.calls, ['at', 'termii']);
    } finally {
      h.restore();
    }
  });

  test('a resend goes through the second provider first, and back to the first if it fails', async () => {
    const h = harness();
    try {
      assert.equal(await h.service.sendForCountry('NG', message, 'bitocard', { attempt: 1 }), 'termii');
      assert.deepEqual(h.calls, ['termii']);
      h.answers.termii = 500;
      assert.equal(await h.service.sendForCountry('NG', message, 'bitocard', { attempt: 1 }), 'africas_talking');
      assert.deepEqual(h.calls, ['termii', 'termii', 'at']);
    } finally {
      h.restore();
    }
  });

  test('with both refusing, the provider error is thrown (reported as a failed delivery)', async () => {
    const h = harness();
    h.answers.at = 403;
    h.answers.termii = 500;
    try {
      await assert.rejects(h.service.sendForCountry('NG', message, 'bitocard'), error => !('code' in error && error.code === 'sms_provider_unavailable') && /Africa's Talking rejected|Termii HTTP 500/.test(error.message));
    } finally {
      h.restore();
    }
  });

  test('a market with one provider uses it for resends too', async () => {
    const h = harness({ second: null });
    try {
      assert.equal(await h.service.sendForCountry('NG', message, 'bitocard', { attempt: 1 }), 'africas_talking');
      assert.deepEqual(h.calls, ['at']);
    } finally {
      h.restore();
    }
  });

  test('in production, a first provider that is not set up hands the code to the second', async () => {
    const h = harness({ config: { ...settings, AFRICASTALKING_API_KEY: undefined } });
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.equal(await h.service.sendForCountry('NG', message, 'bitocard'), 'termii');
      assert.deepEqual(h.calls, ['termii']);
    } finally {
      process.env.NODE_ENV = env;
      h.restore();
    }
  });

  test('a market without a first provider cannot text', async () => {
    const h = harness({ first: null, second: null });
    try {
      await assert.rejects(h.service.sendForCountry('NG', message, 'bitocard'), { code: 'phone_verification_unavailable' });
    } finally {
      h.restore();
    }
  });
});

describe("the admin's second provider", () => {
  let server;
  let admin;
  before(async () => {
    server = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate' } });
    admin = await adminClient(server);
  });
  after(() => server?.close());

  test('is set beside the first, never the same, and goes with it', async () => {
    const set = await admin.patch('/v1/admin/countries/GH', { sms_provider: 'africas_talking', sms_fallback_provider: 'termii' });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual([set.json.sms_provider, set.json.sms_fallback_provider], ['africas_talking', 'termii']);

    // Making the second the first leaves no second.
    const same = await admin.patch('/v1/admin/countries/GH', { sms_provider: 'termii' });
    assert.deepEqual([same.json.sms_provider, same.json.sms_fallback_provider], ['termii', null]);
    const refused = await admin.patch('/v1/admin/countries/GH', { sms_fallback_provider: 'termii' });
    assert.equal(refused.json.sms_fallback_provider, null, 'never the first');

    assert.equal((await admin.patch('/v1/admin/countries/GH', { sms_fallback_provider: 'africas_talking' })).json.sms_fallback_provider, 'africas_talking');
    const off = await admin.patch('/v1/admin/countries/GH', { sms_provider: null });
    assert.deepEqual([off.json.sms_provider, off.json.sms_fallback_provider], [null, null]);

    const bad = await admin.patch('/v1/admin/countries/GH', { sms_fallback_provider: 'pigeon' });
    assert.equal(bad.status, 400);
  });
});
