// Cross-cutting behaviour: service routes, error format, idempotency and rate limits. See helpers.mjs for the two test modes.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { FixturesModule, fixtureCalls, startApp, useRedis } from './helpers.mjs';

let server;
let base;

before(async () => {
  server = await startApp({ extraModules: [FixturesModule] });
  base = server.base;
});

after(() => server?.close());

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('service routes', () => {
  test('GET /health reports ok with the database check and is never cached', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.deepEqual(body.checks, { database: 'ok' });
  });

  test('GET / describes the service', async () => {
    const body = await (await fetch(base)).json();
    assert.equal(body.service, 'bitocard-api');
    assert.equal(body.openapi, '/v1/openapi.json');
  });

  test('every response carries security headers, noindex and a request ID', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.match(res.headers.get('request-id') ?? '', /^req_[0-9a-f]{32}$/);
  });

  test('a well-formed caller X-Request-Id is echoed back', async () => {
    const res = await fetch(`${base}/health`, { headers: { 'x-request-id': 'caller-trace-1234' } });
    assert.equal(res.headers.get('request-id'), 'caller-trace-1234');
  });

  test('robots.txt disallows crawling', async () => {
    const res = await fetch(`${base}/robots.txt`);
    assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await res.text(), 'User-Agent: *\nDisallow: /\n');
  });

  test('GET /v1/openapi.json serves the API description', async () => {
    const res = await fetch(`${base}/v1/openapi.json`);
    assert.equal(res.status, 200);
    const doc = await res.json();
    assert.equal(doc.info.title, 'BitoCard API');
    assert.ok(doc.openapi.startsWith('3.'));
  });
});

describe('error format', () => {
  test('unknown routes return a JSON not_found_error with the request ID', async () => {
    const res = await fetch(`${base}/v1/nope`);
    assert.equal(res.status, 404);
    const { error } = await res.json();
    assert.equal(error.type, 'not_found_error');
    assert.equal(error.code, 'resource_missing');
    assert.equal(error.request_id, res.headers.get('request-id'));
  });

  test('invalid bodies name the failing field', async () => {
    const res = await post('/v1/fixtures/things', { name: 'a', quantity: 0 }, { 'idempotency-key': 'validation-1' });
    assert.equal(res.status, 400);
    const { error } = await res.json();
    assert.equal(error.type, 'invalid_request_error');
    assert.equal(error.code, 'parameter_invalid');
    assert.equal(error.param, 'quantity');
  });

  test('unknown fields are rejected', async () => {
    const res = await post('/v1/fixtures/things', { name: 'a', quantity: 1, admin: true }, { 'idempotency-key': 'validation-2' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.param, 'admin');
  });

  test('unexpected failures return a generic api_error without internals', async () => {
    const res = await post('/v1/fixtures/things', { name: 'explode', quantity: 1 }, { 'idempotency-key': 'explode-1' });
    assert.equal(res.status, 500);
    const { error } = await res.json();
    assert.deepEqual([error.type, error.code], ['api_error', 'internal_error']);
    assert.doesNotMatch(error.message, /boom/);
  });
});

describe('idempotency', () => {
  test('POST without an Idempotency-Key is rejected', async () => {
    const res = await post('/v1/fixtures/things', { name: 'a', quantity: 1 });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'idempotency_key_required');
  });

  test('a retry with the same key replays the first result without running again', async () => {
    const start = fixtureCalls.count;
    const first = await post('/v1/fixtures/things', { name: 'card', quantity: 2 }, { 'idempotency-key': 'order-123' });
    const second = await post('/v1/fixtures/things', { name: 'card', quantity: 2 }, { 'idempotency-key': 'order-123' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.deepEqual(await second.json(), await first.json());
    assert.equal(fixtureCalls.count, start + 1);
  });

  test('the original status code is replayed', async () => {
    await post('/v1/fixtures/things/accept', {}, { 'idempotency-key': 'accept-1' });
    const replay = await post('/v1/fixtures/things/accept', {}, { 'idempotency-key': 'accept-1' });
    assert.equal(replay.status, 202);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');
  });

  test('reusing a key with a different body is refused', async () => {
    await post('/v1/fixtures/things', { name: 'one', quantity: 1 }, { 'idempotency-key': 'reuse-1' });
    const res = await post('/v1/fixtures/things', { name: 'two', quantity: 1 }, { 'idempotency-key': 'reuse-1' });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).error.code, 'idempotency_key_reused');
  });

  test('client errors are stored and replayed; server errors release the key for retry', async () => {
    const invalid = await post('/v1/fixtures/things', { name: 'a', quantity: 0 }, { 'idempotency-key': 'validation-1' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('idempotent-replayed'), 'true');

    const start = fixtureCalls.count;
    const retry = await post('/v1/fixtures/things', { name: 'explode', quantity: 1 }, { 'idempotency-key': 'explode-1' });
    assert.equal(retry.status, 500);
    assert.equal(retry.headers.get('idempotent-replayed'), null);
    assert.equal(fixtureCalls.count, start + 1);
  });

  test('concurrent requests with one key run once', async () => {
    const start = fixtureCalls.count;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post('/v1/fixtures/things', { name: 'race', quantity: 1 }, { 'idempotency-key': 'race-1' })),
    );
    const statuses = results.map(res => res.status);
    assert.equal(fixtureCalls.count, start + 1);
    assert.ok(statuses.every(status => status === 201 || status === 409), `unexpected statuses ${statuses}`);
  });
});

