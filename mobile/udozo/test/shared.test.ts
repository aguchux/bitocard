// The app's copies of udozo.com's shared types and helpers match their originals (run node scripts/sync-shared.mjs).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const files = ['classifieds.ts', 'home.ts', 'storefront.ts'];
const original = (file: string) => new URL(`../../../packages/api-client/src/${file}`, import.meta.url);

test('src/shared is the same as packages/api-client/src', { skip: !existsSync(original('classifieds.ts')) && 'not in the monorepo' }, () => {
  for (const file of files) {
    assert.equal(readFileSync(new URL(`../src/shared/${file}`, import.meta.url), 'utf8'), readFileSync(original(file), 'utf8'), `${file} is out of date: run node scripts/sync-shared.mjs`);
  }
});
