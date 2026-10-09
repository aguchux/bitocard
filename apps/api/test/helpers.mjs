// Shared test setup. Every test file starts its own app against an empty, fully migrated database:
// - default: in-process Postgres (PGlite), so `npm test` needs nothing running;
// - `npm run test:docker`: the Docker Postgres (TEST_DATABASE_URL, a *_test database reset each time) and the
//   Upstash-compatible Redis (TEST_REDIS_REST_URL). Files then run one at a time because they share the database.
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { Secret, TOTP } from 'otpauth';
import { createApp } from '../dist/bootstrap.js';
import { Public, Scopes } from '../dist/auth/caller.js';

export const dockerUrl = process.env.TEST_DATABASE_URL;
export const useRedis = Boolean(process.env.TEST_REDIS_REST_URL);
export const appOrigin = 'http://localhost:3004';

/** Settings every test app starts with; tests can override any of them. */
const baseEnv = {
  // Request logs only in the Docker run, where CI needs them to diagnose failures.
  LOG_LEVEL: dockerUrl ? 'error' : 'silent',
  RATE_LIMIT_PER_MINUTE: '1000',
  ADDRESS_RATE_LIMIT_PER_MINUTE: '100000',
  AUTH_RATE_LIMIT_PER_MINUTE: '100000',
  PASSWORD_BREACH_CHECK: 'off',
  ALLOWED_ORIGINS: `${appOrigin},https://*.bitocard.com`,
  COOKIE_SECURE: 'off',
  RESEND_API_KEY: '',
  MAILERSEND_API_KEY: '',
  TERMII_API_KEY: '',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  ...(useRedis ? { UPSTASH_REDIS_REST_URL: process.env.TEST_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: process.env.TEST_REDIS_REST_TOKEN } : {}),
};

export function migrationSql() {
  const dir = new URL('../prisma/migrations/', import.meta.url);
  return readdirSync(dir)
    .filter(entry => /^\d+_/.test(entry))
    .sort()
    .map(name => readFileSync(new URL(`${name}/migration.sql`, dir), 'utf8'));
}

async function dockerDatabase(url) {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset "${name}": TEST_DATABASE_URL must point at a *_test database.`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  for (const sql of migrationSql()) await client.query(sql);
  await client.end();
  return { adapter: new PrismaPg({ connectionString: url }), close: async () => {} };
}

async function pgliteDatabase() {
  const db = new PGlite();
  for (const sql of migrationSql()) await db.exec(sql);
  return { adapter: new PrismaPGlite(db), close: () => db.close() };
}

/** Configuration is read when the app is created, so env overrides apply only to that app. */
async function withEnv(overrides, fn) {
  const saved = {};
  for (const [name, value] of Object.entries(overrides)) {
    saved[name] = process.env[name];
    if (value === undefined || value === '') delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/**
 * Starts the API on a random port. `database: 'auto'` uses Docker Postgres when configured, otherwise PGlite;
 * `'pglite'` forces a private in-process database (for extra apps inside one test file).
 */
export async function startApp({ env = {}, extraModules = [], database = 'auto' } = {}) {
  const db = database === 'auto' && dockerUrl ? await dockerDatabase(dockerUrl) : await pgliteDatabase();
  const app = await withEnv({ ...baseEnv, ...env }, () => createApp({ databaseAdapter: db.adapter, extraModules }));
  app.useLogger(dockerUrl ? ['error'] : false);
  await app.listen(0);
  const base = (await app.getUrl()).replace('[::1]', 'localhost');
  return {
    app,
    base,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/**
 * A minimal browser-like client: keeps cookies, sends the app Origin on changes and JSON bodies.
 * `json` is the parsed body (or null); the raw Response is returned too.
 */
export function client(base, { origin = appOrigin, autoIdempotency = false } = {}) {
  const jar = new Map();
  async function request(method, path, body, headers = {}) {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(origin && method !== 'GET' ? { origin } : {}),
        ...(autoIdempotency && method === 'POST' ? { 'idempotency-key': `auto-${Date.now()}-${Math.random()}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const [name, value] = pair.split('=');
      const expired = attributes.some(attr => /expires=Thu, 01 Jan 1970/i.test(attr) || /max-age=0/i.test(attr));
      if (expired || value === '') jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
    const text = await res.text();
    return { res, status: res.status, json: text ? JSON.parse(text) : null };
  }
  return {
    jar,
    get: (path, headers) => request('GET', path, undefined, headers),
    post: (path, body = {}, headers) => request('POST', path, body, headers),
    patch: (path, body = {}, headers) => request('PATCH', path, body, headers),
    put: (path, body = {}, headers) => request('PUT', path, body, headers),
    delete: (path, headers) => request('DELETE', path, undefined, headers),
  };
}

