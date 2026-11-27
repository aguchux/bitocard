import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
type Release = 'major' | 'minor' | 'patch';
type PackageManifest = { version: string; [key: string]: unknown };
type AppManifest = { expo: { version: string; ios?: { buildNumber?: string; [key: string]: unknown }; android?: { versionCode?: number; [key: string]: unknown }; [key: string]: unknown } };
type LockManifest = { version: string; packages?: Record<string, { version?: string; [key: string]: unknown }>; [key: string]: unknown };

export function nextVersion(current: string, requested: string): string {
  const match = current.match(versionPattern);
  if (!match) throw new Error(`Current version ${current} is not major.minor.patch.`);
  if (requested.match(versionPattern)) {
    if (compare(requested, current) <= 0) throw new Error(`New version ${requested} must be newer than ${current}.`);
    return requested;
  }
  if (!(['major', 'minor', 'patch'] as string[]).includes(requested)) {
    throw new Error('Choose major, minor, patch, or an explicit version such as 1.2.3.');
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  const release = requested as Release;
  if (release === 'major') return `${major + 1}.0.0`;
  if (release === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const compare = (left: string, right: string) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference) return difference;
  }
  return 0;
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function bumpVersion(root: string, requested: string) {
  const packagePath = resolve(root, 'package.json');
  const appPath = resolve(root, 'app.json');
  const lockPath = resolve(root, 'package-lock.json');
  const [pkg, app, lock] = await Promise.all([
    readFile(packagePath, 'utf8').then(value => JSON.parse(value) as PackageManifest),
    readFile(appPath, 'utf8').then(value => JSON.parse(value) as AppManifest),
    readFile(lockPath, 'utf8').then(value => JSON.parse(value) as LockManifest),
  ]);
  if (pkg.version !== app.expo.version || pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) {
    throw new Error('package.json, app.json and package-lock.json must have the same version before bumping.');
  }

  const version = nextVersion(pkg.version, requested);
  pkg.version = version;
  app.expo.version = version;
  app.expo.ios = { ...app.expo.ios, buildNumber: String(Number(app.expo.ios?.buildNumber ?? '0') + 1) };
  app.expo.android = { ...app.expo.android, versionCode: (app.expo.android?.versionCode ?? 0) + 1 };
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;

  await Promise.all([writeFile(packagePath, json(pkg)), writeFile(appPath, json(app)), writeFile(lockPath, json(lock))]);
  return { version, iosBuild: app.expo.ios.buildNumber, androidBuild: app.expo.android.versionCode };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const requested = process.argv[2] ?? 'patch';
  bumpVersion(root, requested)
    .then(result => console.log(`BitoCard ${result.version} (iOS ${result.iosBuild}, Android ${result.androidBuild})`))
    .catch(error => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
