// Integrations' Sandbox switches: the provider's live or sandbox address is picked automatically, admins test BitoCard's
// own credentials with Test connection, and an integration in its sandbox is never synced or used for live orders or
// payments. Stub suppliers keep their switch for later.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, adminCode, fakeService, startApp } from './helpers.mjs';

const { inSandbox, providerUrl, urlsFor } = await import('../dist/integrations/endpoints.js');

let server;
let provider;
let admin;
let adapters;
let payments;

before(async () => {
  provider = await fakeService(call => {
    const bearer = call.headers.authorization;
    if (call.url.startsWith('/pawapay/v2/active-conf')) return bearer === 'Bearer pawapay-good' ? { body: { countries: [] } } : { status: 401, body: { failureReason: { failureCode: 'AUTHENTICATION_ERROR' } } };
    if (call.url.startsWith('/zendit/balance')) return bearer === 'Bearer zendit-good' ? { body: { availableBalance: 100, currency: 'USD' } } : { status: 401, body: { message: 'Invalid API key' } };
    if (call.url.startsWith('/flutterwave/balances')) return { body: { status: 'success', data: [] } };
    return { status: 404, body: {} };
  });
  server = await startApp({
    env: {
      PAWAPAY_API_URL: `${provider.url}/pawapay`,
      PAWAPAY_API_TOKEN: 'pawapay-good',
      PAWAPAY_PAYOUT_FEE_PERCENT: '1.5',
      ZENDIT_API_URL: `${provider.url}/zendit`,
      FLUTTERWAVE_API_URL: `${provider.url}/flutterwave`,
      FLUTTERWAVE_SECRET_KEY: 'FLWSECK-live-key',
    },
  });
  admin = await adminClient(server);
  adapters = server.app.get((await import('../dist/suppliers/supplier-adapters.js')).SupplierAdapters);
  payments = server.app.get((await import('../dist/payments/payment-providers.js')).PaymentProviders);
});

after(async () => {
  await server?.close();
  await provider?.close();
});

const update = async (id, values) => admin.put(`/v1/admin/integrations/${id}`, { values, code: await adminCode(server, admin) });
const card = async id => (await admin.get('/v1/admin/integrations')).json.data.find(item => item.id === id);

describe('addresses', () => {
  test('each integration’s address follows its Sandbox switch; an address set to anything else overrides both', () => {
    const defaults = { PAWAPAY_API_URL: 'https://api.pawapay.io', VTPASS_API_URL: 'https://vtpass.com/api', DIDWW_API_URL: 'https://api.didww.com/v3' };
    assert.equal(providerUrl(defaults, 'pawapay', 'live'), 'https://api.pawapay.io');
    assert.equal(providerUrl(defaults, 'pawapay', 'sandbox'), 'https://api.sandbox.pawapay.io');
    assert.equal(providerUrl(defaults, 'vtpass', 'sandbox'), 'https://sandbox.vtpass.com/api');
    assert.equal(providerUrl({ ZENDIT_API_URL: 'https://api.zendit.io/v1' }, 'zendit', 'sandbox'), 'https://test-api.zendit.io/v1');
    assert.equal(providerUrl({ MONNIFY_API_URL: 'https://api.monnify.com' }, 'monnify', 'sandbox'), 'https://sandbox.monnify.com');
    assert.equal(providerUrl({ PAWAPAY_API_URL: 'https://pawapay.example' }, 'pawapay', 'sandbox'), 'https://pawapay.example', 'an override wins');
    const sandbox = urlsFor({ ...defaults, RELOADLY_TOPUPS_URL: undefined }, 'sandbox');
    assert.deepEqual([sandbox.RELOADLY_TOPUPS_URL, sandbox.RELOADLY_GIFTCARDS_URL, sandbox.DIDWW_API_URL], ['https://topups-sandbox.reloadly.com', 'https://giftcards-sandbox.reloadly.com', 'https://sandbox-api.didww.com/v3']);
    assert.deepEqual([inSandbox({ ZENDIT_SANDBOX: true }, 'zendit'), inSandbox({ ZENDIT_SANDBOX: false }, 'zendit'), inSandbox({}, 'email')], [true, false, false]);
  });
});

