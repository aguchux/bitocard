// Home's banners: the page's own cards, then Udozo's auctions on the first banner block where the market has them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auctionsCard, bannerCards, bannerIcon } from '../src/lib/home-banners.ts';

const sell = { title: 'Sell what you no longer use', body: 'Post an ad in minutes.', image: null, href: '/sell' };
const pay = { title: 'Pay safely with UdozoPay', body: 'Your money is held until you have the item.', image: null, href: '/legal/udozopay' };

test('auctions join the cards only where the market has them, once', () => {
  assert.deepEqual(bannerCards([sell, pay], null), [sell, pay]);
  assert.deepEqual(bannerCards([sell, pay], 'NG'), [sell, pay, auctionsCard('NG')]);
  assert.equal(auctionsCard('NG').href, '/ng/auctions');
  assert.equal(bannerCards([sell, auctionsCard('GH')], 'GH').length, 2);
});

test('a banner without a picture gets an icon for where it goes', () => {
  assert.equal(bannerIcon('/ng/auctions'), 'auctions');
  assert.equal(bannerIcon('https://udozo.com/sell'), 'sell');
  assert.equal(bannerIcon('/ng/sell'), 'sell');
  assert.equal(bannerIcon('/legal/udozopay'), 'pay');
  assert.equal(bannerIcon('/safe-trade#udozopay'), 'pay');
  assert.equal(bannerIcon('/ng/c/phones'), 'other');
});
