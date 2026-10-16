// The shared design tokens: styles/tokens.css (Tailwind) and tokens.ts (JavaScript) hold the same palette, and the
// fonts the apps use (`font-sans`, `font-display`) are both defined.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
