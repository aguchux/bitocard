// Applies pending migrations during a Vercel build. Skips (without failing) when no database is configured,
// so builds of branches without a database still succeed. Migrates over the direct (non-pooled) address
// (`migrate-url.mjs`), and retries when Prisma's migration lock is briefly held by another run.
import { execSync } from 'node:child_process';
import { migrationUrl } from './migrate-url.mjs';

const url = migrationUrl();
if (!url) {
  console.log('[db] DATABASE_URL is not set; skipping migrations.');
  process.exit(0);
}

const attempts = 4;
for (let attempt = 1; ; attempt += 1) {
  try {
    // prisma.config.ts reads DATABASE_URL; only this command sees the direct address.
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
    break;
  } catch (error) {
    if (attempt === attempts) throw error;
    const wait = attempt * 15;
    console.log(`[db] Migrations failed (attempt ${attempt} of ${attempts}); trying again in ${wait} seconds.`);
    await new Promise(resolve => setTimeout(resolve, wait * 1000));
  }
}
