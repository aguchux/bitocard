// Gift cards: the values offered and their price at the day's rate (never less than checkout asks), and what a sell
// offer takes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { payoutAt, priceAt, saleAmount, saleStatusOf, sellForms, valuesOf } from '../src/lib/gift-cards.ts';

test('fixed values first, else the rate’s values, else round amounts in the range', () => {
  assert.deepEqual(valuesOf({ denominations: [5000, 1000, 2500], range: null, face_currency: 'USD' }), [1000, 2500, 5000]);
  const rate = { object: 'store_rate' as const, currency: 'NGN', face_currency: 'USD', rate: 129000, values: [{ face_value: 2500, price: 3225000 }] };
  assert.deepEqual(valuesOf({ denominations: null, range: { min: 500, max: 50000 }, face_currency: 'USD' }, rate), [2500]);
  assert.deepEqual(valuesOf({ denominations: null, range: { min: 1500, max: 30000 }, face_currency: 'USD' }), [2500, 5000, 10000, 20000]);
});

test('the price is the API’s for a listed value, else the rate times the value rounded up', () => {
  const rate = { object: 'store_rate' as const, currency: 'NGN', face_currency: 'USD', rate: 129033, values: [{ face_value: 5000, price: 6451650 }] };
  assert.equal(priceAt(rate, 5000, 'USD'), 6451650);
  assert.equal(priceAt(rate, 1050, 'USD'), Math.ceil(10.5 * 129033));
  assert.equal(priceAt({ object: 'store_rate', rate: null }, 5000, 'USD'), null);
});

test('selling: the payout, the forms and the value’s limits', () => {
  assert.equal(payoutAt({ rate: 124800 }, 100), 12480000);
  assert.deepEqual(sellForms({ form: 'both' }), ['physical', 'ecode']);
  assert.deepEqual(sellForms({ form: 'ecode' }), ['ecode']);
  assert.deepEqual(saleAmount('100', { minimum: 10, maximum: 500, currency: 'NGN' }), { amount: 100 });
  assert.ok('problem' in saleAmount('5', { minimum: 10, maximum: 500, currency: 'NGN' }));
  assert.ok('problem' in saleAmount('10.5', { minimum: 10, maximum: 500, currency: 'NGN' }));
  assert.equal(saleStatusOf('completed').label, 'Accepted and paid');
});
