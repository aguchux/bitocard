// Lays out Udozo POS's MSIX package: the built udozo-pos.exe, the Store tiles and AppxManifest.xml with its values filled
// in, ready for `makeappx pack /d <out> /p udozo-pos.msix`. The identity comes from Partner Center (the reserved app's
// Product identity) through the environment; without it a test identity is used, fine for checking a build but never
// for uploading.
//   node scripts/msix-layout.mjs --exe src-tauri/target/release/udozo-pos.exe --out msix-layout
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The test identity used when Partner Center's is not given. */
export const testIdentity = { name: 'Udozo.UdozoPOS.Test', publisher: 'CN=Udozo', publisherName: 'Udozo' };

/** The app's version as an MSIX version: the Store wants four parts, the last one 0. */
export function msixVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`The version ${version} is not major.minor.patch.`);
  const parts = match.slice(1, 4).map(Number);
  if (parts.some(part => part > 65535)) throw new Error(`Each part of ${version} must be at most 65535.`);
  if (parts[0] === 0 && parts[1] === 0 && parts[2] === 0) throw new Error('The version cannot be 0.0.0.');
  return `${parts.join('.')}.0`;
}

const escapeXml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Checks the identity Partner Center gives and refuses anything a manifest would not take. */
export function checkIdentity({ name, publisher, publisherName }) {
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(name)) throw new Error('The package name is 3 to 50 letters, digits, dots and hyphens.');
  if (!/^CN=[^"<>&]{1,200}$/.test(publisher)) throw new Error('The publisher starts with CN= (Partner Center > Product identity).');
  if (!publisherName.trim() || publisherName.length > 256) throw new Error('The publisher display name is 1 to 256 characters.');
  return { name, publisher, publisherName: publisherName.trim() };
}

/** AppxManifest.xml with its values filled in. */
export function manifestFor({ version, identity }) {
  const id = checkIdentity(identity);
  const values = { IDENTITY_NAME: id.name, PUBLISHER: id.publisher, PUBLISHER_NAME: id.publisherName, VERSION: msixVersion(version) };
  const template = readFileSync(join(here, 'msix', 'AppxManifest.xml'), 'utf8');
  const filled = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => {
    if (!(key in values)) throw new Error(`The manifest asks for ${key}, which nothing fills.`);
    return escapeXml(values[key]);
  });
  return filled;
}

/** The identity from the environment (Partner Center's), else the test one. */
export function identityFrom(env) {
  if (!env.POS_MSIX_IDENTITY_NAME) return testIdentity;
  return { name: env.POS_MSIX_IDENTITY_NAME, publisher: env.POS_MSIX_PUBLISHER ?? '', publisherName: env.POS_MSIX_PUBLISHER_NAME ?? '' };
}

/** Writes the package's folder: the executable, the tiles and the manifest. */
export function layout({ exe, out, identity }) {
  if (!existsSync(exe)) throw new Error(`There is no ${exe}: build it first (npm run tauri -- build).`);
  const config = JSON.parse(readFileSync(join(here, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'Assets'), { recursive: true });
  copyFileSync(exe, join(out, 'udozo-pos.exe'));
  for (const file of readdirSync(join(here, 'msix', 'Assets'))) copyFileSync(join(here, 'msix', 'Assets', file), join(out, 'Assets', file));
  writeFileSync(join(out, 'AppxManifest.xml'), manifestFor({ version: config.version, identity }));
  return { out, version: msixVersion(config.version) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => {
    const at = process.argv.indexOf(`--${name}`);
    return at > 0 ? process.argv[at + 1] : undefined;
  };
  const identity = identityFrom(process.env);
  const result = layout({ exe: resolve(arg('exe') ?? 'src-tauri/target/release/udozo-pos.exe'), out: resolve(arg('out') ?? 'msix-layout'), identity });
  console.log(`Laid out Udozo POS ${result.version} in ${result.out} as ${identity.name}${identity === testIdentity ? ' (test identity: not for the Store)' : ''}`);
}
