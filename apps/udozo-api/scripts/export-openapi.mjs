// Writes Udozo's API description to openapi.json (committed, so reviews see every change). Run after `npm run build`.
// `--check` fails if the committed file is out of date. BitoCard's API (apps/api) writes BitoCard's document and SHQ's
// generated lists; this copy never touches them.
import { readFileSync, writeFileSync } from 'node:fs';
import { createApp, buildOpenApi } from '../dist/bootstrap.js';

process.env.APP_PRODUCT ??= 'udozo';
const app = await createApp();
app.useLogger(false);
await app.init();
const json = `${JSON.stringify(buildOpenApi(app), null, 2)}\n`;
await app.close();

const file = new URL('../openapi.json', import.meta.url);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // Missing: out of date.
  }
  if (current !== json) {
    console.error('openapi.json is out of date. Run `npm run openapi -w @udozo/api` and commit the result.');
    process.exit(1);
  }
  console.log('openapi.json is up to date.');
} else {
  writeFileSync(file, json);
  console.log('Wrote openapi.json');
}
