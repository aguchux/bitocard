// Runs the local copy of BitoCard and Udozo inside one container (docs/LOCAL_TESTING.md).
//   node docker/local/run.mjs write-public   (image build) writes each Next.js app's NEXT_PUBLIC_* values
//   node docker/local/run.mjs                (container start) migrates both databases, then starts every app
// Each app's output is prefixed with its name; an app that stops is started again after five seconds.
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localApps } from './apps.mjs';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

if (process.argv[2] === 'write-public') {
  for (const app of localApps()) {
    if (!app.public) continue;
    const lines = Object.entries(app.public).map(([key, value]) => `${key}=${value}`);
    writeFileSync(join(root, app.dir, '.env.production.local'), `${lines.join('\n')}\n`);
  }
  process.exit(0);
}

const apps = localApps();
const missing = ['BITOCARD_ENCRYPTION_KEY', 'UDOZO_ENCRYPTION_KEY', 'LOCAL_CRON_SECRET', 'BITOCARD_STORE_SERVER_SECRET', 'UDOZO_STORE_SERVER_SECRET'].filter(key => !process.env[key]);
if (missing.length) {
  console.error(`[local] Missing in .env.docker: ${missing.join(', ')}. Run "npm run local:setup" first.`);
  process.exit(1);
}

// New migrations in this branch run on the local copy, never on production.
for (const app of apps.filter(item => item.kind === 'api')) {
  console.log(`[local] Migrating ${app.name}'s local database`);
  execFileSync('node', ['scripts/migrate-deploy.mjs'], { cwd: join(root, app.dir), stdio: 'inherit', env: { ...process.env, ...app.env } });
}

const colours = [36, 35, 33, 32, 34, 31, 96, 95, 93, 92, 94, 91, 37];
const children = new Map();
let stopping = false;

function start(app, index) {
  const command = app.kind === 'api' ? ['node', ['dist/main']] : [join(root, 'node_modules/.bin/next'), ['start', '--port', String(app.port), '--hostname', '0.0.0.0']];
  const child = spawn(command[0], command[1], { cwd: join(root, app.dir), env: { ...process.env, NODE_ENV: 'production', ...app.env } });
  const tag = `\u001b[${colours[index % colours.length]}m${app.name.padEnd(13)}\u001b[0m|`;
  const pipe = stream => {
    let rest = '';
    stream.on('data', chunk => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      for (const line of lines) process.stdout.write(`${tag} ${line}\n`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', code => {
    children.delete(app.name);
    if (stopping) return;
    console.log(`${tag} stopped (${code}); starting it again in 5 seconds`);
    setTimeout(() => start(app, index), 5000);
  });
  children.set(app.name, child);
}

apps.forEach(start);
console.log(`[local] Started:\n${apps.map(app => `  ${app.name.padEnd(13)} http://localhost:${app.port}`).join('\n')}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    for (const child of children.values()) child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 3000);
  });
}
