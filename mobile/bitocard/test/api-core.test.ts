// The app's API calls: the session header, Idempotency-Keys on every POST, and the API's error shape.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, appHeader, appTag, buildRequest, networkError, request, sessionHeader, transactionPinHeader } from '../src/lib/api-core.ts';

const key = () => 'new-key';

test('GETs carry the session and no key; POSTs always carry one', () => {
  const get = buildRequest('https://api.bitocard.com/', '/v1/app/config', { session: 'ses_1' }, key);
  assert.equal(get.url, 'https://api.bitocard.com/v1/app/config');
  assert.equal(get.init.method, 'GET');
  assert.equal((get.init.headers as Record<string, string>)[sessionHeader], 'ses_1');
  assert.equal((get.init.headers as Record<string, string>)['Idempotency-Key'], undefined);

  const post = buildRequest('https://api.bitocard.com', '/v1/store/wallet/top-ups', { body: { amount: 500 } }, key);
  assert.equal(post.init.method, 'POST');
  assert.equal((post.init.headers as Record<string, string>)['Idempotency-Key'], 'new-key');
  assert.equal(post.init.body, '{"amount":500}');
  assert.equal((post.init.headers as Record<string, string>)[sessionHeader], undefined);

  const money = buildRequest('https://api.bitocard.com', '/v1/store/checkouts', { body: {}, idempotencyKey: 'kept', transactionPin: '246802' }, key);
  assert.equal((money.init.headers as Record<string, string>)['Idempotency-Key'], 'kept');
  assert.equal((money.init.headers as Record<string, string>)[transactionPinHeader], '246802');
});

test('the app names itself in BitoCard-App and words a lost connection as BitoCard', () => {
  const call = buildRequest('https://api.bitocard.com', '/v1/store/account', { app: appTag('android', '0.1.0') }, key);
  assert.equal(appHeader, 'BitoCard-App');
  assert.equal((call.init.headers as Record<string, string>)['BitoCard-App'], 'android/0.1.0');
  assert.match(networkError().message, /^BitoCard cannot be reached/);
});

test('only API paths are called', () => {
  assert.throws(() => buildRequest('https://api.bitocard.com', 'https://evil.example/v1/x', {}, key));
});

test("the API's errors come back as ApiError with its code and words", async () => {
  const fetcher = (async () =>
    new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'wallet_balance_low', message: 'Add ₦500.', param: 'amount', request_id: 'req_1' } }), {
      status: 402,
    })) as typeof fetch;
  await assert.rejects(request(fetcher, 'https://api.bitocard.com', '/v1/x', {}, key), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 402);
    assert.equal(error.code, 'wallet_balance_low');
    assert.equal(error.message, 'Add ₦500.');
    assert.equal(error.param, 'amount');
    return true;
  });
});

test('no network and unreadable answers have the app’s own words', async () => {
  const offline = (async () => {
    throw new TypeError('Network request failed');
  }) as typeof fetch;
  await assert.rejects(request(offline, 'https://api.bitocard.com', '/v1/x', {}, key), { code: 'network_error', status: 0 });
  const html = (async () => new Response('<html>Bad gateway</html>', { status: 502 })) as typeof fetch;
  await assert.rejects(request(html, 'https://api.bitocard.com', '/v1/x', {}, key), { code: 'api_error', status: 502 });
  const empty = (async () => new Response(null, { status: 204 })) as typeof fetch;
  assert.equal(await request(empty, 'https://api.bitocard.com', '/v1/x', {}, key), undefined);
});