describe('Sandbox switch and Test connection', () => {
  test('every integration card says whether it has a Sandbox switch, can be tested, and can be opened to resellers', async () => {
    const pawapay = await card('pawapay');
    assert.deepEqual([pawapay.sandbox, pawapay.testable, pawapay.reseller_access], [false, true, { available: true, enabled: false }]);
    const email = await card('email');
    assert.deepEqual([email.sandbox, email.testable, email.reseller_access.available], [null, false, false]);
    const telnyx = await card('telnyx');
    assert.deepEqual([telnyx.sandbox, telnyx.testable, telnyx.reseller_access.available], [false, false, false], 'a stub keeps its switch for later');
    assert.equal((await update('telnyx', { TELNYX_SANDBOX: true })).json.sandbox, true);
    const untestable = await admin.post('/v1/admin/integrations/telnyx/test');
    assert.deepEqual([untestable.status, untestable.json.error.code], [400, 'integration_not_testable']);
  });

  test('Test connection checks live credentials, then the sandbox ones once switched; a sandboxed supplier is never synced or sold', async () => {
    const live = await admin.post('/v1/admin/integrations/pawapay/test');
    assert.deepEqual([live.status, live.json.environment, live.json.ok, live.json.message], [200, 'live', true, null]);
    assert.equal(adapters.get('pawapay').configured(), true);

    const switched = await update('pawapay', { PAWAPAY_SANDBOX: true });
    assert.equal(switched.status, 200, JSON.stringify(switched.json));
    assert.equal(switched.json.sandbox, true);
    const sandbox = await admin.post('/v1/admin/integrations/pawapay/test');
    assert.deepEqual([sandbox.json.environment, sandbox.json.ok], ['sandbox', true]);
    assert.equal(adapters.get('pawapay').configured(), false, 'never used for live orders');
    const supplier = (await admin.get('/v1/admin/suppliers/pawapay')).json;
    assert.deepEqual([supplier.sandbox, supplier.configured], [true, false]);
    assert.equal((await admin.patch('/v1/admin/suppliers/pawapay', { enabled: true })).status, 200);
    assert.equal((await admin.put('/v1/admin/suppliers/pawapay/markets/GH/mobile_money', { enabled: true })).status, 200);
    const sync = await admin.post('/v1/admin/suppliers/pawapay/sync');
    assert.deepEqual([sync.status, sync.json.error.code], [409, 'supplier_in_sandbox']);

    await update('pawapay', { PAWAPAY_API_TOKEN: 'pawapay-wrong' });
    const wrong = await admin.post('/v1/admin/integrations/pawapay/test');
    assert.equal(wrong.json.ok, false);
    assert.match(wrong.json.message, /^pawaPay’s sandbox refused these credentials/);
    assert.ok(!wrong.json.message.includes('pawapay-wrong'), 'never the token');

    await update('pawapay', { PAWAPAY_API_TOKEN: 'pawapay-good', PAWAPAY_SANDBOX: false });
    assert.equal(adapters.get('pawapay').configured(), true, 'live again once switched off');
    assert.equal((await admin.post('/v1/admin/suppliers/pawapay/sync')).status, 200);
    const operations = await adminClient(server, ['operations']);
    assert.equal((await operations.post('/v1/admin/integrations/pawapay/test')).status, 403);
  });

  test('Test connection says what is missing', async () => {
    const zendit = await admin.post('/v1/admin/integrations/zendit/test');
    assert.deepEqual([zendit.json.ok, zendit.json.message], [false, 'Set the API key first.']);
    await update('zendit', { ZENDIT_API_KEY: 'zendit-good', ZENDIT_SANDBOX: true });
    assert.deepEqual((({ environment, ok }) => [environment, ok])((await admin.post('/v1/admin/integrations/zendit/test')).json), ['sandbox', true]);
  });

  test('a payment gateway in its sandbox is never used for live money, and its test key is checked', async () => {
    assert.ok(payments.flutterwave);
    await update('flutterwave', { FLUTTERWAVE_SANDBOX: true });
    assert.equal(payments.flutterwave, null, 'not used for live payments');
    const liveKey = await admin.post('/v1/admin/integrations/flutterwave/test');
    assert.deepEqual([liveKey.json.environment, liveKey.json.ok], ['sandbox', false]);
    assert.match(liveKey.json.message, /live key was given for the sandbox/);
    await update('flutterwave', { FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-sandbox-key' });
    assert.equal((await admin.post('/v1/admin/integrations/flutterwave/test')).json.ok, true);
    await update('flutterwave', { FLUTTERWAVE_SANDBOX: false, FLUTTERWAVE_SECRET_KEY: 'FLWSECK-live-key' });
    assert.ok(payments.flutterwave);
  });
});
