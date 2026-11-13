// The search address the app asks for: only what is set, conditions repeated, pages of 24.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { photoUrl } from '../src/lib/photo.ts';
import { searchQuery } from '../src/lib/search-query.ts';

test('only what is set, conditions repeated', () => {
  assert.equal(searchQuery({ country: 'NG' }, 0), 'country=NG&offset=0&limit=24');
  assert.equal(
    searchQuery({ country: 'NG', q: 'iphone 13', category: 'mobile-phones', condition: ['new', 'used'], sort: 'price_asc' }, 24),
    'country=NG&offset=24&limit=24&q=iphone+13&category=mobile-phones&sort=price_asc&condition=new&condition=used',
  );
});

test('a place searches its area, local first, in its state', () => {
  assert.equal(searchQuery({ country: 'NG', category: 'mobile-phones', area: 'ikeja', state: 'lagos' }, 0), 'country=NG&offset=0&limit=24&category=mobile-phones&area=ikeja&state=lagos');
});

test('photos at the width needed, only on Udozo’s photo route', () => {
  assert.equal(photoUrl('https://udozo.com/img/abc.jpg?m=3', 960), 'https://udozo.com/img/abc.jpg?m=3&w=960');
  assert.equal(photoUrl('https://udozo.com/img/abc.jpg?m=3&w=1600', 480), 'https://udozo.com/img/abc.jpg?m=3&w=480');
  assert.equal(photoUrl('https://media.test/x.png', 480), 'https://media.test/x.png');
  assert.equal(photoUrl(null), null);
});
