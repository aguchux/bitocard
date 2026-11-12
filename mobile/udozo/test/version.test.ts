// The app compares versions exactly as the API does (apps/udozo-api/src/app-config/versions.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareVersions, updateState } from '../src/lib/version.ts';

test('versions compare part by part, as numbers', () => {
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('0.1.0', '0.2.0') < 0);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

test('below the minimum is required, below the latest is offered', () => {
  assert.equal(updateState('0.1.0', '0.2.0', '0.3.0'), 'required');
  assert.equal(updateState('0.2.0', '0.2.0', '0.3.0'), 'available');
  assert.equal(updateState('0.3.0', '0.2.0', '0.3.0'), 'none');
  assert.equal(updateState('0.3.0', null, null), 'none');
  assert.equal(updateState('not a version', '9.9.9', '9.9.9'), 'none');
  assert.equal(updateState('1.0.0', 'nonsense', null), 'none');
});
