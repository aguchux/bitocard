// The listing page's rules: the stock line, which ways to get in touch it offers (as udozo.com's ListingActions), a
// request's state on its button, the place's search and the rails' searches.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contactOptions, placeSearch, railSearches, requestState, stockLine } from '../src/lib/listing-page.ts';

test('the stock line', () => {
  assert.deepEqual(stockLine({ status: 'active', available: 3 }), { text: '3 in stock', out: false });
  assert.deepEqual(stockLine({ status: 'active', available: 1 }), { text: 'Last one in stock', out: false });
  assert.deepEqual(stockLine({ status: 'active', in_stock: false, available: 0 }), { text: 'Out of stock', out: true });
  assert.equal(stockLine({ status: 'active' }), null);
  assert.equal(stockLine({ status: 'sold', available: 2 }), null);
});

test('a request is waiting, declined until the buyer may ask again, or none', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(requestState(null, now), 'none');
  assert.equal(requestState({ status: 'pending' }, now), 'pending');
  assert.equal(requestState({ status: 'declined', ask_again_at: '2026-11-20T00:00:00Z' }, now), 'declined');
  assert.equal(requestState({ status: 'declined', ask_again_at: '2026-11-01T00:00:00Z' }, now), 'none');
});

const listing = { status: 'active' as const, contact: { chat: true, phone: true } };
const viewer = (more: object) => ({ object: 'classified_listing_viewer' as const, listing_id: 'l', own: false, favourite: false, conversation_id: null, order: null, can_contact: true, ...more });

test('signed out, a listing taking calls offers every way; signed in, what the viewer allows', () => {
  assert.deepEqual(contactOptions(listing, null, false), { allowed: true, chat: true, call: true, callback: true, contact: true, shared: null });
  // Signed in, while the viewer loads: chat only, so the row never sits empty or offers what may be refused.
  assert.deepEqual(contactOptions(listing, null, true), { allowed: true, chat: true, call: false, callback: false, contact: false, shared: null });
  const some = contactOptions(listing, viewer({ calls: true, callback: { available: true, request: null }, contact: { available: false, shared: null, request: null } }), true);
  assert.deepEqual([some.call, some.callback, some.contact], [true, true, false]);
  const shared = contactOptions(listing, viewer({ contact: { available: true, shared: { phone: '+2348030000000', email: 'a@b.c' }, request: null } }), true);
  assert.equal(shared.contact, false);
  assert.equal(shared.shared?.email, 'a@b.c');
  assert.equal(contactOptions(listing, viewer({ can_contact: false }), true).allowed, false);
  assert.deepEqual(contactOptions({ status: 'sold', contact: { chat: true, phone: true } }, null, false), { allowed: true, chat: false, call: false, callback: false, contact: false, shared: null });
});

test('the place searches its area in its state; the rails search the seller and the category near it', () => {
  const data = { area: { slug: 'ikeja', name: 'Ikeja', state: { slug: 'lagos', name: 'Lagos' } }, category: { slug: 'mobile-phones', name: 'Mobile phones', parent: null, safety_checklist: [] }, seller: { name: 'Chidi O.', handle: 'abc', username: 'chidi', member_since: '', badges: [], active_listings: 4, response_rate: null } };
  assert.deepEqual(placeSearch(data, 'NG'), { country: 'NG', area: 'ikeja', state: 'lagos', place: 'Ikeja, Lagos' });
  assert.deepEqual(railSearches(data, 'NG'), { seller: { country: 'NG', seller: 'chidi' }, similar: { country: 'NG', category: 'mobile-phones', area: 'ikeja', state: 'lagos' } });
  assert.equal(railSearches({ ...data, seller: { ...data.seller, handle: undefined, username: null } }, 'NG').seller, null);
});
