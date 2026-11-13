// My Resellers: a deal's body from what was typed, and a note's decision.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dealBody, noteBody, percentBps } from '../src/lib/resellers.ts';

test('percentages become basis points', () => {
  assert.equal(percentBps('15'), 1500);
  assert.equal(percentBps(' 7.5 '), 750);
  assert.equal(percentBps('abc'), null);
});

test('a deal needs a discount; the floor and end date are optional', () => {
  assert.deepEqual(dealBody({ listingId: null, discount: '15', floor: '', endsOn: '' }), { body: { listing_id: null, discount_bps: 1500, floor_bps: 0, ends_at: null } });
  assert.deepEqual(dealBody({ listingId: 'l1', discount: '10', floor: '5', endsOn: '2026-12-31' }), { body: { listing_id: 'l1', discount_bps: 1000, floor_bps: 500, ends_at: '2026-12-31T23:59:59.000Z' } });
  assert.ok('problem' in dealBody({ listingId: null, discount: '', floor: '', endsOn: '' }));
  assert.ok('problem' in dealBody({ listingId: null, discount: '10', floor: 'x', endsOn: '' }));
  assert.ok('problem' in dealBody({ listingId: null, discount: '10', floor: '', endsOn: '31/12/2026' }));
});

test('approving names the exact note; refusing may say why', () => {
  assert.deepEqual(noteBody('approve', { note: 'Fast delivery in Lagos' }), { note: 'Fast delivery in Lagos' });
  assert.deepEqual(noteBody('refuse', { note: 'x', reason: ' Not true ' }), { reason: 'Not true' });
  assert.deepEqual(noteBody('withdraw', { note: 'x', reason: 'y' }), {});
});
