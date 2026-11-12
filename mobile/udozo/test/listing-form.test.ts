// Post an ad in the app: money typed, the body sent, the steps' checks and Fill from photos.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyDraftSuggestion, bodyOf, emptyDraft, firstIncomplete, fromMinor, listingActions, photoCounts, stepOf, stepProblem, toMinor } from '../src/lib/listing-form.ts';

const ready = { ready: 4, uploading: 0, failed: 0 };

test('money is read as typed and shown with thousands', () => {
  assert.equal(toMinor('520,000'), 52_000_000);
  assert.equal(toMinor(' 1500.5 '), 150_050);
  assert.equal(toMinor('0'), null);
  assert.equal(toMinor('12a'), null);
  assert.equal(fromMinor(52_000_000), '520,000');
  assert.equal(fromMinor(150_050), '1,500.50');
  assert.equal(fromMinor(0), '');
  assert.equal(fromMinor(null), '');
});

test('the body carries the price in minor units, free delivery as 0, and only filled features', () => {
  const made = bodyOf(
    { ...emptyDraft, title: ' iPhone 13 ', categoryId: 'c1', price: '450,000', condition: 'used', features: { brand: 'Apple', storage: '128', unlocked: 'true', colour: '' }, stock: '2', areaId: 'a1', feeState: '2,000' },
    { storage: { data_type: 'number' }, unlocked: { data_type: 'boolean' }, brand: { data_type: 'text' } },
  );
  assert.ok('body' in made);
  assert.equal(made.body.title, 'iPhone 13');
  assert.equal(made.body.price, 45_000_000);
  assert.equal(made.body.delivery_fee_state, 200_000);
  assert.equal(made.body.delivery_fee_nationwide, 0);
  assert.equal(made.body.stock, 2);
  assert.deepEqual(made.body.features, [
    { key: 'brand', value: 'Apple' },
    { key: 'storage', value: 128 },
    { key: 'unlocked', value: true },
  ]);
  assert.equal('on_shop' in made.body, false, 'where it is sold is left as it is');
});

test('contact for price sends no price, and a bad amount names its field', () => {
  const onRequest = bodyOf({ ...emptyDraft, priceKind: 'on_request', price: '10' });
  assert.ok('body' in onRequest && onRequest.body.price === null);
  const bad = bodyOf({ ...emptyDraft, price: 'ten' });
  assert.ok('problem' in bad && bad.problem.param === 'price');
  const stock = bodyOf({ ...emptyDraft, stock: '1.5' });
  assert.ok('problem' in stock && stock.problem.param === 'stock');
});

test('each step names what it still needs', () => {
  assert.equal(stepProblem(0, { ...emptyDraft, title: 'Phone' }, ready)?.param, 'category_id');
  assert.equal(stepProblem(0, { ...emptyDraft, title: 'TV' }, ready)?.param, 'title');
  assert.equal(stepProblem(1, emptyDraft, { ready: 3, uploading: 0, failed: 0 })?.message, 'Add at least 4 photos.');
  assert.equal(stepProblem(1, emptyDraft, { ready: 4, uploading: 1, failed: 0 })?.param, 'photos');
  assert.equal(stepProblem(2, { ...emptyDraft, priceKind: 'on_request' }, ready)?.param, 'condition');
  assert.equal(stepProblem(3, { ...emptyDraft, areaId: 'a1', pickup: false, delivery: 'none' }, ready)?.param, 'pickup');
  const done = { ...emptyDraft, title: 'iPhone 13', categoryId: 'c1', price: '1', condition: 'new' as const, areaId: 'a1' };
  assert.equal(firstIncomplete(done, ready), 4);
  assert.equal(firstIncomplete(done, { ready: 2, uploading: 0, failed: 0 }), 1);
});

test("the API's refusals open the step holding the field", () => {
  assert.equal(stepOf('terms'), 4);
  assert.equal(stepOf('features[2].value'), 2);
  assert.equal(stepOf('delivery_fee_state'), 3);
  assert.equal(stepOf('photos'), 1);
  assert.equal(stepOf('resale_discount_bps'), null);
});

test('Fill from photos fills only what is empty, unless asked to replace it all', () => {
  const draft = { ...emptyDraft, title: 'My phone', features: { brand: 'Apple' } };
  const offered = { title: 'iPhone 13 128GB', category: { id: 'c1' }, condition: 'used' as const, features: [{ key: 'brand', value: 'Samsung' }, { key: 'storage', value: 128 }], description: 'Clean.' };
  const kept = applyDraftSuggestion(draft, offered);
  assert.equal(kept.title, 'My phone');
  assert.equal(kept.categoryId, 'c1');
  assert.equal(kept.features.brand, 'Apple');
  assert.equal(kept.features.storage, 128);
  const all = applyDraftSuggestion(draft, offered, true);
  assert.equal(all.title, 'iPhone 13 128GB');
  assert.equal(all.features.brand, 'Samsung');
});

test('photos are counted by state, and each listing offers what can be done now', () => {
  assert.deepEqual(photoCounts([{ status: 'ready' }, { status: 'failed' }, { status: 'processing' }], 2), { ready: 1, failed: 1, uploading: 3 });
  assert.deepEqual(listingActions({ status: 'active', stock: 1, expired_reason: null }), ['edit', 'view', 'sold', 'restock', 'delete']);
  assert.deepEqual(listingActions({ status: 'expired', stock: 0, expired_reason: 'out_of_stock' }), ['restock', 'delete']);
  assert.deepEqual(listingActions({ status: 'expired', stock: 1, expired_reason: null }), ['renew', 'delete']);
  assert.deepEqual(listingActions({ status: 'sold', stock: 0, expired_reason: null }), ['delete']);
  const now = Date.parse('2026-11-12T00:00:00Z');
  assert.ok(listingActions({ status: 'active', stock: 1, expired_reason: null, expires_at: '2026-11-14T00:00:00Z' }, now).includes('renew'));
  assert.ok(!listingActions({ status: 'active', stock: 1, expired_reason: null, expires_at: '2026-11-30T00:00:00Z' }, now).includes('renew'));
});
