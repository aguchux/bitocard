import { describe, expect, test } from 'vitest';
import { safeNext } from '../src/shell/return-to';

describe('where sign-in returns to', () => {
  test('paths in the app, and pages of the API docs', () => {
    expect(safeNext('/wallet?tab=top-ups')).toBe('/wallet?tab=top-ups');
    expect(safeNext('https://docs.bitocard.com/reference/orders#post-v1-orders')).toBe('https://docs.bitocard.com/reference/orders#post-v1-orders');
    expect(safeNext('http://localhost:3002/guides/try-it')).toBe('http://localhost:3002/guides/try-it');
  });

  test('BitoCard Verify, where registered resellers review their customers', () => {
    expect(safeNext('https://verify.bitocard.com/review/kyc_1')).toBe('https://verify.bitocard.com/review/kyc_1');
    expect(safeNext('http://localhost:3006/review')).toBe('http://localhost:3006/review');
    for (const value of ['http://verify.bitocard.com/review', 'https://verify.bitocard.com.evil.example/', 'https://evil.verify.bitocard.com/']) expect(safeNext(value)).toBe('/');
  });

  test('anything else goes home, so a crafted link cannot send a reseller away', () => {
    for (const value of [null, '', '//evil.example/x', '/\\evil.example', 'https://evil.example/', 'https://docs.bitocard.com.evil.example/', 'http://docs.bitocard.com/', 'javascript:alert(1)']) {
      expect(safeNext(value)).toBe('/');
    }
  });
});
