// Wanted requests: the form's body (the budget in minor units), refusals in words, and how a request's time is told.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyWanted, startingWanted, wantedBody, wantedRefusal, wantedToldText, wantedWhen } from '../src/lib/wanted.ts';

const form = { ...emptyWanted, words: '  Toyota   Corolla 2012 ', categoryId: 'cat-1' };

test('the body takes the words, category and, when given, the place, budget, condition and details', () => {
  assert.deepEqual(wantedBody(form), { body: { words: 'Toyota Corolla 2012', category_id: 'cat-1' } });
  const full = wantedBody({ ...form, stateId: 'state-1', areaId: 'area-1', budget: '4,500,000', condition: 'used', details: ' Silver ' });
  assert.deepEqual(full, { body: { words: 'Toyota Corolla 2012', category_id: 'cat-1', area_id: 'area-1', budget_max: 450_000_000, conditions: ['used', 'untested'], details: 'Silver' } });
  assert.deepEqual(wantedBody({ ...form, stateId: 'state-1' }), { body: { words: 'Toyota Corolla 2012', category_id: 'cat-1', state_id: 'state-1' } });
  assert.deepEqual(wantedBody({ ...form, budget: '1500.50', condition: 'new' }), { body: { words: 'Toyota Corolla 2012', category_id: 'cat-1', budget_max: 150_050, conditions: ['new'] } });
});

test('what is missing is said on its field', () => {
  assert.deepEqual(wantedBody({ ...form, words: 'tv' }), { problem: { message: 'Say what you are looking for in a few words.', param: 'words' } });
  assert.equal((wantedBody({ ...form, words: 'x'.repeat(81) }) as { problem: { param: string } }).problem.param, 'words');
  assert.deepEqual(wantedBody({ ...form, categoryId: null }), { problem: { message: 'Choose a category.', param: 'category_id' } });
  assert.equal((wantedBody({ ...form, budget: 'lots' }) as { problem: { param: string } }).problem.param, 'budget_max');
  assert.equal((wantedBody({ ...form, budget: '0' }) as { problem: { param: string } }).problem.param, 'budget_max');
});

test('refusals are said in words', () => {
  assert.equal(wantedRefusal('request_prohibited', 'x'), 'This cannot be asked for on Udozo.');
  assert.match(wantedRefusal('too_many_requests', 'You have 3 open requests. Close one first.'), /Close one you no longer need/);
  assert.equal(wantedRefusal('request_limit', 'x'), 'You have made several requests today. Try again tomorrow.');
  assert.equal(wantedRefusal('parameter_invalid', 'Choose an area in your country.'), 'Choose an area in your country.');
});

test('how long a request has, or how it ended, and who was told', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(wantedWhen({ status: 'open', expires_at: '2026-11-16T09:00:00Z' }, now), 'Ends in 3 days');
  assert.equal(wantedWhen({ status: 'open', expires_at: '2026-11-14T09:00:00Z' }, now), 'Ends tomorrow');
  assert.equal(wantedWhen({ status: 'open', expires_at: '2026-11-13T09:00:00Z' }, now), 'Ends today');
  assert.equal(wantedWhen({ status: 'fulfilled', expires_at: '2026-11-16T09:00:00Z' }, now), 'Found it');
  assert.equal(wantedToldText(1), 'We told 1 seller who sell this. Their answers come to your chats.');
  assert.match(wantedToldText(0), /as they post/);
});

test('a request started from a brand or category page starts with its words and subcategory', () => {
  const tree = [{ children: [{ id: 'c-cars', slug: 'cars' }] }];
  assert.deepEqual(startingWanted(emptyWanted, tree, { words: ' Toyota ', category: 'cars' }), { ...emptyWanted, words: 'Toyota', categoryId: 'c-cars' });
  // A top category's slug chooses nothing: a request needs one of its subcategories.
  assert.deepEqual(startingWanted(emptyWanted, tree, { category: 'vehicles' }), emptyWanted);
  assert.equal(startingWanted(emptyWanted, tree, { words: 'x'.repeat(90) }).words.length, 80);
});
