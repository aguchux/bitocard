// Runs against the compiled dist/ output, which is what Vercel deploys. Run `npm run build` first.
// Two modes, both applying the real migrations to an empty database:
// - `npm test`: in-process Postgres (PGlite) and in-memory rate limits; needs nothing running.
// - `npm run test:docker`: the Docker Postgres and Upstash-compatible Redis (npm run docker:up), like production.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Body, Controller, HttpCode, Module, Post } from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { createApp } from '../dist/bootstrap.js';

// Fixture endpoints, declared without decorator syntax because this file is plain JavaScript.
class CreateThing {}
IsString()(CreateThing.prototype, 'name');
IsInt()(CreateThing.prototype, 'quantity');
Min(1)(CreateThing.prototype, 'quantity');

let calls = 0;
class ThingsController {
  create(body) {
    calls += 1;
    if (body.name === 'explode') throw new Error('boom');
    return { id: `thing_${calls}`, ...body };
  }

  accept() {
    calls += 1;
    return { accepted: true };
  }
}
Reflect.defineMetadata('design:paramtypes', [CreateThing], ThingsController.prototype, 'create');
Body()(ThingsController.prototype, 'create', 0);
const createDescriptor = Object.getOwnPropertyDescriptor(ThingsController.prototype, 'create');
Post()(ThingsController.prototype, 'create', createDescriptor);
const acceptDescriptor = Object.getOwnPropertyDescriptor(ThingsController.prototype, 'accept');
Post('accept')(ThingsController.prototype, 'accept', acceptDescriptor);
HttpCode(202)(ThingsController.prototype, 'accept', acceptDescriptor);
Controller('fixtures/things')(ThingsController);

class FixturesModule {}
Module({ controllers: [ThingsController] })(FixturesModule);

let app;
let base;
let pglite;
const dockerUrl = process.env.TEST_DATABASE_URL;
const useRedis = Boolean(process.env.TEST_REDIS_REST_URL);

function migrationSql() {
  const dir = new URL('../prisma/migrations/', import.meta.url);
  return readdirSync(dir)
    .filter(entry => /^\d+_/.test(entry))
    .sort()
    .map(name => readFileSync(new URL(`${name}/migration.sql`, dir), 'utf8'));
}

/** Empties the Docker test database and applies every migration. Refuses anything not named *_test. */
async function migratedDockerDatabase(url) {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset "${name}": TEST_DATABASE_URL must point at a *_test database.`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  for (const sql of migrationSql()) await client.query(sql);
  await client.end();
  return new PrismaPg({ connectionString: url });
}

async function migratedPglite() {
  pglite = new PGlite();
  for (const sql of migrationSql()) await pglite.exec(sql);
  return new PrismaPGlite(pglite);
}

before(async () => {
  process.env.RATE_LIMIT_PER_MINUTE = '1000';
  if (useRedis) {
    process.env.UPSTASH_REDIS_REST_URL = process.env.TEST_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = process.env.TEST_REDIS_REST_TOKEN;
  }
  const databaseAdapter = dockerUrl ? await migratedDockerDatabase(dockerUrl) : await migratedPglite();
  app = await createApp({ databaseAdapter, extraModules: [FixturesModule] });
  // Keep error logs in the Docker run so infrastructure failures are visible in CI.
  app.useLogger(dockerUrl ? ['error'] : false);
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

after(async () => {
  await app?.close();
  await pglite?.close();
});

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
    const start = calls;
    const first = await post('/v1/fixtures/things', { name: 'card', quantity: 2 }, { 'idempotency-key': 'order-123' });
    const second = await post('/v1/fixtures/things', { name: 'card', quantity: 2 }, { 'idempotency-key': 'order-123' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.headers.get('idempotent-replayed'), 'true');
    assert.deepEqual(await second.json(), await first.json());
    assert.equal(calls, start + 1);
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

    const start = calls;
    const retry = await post('/v1/fixtures/things', { name: 'explode', quantity: 1 }, { 'idempotency-key': 'explode-1' });
    assert.equal(retry.status, 500);
    assert.equal(retry.headers.get('idempotent-replayed'), null);
    assert.equal(calls, start + 1);
  });

  test('concurrent requests with one key run once', async () => {
    const start = calls;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post('/v1/fixtures/things', { name: 'race', quantity: 1 }, { 'idempotency-key': 'race-1' })),
    );
    const statuses = results.map(res => res.status);
    assert.equal(calls, start + 1);
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

describe('rate limiter outage', () => {
  test('requests are still served when Redis is unreachable', async () => {
    const saved = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
    process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:9';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'unreachable';
    const db = new PGlite();
    for (const sql of migrationSql()) await db.exec(sql);
    const outage = await createApp({ databaseAdapter: new PrismaPGlite(db), extraModules: [FixturesModule] });
    outage.useLogger(false);
    try {
      await outage.listen(0);
      const url = (await outage.getUrl()).replace('[::1]', 'localhost');
      const res = await fetch(`${url}/v1/fixtures/things/accept`, { method: 'POST', headers: { 'idempotency-key': 'outage-1' } });
      assert.equal(res.status, 202);
      assert.equal(res.headers.get('ratelimit-limit'), null);
    } finally {
      await outage.close();
      await db.close();
      for (const [name, value] of [['UPSTASH_REDIS_REST_URL', saved.url], ['UPSTASH_REDIS_REST_TOKEN', saved.token]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
