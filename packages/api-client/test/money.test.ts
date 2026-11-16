import { describe, expect, test } from 'vitest';
import { currencySymbol, formatCurrency, formatMoneyInput, moneyInputValue, parseMoney } from '../src/money';
import { formatFace } from '../src/storefront';

describe('money as people read it', () => {
  test("each market's currency has its own sign", () => {
    expect(currencySymbol('NGN')).toBe('₦');
    expect(currencySymbol('ghs')).toBe('GH₵');
    expect(currencySymbol('KES')).toBe('KSh');
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('XOF')).toBe('CFA');
  });

  test('amounts carry the sign, commas and the decimal places', () => {
    expect(formatCurrency(1041934, 'NGN')).toBe('₦10,419.34');
    expect(formatCurrency(500000, 'NGN', { trim: true })).toBe('₦5,000');
    expect(formatCurrency(500000, 'NGN')).toBe('₦5,000.00');
    expect(formatCurrency(20000, 'KES')).toBe('KSh 200.00');
    expect(formatCurrency(5000, 'XOF')).toBe('CFA 5,000');
    expect(formatCurrency(-43380, 'NGN')).toBe('-₦433.80');
    expect(formatFace(1000, 'USD')).toBe('$10');
    expect(formatFace(550, 'GHS')).toBe('GH₵5.50');
  });

  test('a money field keeps only an amount, with commas as it is typed', () => {
    expect(formatMoneyInput('zss', 2)).toBe('');
    expect(formatMoneyInput('1234567', 2)).toBe('1,234,567');
    expect(formatMoneyInput('1234.567', 2)).toBe('1,234.56');
    expect(formatMoneyInput('12.', 2)).toBe('12.');
    expect(formatMoneyInput('1.2.3', 2)).toBe('1.23');
    expect(formatMoneyInput('007', 2)).toBe('7');
    expect(formatMoneyInput('.5', 2)).toBe('0.5');
    expect(formatMoneyInput('5000.5', 0)).toBe('5,000');
    expect(formatMoneyInput('₦ 1,000abc', 2)).toBe('1,000');
  });

  test('typed amounts read back as minor units, or null', () => {
    expect(parseMoney('1,234.5', 'NGN')).toBe(123450);
    expect(parseMoney('10', 'USD')).toBe(1000);
    expect(parseMoney('5,000', 'XOF')).toBe(5000);
    expect(parseMoney('1.234', 'NGN')).toBeNull();
    expect(parseMoney('abc', 'NGN')).toBeNull();
    expect(parseMoney('', 'NGN')).toBeNull();
    expect(moneyInputValue(500000, 'NGN')).toBe('5,000');
    expect(moneyInputValue(500050, 'NGN')).toBe('5,000.50');
  });
});
