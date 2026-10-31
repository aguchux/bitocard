// Udozo's API runs on Vercel (apps/udozo-api/vercel.json): Vercel Cron calls GET /v1/cron/<job> with CRON_SECRET, so
// vercel.json must schedule exactly the jobs Udozo's instance runs (the API's job table, less BitoCard's own jobs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { jobRunsFor } from '../dist/products/jobs.js';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test("vercel.json schedules every job Udozo's instance runs, and nothing else", () => {
  const source = readFileSync(new URL('../src/cron/cron.controller.ts', import.meta.url), 'utf8');
  const table = source.slice(source.indexOf('this.jobs = {'), source.indexOf('@Get('));
  const defined = [...table.matchAll(/^\s{6}'?([a-z0-9-]+)'?: (?:async )?\(\) =>/gm)].map(match => match[1]);
  assert.ok(defined.length >= 20, 'the job table was read');
  const expected = defined.filter(job => jobRunsFor(job, 'udozo')).sort();
  const scheduled = vercel.crons.map(cron => cron.path.replace('/v1/cron/', '')).sort();
  assert.deepEqual(scheduled, expected);
});

test('every schedule is a five-field UTC cron expression', () => {
  for (const { path, schedule } of vercel.crons) {
    assert.match(path, /^\/v1\/cron\/[a-z0-9-]+$/);
    assert.equal(schedule.trim().split(/\s+/).length, 5, schedule);
  }
});

test('webhook deliveries are consumed from Vercel Queues', () => {
  const trigger = vercel.functions['api/webhook-queue.mjs'].experimentalTriggers[0];
  assert.equal(trigger.topic, 'webhook-deliveries');
  assert.match(readFileSync(new URL('../api/webhook-queue.mjs', import.meta.url), 'utf8'), /webhookQueueHandler/);
});
