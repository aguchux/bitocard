// Smoke tests against a running API: production (each droplet deploy runs it) or the local Docker API.
//   node scripts/smoke.mjs https://api.bitocard.com
import assert from 'node:assert/strict';
import { test } from 'node:test';

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node scripts/smoke.mjs <base-url>');
  process.exit(2);
}
const get = path => fetch(`${base}${path}`);

test(`health is ok and the database is reachable (${base})`, async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.checks.database, 'ok');
  // After a droplet deploy: the address serves the image just deployed, not an old one (or the old host).
  if (process.env.EXPECT_COMMIT) assert.equal(body.commit, process.env.EXPECT_COMMIT.slice(0, 7), `serving ${body.commit}, expected ${process.env.EXPECT_COMMIT.slice(0, 7)}`);
});

test('security headers and request IDs are present', async () => {
  const res = await get('/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.ok(res.headers.get('request-id'));
});

test('the OpenAPI document is served', async () => {
  const res = await get('/v1/openapi.json');
  assert.equal(res.status, 200);
  const document = await res.json();
  assert.equal(document.info.title, 'BitoCard API');
  assert.ok(document.webhooks?.['order.completed'], 'webhook events are documented');
});

test('errors use the BitoCard error format', async () => {
  const res = await get('/v1/smoke-test-missing-route');
  assert.equal(res.status, 404);
  const { error } = await res.json();
  assert.equal(error.type, 'not_found_error');
  assert.ok(error.request_id);
});

test('protected endpoints refuse requests without credentials', async () => {
  const res = await get('/v1/account');
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.type, 'authentication_error');
});

test('the pilot countries and plans are published', async () => {
  const countries = await (await get('/v1/countries')).json();
  assert.ok(countries.data.some(country => country.code === 'NG'));
  const plans = await (await get('/v1/plans')).json();
  // Admins add and show plans (Enterprise, others); the free plan and Premium are always there.
  const codes = plans.data.map(plan => plan.code);
  assert.equal(codes[0], 'standard');
  assert.ok(codes.includes('premium'), `plans: ${codes.join(', ')}`);
});

test('exchange rates are listed for the pilot currencies', async () => {
  const res = await get('/v1/exchange-rates');
  assert.equal(res.status, 200);
  const currencies = (await res.json()).data.map(rate => rate.currency);
  for (const currency of ['NGN', 'GHS', 'KES']) assert.ok(currencies.includes(currency), currency);
});

test('wallets, provider webhooks and scheduled jobs refuse unauthenticated calls', async () => {
  assert.equal((await get('/v1/wallet')).status, 401);
  assert.equal((await get('/v1/catalogue/products')).status, 401);
  assert.equal((await get('/v1/orders')).status, 401);
  assert.equal((await get('/v1/cron/earnings')).status, 401);
  assert.equal((await get('/v1/cron/webhooks')).status, 401);
  assert.equal((await get('/v1/events')).status, 401);
  assert.equal((await get('/v1/webhook-endpoints')).status, 401);
  const webhook = await fetch(`${base}/v1/webhooks/flutterwave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(webhook.status, 401);
});

test('the public storefront catalogue answers, and never names suppliers', async () => {
  const categories = await get('/v1/store/categories');
  assert.equal(categories.status, 200);
  assert.equal(categories.headers.get('cache-control'), 'public, max-age=60');
  const products = await get('/v1/store/products?limit=5');
  assert.equal(products.status, 200);
  assert.ok(!/reloadly|vtpass|didww/i.test(await products.text()));
  // The home page always renders: the published layout, or the approved default until one is published.
  const home = await get('/v1/store/home');
  assert.equal(home.status, 200, `home ${home.status}`);
  const homeBody = await home.json();
  assert.ok(Array.isArray(homeBody.sections) && homeBody.sections.length > 0, 'home has sections');
  assert.equal(typeof homeBody.published, 'boolean');
  assert.equal((await get('/v1/admin/storefront/home')).status, 401, 'the Storefront Manager needs an admin');
});
