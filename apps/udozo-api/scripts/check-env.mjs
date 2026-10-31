// Checks Udozo's environment before anything runs on it (scripts/vercel-build.mjs runs it in every production build,
// before migrations, so a bad setting fails the build instead of the running API): the database
// answers, ENCRYPTION_KEY is the key the stored secrets were sealed with, Redis accepts its token, and production's
// safety settings hold. A wrong ENCRYPTION_KEY would make every stored service key unreadable and seal new ones with the
// wrong key, so it fails the deploy before the API starts. Prints names and counts only, never a value.
//   node scripts/check-env.mjs
import { createDecipheriv } from 'node:crypto';
import pg from 'pg';

const problems = [];
const env = process.env;
const say = (ok, message) => console.log(`[env] ${ok ? 'ok  ' : 'FAIL'} ${message}`);
const fail = message => {
  problems.push(message);
  say(false, message);
};

for (const name of ['DATABASE_URL', 'ENCRYPTION_KEY', 'CRON_SECRET']) if (!env[name]) fail(`${name} is not set`);
// APP_ENV, else Vercel's own VERCEL_ENV (as the API reads it, config.ts).
if ((env.APP_ENV ?? env.VERCEL_ENV) === 'production') {
  if ((env.APP_PRODUCT ?? 'udozo') !== 'udozo') fail(`APP_PRODUCT is ${env.APP_PRODUCT}: this is Udozo's API`);
  if (env.COOKIE_SECURE === 'off') fail('COOKIE_SECURE is off: session cookies would travel over plain HTTP');
  if (env.WEBHOOK_ALLOW_PRIVATE_URLS === 'on') fail('WEBHOOK_ALLOW_PRIVATE_URLS is on');
  if (/(^|,)\s*http:\/\//.test(env.ALLOWED_ORIGINS ?? '')) fail('ALLOWED_ORIGINS lists plain http:// origins (local development) in production');
  if ((env.CRON_SECRET ?? '').length < 32) fail('CRON_SECRET is shorter than 32 characters');
  if (env.STORE_SERVER_SECRET === undefined) say(true, 'STORE_SERVER_SECRET unset: signed-out shoppers share the store server’s rate limit');
}

const key = Buffer.from(env.ENCRYPTION_KEY ?? '', 'base64');
if (env.ENCRYPTION_KEY && key.length !== 32) fail(`ENCRYPTION_KEY is ${key.length} bytes, not 32`);

/** Whether `sealed` (`v1:<iv>:<tag>:<data>`) opens with the key. */
function opens(sealed) {
  try {
    const [version, iv, tag, data] = sealed.split(':');
    if (version !== 'v1') return false;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
    return true;
  } catch {
    return false;
  }
}

if (env.DATABASE_URL) {
  const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    await client.query('SET default_transaction_read_only = on');
    say(true, 'database answers');
    // Before the first migration there is nothing sealed yet; that is not a failure.
    const table = (await client.query(`SELECT to_regclass('public.integration_settings') AS t`)).rows[0].t;
    if (table && key.length === 32) {
      const rows = (await client.query('SELECT value FROM integration_settings WHERE encrypted LIMIT 20')).rows;
      const opened = rows.filter(row => opens(row.value)).length;
      if (!rows.length) say(true, 'no stored secrets yet to check ENCRYPTION_KEY against');
      else if (opened === rows.length) say(true, `ENCRYPTION_KEY opens the stored secrets (${opened} of ${rows.length})`);
      else fail(`ENCRYPTION_KEY opens ${opened} of ${rows.length} stored secrets: it is not the key they were sealed with`);
    }
  } catch (error) {
    fail(`database: ${error.message}`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (env.UPSTASH_REDIS_REST_URL) {
  try {
    const res = await fetch(`${env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '')}/ping`, { headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN ?? ''}` }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) say(true, 'Redis accepts its token');
    else {
      // Upstash's own reason (a limit reached, a paused database, a wrong token), never the token. 401 is the token.
      const reason = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      fail(`Redis refused (HTTP ${res.status}${reason ? `: ${reason}` : ''})${res.status === 401 ? ': check UPSTASH_REDIS_REST_TOKEN' : ''}`);
    }
  } catch (error) {
    fail(`Redis: ${error.message}`);
  }
}

if (problems.length) {
  console.log(`[env] ${problems.length} problem${problems.length === 1 ? '' : 's'}: the build stops, nothing is deployed.`);
  process.exit(1);
}
console.log('[env] all checks passed');
