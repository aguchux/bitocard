// Writes the API description to openapi.json (committed, so docs and reviews see every change).
// Run after `npm run build`. `--check` fails if the committed file is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { createApp, buildOpenApi } from '../dist/bootstrap.js';

const app = await createApp();
app.useLogger(false);
await app.init();
const json = `${JSON.stringify(buildOpenApi(app), null, 2)}\n`;
await app.close();

const file = new URL('../openapi.json', import.meta.url);
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(file, 'utf8'); } catch { /* missing */ }
  if (current !== json) {
    console.error('openapi.json is out of date. Run `npm run openapi -w @bitocard/api` and commit the result.');
    process.exit(1);
  }
  console.log('openapi.json is up to date.');
} else {
  writeFileSync(file, json);
  console.log('Wrote openapi.json');
}
