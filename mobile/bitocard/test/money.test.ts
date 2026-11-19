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

test('typed amounts become minor units; anything else is not an amount', async () => {
  const { toMinor, keepKey } = await import('../src/lib/money.ts');
  assert.equal(toMinor('5,000', 'NGN'), 500000);
  assert.equal(toMinor(' 12.5 ', 'USD'), 1250);
  assert.equal(toMinor('12.505', 'USD'), null);
  assert.equal(toMinor('1500', 'XOF'), 1500);
  assert.equal(toMinor('15.5', 'XOF'), null);
  assert.equal(toMinor('abc', 'NGN'), null);
  assert.equal(toMinor('0', 'NGN'), null);
  assert.equal(keepKey({ status: 0 }), true, 'no answer: the next tap reuses the key');
  assert.equal(keepKey({ status: 502 }), true);
  assert.equal(keepKey({ status: 402 }), false, 'refused: a new key next time');
});
