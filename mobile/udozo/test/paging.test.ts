// How the app pages the API's lists: the address of each page, when there is another, and each item once.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextPage, pagedItems, pagePath } from '../src/lib/paging.ts';

const items = (...ids: string[]) => ids.map(id => ({ id }));

test('each page asks with its own paging, keeping the list’s own query', () => {
  assert.equal(pagePath('/v1/classifieds/favourites', 'offset', 30, null), '/v1/classifieds/favourites?limit=30&offset=0');
  assert.equal(pagePath('/v1/classifieds/orders?role=buying', 'offset', 30, 60), '/v1/classifieds/orders?role=buying&limit=30&offset=60');
  assert.equal(pagePath('/v1/classifieds/me/buy-orders?role=selling', 'full', 30, 30), '/v1/classifieds/me/buy-orders?role=selling&limit=30&offset=30');
  assert.equal(pagePath('/v1/store/account/notifications', 'cursor', 30, null), '/v1/store/account/notifications?limit=30');
  assert.equal(pagePath('/v1/classifieds/me/listings?status=active', 'cursor', 30, 'abc'), '/v1/classifieds/me/listings?status=active&limit=30&starting_after=abc');
});

test('offset lists page until the total is loaded', () => {
  const first = { data: items('a', 'b'), total: 3 };
  assert.equal(nextPage('offset', 2, first, [first]), 2);
  const second = { data: items('c'), total: 3 };
  assert.equal(nextPage('offset', 2, second, [first, second]), undefined);
});

test('lists without a total page while pages come back full', () => {
  const full = { data: items('a', 'b') };
  assert.equal(nextPage('full', 2, full, [full]), 2);
  const short = { data: items('c') };
  assert.equal(nextPage('full', 2, short, [full, short]), undefined);
});

test('cursor lists page after the last item while there is more', () => {
  assert.equal(nextPage('cursor', 2, { data: items('a', 'b'), has_more: true }, []), 'b');
  assert.equal(nextPage('cursor', 2, { data: items('a', 'b'), has_more: false }, []), undefined);
});

test('an empty page ends the list, whatever it says', () => {
  assert.equal(nextPage('offset', 2, { data: [], total: 10 }, [{ data: [], total: 10 }]), undefined);
  assert.equal(nextPage('cursor', 2, { data: [], has_more: true }, []), undefined);
});

test('each item once, in order, by its own key', () => {
  assert.deepEqual(pagedItems([{ data: items('a', 'b') }, { data: items('b', 'c') }]).map(item => item.id), ['a', 'b', 'c']);
  const saved = [{ data: [{ listing_id: 'x' }, { listing_id: 'y' }] }, { data: [{ listing_id: 'x' }] }];
  assert.deepEqual(pagedItems(saved, item => item.listing_id).map(item => item.listing_id), ['x', 'y']);
  assert.deepEqual(pagedItems(undefined), []);
});
