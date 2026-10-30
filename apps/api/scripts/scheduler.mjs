// Runs the API's scheduled jobs off Vercel: each minute (UTC), every job in cron.json whose schedule matches is called
// as GET <API_INTERNAL_URL>/v1/cron/<job> with the cron secret, exactly as Vercel Cron called them. A job still running
// from an earlier minute is not started again (Vercel could overlap them; every job is safe to run twice or late, so
// skipping is only kinder to the database). One line of JSON is logged per run.
//
//   API_INTERNAL_URL  the API as the scheduler reaches it, never through Cloudflare (default http://api:3001)
//   CRON_SECRET       the API's own CRON_SECRET
//   CRON_TIMEOUT_MS   how long one run may take before it is given up on (default 15 minutes; the job carries on)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The values one cron field matches: `*`, `n`, `a-b`, `*\/n`, `a-b/n` and comma lists of those. */
export function parseField(field, min, max) {
  const values = new Set();
  for (const part of field.split(',')) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part.trim());
    if (!match) throw new Error(`Cron field not understood: ${field}`);
    const step = match[4] ? Number(match[4]) : 1;
    const from = match[1] === '*' ? min : Number(match[2]);
    const to = match[1] === '*' ? max : match[3] !== undefined ? Number(match[3]) : match[4] ? max : from;
    if (step < 1 || from < min || to > max || from > to) throw new Error(`Cron field out of range: ${field}`);
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values;
}

/** A five-field schedule (minute hour day-of-month month day-of-week), read once. */
export function parseSchedule(schedule) {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`A cron schedule has five fields: ${schedule}`);
  const [minute, hour, day, month, weekday] = fields;
  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    day: parseField(day, 1, 31),
    month: parseField(month, 1, 12),
    weekday: new Set([...parseField(weekday, 0, 7)].map(value => value % 7)),
    // Standard cron: with both day fields restricted, either may match.
    dayAny: day === '*',
    weekdayAny: weekday === '*',
  };
}

/** Whether a parsed schedule runs in the minute of `date`, in UTC (Vercel Cron's time zone). */
export function matches(parsed, date) {
  const dayOk = parsed.day.has(date.getUTCDate());
  const weekdayOk = parsed.weekday.has(date.getUTCDay());
  const days = parsed.dayAny || parsed.weekdayAny ? dayOk && weekdayOk : dayOk || weekdayOk;
  return parsed.minute.has(date.getUTCMinutes()) && parsed.hour.has(date.getUTCHours()) && parsed.month.has(date.getUTCMonth() + 1) && days;
}

/**
 * The jobs in cron.json this product's instance runs (`APP_PRODUCT`, BitoCard's by default), each with its parsed
 * schedule: a job naming another `product` belongs to that product's instance (docs/UDOZO_SPINOFF_PLAN.md).
 */
export function loadJobs(path = new URL('../cron.json', import.meta.url), product = process.env.APP_PRODUCT || 'bitocard') {
  const { jobs } = JSON.parse(readFileSync(path, 'utf8'));
  return jobs.filter(job => !job.product || job.product === product).map(job => ({ ...job, parsed: parseSchedule(job.schedule) }));
}

const log = entry => console.log(JSON.stringify({ time: new Date().toISOString(), service: 'scheduler', ...entry }));

/** Starts the jobs due in `minute` that are not still running. Returns their promises (for tests). */
export function tick(jobs, minute, { baseUrl, secret, timeoutMs, running, fetchImpl = fetch }) {
  return jobs
    .filter(job => matches(job.parsed, minute))
    .map(job => {
      if (running.has(job.job)) {
        log({ job: job.job, outcome: 'skipped', reason: 'still running' });
        return Promise.resolve('skipped');
      }
      running.add(job.job);
      const started = Date.now();
      return fetchImpl(`${baseUrl}/v1/cron/${job.job}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(timeoutMs) })
        .then(async res => {
          const body = await res.text();
          log({ job: job.job, outcome: res.ok ? 'ok' : 'failed', status: res.status, ms: Date.now() - started, ...(res.ok ? {} : { body: body.slice(0, 500) }) });
          return res.ok ? 'ok' : 'failed';
        })
        .catch(error => {
          log({ job: job.job, outcome: 'error', ms: Date.now() - started, error: error.message });
          return 'error';
        })
        .finally(() => running.delete(job.job));
    });
}

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is required');
  const options = {
    baseUrl: (process.env.API_INTERNAL_URL ?? 'http://api:3001').replace(/\/$/, ''),
    secret,
    timeoutMs: Number(process.env.CRON_TIMEOUT_MS ?? 15 * 60_000),
    running: new Set(),
  };
  const jobs = loadJobs();
  log({ outcome: 'started', product: process.env.APP_PRODUCT || 'bitocard', jobs: jobs.length, api: options.baseUrl });
  // Stopping at once is safe: a job already called keeps running in the API, which finishes it.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      log({ outcome: 'stopped', signal, running: [...options.running] });
      process.exit(0);
    });
  }
  // Each minute boundary once, even if a timer fires late or early.
  let last = Math.floor(Date.now() / 60_000);
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 60_000 - (Date.now() % 60_000) + 50));
    const now = Math.floor(Date.now() / 60_000);
    // After a long stall (the droplet paused), only the last few minutes are caught up: the jobs catch up themselves.
    for (let minute = Math.max(last + 1, now - 4); minute <= now; minute += 1) tick(jobs, new Date(minute * 60_000), options);
    last = now;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    log({ outcome: 'fatal', error: error.message });
    process.exit(1);
  });
}
