import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { bumpVersion, nextVersion } from '../scripts/bump-version.ts';

test('increments semantic app versions', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(nextVersion('1.9.9', 'major'), '2.0.0');
  assert.equal(nextVersion('1.9.9', '2.1.0'), '2.1.0');
});

test('refuses malformed versions and downgrades', () => {
  assert.throws(() => nextVersion('0.1.0', 'banana'), /Choose major/);
  assert.throws(() => nextVersion('0.1.0', '0.0.9'), /must be newer/);
  assert.throws(() => nextVersion('v1', 'patch'), /not major\.minor\.patch/);
});

test('bumps package, Expo and native store versions together', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bitocard-version-'));
  try {
    await Promise.all([
      writeFile(join(root, 'package.json'), JSON.stringify({ name: 'app', version: '1.2.3' })),
      writeFile(join(root, 'app.json'), JSON.stringify({ expo: { version: '1.2.3', ios: { buildNumber: '8' }, android: { versionCode: 12 } } })),
      writeFile(join(root, 'package-lock.json'), JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } })),
    ]);

    assert.deepEqual(await bumpVersion(root, 'minor'), { version: '1.3.0', iosBuild: '9', androidBuild: 13 });
    const [pkg, app, lock] = await Promise.all(['package.json', 'app.json', 'package-lock.json'].map(file => readFile(join(root, file), 'utf8').then(JSON.parse)));
    assert.equal(pkg.version, '1.3.0');
    assert.deepEqual([app.expo.version, app.expo.ios.buildNumber, app.expo.android.versionCode], ['1.3.0', '9', 13]);
    assert.deepEqual([lock.version, lock.packages[''].version], ['1.3.0', '1.3.0']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
