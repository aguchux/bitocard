// udozo.com addresses open the app's own screens; everything else stays on udozo.com in the browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appLink, foreignScheme, listingUrl } from '../src/lib/links.ts';

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
  assert.deepEqual(appLink('/account/purchases/abc'), { web: 'https://udozo.com/account/purchases/abc' });
  assert.deepEqual(appLink('https://example.com/ng/l/1'), { web: 'https://example.com/ng/l/1' });
  assert.deepEqual(appLink('javascript:alert(1)'), { web: 'javascript:alert(1)' });
  assert.deepEqual(appLink('/ng/l/not-a-number'), { web: 'https://udozo.com/ng/l/not-a-number' });
});

test('the app’s own scheme reads like udozo.com', () => {
  assert.deepEqual(appLink('udozo://ng/l/77-chair'), { route: '/listing/77?country=NG' });
  assert.equal(listingUrl('NG', 77, 'chair'), 'https://udozo.com/ng/l/77-chair');
});

test('selling places, the app’s own routes, and other apps’ links', () => {
  assert.deepEqual(appLink('/sell'), { route: '/post/new' });
  assert.deepEqual(appLink('/account/listings?status=draft'), { route: '/my-listings?status=draft' });
  assert.deepEqual(appLink('/account/listings/0d3f8a5e-1111-4222-8333-944455556666'), { route: '/post/0d3f8a5e-1111-4222-8333-944455556666' });
  assert.deepEqual(appLink('/account/requests'), { route: '/requests' });
  assert.deepEqual(appLink('/account/profile/username'), { route: '/username' });
  assert.deepEqual(appLink('/account/profile/whatsapp'), { route: '/whatsapp' });
  assert.deepEqual(appLink('udozo://listing/77?country=NG'), { route: '/listing/77?country=NG' });
  assert.deepEqual(appLink('udozo://my-listings'), { route: '/my-listings' });
  assert.equal(foreignScheme('fb1234567890://authorize?code=abc'), true);
  assert.equal(foreignScheme('udozo://ng/l/77'), false);
  assert.equal(foreignScheme('https://udozo.com/ng'), false);
  assert.equal(foreignScheme('/ng/l/77'), false);
});

test('money places open in the app: the wallet, payouts, the identity check, orders and a shop till’s payment', () => {
  const order = '0b8e3c1e-1d2a-4c5b-9f00-123456789abc';
  assert.deepEqual(appLink('/account/wallet?wallet=USD'), { route: '/wallet?wallet=USD' });
  assert.deepEqual(appLink('/account/payouts'), { route: '/payouts' });
  assert.deepEqual(appLink('/account/udozopay'), { route: '/payouts' });
  assert.deepEqual(appLink('/account/verification'), { route: '/identity' });
  assert.deepEqual(appLink('/account/orders'), { route: '/orders' });
  assert.deepEqual(appLink(`/account/orders/${order}`), { route: `/order/${order}` });
  assert.deepEqual(appLink(`https://udozo.com/pay/pw_${'b'.repeat(32)}`), { route: `/pay/pw_${'b'.repeat(32)}` });
  assert.deepEqual(appLink('/ng/l/77-chair/buy'), { route: '/listing/77?country=NG' });
});

test('buy orders open in the app', () => {
  const id = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
  assert.deepEqual(appLink('/account/buy-orders'), { route: '/buy-orders' });
  assert.deepEqual(appLink(`https://udozo.com/account/buy-orders/${id}`), { route: `/buy-order/${id}` });
  assert.deepEqual(appLink(`udozo://buy-order/${id}`), { route: `/buy-order/${id}` });
});

test('My Resellers opens in the app', () => {
  const id = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
  assert.deepEqual(appLink('/account/resellers'), { route: '/resellers' });
  assert.deepEqual(appLink(`/account/resellers/${id}`), { route: `/reseller/${id}` });
});

test('wanted requests open the app’s own screens', () => {
  assert.deepEqual(appLink('/ng/wanted/new'), { route: '/wanted/new' });
  assert.deepEqual(appLink('/account/wanted'), { route: '/wanted' });
  assert.deepEqual(appLink('/account/wanted/0b6c7c9e-1d2a-4f3b-9a8e-123456789abc'), { route: '/wanted/0b6c7c9e-1d2a-4f3b-9a8e-123456789abc' });
  assert.deepEqual(appLink('/account/wanted/not-an-id'), { route: '/wanted' });
  assert.deepEqual(appLink('udozo://wanted/new'), { route: '/wanted/new' });
});
