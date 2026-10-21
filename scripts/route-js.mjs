// Client JavaScript each route of a built Next.js app loads (its entry chunks, layouts included, plus the root files),
// gzipped. Usage: node scripts/route-js.mjs apps/shq [--json]. For comparing builds, not for CI.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const app = path.resolve(process.argv[2] ?? '.');
const next = path.join(app, '.next');
const root = JSON.parse(fs.readFileSync(path.join(next, 'build-manifest.json'), 'utf8')).rootMainFiles ?? [];
const sizes = new Map();
const gz = file => {
  if (!sizes.has(file)) {
    const full = path.join(next, file.replace(/^\/_next\//, ''));
    sizes.set(file, fs.existsSync(full) ? zlib.gzipSync(fs.readFileSync(full)).length : 0);
  }
  return sizes.get(file);
};

const rows = [];
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === 'page_client-reference-manifest.js') {
      const text = fs.readFileSync(full, 'utf8');
      const json = JSON.parse(text.slice(text.indexOf('= {') + 2).replace(/;\s*$/, ''));
      const files = new Set(root);
      for (const list of Object.values(json.entryJSFiles ?? {})) for (const file of list) files.add(file);
      const route = '/' + path.relative(path.join(next, 'server', 'app'), path.dirname(full)).split(path.sep).filter(part => !part.startsWith('(')).join('/');
      rows.push({ route, kb: Math.round([...files].reduce((sum, file) => sum + gz(file), 0) / 1024) });
    }
  }
};
walk(path.join(next, 'server', 'app'));
rows.sort((a, b) => b.kb - a.kb);
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else for (const row of rows) console.log(`${String(row.kb).padStart(5)} kB  ${row.route}`);