describe('rate limits', () => {
  test('/v1 endpoints carry rate limit headers', async () => {
    const res = await post('/v1/fixtures/things/accept', {}, { 'idempotency-key': 'rate-1' });
    assert.equal(res.headers.get('ratelimit-limit'), '1000');
    assert.ok(Number(res.headers.get('ratelimit-remaining')) < 1000);
  });

  test('with Redis configured, counters are stored in Redis', { skip: !useRedis && 'Redis not configured' }, async () => {
    await post('/v1/fixtures/things/accept', {}, { 'idempotency-key': 'rate-redis-1' });
    const res = await fetch(process.env.TEST_REDIS_REST_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.TEST_REDIS_REST_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(['KEYS', 'bitocard:ratelimit*']),
    });
    const { result } = await res.json();
    assert.ok(result.length > 0, 'expected rate limit keys in Redis');
  });

  test('health checks are not rate limited', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.headers.get('ratelimit-limit'), null);
  });
});

describe('rate limit enforcement', () => {
  test('callers over the limit get 429 with Retry-After', async () => {
    const limited = await startApp({ env: { RATE_LIMIT_PER_MINUTE: '2', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }, extraModules: [FixturesModule], database: 'pglite' });
    try {
      const send = n => fetch(`${limited.base}/v1/fixtures/things/accept`, { method: 'POST', headers: { 'idempotency-key': `limit-${n}` } });
      const statuses = [];
      let last;
      for (let n = 0; n < 3; n += 1) {
        last = await send(n);
        statuses.push(last.status);
      }
      assert.equal(statuses.at(-1), 429, `statuses ${statuses}`);
      assert.ok(Number(last.headers.get('retry-after')) >= 1);
      assert.equal((await last.json()).error.type, 'rate_limit_error');
    } finally {
      await limited.close();
    }
  });

  test('a made-up customer session token does not get a fresh limit on store routes', async () => {
    const limited = await startApp({ env: { RATE_LIMIT_PER_MINUTE: '2', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }, database: 'pglite' });
    try {
      const statuses = [];
      for (let n = 0; n < 3; n += 1) {
        const res = await fetch(`${limited.base}/v1/store/navigation`, { headers: { 'bitocard-customer-session': `bcc_made-up-${n}` } });
        statuses.push(res.status);
      }
      assert.equal(statuses.at(-1), 429, `statuses ${statuses}: unknown tokens share the caller's address limit`);
    } finally {
      await limited.close();
    }
  });
});

describe('shoppers behind a store server', () => {
  const secret = 'store-server-secret-for-tests-0123456789';

  test('signed-out shoppers are limited by the address the store server signs, not the server’s own', async () => {
    const { signClient } = await import('../dist/common/rate-limit/client-ip.js');
    const limited = await startApp({ env: { RATE_LIMIT_PER_MINUTE: '2', STORE_SERVER_SECRET: secret, UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }, database: 'pglite' });
    try {
      const as = header => fetch(`${limited.base}/v1/store/navigation`, { headers: header ? { 'bitocard-client': header } : {} }).then(res => res.status);
      // Shopper A uses up their limit; shopper B, through the same server, still gets in.
      assert.deepEqual([await as(signClient(secret, '203.0.113.7')), await as(signClient(secret, '203.0.113.7')), await as(signClient(secret, '203.0.113.7'))], [200, 200, 429]);
      assert.equal(await as(signClient(secret, '198.51.100.20')), 200);
      // A wrong signature or a stale one is ignored: the caller's own address is used.
      assert.deepEqual([await as(signClient('another-secret-entirely-0123456789ab', '192.0.2.1')), await as(null)], [200, 200]);
      assert.equal(await as(signClient(secret, '192.0.2.99', Date.now() - 10 * 60_000)), 429, 'stale: the server’s own address, now used up');
    } finally {
      await limited.close();
    }
  });

  test('the signature check refuses anything not signed with the secret', async () => {
    const { signClient, signedClientIp } = await import('../dist/common/rate-limit/client-ip.js');
    const header = signClient(secret, '203.0.113.7');
    assert.equal(signedClientIp(header, secret), '203.0.113.7');
    assert.equal(signedClientIp(header.replace('203.0.113.7', '203.0.113.8'), secret), null, 'address changed');
    assert.equal(signedClientIp(header, undefined), null, 'no secret configured');
    assert.equal(signedClientIp('t=1,ip=evil<script>,v1=00', secret), null);
  });
});

describe('request logs', () => {
  test('customer session tokens are redacted like other credentials', async () => {
    const { loggerParams } = await import('../dist/common/request/logging.js');
    const paths = loggerParams({ LOG_LEVEL: 'info' }).pinoHttp.redact.paths;
    for (const header of ['authorization', 'cookie', '["x-api-key"]', '["bitocard-customer-session"]', '["bitocard-access-pass"]']) {
      assert.ok(paths.some(path => path.endsWith(header)), `${header} is redacted`);
    }
  });
});

describe('rate limiter outage', () => {
  test('requests are still served when Redis is unreachable', async () => {
    const outage = await startApp({
      env: { UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:9', UPSTASH_REDIS_REST_TOKEN: 'unreachable' },
      extraModules: [FixturesModule],
      database: 'pglite',
    });
    try {
      const res = await fetch(`${outage.base}/v1/fixtures/things/accept`, { method: 'POST', headers: { 'idempotency-key': 'outage-1' } });
      assert.equal(res.status, 202);
      assert.equal(res.headers.get('ratelimit-limit'), null);
    } finally {
      await outage.close();
    }
  });
});
