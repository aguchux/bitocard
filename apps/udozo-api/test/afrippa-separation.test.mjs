// Afrippa and BitoCard kept apart (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 9): every route the API serves is tried with
// every kind of caller of the other product. No BitoCard caller (a reseller's session, API key or docs token, a
// bitocard.com customer, a BitoCard admin, anyone at all) reaches an Afrippa route, and no Afrippa caller (a trader,
// an Afrippa admin, Afrippa's signed server) reaches a BitoCard route: each is refused before any handler runs. Routes
// are read from the running app, so a new route is covered as soon as it exists.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, afrippaAdminOrigin, lastEmailCode, resellerClient, startApp } from './helpers.mjs';

const { ModulesContainer } = await import('@nestjs/core');
const { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } = await import('@nestjs/common/constants.js');
const { PUBLIC_ROUTE, ROUTE_CRON, ROUTE_REALM } = await import('../dist/auth/caller.js');
const { afrippaSignedRoutes } = await import('../dist/afrippa/gate.guard.js');
const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { customerFor } = await import('../dist/customers/customer-session.js');
const { CustomersService } = await import('../dist/customers/customers.service.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-separation-secret-afrippa-separation';
const requestMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const unversioned = new Set(['', 'health', 'robots.txt']);
const anyId = '00000000-0000-4000-8000-000000000999';
/**
 * Afrippa's own routes that are public by design, with credentials of their own: admin sign-in, chain providers' signed
 * notifications, and Verify in Afrippa's name (a single-use link, then a session of an Afrippa case only; tested in
 * afrippa-verify.test.mjs).
 */
const afrippaOwnCredentials = /^\/v1\/afrippa\/(?:admin\/auth|webhooks\/chain|kyc)(?:\/|$)/;

let server;
let prisma;
let routes;
const callers = {};

/** Every route of every controller in the app, with what guards it. */
function appRoutes(app) {
  const found = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype;
      if (!type?.prototype) continue;
      const bases = [Reflect.getMetadata(PATH_METADATA, type) ?? ''].flat();
      for (const name of Object.getOwnPropertyNames(type.prototype)) {
        const handler = name === 'constructor' ? undefined : type.prototype[name];
        if (typeof handler !== 'function' || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const meta = key => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, type);
        const guards = [...(Reflect.getMetadata(GUARDS_METADATA, type) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
        for (const base of bases) {
          for (const sub of [Reflect.getMetadata(PATH_METADATA, handler)].flat()) {
            const joined = [base, sub].map(part => String(part).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
            if (unversioned.has(joined)) continue;
            found.push({
              method: requestMethods[Reflect.getMetadata(METHOD_METADATA, handler)],
              path: `/v1/${joined}`,
              url: `/v1/${joined}`.replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, anyId),
              isPublic: Boolean(meta(PUBLIC_ROUTE)),
              cron: Boolean(meta(ROUTE_CRON)),
              customer: guards.some(guard => guard?.name === 'CustomerGuard'),
              realm: meta(ROUTE_REALM) ?? 'reseller',
              where: `${type.name}.${name}`,
            });
          }
        }
      }
    }
  }
  return found;
}

/** Sends one request as a caller: its own headers, a JSON body on writes, a fresh Idempotency-Key on POST. */
async function send(caller, route) {
  const write = !['GET', 'DELETE', 'HEAD', 'OPTIONS'].includes(route.method);
  const body = write ? '{}' : undefined;
  const headers = {
    ...(write ? { 'content-type': 'application/json' } : {}),
    ...(route.method === 'POST' ? { 'idempotency-key': `sep-${Date.now()}-${Math.random()}` } : {}),
    ...caller.headers(route, body),
  };
  const res = await fetch(`${server.base}${route.url}`, { method: route.method, headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not every refusal has a JSON body; the status is what matters.
  }
  return { status: res.status, code: json?.error?.code };
}

/** Sends every route as the caller, a few at a time, and returns each answer that was not one of `allowed(route)`. */
async function sweep(caller, list, allowed) {
  const failures = [];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const route = list[next++];
      const result = await send(caller, route);
      const expected = allowed(route);
      if (!expected.includes(result.status)) failures.push(`${caller.name} ${route.method} ${route.path} (${route.where}): ${result.status} ${result.code ?? ''}, expected ${expected.join(' or ')}`);
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  return failures;
}

const cookieOf = browser => [...browser.jar].map(([name, value]) => `${name}=${value}`).join('; ');

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret } });
  prisma = server.app.get(PrismaService);
  routes = appRoutes(server.app);

  // BitoCard's callers.
  const owner = await resellerClient(server);
  const key = await owner.browser.post('/v1/api-keys', { name: 'Separation', mode: 'test' });
  assert.equal(key.status, 201, JSON.stringify(key.json));
  const docs = await owner.browser.post('/v1/auth/docs-token', { mode: 'test' });
  assert.equal(docs.status, 200, JSON.stringify(docs.json));
  const shopperEmail = `shopper-${Date.now()}@example.com`;
  const shopperSignup = await fetch(`${server.base}/v1/store/account/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `sep-shopper-${Date.now()}` },
    body: JSON.stringify({ name: 'Bola Shopper', email: shopperEmail, password: 'correct horse battery', country: 'NG' }),
  }).then(res => res.json());
  const shopperToken = shopperSignup.session.token;
  await fetch(`${server.base}/v1/store/account/email/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'bitocard-customer-session': shopperToken, 'idempotency-key': `sep-verify-${Date.now()}` },
    body: JSON.stringify({ code: await lastEmailCode(server.app, shopperEmail) }),
  });
  const bitocardAdmin = await adminClient(server, ['super_admin']);
  callers.reseller = { name: 'reseller session', headers: () => ({ cookie: cookieOf(owner.browser), origin: 'https://shq.bitocard.com' }) };
  callers.apiKey = { name: 'reseller API key', headers: () => ({ authorization: `Bearer ${key.json.secret}` }) };
  callers.docsToken = { name: 'docs token', headers: () => ({ authorization: `Bearer ${docs.json.token}` }) };
  callers.shopper = { name: 'bitocard.com customer', headers: () => ({ 'bitocard-customer-session': shopperToken }) };
  callers.shopperAsAfrippa = { name: 'bitocard.com customer naming Afrippa', headers: () => ({ 'bitocard-customer-session': shopperToken, 'bitocard-store': 'afrippa' }) };
  callers.bitocardAdmin = { name: 'BitoCard admin', headers: () => ({ cookie: cookieOf(bitocardAdmin), origin: 'https://admin.bitocard.com' }) };
  callers.anyone = { name: 'anyone', headers: () => ({}) };

  // Afrippa's callers: a signed-in trader (two-step done), Afrippa's admin, and Afrippa's server signing with no one signed in.
  const traderEmail = `trader-${Date.now()}@example.com`;
  const signed = (method, url, body, token) => ({
    'afrippa-signature': signAfrippaRequest(secret, { method, url, body }),
    ...(token ? { 'bitocard-customer-session': token } : {}),
  });
  const afrippaPost = async (path, body, token) => {
    const raw = JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `sep-t-${Date.now()}-${Math.random()}`, ...signed('POST', path, raw, token) }, body: raw });
    return { status: res.status, json: await res.json() };
  };
  const signup = await afrippaPost('/v1/afrippa/account/signup', { name: 'Ada Trader', email: traderEmail, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  const traderToken = signup.json.session.token;
  await prisma.customerCode.updateMany({ where: { customer: { email: traderEmail } }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await afrippaPost('/v1/afrippa/account/two-step/setup', { method: 'email' }, traderToken)).status, 200);
  const code = /\b(\d{6})\b/.exec(server.app.get(EmailService).outbox.filter(item => item.to === traderEmail).at(-1).subject)[1];
  const confirmed = await afrippaPost('/v1/afrippa/account/two-step/setup/confirm', { code }, traderToken);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  const afrippaAdmin = await afrippaAdminClient(server, ['super_admin']);
  callers.trader = { name: 'Afrippa trader', headers: (route, body) => signed(route.method, route.url, body, traderToken) };
  callers.traderAsAfrippaStore = { name: 'Afrippa trader naming its store', headers: (route, body) => ({ ...signed(route.method, route.url, body, traderToken), 'bitocard-store': 'afrippa' }) };
  callers.traderUnsigned = { name: 'Afrippa trader, unsigned', headers: () => ({ 'bitocard-customer-session': traderToken, 'bitocard-store': 'afrippa' }) };
  callers.afrippaAdmin = { name: 'Afrippa admin', headers: () => ({ cookie: cookieOf(afrippaAdmin), origin: afrippaAdminOrigin }) };
  callers.afrippaServer = { name: "Afrippa's server", headers: (route, body) => signed(route.method, route.url, body) };
  // The trader is really signed in on Afrippa, so refusals below are about the product, not a bad session.
  const account = await fetch(`${server.base}/v1/afrippa/account`, { headers: signed('GET', '/v1/afrippa/account', undefined, traderToken) });
  assert.equal(account.status, 200);
});

