// Smoke tests against a running API: a Vercel deployment or the local Docker API.
//   node scripts/smoke.mjs https://api.bitocard.com
// Protected Vercel previews need VERCEL_AUTOMATION_BYPASS_SECRET in the environment.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node scripts/smoke.mjs <base-url>');
  process.exit(2);
}
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const get = path => fetch(`${base}${path}`, { headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {} });

test(`health is ok and the database is reachable (${base})`, async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.checks.database, 'ok');
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
  assert.equal((await res.json()).info.title, 'BitoCard API');
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
  assert.deepEqual(plans.data.map(plan => plan.code), ['standard', 'premium']);
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
  const webhook = await fetch(`${base}/v1/webhooks/flutterwave`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) },
    body: '{}',
  });
  assert.equal(webhook.status, 401);
});
