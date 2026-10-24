// The droplet's job scheduler: cron.json schedules every job the API has (and matches vercel.json while the API is still
// on Vercel), schedules are read like Vercel Cron's (UTC), and a job still running is never started twice.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { loadJobs, matches, parseSchedule, tick } from '../scripts/scheduler.mjs';

const at = iso => new Date(iso);

describe('schedules', () => {
  test('every-n, fixed times, ranges and lists, in UTC', () => {
    const everyTwo = parseSchedule('*/2 * * * *');
    assert.equal(matches(everyTwo, at('2026-10-24T10:04:00Z')), true);
    assert.equal(matches(everyTwo, at('2026-10-24T10:05:00Z')), false);
    const daily = parseSchedule('40 5 * * *');
    assert.equal(matches(daily, at('2026-10-24T05:40:00Z')), true);
    assert.equal(matches(daily, at('2026-10-24T06:40:00Z')), false);
    const weekdays = parseSchedule('0 9-17/4 * * 1-5');
    assert.deepEqual([...weekdays.hour], [9, 13, 17]);
    assert.equal(matches(weekdays, at('2026-10-26T13:00:00Z')), true, 'a Monday');
    assert.equal(matches(weekdays, at('2026-10-25T13:00:00Z')), false, 'a Sunday');
    assert.equal(matches(parseSchedule('0 0 1,15 * 7'), at('2026-10-25T00:00:00Z')), true, 'day of month or day of week (7 is Sunday)');
  });

  test('a schedule it cannot read is refused, never guessed', () => {
    for (const bad of ['* * * *', '61 * * * *', '*/0 * * * *', 'every minute * * * *']) assert.throws(() => parseSchedule(bad));
  });

  test('cron.json schedules every job the API has, and matches vercel.json while both exist', () => {
    const jobs = loadJobs();
    const source = readFileSync(new URL('../src/cron/cron.controller.ts', import.meta.url), 'utf8');
    const table = source.slice(source.indexOf('this.jobs = {'), source.indexOf('@Get('));
    const defined = [...table.matchAll(/^\s{6}'?([a-z-]+)'?: (?:async )?\(\) =>/gm)].map(match => match[1]).sort();
    assert.ok(defined.length >= 20, 'the job table was read');
    assert.deepEqual(jobs.map(job => job.job).sort(), defined);
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    if (vercel.crons) assert.deepEqual(vercel.crons.map(cron => [cron.path.replace('/v1/cron/', ''), cron.schedule]).sort(), jobs.map(job => [job.job, job.schedule]).sort());
  });
});

describe('running jobs', () => {
  test('calls each job due with the cron secret, and skips one still running', async () => {
    const jobs = [
      { job: 'orders', parsed: parseSchedule('*/2 * * * *') },
      { job: 'plans', parsed: parseSchedule('0 6 * * *') },
    ];
    const calls = [];
    const pending = [];
    const fetchImpl = (url, init) => {
      calls.push([url, init.headers.authorization]);
      return new Promise(resolve => pending.push(() => resolve(new Response('{}', { status: 200 }))));
    };
    const options = { baseUrl: 'http://api:3001', secret: 'cron-secret', timeoutMs: 1000, running: new Set(), fetchImpl };
    const first = tick(jobs, at('2026-10-24T06:00:00Z'), options);
    assert.equal(first.length, 2);
    assert.deepEqual(calls.map(call => call[0]), ['http://api:3001/v1/cron/orders', 'http://api:3001/v1/cron/plans']);
    assert.equal(calls[0][1], 'Bearer cron-secret');
    const second = tick(jobs, at('2026-10-24T06:02:00Z'), options);
    assert.deepEqual(await Promise.all(second), ['skipped'], 'orders is still running from 06:00');
    for (const release of pending) release();
    assert.deepEqual(await Promise.all(first), ['ok', 'ok']);
    assert.equal(options.running.size, 0, 'finished jobs can run again');
  });

  test('a failed or unreachable job is logged and freed for the next minute', async () => {
    const jobs = [{ job: 'orders', parsed: parseSchedule('* * * * *') }];
    const running = new Set();
    const down = () => Promise.reject(new Error('connect ECONNREFUSED'));
    assert.deepEqual(await Promise.all(tick(jobs, at('2026-10-24T06:00:00Z'), { baseUrl: 'http://api:3001', secret: 's', timeoutMs: 1000, running, fetchImpl: down })), ['error']);
    const refused = () => Promise.resolve(new Response('{"error":{}}', { status: 401 }));
    assert.deepEqual(await Promise.all(tick(jobs, at('2026-10-24T06:01:00Z'), { baseUrl: 'http://api:3001', secret: 's', timeoutMs: 1000, running, fetchImpl: refused })), ['failed']);
    assert.equal(running.size, 0);
  });
});
