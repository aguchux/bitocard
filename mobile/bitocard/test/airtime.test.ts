// The airtime exchange: rates in words, a typed amount held to the network's limits (whole naira only), what each
// status says, numbers as people write them, and dialling the network's transfer code.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dialUrl, isDialCode, localNumber, purchaseMoving, purchaseStatusOf, rateText, saleMoving, saleStatusOf, timeLeft, tradeAmount } from '../src/lib/airtime.ts';

test('rates read as percentages', () => {
  assert.equal(rateText(8000), '80%');
  assert.equal(rateText(8250), '82.5%');
  assert.equal(rateText(8833), '88.33%');
});

test('amounts are whole units within the network limits', () => {
  const network = { min_amount: 50000, max_amount: 5000000 };
  assert.deepEqual(tradeAmount('1,000', network, 'NGN'), { amount: 100000 });
  assert.deepEqual(tradeAmount('100.50', network, 'NGN'), { problem: 'Enter a whole amount, with no kobo.' });
  assert.deepEqual(tradeAmount('100', network, 'NGN'), { problem: 'Choose between ₦500 and ₦50,000.' });
  assert.deepEqual(tradeAmount('', network, 'NGN'), { problem: 'Enter a whole amount, with no kobo.' });
});

test('statuses say what happens next, and which still move', () => {
  assert.deepEqual(saleStatusOf('awaiting_transfer'), { label: 'Send the airtime', tone: 'warn' });
  assert.equal(saleStatusOf('credited').tone, 'good');
  assert.equal(saleStatusOf('reversed').tone, 'bad');
  assert.equal(purchaseStatusOf('delivered').label, 'Sent to your number');
  assert.ok(saleMoving('sent') && !saleMoving('received'));
  assert.ok(purchaseMoving('delivering') && !purchaseMoving('refunded'));
});

test('numbers, time left and the dial code', () => {
  assert.equal(localNumber('+2348061234567'), '0806 123 4567');
  assert.equal(localNumber('+233241234567'), '+233241234567');
  const now = Date.parse('2026-11-19T10:00:00Z');
  assert.equal(timeLeft('2026-11-19T10:12:00Z', now), '12 min');
  assert.equal(timeLeft('2026-11-19T11:05:00Z', now), '1 h 5 min');
  assert.equal(timeLeft('2026-11-19T09:59:00Z', now), null);
  assert.equal(dialUrl('*600*08031234567*1000*PIN#'), 'tel:*600*08031234567*1000*PIN%23');
  assert.ok(isDialCode('*600*08031234567*1000*PIN#'));
  assert.ok(!isDialCode('Open the MyMTN app and choose Share airtime.'));
});
