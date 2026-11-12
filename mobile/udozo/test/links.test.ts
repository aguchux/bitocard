// udozo.com addresses open the app's own screens; everything else stays on udozo.com in the browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appLink, listingUrl } from '../src/lib/links.ts';

test('market pages become the app’s screens', () => {
  assert.deepEqual(appLink('/ng/l/1234-iphone-13-pro'), { route: '/listing/1234?country=NG' });
  assert.deepEqual(appLink('https://udozo.com/gh/seller/ama_k'), { route: '/seller/ama_k' });
  assert.deepEqual(appLink('/ng/brand/samsung'), { route: '/brand/samsung?country=NG' });
  assert.deepEqual(appLink('/ng/c/mobile-phones'), { route: '/category/mobile-phones?country=NG' });
  assert.deepEqual(appLink('/ng/search?q=iphone 13&category=mobile-phones'), { route: '/search?country=NG&q=iphone%2013&category=mobile-phones' });
  assert.deepEqual(appLink('/ke'), { route: '/?country=KE' });
  assert.deepEqual(appLink('https://www.udozo.com/'), { route: '/' });
});

test('account places, invites and sign-in', () => {
  assert.deepEqual(appLink('/account/messages/0d3f8a5e-1111-4222-8333-944455556666'), { route: '/chat/0d3f8a5e-1111-4222-8333-944455556666' });
  assert.deepEqual(appLink('/account/messages'), { route: '/chats' });
  assert.deepEqual(appLink('/account/notifications'), { route: '/notifications' });
  assert.deepEqual(appLink('/account/favourites'), { route: '/saved' });
  assert.deepEqual(appLink('/account'), { route: '/me' });
  assert.deepEqual(appLink('/i/ADA42'), { route: '/signup?ref=ADA42' });
  assert.deepEqual(appLink('/signin/whatsapp'), { route: '/signin' });
});

test('what the app does not have yet, or other sites, open in the browser', () => {
  assert.deepEqual(appLink('/account/orders/abc'), { web: 'https://udozo.com/account/orders/abc' });
  assert.deepEqual(appLink('/ng/wanted/new'), { web: 'https://udozo.com/ng/wanted/new' });
  assert.deepEqual(appLink('https://example.com/ng/l/1'), { web: 'https://example.com/ng/l/1' });
  assert.deepEqual(appLink('javascript:alert(1)'), { web: 'javascript:alert(1)' });
  assert.deepEqual(appLink('/ng/l/not-a-number'), { web: 'https://udozo.com/ng/l/not-a-number' });
});

test('the app’s own scheme reads like udozo.com', () => {
  assert.deepEqual(appLink('udozo://ng/l/77-chair'), { route: '/listing/77?country=NG' });
  assert.equal(listingUrl('NG', 77, 'chair'), 'https://udozo.com/ng/l/77-chair');
});
