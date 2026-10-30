// The deploy's smoke test (scripts/smoke.mjs) passes against each product's instance as it starts, so a deploy fails
// only for a real problem (docs/UDOZO_SPINOFF_PLAN.md, step 5: both instances on one droplet).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { startApp } from './helpers.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));
let bitocard;
let udozo;

before(async () => {
  bitocard = await startApp({ env: { PRODUCT_ROUTES: 'separate' } });
  udozo = await startApp({ env: { APP_PRODUCT: 'udozo', PRODUCT_ROUTES: 'separate' }, database: 'pglite' });
});

after(async () => {
  await bitocard?.close();
  await udozo?.close();
});

const smoke = (base, product) => run(process.execPath, [script, base], { env: { ...process.env, SMOKE_PRODUCT: product }, timeout: 120_000 }).then(
  result => ({ ok: true, output: result.stdout }),
  error => ({ ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }),
);

describe('the smoke test', () => {
  test("passes against BitoCard's instance", async () => {
    const result = await smoke(bitocard.base, 'bitocard');
    assert.ok(result.ok, result.output);
  });

  test("passes against Udozo's instance, and refuses the other product's address", async () => {
    const result = await smoke(udozo.base, 'udozo');
    assert.ok(result.ok, result.output);
    const wrong = await smoke(udozo.base, 'bitocard');
    assert.equal(wrong.ok, false);
    assert.match(wrong.output, /serves udozo, not bitocard/);
  });
});
