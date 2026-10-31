// One API, two products (docs/UDOZO_SPINOFF_PLAN.md, step 1): the same code runs as BitoCard's instance and, on its
// own database, as Udozo's (APP_PRODUCT). Each serves only its own routes and the shared ones, runs only its own jobs,
// describes only its own routes, and names its cookies, API keys, webhook signatures and admins' authenticator itself.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PRODUCT_ONLY } from '../dist/products/product.js';
import { seedProduct } from '../scripts/product-seed.mjs';
import { client, migrationSql, resellerClient, startApp } from './helpers.mjs';

const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const anyId = '00000000-0000-4000-8000-000000000000';
const env = { PRODUCT_ROUTES: 'separate', CRON_SECRET: 'cron-secret', WEBHOOK_ALLOW_PRIVATE_URLS: 'on', EVENTS_SETTLE_SECONDS: '0' };
const sandbox = { 'bitocard-mode': 'test' };

let bitocard;
let udozo;
const receivers = [];

/** Every route of the app with the product it belongs to (null: shared). */
function ownedRoutes(app) {
  const found = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype;
      if (!type?.prototype) continue;
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const handler = name === 'constructor' ? undefined : type.prototype[name];
        if (typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const owner = Reflect.getMetadata(PRODUCT_ONLY, handler) ?? Reflect.getMetadata(PRODUCT_ONLY, type) ?? null;
        for (const base of [Reflect.getMetadata(PATH_METADATA, type) ?? ''].flat()) {
          for (const sub of [Reflect.getMetadata(PATH_METADATA, handler)].flat()) {
            const joined = [base, sub].map(part => String(part).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
            if (['', 'health', 'robots.txt'].includes(joined)) continue;
            found.push({ owner, method: methods[Reflect.getMetadata(METHOD_METADATA, handler)], path: `/v1/${joined}`, url: `/v1/${joined}`.replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, anyId), where: `${type.name}.${name}` });
          }
        }
      }
    }
  }
  return found;
}

