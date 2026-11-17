// Which images a change needs rebuilt, for .github/workflows/docker-images.yml: every image in images.json whose
// package (or a workspace package it uses) changed since `base`, read from turbo's own dependency graph; all of them
// when there is no base (a first push, or a base git no longer has) or a change touches what every image shares
// (the frontends' Dockerfile, images.json, the lockfile). Prints the chosen images as JSON.
//   node deploy/k8s/affected.mjs <base commit | all> [only, comma separated]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const images = JSON.parse(readFileSync(new URL('images.json', import.meta.url), 'utf8'));
const [base = 'all', only = ''] = process.argv.slice(2);

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' });

function affected() {
  if (base === 'all' || /^0+$/.test(base)) return images;
  try {
    run('git', ['cat-file', '-e', `${base}^{commit}`]);
  } catch {
    return images;
  }
  const changed = run('git', ['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean);
  if (changed.some(file => file === 'package-lock.json' || file === 'deploy/k8s/images.json')) return images;
  const webDockerfile = changed.includes('deploy/k8s/web.Dockerfile');
  const packages = new Set(JSON.parse(run('npx', ['--yes', 'turbo@2.11.5', 'run', 'build', `--filter=...[${base}]`, '--dry=json'])).packages);
  return images.filter(image => packages.has(image.pkg) || (webDockerfile && image.dockerfile === 'deploy/k8s/web.Dockerfile'));
}

const wanted = only.split(',').map(name => name.trim()).filter(Boolean);
const unknown = wanted.filter(name => !images.some(image => image.name === name));
if (unknown.length) {
  console.error(`No such image: ${unknown.join(', ')} (choose from ${images.map(image => image.name).join(', ')})`);
  process.exit(1);
}
const chosen = wanted.length ? images.filter(image => wanted.includes(image.name)) : affected();
process.stdout.write(JSON.stringify(chosen));
