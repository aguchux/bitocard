// Every app has the complete, generated icon set (scripts/brand-assets.py): favicon.ico, the adaptive SVG icon, a
// PNG icon, the Apple touch icon, and the manifest icons its manifest lists, at the sizes they claim.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const root = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const apps = ['storefront', 'docs', 'legals', 'admin', 'shq'];

/** Width, height and colour type from a PNG's header. */
function png(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${path} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

/** The image sizes inside a .ico file. */
function ico(path) {
  const bytes = readFileSync(path);
  assert.deepEqual([bytes.readUInt16LE(0), bytes.readUInt16LE(2)], [0, 1], `${path} is an icon file`);
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => bytes[6 + index * 16] || 256).sort((a, b) => a - b);
}

const manifestIcons = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512 };

describe('icons', () => {
  for (const app of apps) {
    test(`${app} has the full favicon and app icon set`, () => {
      const dir = join(root, 'apps', app);
      assert.deepEqual(ico(join(dir, 'app/favicon.ico')), [16, 32, 48]);

      const svg = readFileSync(join(dir, 'app/icon.svg'), 'utf8');
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.equal(svg.match(/<image /g)?.length, 2, 'normal and light marks');
      assert.match(svg, /prefers-color-scheme:dark/);

      assert.deepEqual([png(join(dir, 'app/icon1.png')).width, png(join(dir, 'app/icon1.png')).height], [96, 96]);
      const apple = png(join(dir, 'app/apple-icon.png'));
      assert.deepEqual([apple.width, apple.height, apple.colourType], [180, 180, 2], 'Apple icons are opaque (no alpha)');

      for (const [file, size] of Object.entries(manifestIcons)) {
        const icon = png(join(dir, 'public', file));
        assert.deepEqual([icon.width, icon.height], [size, size], file);
      }
      for (const file of ['bitocard-mark.png', 'bitocard-mark-light.png', 'bitocard-logo.png', 'bitocard-logo-light.png']) assert.ok(existsSync(join(dir, 'public', file)), file);
      // Icons are files, never generated routes; layouts set no icons metadata of their own.
      for (const stale of ['app/icon.tsx', 'app/apple-icon.tsx']) assert.ok(!existsSync(join(dir, stale)), `${stale} is gone`);
      assert.doesNotMatch(readFileSync(join(dir, 'app/layout.tsx'), 'utf8'), /\bicons:/);
    });

    test(`${app} has a manifest listing the shared icons`, () => {
      const manifest = readFileSync(join(root, 'apps', app, 'app/manifest.ts'), 'utf8');
      assert.match(manifest, /icons: \[\.\.\.manifestIcons\]/);
    });
  }

  test('the shared manifest icon list names files at their real sizes', () => {
    const site = readFileSync(join(root, 'packages/ui/src/site.ts'), 'utf8');
    const listed = [...site.matchAll(/\{ src: "\/([\w-]+\.png)", sizes: "(\d+)x(\d+)", type: "image\/png", purpose: "(any|maskable)" \}/g)];
    assert.deepEqual(listed.map(match => [match[1], Number(match[2]), match[4]]), [
      ['icon-192.png', 192, 'any'],
      ['icon-512.png', 512, 'any'],
      ['icon-maskable-512.png', 512, 'maskable'],
    ]);
  });
});