/** Sends a route its plainest request: no credentials, an empty body, a fresh Idempotency-Key. */
async function send(server, route) {
  const method = route.method === 'ALL' ? 'GET' : route.method;
  const res = await fetch(`${server.base}${route.url}`, {
    method,
    headers: { 'idempotency-key': `product-${Math.random()}`, ...(method === 'GET' ? {} : { 'content-type': 'application/json', origin: 'http://localhost:3004' }) },
    body: method === 'GET' ? undefined : '{}',
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function receiver() {
  const calls = [];
  const http = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      calls.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const handle = { calls, url: `http://127.0.0.1:${http.address().port}/hooks`, close: () => new Promise(resolve => http.close(resolve)) };
  receivers.push(handle);
  return handle;
}

before(async () => {
  bitocard = await startApp({ env });
  // Its own database, as in production.
  udozo = await startApp({ env: { ...env, APP_PRODUCT: 'udozo' }, database: 'pglite' });
});

after(async () => {
  for (const handle of receivers) await handle.close();
  await bitocard?.close();
  await udozo?.close();
});

describe('routes', () => {
  test("each instance answers the other product's routes as unknown routes, before anything else runs", async () => {
    const unknown = await send(bitocard, { method: 'GET', url: '/v1/no-such-route' });
    assert.equal(unknown.status, 404);
    for (const [server, other] of [
      [bitocard, 'udozo'],
      [udozo, 'bitocard'],
    ]) {
      const routes = ownedRoutes(server.app).filter(route => route.owner === other);
      assert.ok(routes.length > (other === 'udozo' ? 60 : 120), `${other} owns ${routes.length} routes`);
      for (const route of routes) {
        const { status, json } = await send(server, route);
        assert.equal(status, 404, `${route.method} ${route.path} (${route.where})`);
        assert.equal(json?.error?.code, unknown.json.error.code, `${route.method} ${route.path}`);
      }
    }
  });

  test('the shared routes and each product its own answer as before', async () => {
    for (const server of [bitocard, udozo]) assert.equal((await fetch(`${server.base}/v1/countries`)).status, 200);
    assert.equal((await fetch(`${udozo.base}/v1/classifieds/markets`)).status, 200);
    assert.equal((await fetch(`${bitocard.base}/v1/classifieds/markets`)).status, 404);
    assert.equal((await fetch(`${bitocard.base}/v1/catalogue/products`)).status, 401, "BitoCard's catalogue still wants a caller");
    assert.equal((await fetch(`${udozo.base}/v1/catalogue/products`)).status, 404);
    assert.equal((await fetch(`${udozo.base}/v1/afrippa/markets`)).status, 404, 'Afrippa lives inside BitoCard');
  });

  test("each OpenAPI document describes its own product's routes only", async () => {
    const docs = {};
    for (const [name, server] of Object.entries({ bitocard, udozo })) docs[name] = await (await fetch(`${server.base}/v1/openapi.json`)).json();
    assert.equal(docs.bitocard.info.title, 'BitoCard API');
    assert.equal(docs.udozo.info.title, 'Udozo API');
    assert.deepEqual(docs.udozo.servers, [{ url: 'https://api.udozo.com' }]);
    const paths = name => Object.keys(docs[name].paths);
    assert.ok(paths('udozo').includes('/v1/resale/orders') && !paths('bitocard').includes('/v1/resale/orders'));
    assert.ok(paths('bitocard').includes('/v1/orders') && !paths('udozo').includes('/v1/orders'));
    assert.ok(paths('bitocard').includes('/v1/api-keys') && paths('udozo').includes('/v1/api-keys'), 'shared routes are in both');
    const tags = name => new Set(Object.values(docs[name].paths).flatMap(item => Object.values(item).flatMap(operation => operation.tags ?? [])));
    assert.ok(!tags('bitocard').has('Resale'), "BitoCard's document has no Resale operations");
    assert.ok(tags('udozo').has('Resale') && !tags('udozo').has('Orders'));
    assert.match(docs.udozo.components.securitySchemes.bearer.description, /udz_test_/);
  });
});

describe('what each product offers', () => {
  test("BitoCard's stores, keys, switches and webhooks leave out the Resale shop; Udozo's keep it", async () => {
    const owners = { bitocard: await resellerClient(bitocard), udozo: await resellerClient(udozo) };
    const templates = async name => (await owners[name].browser.get('/v1/store-templates')).json.data.map(item => item.key);
    assert.ok(!(await templates('bitocard')).includes('resale_shop'));
    assert.ok((await templates('udozo')).includes('resale_shop'));

    const key = async (name, scopes) => owners[name].browser.post('/v1/api-keys', { name: 'Keys', mode: 'test', ...(scopes ? { scopes } : {}) });
    assert.ok(!(await key('bitocard')).json.scopes.includes('resale:read'), "BitoCard's keys hold no resale scopes");
    assert.deepEqual([(await key('bitocard', ['resale:read'])).status, (await key('bitocard', ['resale:read'])).json.error.param], [400, 'scopes']);
    assert.ok((await key('udozo')).json.scopes.includes('resale:read'));

    const features = async name => Object.keys((await owners[name].browser.get('/v1/settings')).json.features);
    assert.ok(!(await features('bitocard')).includes('reseller_resale') && !(await features('bitocard')).includes('classifieds'));
    assert.ok((await features('udozo')).includes('reseller_resale'));

    const hook = async name => owners[name].browser.post('/v1/webhook-endpoints', { url: 'https://example.com/hooks', events: ['resale_order.created'] }, sandbox);
    assert.equal((await hook('bitocard')).json.error?.code, 'event_type_invalid');
    assert.equal((await hook('udozo')).status, 201);

    const documents = {};
    for (const [name, server] of Object.entries({ bitocard, udozo })) documents[name] = await (await fetch(`${server.base}/v1/openapi.json`)).json();
    assert.ok(!('resale_order.created' in documents.bitocard.webhooks) && !JSON.stringify(documents.bitocard).includes('"resale_order.updated"'));
    assert.ok('resale_order.created' in documents.udozo.webhooks && !('order.completed' in documents.udozo.webhooks));
  });
});

describe('jobs', () => {
  test("each instance runs its own jobs and the shared ones, never the other product's", async () => {
    const run = (server, job) => fetch(`${server.base}/v1/cron/${job}`, { headers: { authorization: 'Bearer cron-secret' } });
    assert.equal((await run(bitocard, 'classifieds')).status, 404);
    assert.equal((await run(udozo, 'classifieds')).status, 200);
    assert.equal((await run(udozo, 'orders')).status, 404);
    assert.equal((await run(udozo, 'crypto')).status, 404);
    assert.equal((await run(udozo, 'notifications-cleanup')).status, 200, 'shared jobs run on both');
  });
});

describe('names', () => {
  test("Udozo's instance defaults to its own addresses and admin domain, never bitocard.com's", async () => {
    const { loadConfig } = await import('../dist/config/config.js');
    const own = loadConfig({ APP_PRODUCT: 'udozo' });
    assert.deepEqual([own.STOREFRONT_URL, own.SHOP_URL, own.DASHBOARD_URL, own.VERIFY_URL, own.ADMIN_APP_URL, own.ADMIN_EMAIL_DOMAINS], ['https://udozo.com', 'https://udozo.com', 'https://shq.udozo.com', 'https://verify.udozo.com', 'https://admin.udozo.com', ['udozo.com']]);
    assert.equal(loadConfig({ APP_PRODUCT: 'udozo', STOREFRONT_URL: 'https://staging.udozo.com' }).STOREFRONT_URL, 'https://staging.udozo.com', 'its environment wins');
    assert.equal(loadConfig({}).STOREFRONT_URL, 'https://bitocard.com', "BitoCard's unchanged");
  });

  test("BitoCard's API refuses to run as Udozo in production (Udozo has its own, apps/udozo-api)", async () => {
    const { loadConfig } = await import('../dist/config/config.js');
    assert.throws(() => loadConfig({ APP_PRODUCT: 'udozo', APP_ENV: 'production' }), /APP_PRODUCT must be bitocard in production/);
    assert.equal(loadConfig({ APP_ENV: 'production' }).APP_PRODUCT, 'bitocard');
  });

  test('each instance says which product it is and fingerprints its own database in /health', async () => {
    const [ours, theirs] = await Promise.all([bitocard, udozo].map(async server => (await fetch(`${server.base}/health`)).json()));
    assert.deepEqual([ours.service, ours.product, theirs.service, theirs.product], ['bitocard-api', 'bitocard', 'udozo-api', 'udozo']);
    const { databaseId } = await import('../dist/health/health.service.js');
    assert.equal(databaseId('postgresql://u:p@ep-cool-1-pooler.us-east-2.aws.neon.tech/bitocard?sslmode=require'), databaseId('postgresql://u:p@ep-cool-1.us-east-2.aws.neon.tech/bitocard'), 'pooled or direct, the same database');
    assert.notEqual(databaseId('postgresql://u:p@ep-cool-1.neon.tech/bitocard'), databaseId('postgresql://u:p@ep-other-2.neon.tech/bitocard'));
    assert.equal(databaseId(undefined), null);
    assert.equal((await (await fetch(udozo.base)).json()).service, 'udozo-api');
  });

  test("Udozo's sessions, API keys and webhook signatures carry its own names", async () => {
    const owner = await resellerClient(udozo);
    assert.ok(owner.browser.jar.has('udz_session') && !owner.browser.jar.has('bc_session'));
    const key = (await owner.browser.post('/v1/api-keys', { name: 'Back office', mode: 'test' })).json;
    assert.match(key.secret, /^udz_test_/);
    const account = await fetch(`${udozo.base}/v1/account`, { headers: { authorization: `Bearer ${key.secret}` } });
    assert.equal(account.status, 200);
    // A key of the other shape is never even looked up.
    const bitocardShape = await fetch(`${udozo.base}/v1/account`, { headers: { authorization: `Bearer bc_test_${key.secret.slice('udz_test_'.length)}` } });
    assert.equal(bitocardShape.status, 401);

    const hook = await receiver();
    const endpoint = await owner.browser.post('/v1/webhook-endpoints', { url: hook.url }, sandbox);
    assert.equal(endpoint.status, 201, JSON.stringify(endpoint.json));
    const topUp = (await owner.browser.post('/v1/wallet/top-ups', { amount: 500_000 }, sandbox)).json;
    await owner.browser.post(`/v1/wallet/top-ups/${topUp.id}/simulate`, { outcome: 'succeeded' }, sandbox);
    for (let wait = 0; hook.calls.length === 0 && wait < 50; wait += 1) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(hook.calls.length > 0, 'the event was delivered');
    assert.match(hook.calls[0].headers['udozo-signature'] ?? '', /^t=\d+,v1=[0-9a-f]{64}$/);
    assert.equal(hook.calls[0].headers['bitocard-signature'], undefined);
    assert.ok(hook.calls[0].headers['udozo-event-id'] && hook.calls[0].headers['udozo-event-type'] && !hook.calls[0].headers['bitocard-event-id']);
    assert.match(hook.calls[0].headers['user-agent'], /^Udozo-Webhooks\//);
  });

  test("Udozo's emails and texts say Udozo, where the shared templates say BitoCard", async () => {
    const { inProductWords } = await import('../dist/products/product.js');
    assert.equal(inProductWords('Your BitoCard code. BitoCard Shop and BitoCard Verify. support@bitocard.com. BitoCard, a Golojan Ltd venture.', 'udozo'), 'Your Udozo code. Udozo and Udozo Verify. support@udozo.com. Udozo.');
    assert.equal(inProductWords('Your BitoCard code', 'bitocard'), 'Your BitoCard code');
    const owner = await resellerClient(udozo);
    const { EmailService } = await import('../dist/notifications/email.service.js');
    const sent = udozo.app.get(EmailService).outbox.filter(item => item.to === owner.email);
    assert.ok(sent.length > 0, 'the sign-up code was emailed');
    for (const message of sent) {
      assert.doesNotMatch(`${message.subject} ${message.text} ${message.html}`, /BitoCard/);
      assert.match(`${message.subject} ${message.text}`, /Udozo/);
    }
  });

  test("BitoCard's names are unchanged", async () => {
    const owner = await resellerClient(bitocard);
    assert.ok(owner.browser.jar.has('bc_session'));
    assert.match((await owner.browser.post('/v1/api-keys', { name: 'Back office', mode: 'test' })).json.secret, /^bc_test_/);
  });

  test("Udozo's admins sign in as Udozo's, in their authenticator too", async () => {
    const { AdminAuthService } = await import('../dist/auth/admin-auth.service.js');
    const email = `admin-${Date.now()}@bitocard.com`;
    await udozo.app.get(AdminAuthService).createAdmin({ email, name: 'Udozo Admin', password: 'admin passphrase long', roles: ['super_admin'], realm: 'admin' });
    const browser = client(udozo.base, { autoIdempotency: true });
    const challenge = (await browser.post('/v1/admin/auth/signin', { email, password: 'admin passphrase long' })).json;
    const setup = (await browser.post('/v1/admin/auth/mfa/setup', { challenge_token: challenge.challenge_token })).json;
    assert.match(setup.otpauth_uri, /issuer=Udozo%20Admin/);
  });
});

describe('product seed', () => {
  test("a freshly migrated database becomes Udozo's, and running it again changes nothing", async () => {
    const db = new PGlite({ extensions: { pg_trgm } });
    for (const sql of migrationSql()) await db.exec(sql);
    const query = sql => db.query(sql);
    assert.deepEqual(await seedProduct(query, 'bitocard'), [], "BitoCard's database needs nothing");
    const first = await seedProduct(query, 'udozo');
    // Enterprise is created hidden already; the rest change rows on a fresh database.
    assert.ok(first.filter(seed => seed.name !== 'Enterprise hidden').every(seed => seed.rows >= 1), JSON.stringify(first));
    const store = (await db.query(`SELECT "name" FROM "stores" WHERE "id" = '00000000-0000-4000-8000-0000000000b2'`)).rows[0];
    assert.equal(store.name, 'Udozo');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM "resellers" WHERE "house" = true AND "name" = 'BitoCard'`)).rows[0].n, 0);
    assert.equal((await db.query(`SELECT "available" FROM "plans" WHERE "code" = 'enterprise'`)).rows[0].available, false);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM "stores" WHERE "status" = 'published' AND "id" <> '00000000-0000-4000-8000-0000000000b2'`)).rows[0].n, 0);
    // The owner's starting prices: a US$10 setup fee for every market and Premium at US$5 a month.
    assert.deepEqual((await db.query(`SELECT "enabled", "amount_minor"::int AS amount FROM "setup_fees" WHERE "country" = 'WW'`)).rows[0], { enabled: true, amount: 1000 });
    assert.equal((await db.query(`SELECT "price_cents" FROM "plans" WHERE "code" = 'premium'`)).rows[0].price_cents, 500);
    // Set once: an admin's later price is never put back.
    await db.query(`UPDATE "plans" SET "price_cents" = 700 WHERE "code" = 'premium'`);
    assert.ok((await seedProduct(query, 'udozo')).every(seed => seed.rows === 0));
    assert.equal((await db.query(`SELECT "price_cents" FROM "plans" WHERE "code" = 'premium'`)).rows[0].price_cents, 700);
    await assert.rejects(() => seedProduct(query, 'nope'), /Unknown APP_PRODUCT/);
    await db.close();
  });
});
