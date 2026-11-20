// Notices open the app's own screens; unknown and outside links open nothing; products open where the app sells them;
// versions decide whether the app must, may or need not update.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appLink, productRoute } from '../src/lib/links.ts';
import { compareVersions, updateState } from '../src/lib/version.ts';

test('bitocard.com paths become the app’s screens', () => {
  assert.deepEqual(appLink('/account/orders/chk_9'), { pathname: '/order/[id]', params: { id: 'chk_9' } });
  assert.equal(appLink('/account/orders'), '/orders');
  assert.deepEqual(appLink('/account/wallet/deposits/d-1'), { pathname: '/bank-deposit/[id]', params: { id: 'd-1' } });
  assert.equal(appLink('/account/wallet?top_up=1'), '/wallet');
  assert.deepEqual(appLink('/account/sold/s-1'), { pathname: '/sale/[id]', params: { id: 's-1' } });
  assert.deepEqual(appLink('/account/airtime/sales/a-1'), { pathname: '/airtime/sale/[id]', params: { id: 'a-1' } });
  assert.deepEqual(appLink('/account/airtime/purchases/p-1'), { pathname: '/airtime/purchase/[id]', params: { id: 'p-1' } });
  assert.equal(appLink('/account/airtime/sell'), '/airtime/sell');
  assert.equal(appLink('/account/airtime'), '/airtime');
  assert.deepEqual(appLink('/account/support/t-1'), { pathname: '/help/ticket/[id]', params: { id: 't-1' } });
  assert.equal(appLink('/?chat=1'), '/help/chat');
  assert.equal(appLink('/account/disputes'), '/disputes');
  assert.deepEqual(appLink('/account/disputes/d-9'), { pathname: '/disputes/[id]', params: { id: 'd-9' } });
  assert.equal(appLink('/account/sold'), '/sold');
  assert.equal(appLink('/account/wallet/deposits'), '/bank-deposit/all');
  assert.equal(appLink('/account/profile/details'), '/profile');
  assert.equal(appLink('/account/profile/security'), '/security');
  assert.deepEqual(appLink('/p/bills%3ANG%3Aeko-electric%3Aprepaid'), { pathname: '/product/[key]', params: { key: 'bills:NG:eko-electric:prepaid' } });
  assert.deepEqual(appLink('/p/data:NG:mtn:1gb'), { pathname: '/mobile', params: { kind: 'data' } });
  assert.deepEqual(appLink('/catalogs/pay-tv'), { pathname: '/browse', params: { category: 'pay_tv' } });
});

test('categories open their tab or their list', async () => {
  const { categoryRoute } = await import('../src/lib/links.ts');
  assert.deepEqual(categoryRoute('gift_cards'), { pathname: '/gift-cards', params: { mode: 'buy' } });
  assert.deepEqual(categoryRoute('mobile'), { pathname: '/mobile', params: { kind: 'airtime' } });
  assert.deepEqual(categoryRoute('bills'), { pathname: '/browse', params: { category: 'bills' } });
});

test('anything else opens nothing', () => {
  assert.equal(appLink('/account/messages/m-1'), null);
  assert.equal(appLink('//evil.example/account/orders'), null);
  assert.equal(appLink('https://evil.example'), null);
  assert.equal(appLink(null), null);
});

test('products open where the app sells them', () => {
  assert.deepEqual(productRoute({ key: 'gift_cards:US:amazon:usd', category: 'gift_cards' }), { pathname: '/gift-card/[key]', params: { key: 'gift_cards:US:amazon:usd' } });
  assert.deepEqual(productRoute({ key: 'data:NG:mtn:1gb', category: 'data' }), { pathname: '/mobile', params: { kind: 'data' } });
  assert.deepEqual(productRoute({ key: 'pay_tv:NG:dstv:padi', category: 'pay_tv' }), { pathname: '/product/[key]', params: { key: 'pay_tv:NG:dstv:padi' } });
  assert.deepEqual(productRoute({ key: 'software:WW:microsoft:office-12m', category: 'software' }), { pathname: '/product/[key]', params: { key: 'software:WW:microsoft:office-12m' } });
});

test('versions', () => {
  assert.ok(compareVersions('0.4.0', '0.10.0') < 0);
  assert.equal(updateState('1.0.0', '1.1.0', '1.2.0'), 'required');
  assert.equal(updateState('1.1.0', '1.1.0', '1.2.0'), 'available');
  assert.equal(updateState('1.2.0', '1.1.0', '1.2.0'), 'none');
  assert.equal(updateState('dev', '9.0.0'), 'none');
});

test('links the phone hands the app open their screens, else Home', async () => {
  const { incomingRoute } = await import('../src/lib/links.ts');
  assert.equal(incomingRoute('https://bitocard.com/account/orders/chk_9'), '/order/chk_9');
  assert.equal(incomingRoute('https://bitocard.com/p/gift_cards%3AUS%3Aamazon%3Ausd'), '/gift-card/gift_cards%3AUS%3Aamazon%3Ausd');
  assert.deepEqual(appLink('/p/gift_cards:US:amazon:usd'), { pathname: '/gift-card/[key]', params: { key: 'gift_cards:US:amazon:usd' } });
  assert.equal(incomingRoute('bitocard://account/wallet'), '/wallet');
  assert.equal(incomingRoute('/account/support'), '/help');
  assert.equal(incomingRoute('https://bitocard.com/p/pay_tv:NG:dstv:padi'), '/product/pay_tv%3ANG%3Adstv%3Apadi');
  assert.equal(incomingRoute('https://bitocard.com/account/disputes/d-1'), '/disputes/d-1');
  assert.equal(incomingRoute('https://bitocard.com/catalogs'), '/');
  assert.equal(incomingRoute('not a url ::'), '/');
});
