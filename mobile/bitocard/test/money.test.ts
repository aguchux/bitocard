// Money as the API sends it (integer minor units) shown with the currency's own symbol, never as a float.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { digitsOf, formatMoney } from '../src/lib/money.ts';

test('naira, cedis and shillings with their symbols and two decimals', () => {
  assert.equal(formatMoney(4825000, 'NGN'), '₦48,250.00');
  assert.equal(formatMoney(4825000, 'ngn', { cents: false }), '₦48,250');
  assert.equal(formatMoney(4825050, 'NGN', { cents: false }), '₦48,250.50');
  assert.equal(formatMoney(1240, 'USD'), '$12.40');
  assert.equal(formatMoney(150000, 'GHS'), 'GH₵1,500.00');
  assert.equal(formatMoney(-100000, 'NGN'), '−₦1,000.00');
  assert.equal(formatMoney(5, 'KES'), 'KSh 0.05');
});

test('currencies without a minor unit, and ones without a symbol', () => {
  assert.equal(digitsOf('XOF'), 0);
  assert.equal(formatMoney(15000, 'XOF'), '15,000 XOF');
  assert.equal(formatMoney(123456, 'ZMW'), '1,234.56 ZMW');
});
