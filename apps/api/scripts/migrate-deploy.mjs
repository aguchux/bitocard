// Applies pending migrations during a Vercel build. Skips (without failing) when no database is configured,
// so builds of branches without a database still succeed.
import { execSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.log('[db] DATABASE_URL is not set; skipping migrations.');
  process.exit(0);
}
execSync('npx prisma migrate deploy', { stdio: 'inherit' });
