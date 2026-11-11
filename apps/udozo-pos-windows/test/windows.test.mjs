// Udozo POS for Windows, checked without Rust: the Tauri settings, the window's rules in main.rs, the bundled start page,
// the icons and Store tiles (scripts/brand-assets.py), the MSIX manifest and its layout script, and the CI workflow
// that builds it all on Windows.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkIdentity, identityFrom, layout, manifestFor, msixVersion, testIdentity } from '../scripts/msix-layout.mjs';

const here = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(join(here, path), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargo = read('src-tauri/Cargo.toml');
const main = read('src-tauri/src/main.rs');

/** Width and height from a PNG's header. */
function png(path) {
  const bytes = readFileSync(join(here, path));
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${path} is a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** The sites main.rs keeps in the window. */
const allowedHosts = () => [...main.match(/ALLOWED_HOSTS: \[&str; \d+\] = \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);

describe('the Tauri app', () => {
  test('is Udozo POS, with a version the Store can take and no installer of its own', () => {
    assert.equal(config.productName, 'Udozo POS');
    assert.equal(config.identifier, 'com.udozo.pos');
    assert.match(config.version, /^\d+\.\d+\.\d+$/);
    assert.match(cargo, new RegExp(`^version = "${config.version.replace(/\./g, '\\.')}"$`, 'm'), 'Cargo.toml has the same version');
    // The MSIX is made by makeappx from the bare executable; Tauri's own MSI and NSIS installers are never built.
    assert.equal(config.bundle.active, false);
    assert.equal(config.build.frontendDist, '../dist');
    assert.deepEqual(config.app.windows, [], 'the window is made in main.rs, with its navigation rules');
  });

  test('builds udozo-pos.exe on Tauri 2 with one copy at a time', () => {
    assert.match(cargo, /^name = "udozo-pos"$/m);
    assert.match(cargo, /^tauri = \{ version = "2"/m);
    assert.match(cargo, /^tauri-build = \{ version = "2"/m);
    assert.match(cargo, /^tauri-plugin-single-instance = "2"$/m);
    assert.match(main, /windows_subsystem = "windows"/, 'no console window');
    const plugins = [...main.matchAll(/\.plugin\(tauri_plugin_(\w+)::init/g)].map(match => match[1]);
    assert.equal(plugins[0], 'single_instance', 'the single-instance plugin is registered first');
    assert.match(read('src-tauri/build.rs'), /tauri_build::build\(\)/);
  });

  test('keeps only Udozo POS and udozo.com in the window, over https, and gives pages no commands', () => {
    assert.deepEqual(allowedHosts(), ['pos.udozo.com', 'udozo.com', 'www.udozo.com']);
    assert.match(main, /"https" => url\.host_str\(\)\.is_some_and/);
    assert.match(main, /\.on_navigation\(/);
    assert.match(main, /open_url\(url\.as_str\(\)/, 'other addresses open in the browser');
    assert.ok(!existsSync(join(here, 'src-tauri', 'capabilities')), 'no capabilities: nothing a page shows can call into Windows');
    assert.ok(!/withGlobalTauri["']?\s*:\s*true/.test(read('src-tauri/tauri.conf.json')));
  });

  test('starts on the bundled page, which opens the till once online', () => {
    const start = read('dist/start.js');
    const [, target] = start.match(/const START = "([^"]+)"/);
    const [, probe] = start.match(/const PROBE = "([^"]+)"/);
    for (const address of [target, probe]) {
      const url = new URL(address);
      assert.equal(url.protocol, 'https:');
      assert.ok(allowedHosts().includes(url.hostname), `${url.hostname} is kept in the window`);
    }
    assert.equal(new URL(target).pathname, '/app', 'the owner’s and staff pages');
    // The page's own rules: scripts and styles from the app only, the internet check to pos.udozo.com only.
    const csp = Object.fromEntries(config.app.security.csp.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
    assert.deepEqual(csp['script-src'], ["'self'"]);
    assert.deepEqual(csp['connect-src'], [new URL(probe).origin]);
    const html = read('dist/index.html');
    assert.ok(!/<script>/.test(html) && !/style="/.test(html), 'no inline script or style, so the policy can stay strict');
    assert.match(html, /src="start\.js"/);
    assert.match(html, /role="status"/);
  });
});

describe('icons and Store tiles', () => {
  test('are the generated set at their sizes', () => {
    assert.deepEqual(png('src-tauri/icons/32x32.png'), [32, 32]);
    assert.deepEqual(png('src-tauri/icons/128x128.png'), [128, 128]);
    assert.deepEqual(png('src-tauri/icons/128x128@2x.png'), [256, 256]);
    assert.deepEqual(png('src-tauri/icons/icon.png'), [512, 512]);
    assert.deepEqual(png('dist/icon.png'), [128, 128]);
    const ico = readFileSync(join(here, 'src-tauri/icons/icon.ico'));
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ico[6 + index * 16] || 256);
    assert.ok(sizes.includes(16) && sizes.includes(256), 'the executable icon goes from 16 to 256 pixels');
    for (const icon of config.bundle.icon) assert.ok(existsSync(join(here, 'src-tauri', icon)), icon);
  });

  test('every tile the manifest names exists at the size Windows expects', () => {
    const manifest = read('msix/AppxManifest.xml');
    const named = [...manifest.matchAll(/Assets\\([A-Za-z0-9]+)\.png/g)].map(match => match[1]);
    const sizes = { StoreLogo: [50, 50], Square44x44Logo: [44, 44], Square150x150Logo: [150, 150], Wide310x150Logo: [310, 150] };
    assert.deepEqual([...new Set(named)].sort(), Object.keys(sizes).sort());
    for (const [file, size] of Object.entries(sizes)) assert.deepEqual(png(`msix/Assets/${file}.png`), size, file);
  });
});

describe('the MSIX package', () => {
  test('versions have four parts ending in 0', () => {
    assert.equal(msixVersion('0.1.0'), '0.1.0.0');
    assert.equal(msixVersion('1.12.3'), '1.12.3.0');
    assert.throws(() => msixVersion('1.2'), /major\.minor\.patch/);
    assert.throws(() => msixVersion('1.2.3-beta'), /major\.minor\.patch/);
    assert.throws(() => msixVersion('70000.0.0'), /65535/);
    assert.throws(() => msixVersion('0.0.0'), /0\.0\.0/);
  });

  test('the manifest is a full-trust desktop app for Windows 10 and later, filled with no placeholder left', () => {
    const manifest = manifestFor({ version: '0.1.0', identity: { name: '12345Udozo.UdozoPOS', publisher: 'CN=ABCD1234-5678', publisherName: 'Udozo & Co' } });
    assert.match(manifest, /<Identity Name="12345Udozo\.UdozoPOS" Publisher="CN=ABCD1234-5678" Version="0\.1\.0\.0" ProcessorArchitecture="x64" \/>/);
    assert.match(manifest, /<PublisherDisplayName>Udozo &amp; Co<\/PublisherDisplayName>/, 'values are escaped');
    assert.match(manifest, /Executable="udozo-pos\.exe" EntryPoint="Windows\.FullTrustApplication"/);
    assert.match(manifest, /<rescap:Capability Name="runFullTrust" \/>/);
    assert.match(manifest, /<Capability Name="internetClient" \/>/);
    assert.match(manifest, /Name="Windows\.Desktop" MinVersion="10\.0\.17763\.0"/, 'Windows 10 (1809) or later');
    assert.ok(!/\{\{/.test(manifest));
    assert.match(cargo, /^name = "udozo-pos"$/m, 'the executable the manifest starts is the one Cargo builds');
  });

  test('refuses an identity the Store would refuse', () => {
    assert.throws(() => checkIdentity({ name: 'no spaces allowed', publisher: 'CN=X', publisherName: 'Udozo' }), /package name/);
    assert.throws(() => checkIdentity({ name: 'Udozo.POS', publisher: 'Udozo', publisherName: 'Udozo' }), /CN=/);
    assert.throws(() => checkIdentity({ name: 'Udozo.POS', publisher: 'CN="x"', publisherName: 'Udozo' }), /CN=/);
    assert.throws(() => checkIdentity({ name: 'Udozo.POS', publisher: 'CN=X', publisherName: '  ' }), /display name/);
  });

  test('takes Partner Center’s identity from the environment, else a test one', () => {
    assert.equal(identityFrom({}), testIdentity);
    assert.deepEqual(identityFrom({ POS_MSIX_IDENTITY_NAME: 'A.B', POS_MSIX_PUBLISHER: 'CN=C', POS_MSIX_PUBLISHER_NAME: 'Udozo' }), { name: 'A.B', publisher: 'CN=C', publisherName: 'Udozo' });
  });

  test('lays out the executable, the tiles and the manifest for makeappx', () => {
    const folder = mkdtempSync(join(tmpdir(), 'udozo-pos-msix-'));
    try {
      const exe = join(folder, 'built.exe');
      writeFileSync(exe, 'MZ');
      const out = join(folder, 'layout');
      const result = layout({ exe, out, identity: testIdentity });
      assert.equal(result.version, msixVersion(config.version));
      assert.equal(readFileSync(join(out, 'udozo-pos.exe'), 'utf8'), 'MZ');
      for (const file of ['StoreLogo', 'Square44x44Logo', 'Square150x150Logo', 'Wide310x150Logo']) assert.ok(existsSync(join(out, 'Assets', `${file}.png`)), file);
      assert.match(readFileSync(join(out, 'AppxManifest.xml'), 'utf8'), /Name="Udozo\.UdozoPOS\.Test"/);
      assert.throws(() => layout({ exe: join(folder, 'missing.exe'), out, identity: testIdentity }), /build it first/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('the workflow', () => {
  const workflow = readFileSync(join(here, '..', '..', '.github', 'workflows', 'pos-windows.yml'), 'utf8');

  test('builds on Windows with Tauri 2, then packs the MSIX with the Windows SDK', () => {
    assert.match(workflow, /runs-on: windows-latest/);
    assert.match(workflow, /@tauri-apps\/cli@2 build/);
    assert.match(workflow, /--exe src-tauri\/target\/release\/udozo-pos\.exe/);
    assert.match(workflow, /makeappx pack \/d msix-layout \/p udozo-pos\.msix/);
    assert.match(workflow, /name: udozo-pos-msix/);
    for (const name of ['POS_MSIX_IDENTITY_NAME', 'POS_MSIX_PUBLISHER', 'POS_MSIX_PUBLISHER_NAME']) assert.match(workflow, new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`));
    assert.ok(!/secrets\./.test(workflow), 'nothing secret: the package is unsigned and the Store signs it');
  });
});
