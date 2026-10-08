// The address `prisma migrate deploy` uses. Prisma's migrations hold a Postgres advisory lock for the whole run,
// which a pooler (Neon's PgBouncer, the `-pooler` host) does not keep on one connection, so migrating through it can
// time out acquiring the lock. DIRECT_URL wins when set; otherwise a Neon pooled address is turned into its direct one
// (the same host without `-pooler`, and no `pgbouncer` parameter). Anything else is used as it is.
export function migrationUrl(env = process.env) {
  if (env.DIRECT_URL) return env.DIRECT_URL;
  const pooled = env.DATABASE_URL;
  if (!pooled) return undefined;
  let url;
  try {
    url = new URL(pooled);
  } catch {
    return pooled;
  }
  if (!url.hostname.endsWith('.neon.tech') || !url.hostname.includes('-pooler.')) return pooled;
  url.hostname = url.hostname.replace('-pooler.', '.');
  url.searchParams.delete('pgbouncer');
  return url.toString();
}
