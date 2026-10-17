// The shared design tokens: styles/tokens.css (Tailwind) and tokens.ts (JavaScript) hold the same palette, and the
// fonts the apps use (`font-sans`, `font-display`) are both defined.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const ts = readFileSync(new URL('../src/tokens.ts', import.meta.url), 'utf8');

/** `--color-navy-900: #070f4c` → { navy900: '#070f4c' }, the names tokens.ts uses. */
const cssColors = Object.fromEntries(
  [...css.matchAll(/--color-([a-z]+)(?:-(\d+))?:\s*(#[0-9a-f]{6});/g)].map(([, name, step, value]) => [`${name}${step ?? ''}`, value]),
);
const tsColors = Object.fromEntries([...ts.matchAll(/^\s+([a-z]+\d*): "(#[0-9a-f]{6})",$/gm)].map(([, name, value]) => [name, value]));

describe('design tokens', () => {
  test('tokens.ts mirrors every colour in tokens.css', () => {
    assert.ok(Object.keys(cssColors).length > 10, 'tokens.css lists the palette');
    assert.deepEqual(tsColors, cssColors);
  });

  test('the brand pair is the logo navy and pink', () => {
    assert.equal(cssColors.navy900, '#070f4c');
    assert.equal(cssColors.brand500, '#ff2382');
  });

  test('font-sans and font-display are Inter', () => {
    assert.match(css, /--font-sans:\s*var\(--font-inter\)/);
    assert.match(css, /--font-display:\s*var\(--font-inter\)/);
  });

  test('every variable is emitted, for plain CSS and inline styles', () => {
    assert.match(css, /@theme static \{/);
  });
});

// The docs, legals and the storefront's /resellers page take their colours from the tokens. Brand and text colours
// that have a token are never written as hex (illustrations keep their own literal tints), and Tailwind code never
// uses a hex class (`text-[#070f4c]`: use `text-navy-900`).
describe('apps use the tokens', () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const walk = dir =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === 'node_modules' || name.startsWith('.') ? [] : walk(path);
      return /\.(tsx?|css)$/.test(name) ? [path] : [];
    });
  const files = [
    ...['apps/docs/app', 'apps/docs/components', 'apps/legals/app', 'apps/legals/components'].flatMap(dir => walk(join(repo, dir))),
    join(repo, 'apps/storefront/app/resellers/resellers.css'),
  ];
  const tokenised = Object.values(cssColors).map(value => value.slice(1));
  const found = pattern =>
    files.flatMap(file => [...readFileSync(file, 'utf8').matchAll(pattern)].map(([match]) => `${relative(repo, file)}: ${match}`));

  test('no hex colour that has a token', () => {
    assert.deepEqual(found(new RegExp(`#(?:${tokenised.join('|')})(?:[0-9a-f]{2})?\\b`, 'gi')), []);
  });

  test('no Tailwind hex classes', () => {
    assert.deepEqual(found(/-\[#[0-9a-fA-F]{3,8}\]/g), []);
  });

  test('docs and legals import the tokens', () => {
    for (const app of ['docs', 'legals']) {
      assert.match(readFileSync(join(repo, `apps/${app}/app/globals.css`), 'utf8'), /@import "@bitocard\/ui\/styles\/tokens\.css";/);
    }
  });
});
