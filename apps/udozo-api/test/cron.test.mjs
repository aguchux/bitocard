// Scheduled jobs: the cron secret, unknown jobs, and jobs safe to run with nothing to do.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './helpers.mjs';

let server;

before(async () => {
  server = await startApp({ env: { CRON_SECRET: 'cron-secret' } });
});

after(() => server?.close());

const run = (job, secret = 'cron-secret') => fetch(`${server.base}/v1/cron/${job}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

test('every job runs with the secret and reports what it did', async () => {
  for (const job of ['exchange-rates', 'payments', 'earnings', 'plans']) {
    const res = await run(job);
    assert.equal(res.status, 200, job);
    assert.equal((await res.json()).job, job);
  }
});

test('the secret is required and unknown jobs are not found', async () => {
  assert.equal((await run('earnings', null)).status, 401);
  assert.equal((await run('earnings', 'bc_live_' + 'x'.repeat(30))).status, 401);
  assert.equal((await run('nothing')).status, 404);
});

test('without a configured secret no job runs', async () => {
  const other = await startApp({ env: { CRON_SECRET: '' }, database: 'pglite' });
  try {
    assert.equal((await fetch(`${other.base}/v1/cron/earnings`, { headers: { authorization: 'Bearer ' } })).status, 401);
  } finally {
    await other.close();
  }
});
