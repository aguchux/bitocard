// The hero reel's rules: which columns show, collages, the columns repeated to loop, and where it moves next.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collageOf, columnWidth, filledSlides, reelAdvance, reelSettle, safeHref, shownSlides } from '../src/lib/hero.ts';

const tile = (overrides: Record<string, unknown> = {}) => ({ id: 't', image_url: 'https://cdn.udozo.com/a.jpg', photos: [], alt: 'Phones', href: '/ng/c/phones', ad: false, ...overrides });

test('shows columns whose banners fit their split and have an https image or photos', () => {
  const shown = shownSlides([
    { object: 'hero_slide', id: 'a', layout: 'full', tiles: [tile()] },
    { object: 'hero_slide', id: 'b', layout: 'thirds', tiles: [tile(), tile()] },
    { object: 'hero_slide', id: 'c', layout: 'full', tiles: [tile({ image_url: 'http://insecure/a.jpg' })] },
    { object: 'hero_slide', id: 'd', layout: 'two_thirds_third', tiles: [tile({ image_url: null, photos: ['http://x/1.jpg', 'https://x/2.jpg'] }), tile({ href: 'javascript:alert(1)', ad: true })] },
    { object: 'hero_slide', id: 'e', layout: 'full', tiles: [tile({ image_url: null, photos: [] })] },
  ] as never);
  assert.deepEqual(
    shown.map(slide => slide.id),
    ['a', 'd'],
  );
  assert.deepEqual(
    shown[1]!.tiles.map(item => item.rows),
    [2, 1],
  );
  assert.deepEqual(shown[1]!.tiles[0]!.photos, ['https://x/2.jpg']);
  assert.equal(shown[1]!.tiles[1]!.href, null);
  assert.equal(shown[1]!.tiles[1]!.ad, true);
  assert.deepEqual(shownSlides(undefined), []);
});

test('links are a page of udozo.com or an https address', () => {
  assert.equal(safeHref('/ng/l/12-phone'), '/ng/l/12-phone');
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeHref('//evil.com'), null);
  assert.equal(safeHref('http://example.com'), null);
  assert.equal(safeHref(null), null);
});

test('collages take as many photos as fit evenly', () => {
  const photos = (n: number) => Array.from({ length: n }, (_, at) => `https://x/${at}.jpg`);
  assert.deepEqual([collageOf(photos(5), 1).photos.length, collageOf(photos(5), 1).columns], [3, 3]);
  assert.deepEqual(collageOf(photos(3), 2), { photos: photos(2), columns: 2, rows: 1 });
  assert.deepEqual([collageOf(photos(6), 3).columns, collageOf(photos(6), 3).rows], [2, 3]);
  assert.deepEqual([collageOf(photos(3), 3).photos.length, collageOf(photos(3), 3).columns, collageOf(photos(3), 3).rows], [2, 1, 2]);
  assert.equal(collageOf([], 2).photos.length, 0);
});

test('columns are repeated in whole copies, at least three, the first copy marked', () => {
  assert.deepEqual(filledSlides([]), []);
  assert.deepEqual(
    filledSlides(['a']).map(item => item.repeat),
    [0, 1, 2, 3, 4, 5],
  );
  const four = filledSlides(['a', 'b', 'c', 'd']);
  assert.equal(four.length, 12);
  assert.deepEqual(
    four.slice(0, 5).map(item => [item.slide, item.repeat]),
    [
      ['a', 0],
      ['b', 0],
      ['c', 0],
      ['d', 0],
      ['a', 1],
    ],
  );
});

test('the reel steps one column, jumping back a copy once past the first', () => {
  assert.deepEqual(reelAdvance(0, 3), { jump: null, to: 1 });
  assert.deepEqual(reelAdvance(2, 3), { jump: null, to: 3 });
  assert.deepEqual(reelAdvance(3, 3), { jump: 0, to: 1 });
  assert.deepEqual(reelAdvance(5, 3), { jump: 2, to: 3 });
  assert.deepEqual(reelAdvance(1, 0), { jump: null, to: 0 });
  assert.equal(reelSettle(4, 3), 1);
  assert.equal(reelSettle(2, 3), 2);
  assert.equal(columnWidth(390), 304);
  assert.equal(columnWidth(1024), 440);
});
