// Where the API runs is configuration, not Vercel: APP_ENV (the droplet) and Vercel's VERCEL_ENV both mean production
// the same way, secure cookies by default, and settings that would be unsafe in production refused at start.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { loadConfig } = await import('../dist/config/config.js');

describe('the deployment environment', () => {
  test('APP_ENV=production (the droplet) gives secure cookies, as Vercel production does; locally they are not', () => {
    assert.deepEqual([loadConfig({ APP_ENV: 'production' }).appEnv, loadConfig({ APP_ENV: 'production' }).cookieSecure], ['production', true]);
    assert.deepEqual([loadConfig({ VERCEL_ENV: 'production' }).appEnv, loadConfig({ VERCEL_ENV: 'production' }).cookieSecure], ['production', true]);
    assert.deepEqual([loadConfig({}).appEnv, loadConfig({}).cookieSecure], [undefined, false]);
    assert.equal(loadConfig({ APP_ENV: 'production', VERCEL_ENV: 'preview' }).appEnv, 'production', 'APP_ENV wins');
  });

  test('off the droplet webhooks are delivered from the database, never Vercel Queues', () => {
    assert.equal(loadConfig({ APP_ENV: 'production' }).webhookQueue, 'database');
    assert.equal(loadConfig({ VERCEL: '1', VERCEL_ENV: 'production' }).webhookQueue, 'vercel');
  });

  test('insecure cookies or private webhook addresses refuse to start in production', () => {
    assert.throws(() => loadConfig({ APP_ENV: 'production', COOKIE_SECURE: 'off' }), /COOKIE_SECURE must be on in production/);
    assert.throws(() => loadConfig({ APP_ENV: 'production', WEBHOOK_ALLOW_PRIVATE_URLS: 'on' }), /must be off in production/);
    assert.equal(loadConfig({ COOKIE_SECURE: 'off' }).cookieSecure, false, 'allowed locally');
  });
});
