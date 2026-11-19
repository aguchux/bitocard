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
  assert.equal(productRoute({ key: 'pay_tv:NG:dstv:padi', category: 'pay_tv' }), null);
});

test('versions', () => {
  assert.ok(compareVersions('0.4.0', '0.10.0') < 0);
  assert.equal(updateState('1.0.0', '1.1.0', '1.2.0'), 'required');
  assert.equal(updateState('1.1.0', '1.1.0', '1.2.0'), 'available');
  assert.equal(updateState('1.2.0', '1.1.0', '1.2.0'), 'none');
  assert.equal(updateState('dev', '9.0.0'), 'none');
});
