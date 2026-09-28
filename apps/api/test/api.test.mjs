// Runs against the compiled dist/ output, which is what Vercel deploys. Run `npm run build` first.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../dist/bootstrap.js';

let app;
let base;

before(async () => {
  app = await createApp();
  app.useLogger(false);
  await app.listen(0);
  base = await app.getUrl();
});

after(() => app?.close());

test('GET /health reports ok and is never cached', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'bitocard-api');
});

test('GET / describes the service', async () => {
  const body = await (await fetch(base)).json();
  assert.deepEqual(body, { service: 'bitocard-api', status: 'scaffold', health: '/health' });
});

test('every response carries security headers and noindex', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('robots.txt disallows crawling', async () => {
  const res = await fetch(`${base}/robots.txt`);
  assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
  assert.equal(await res.text(), 'User-Agent: *\nDisallow: /\n');
});

test('unknown routes return a JSON 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
});
