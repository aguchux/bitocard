// Post an ad in the app: money typed, the body sent, the steps' checks and Fill from photos.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyDraftSuggestion, bodyOf, emptyDraft, firstIncomplete, fromMinor, listingActions, maxVideoBytes, photoCounts, stepOf, stepProblem, toMinor, videoProblem, videoRefusal } from '../src/lib/listing-form.ts';

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
  assert.equal(made.body.on_shop, true);
  for (const key of ['resale', 'pos_enabled', 'connect', 'sale_method']) assert.equal(key in made.body, false, `${key} is sent only where it is offered`);
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
  assert.equal(stepProblem(4, { ...emptyDraft, areaId: 'a1', pickup: false, delivery: 'none' }, ready)?.param, 'pickup');
  const done = { ...emptyDraft, title: 'iPhone 13', categoryId: 'c1', price: '1', condition: 'new' as const, areaId: 'a1' };
  assert.equal(firstIncomplete(done, ready), 5);
  assert.equal(firstIncomplete(done, { ready: 2, uploading: 0, failed: 0 }), 1);
});

test("the API's refusals open the step holding the field", () => {
  assert.equal(stepOf('terms'), 5);
  assert.equal(stepOf('features[2].value'), 2);
  assert.equal(stepOf('auction_reserve'), 2);
  assert.equal(stepOf('resale_discount_bps'), 3);
  assert.equal(stepOf('pos_enabled'), 3);
  assert.equal(stepOf('delivery_fee_state'), 4);
  assert.equal(stepOf('connect_states[0].shipping'), 4);
  assert.equal(stepOf('photos'), 1);
  assert.equal(stepOf('anything_else'), null);
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

const all = { resale: true, pos: true, connect: true, auctions: true, shopOnly: false };

test('the market’s own photo minimum, and none for a shop-only listing', () => {
  assert.equal(stepProblem(1, emptyDraft, { ready: 5, uploading: 0, failed: 0 }, { minPhotos: 6 })?.message, 'Add at least 6 photos.');
  assert.equal(stepProblem(1, emptyDraft, { ready: 0, uploading: 0, failed: 0 }, { offers: { ...all, shopOnly: true } }), null);
});

test('an auction sends its starting price, reserve and length, and is sold on Udozo only', () => {
  const draft = { ...emptyDraft, saleMethod: 'auction' as const, priceKind: 'negotiable' as const, price: '100,000', auctionReserve: '150,000', auctionDays: 5, resale: true, pos: true };
  const made = bodyOf(draft, {}, all);
  assert.ok('body' in made);
  assert.equal(made.body.sale_method, 'auction');
  assert.equal(made.body.price_kind, 'fixed');
  assert.equal(made.body.auction_reserve, 15_000_000);
  assert.equal(made.body.auction_days, 5);
  assert.equal(made.body.resale, false);
  assert.equal(made.body.pos_enabled, false);
  assert.equal(stepProblem(2, { ...draft, auctionDays: null }, ready, { offers: all })?.param, 'auction_days');
  assert.equal(stepProblem(3, { ...draft, onShop: false }, ready, { offers: all }), null);
});

test('where to sell: resale terms, Udozo POS and at least one place', () => {
  const draft = { ...emptyDraft, resale: true, discountBps: 1000, markupMaxBps: 1500, pos: true, barcode: ' 5012345678900 ', reorderLevel: '3' };
  const made = bodyOf(draft, {}, all);
  assert.ok('body' in made);
  assert.deepEqual([made.body.resale, made.body.resale_discount_bps, made.body.resale_markup_max_bps], [true, 1000, 1500]);
  assert.deepEqual([made.body.pos_enabled, made.body.barcode, made.body.reorder_level], [true, '5012345678900', 3]);
  assert.equal(stepProblem(3, { ...emptyDraft, onShop: false }, ready, { offers: all })?.param, 'on_shop');
  const shopOnly = bodyOf(draft, {}, { ...all, shopOnly: true });
  assert.ok('body' in shopOnly);
  assert.equal('on_shop' in shopOnly.body, false, 'a shop-only category is placed by the API');
  assert.equal('pos_enabled' in shopOnly.body, false);
});

test('Udozo Connect sends its states with charges, and every centre or the chosen ones', () => {
  const draft = { ...emptyDraft, price: '10,000', connect: true, connectStates: { s1: '2,500', s2: '0' }, connectAllCentres: false, connectCentres: ['cc1'] };
  const made = bodyOf(draft, {}, all);
  assert.ok('body' in made);
  assert.deepEqual(made.body.connect_states, [{ state_id: 's1', shipping: 250_000 }, { state_id: 's2', shipping: 0 }]);
  assert.deepEqual(made.body.connect_centres, ['cc1']);
  const every = bodyOf({ ...draft, connectAllCentres: true }, {}, all);
  assert.ok('body' in every && every.body.connect_centres === null);
  assert.equal(stepProblem(4, { ...draft, areaId: 'a1', connectStates: {} }, ready, { offers: all })?.param, 'connect_states');
  assert.equal(stepProblem(4, { ...draft, areaId: 'a1', pickup: false, delivery: 'none' }, ready, { offers: all }), null, 'Connect is a way to hand it over');
  const off = bodyOf({ ...draft, connect: false }, {}, all);
  assert.ok('body' in off && off.body.connect === false && !('connect_states' in off.body));
});

test('a video is checked before it is sent, and the API’s refusals are worded', () => {
  assert.deepEqual(videoProblem({ name: 'clip.MOV', type: null, size: 10_000_000, durationMs: 30_000 }), { type: 'video/quicktime' });
  assert.deepEqual(videoProblem({ name: 'a', type: 'video/mp4' }), { type: 'video/mp4' });
  assert.deepEqual(videoProblem({ name: 'clip.avi', type: 'video/x-msvideo' }), { problem: 'Choose an MP4, MOV or WebM video.' });
  assert.ok('problem' in videoProblem({ name: 'big.mp4', size: maxVideoBytes + 1 }));
  assert.deepEqual(videoProblem({ name: 'long.webm', durationMs: 75_000 }), { problem: 'Videos can be at most 60 seconds long.' });
  assert.match(videoRefusal('video_exists', 'x'), /already has a video/);
  assert.match(videoRefusal('file_invalid', 'x'), /MP4, MOV or WebM/);
  assert.equal(videoRefusal('listing_closed', 'This ad is closed.'), 'This ad is closed.');
});
