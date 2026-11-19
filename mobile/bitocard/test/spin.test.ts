// The spin wheel: the won segment always stops under the pointer at the top, turning forward; values read as cents.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { labelPoint, landingRotation, spinValue, wedgePath } from '../src/lib/spin.ts';

test('the won segment stops at the top, always turning forward', () => {
  for (const current of [0, 95, 1800, 2075]) {
    for (let index = 0; index < 12; index++) {
      const next = landingRotation(current, index, 12);
      assert.ok(next >= current + 5 * 360, 'turns forward at least five times');
      // The segment's centre (index × 30° clockwise from the top), turned by the wheel, ends at 0°.
      assert.equal((((index * 30 + next) % 360) + 360) % 360, 0);
    }
  }
});

test('segment 0 is centred at the top', () => {
  assert.equal(wedgePath(0, 12, 100).split(' ').length > 5, true);
  const top = labelPoint(0, 12, 100);
  assert.ok(Math.abs(top.x - 100) < 1e-9 && top.y < 100);
  const right = labelPoint(3, 12, 100);
  assert.ok(right.x > 100 && Math.abs(right.y - 100) < 1e-9);
});

test('values', () => {
  assert.equal(spinValue('0.05'), '5¢');
  assert.equal(spinValue('0.10'), '10¢');
  assert.equal(spinValue('1.00'), '$1');
  assert.equal(spinValue('1.25'), '$1.25');
});