/** A local HTTP server standing in for an outside service (email provider, breach check, Google, Termii). */
export async function fakeService(handler) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const body = raw.toString('utf8');
    // `raw` keeps binary bodies (encrypted pushes) intact.
    const call = { method: req.method, url: req.url, headers: req.headers, body: body ? safeJson(body) : null, raw };
    calls.push(call);
    const reply = await handler(call);
    res.writeHead(reply.status ?? 200, reply.headers ?? { 'content-type': 'application/json' });
    res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise(resolve => server.close(resolve)) };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The last code emailed to an address, read from the outbox used when no email provider is configured. */
export async function lastEmailCode(app, to) {
  const { EmailService } = await import('../dist/notifications/email.service.js');
  const message = app.get(EmailService).outbox.filter(item => item.to === to).at(-1);
  return message ? /\b(\d{6})\b/.exec(message.subject)?.[1] ?? null : null;
}

let adminCounter = 0;

/** A signed-in admin (password plus authenticator) with the given roles, as a browser-like client. */
export async function adminClient(server, roles = ['super_admin']) {
  const { AdminAuthService } = await import('../dist/auth/admin-auth.service.js');
  const email = `admin${(adminCounter += 1)}-${Date.now()}@bitocard.com`;
  const password = 'admin passphrase long';
  await server.app.get(AdminAuthService).createAdmin({ email, name: 'Test Admin', password, roles });
  // Like the admin app, sends an Idempotency-Key with every POST.
  const browser = client(server.base, { autoIdempotency: true });
  const { json: challenge } = await browser.post('/v1/admin/auth/signin', { email, password });
  const { json: setup } = await browser.post('/v1/admin/auth/mfa/setup', { challenge_token: challenge.challenge_token });
  const code = new TOTP({ issuer: 'BitoCard Admin', label: email, secret: Secret.fromBase32(setup.secret) }).generate();
  const verified = await browser.post('/v1/admin/auth/mfa/verify', { challenge_token: challenge.challenge_token, code });
  if (verified.status !== 200) throw new Error(`Admin sign-in failed: ${JSON.stringify(verified.json)}`);
  browser.admin = { email, secret: setup.secret };
  return browser;
}

/**
 * A current authenticator code for an admin client, for step-up checks. A code's time step can be used only once, so
 * this forgets the last used step first (tests may need several codes within 30 seconds).
 */
export async function adminCode(server, browser) {
  const { PrismaService } = await import('../dist/database/prisma.service.js');
  const prisma = server.app.get(PrismaService);
  const user = await prisma.user.findFirstOrThrow({ where: { realm: 'admin', email: browser.admin.email } });
  await prisma.totpCredential.update({ where: { userId: user.id }, data: { lastUsedStep: null } });
  return new TOTP({ issuer: 'BitoCard Admin', label: browser.admin.email, secret: Secret.fromBase32(browser.admin.secret) }).generate();
}

/** A newly signed-up reseller owner. */
export async function resellerClient(server, { country = 'NG', name = 'Ada Obi', business = 'Ada Digital' } = {}) {
  const browser = client(server.base, { autoIdempotency: true });
  const email = `owner${(adminCounter += 1)}-${Date.now()}@example.com`;
  const { status, json } = await browser.post('/v1/auth/signup', { name, email, password: 'correct horse battery', country, business_name: business });
  if (status !== 201) throw new Error(`Sign-up failed: ${JSON.stringify(json)}`);
  return { browser, email, userId: json.user.id, resellerId: json.memberships[0].reseller.id };
}

/** The last code texted to a number, read from the SMS outbox used when Termii is not configured. */
export async function lastSmsCode(app, to) {
  const { SmsService } = await import('../dist/notifications/sms.service.js');
  const message = app.get(SmsService).outbox.filter(item => item.to === to).at(-1);
  return message ? /\b(\d{6})\b/.exec(message.text)?.[1] ?? null : null;
}

// Fixture endpoints for testing cross-cutting behaviour, declared without decorator syntax (plain JavaScript).
class CreateThing {}
IsString()(CreateThing.prototype, 'name');
IsInt()(CreateThing.prototype, 'quantity');
Min(1)(CreateThing.prototype, 'quantity');

export const fixtureCalls = { count: 0 };
class ThingsController {
  create(body) {
    fixtureCalls.count += 1;
    if (body.name === 'explode') throw new Error('boom');
    return { id: `thing_${fixtureCalls.count}`, ...body };
  }

  accept() {
    fixtureCalls.count += 1;
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
Public()(ThingsController);
Controller('fixtures/things')(ThingsController);

// An API-key route needing the orders:write scope (for scope and plan-restriction tests).
class ScopedController {
  check() {
    return { ok: true };
  }
}
const checkDescriptor = Object.getOwnPropertyDescriptor(ScopedController.prototype, 'check');
Get()(ScopedController.prototype, 'check', checkDescriptor);
Scopes('orders:write')(ScopedController.prototype, 'check', checkDescriptor);
Controller('fixtures/scoped')(ScopedController);

export class FixturesModule {}
Module({ controllers: [ThingsController, ScopedController] })(FixturesModule);
