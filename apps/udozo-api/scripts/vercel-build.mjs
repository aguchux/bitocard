// The last step of every Vercel build of Udozo's API (vercel.json's buildCommand, after the code is built). A production
// build checks the environment (check-env.mjs: the database answers, ENCRYPTION_KEY opens the stored secrets, Redis
// accepts its token, production's safety settings hold), then migrates and seeds Udozo's database (migrate-deploy.mjs),
// so a problem fails the build and the running deployment is untouched. Preview builds do neither: they must never
// migrate the production database, and they get no production environment.
import { execFileSync } from 'node:child_process';

if (process.env.VERCEL_ENV !== 'production') {
  console.log(`[build] ${process.env.VERCEL_ENV ?? 'local'} build: no environment check or migrations (production builds only).`);
  process.exit(0);
}

for (const script of ['scripts/check-env.mjs', 'scripts/migrate-deploy.mjs']) {
  execFileSync(process.execPath, [script], { stdio: 'inherit' });
}