after(async () => {
  await server?.close();
});

const isAfrippa = route => route.path.startsWith('/v1/afrippa/');

describe('Afrippa and BitoCard are kept apart', () => {
  test("Afrippa's routes are each behind its signed gate, its admins' realm or credentials of their own", () => {
    const afrippa = routes.filter(isAfrippa);
    assert.ok(afrippa.length > 40, `found ${afrippa.length} Afrippa routes`);
    assert.ok(routes.filter(route => !isAfrippa(route)).length > 400);
    const loose = afrippa.filter(route => !afrippaSignedRoutes.test(route.path) && !afrippaOwnCredentials.test(route.path) && !(route.realm === 'afrippa_admin' && !route.isPublic));
    assert.deepEqual(loose.map(route => `${route.method} ${route.path}`), []);
    // Afrippa's admin realm and its customers' guard appear nowhere else.
    assert.deepEqual(routes.filter(route => route.realm === 'afrippa_admin' && !isAfrippa(route)).map(route => route.path), []);
    assert.deepEqual(afrippa.filter(route => route.customer && !afrippaSignedRoutes.test(route.path)).map(route => route.path), []);
  });

  test('no BitoCard caller reaches an Afrippa route', async () => {
    const afrippa = routes.filter(route => isAfrippa(route) && !afrippaOwnCredentials.test(route.path));
    // Unsigned, the gated routes are unknown; Afrippa's admin routes do not know BitoCard's sessions or keys.
    const allowed = route => (afrippaSignedRoutes.test(route.path) ? [404] : [401, 403]);
    const failures = [];
    for (const caller of ['reseller', 'apiKey', 'docsToken', 'shopper', 'shopperAsAfrippa', 'bitocardAdmin', 'anyone']) {
      failures.push(...(await sweep(callers[caller], afrippa, allowed)));
    }
    assert.deepEqual(failures, []);
    // Afrippa's admin sign-in does not know BitoCard's admin session.
    const session = await fetch(`${server.base}/v1/afrippa/admin/auth/session`, { headers: callers.bitocardAdmin.headers() });
    assert.equal(session.status, 401);
  });

  test('no Afrippa caller reaches a BitoCard route', async () => {
    const bitocard = routes.filter(route => !isAfrippa(route) && (!route.isPublic || route.customer));
    // Customers' routes want a session of their own store, signed-in routes a BitoCard session or key, jobs the cron
    // secret.
    const allowed = route => (route.customer ? [401] : [401, 403]);
    const failures = [];
    for (const caller of ['trader', 'traderAsAfrippaStore', 'traderUnsigned', 'afrippaAdmin', 'afrippaServer']) {
      failures.push(...(await sweep(callers[caller], bitocard, allowed)));
    }
    assert.deepEqual(failures, []);
    // BitoCard's admin sign-in does not know Afrippa's admin session.
    const session = await fetch(`${server.base}/v1/admin/auth/session`, { headers: callers.afrippaAdmin.headers() });
    assert.equal(session.status, 401);
  });

  test("a trader's session counts only on Afrippa's own routes, and a bitocard.com customer's never there", async () => {
    const customers = server.app.get(CustomersService);
    const request = (path, token, store) => ({ path, get: name => ({ 'bitocard-customer-session': token, 'bitocard-store': store })[name.toLowerCase()] });
    const traderToken = callers.trader.headers({ method: 'GET', url: '/' })['bitocard-customer-session'];
    const shopperToken = callers.shopper.headers()['bitocard-customer-session'];
    assert.ok(await customerFor(customers, request('/v1/afrippa/account', traderToken, 'afrippa')));
    // Optional-customer routes (catalogue reads, the shop assistant) treat a trader as signed out.
    for (const path of ['/v1/store/products', '/v1/store/account', '/v1/classifieds/assistant', '/v1/store/support/chat']) {
      assert.equal(await customerFor(customers, request(path, traderToken, 'afrippa')), null, path);
      assert.equal(await customerFor(customers, request(path, traderToken, undefined)), null, path);
    }
    // Afrippa's server pins its own store, where a bitocard.com session is no one.
    assert.equal(await customerFor(customers, request('/v1/afrippa/account', shopperToken, 'afrippa')), null);
    const shopperThroughAfrippa = await fetch(`${server.base}/v1/afrippa/account`, { headers: { ...callers.afrippaServer.headers({ method: 'GET', url: '/v1/afrippa/account' }), 'bitocard-customer-session': shopperToken } });
    assert.equal(shopperThroughAfrippa.status, 401);
  });
});
