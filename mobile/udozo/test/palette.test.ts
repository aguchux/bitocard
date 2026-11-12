// The admins' published theme over the app's light colours; the dark ones stay the app's own.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { darkPalette, lightPalette, themed } from '../src/lib/palette.ts';

test("Udozo's own colours until a theme is published", () => {
  assert.deepEqual(themed('light', null), lightPalette);
  assert.deepEqual(themed('dark', null), darkPalette);
});

test('the published theme on light, links in its accent; dark mode unchanged', () => {
  const colors = themed('light', { primary: '#14532d', accent: '#b45309', ink: '#111827', page: '#fffbf5' });
  assert.deepEqual([colors.primary, colors.accent, colors.link, colors.text, colors.background], ['#14532d', '#b45309', '#b45309', '#111827', '#fffbf5']);
  assert.equal(colors.onPrimary, '#ffffff');
  assert.deepEqual(themed('dark', { primary: '#14532d', accent: '#b45309', ink: '#111827', page: '#fffbf5' }), darkPalette);
});

test('anything not a colour keeps Udozo’s own', () => {
  const colors = themed('light', { primary: 'red', accent: '#12345', ink: 'url(x)', page: '' });
  assert.deepEqual([colors.primary, colors.accent, colors.text, colors.background], [lightPalette.primary, lightPalette.accent, lightPalette.text, lightPalette.background]);
});
