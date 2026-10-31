// Udozo's Vercel build (scripts/vercel-build.mjs): production builds check the environment before migrating, so a bad
// setting fails the build rather than the running API; preview builds neither check nor migrate.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const run = (script, env) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(APP_|VERCEL|DATABASE_URL|ENCRYPTION_KEY|CRON_SECRET|COOKIE_SECURE|ALLOWED_ORIGINS|WEBHOOK_ALLOW|UPSTASH)/.test(key)));
  const result = spawnSync(process.execPath, [script], { cwd: new URL('..', import.meta.url), env: { ...clean, ...env }, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
};

const secure = {
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CRON_SECRET: 'c'.repeat(40),
  ALLOWED_ORIGINS: 'https://udozo.com,https://shq.udozo.com',
};

test('a preview build neither checks the environment nor migrates', () => {
  const { status, out } = run('scripts/vercel-build.mjs', { VERCEL_ENV: 'preview', DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/never' });
  assert.equal(status, 0, out);
  assert.match(out, /preview build: no environment check or migrations/);
});

test('a production build stops at a bad environment, before any migration', () => {
  const { status, out } = run('scripts/vercel-build.mjs', { VERCEL_ENV: 'production', ...secure, COOKIE_SECURE: 'off' });
  assert.notEqual(status, 0);
  assert.match(out, /COOKIE_SECURE is off/);
  assert.match(out, /DATABASE_URL is not set/);
  assert.doesNotMatch(out, /\[db\]/, 'no migration was attempted');
});

test("the environment check reads Vercel's production setting and refuses BitoCard's product", () => {
  const plain = run('scripts/check-env.mjs', { VERCEL_ENV: 'production', ...secure, ALLOWED_ORIGINS: 'http://localhost:3007', APP_PRODUCT: 'bitocard' });
  assert.notEqual(plain.status, 0);
  assert.match(plain.out, /ALLOWED_ORIGINS lists plain http:\/\//);
  assert.match(plain.out, /APP_PRODUCT is bitocard/);
  assert.doesNotMatch(plain.out, /AFRIPPA/);
});
