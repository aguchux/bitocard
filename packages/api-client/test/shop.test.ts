import { describe, expect, test } from 'vitest';
import { categoryPath, descriptionBlocks, featureValueText, listingPath, listingRef, nameInitials, placePath, postedAgo, shopMoney, shopPriceText } from '../src/classifieds';

describe('BitoCard Shop addresses', () => {
  test('listings by number and slug, categories and places, always lower-case countries', () => {
    expect(listingPath('NG', 100001, 'iphone-13-pro')).toBe('/ng/l/100001-iphone-13-pro');
    expect(listingRef('100001-iphone-13-pro')).toBe(100001);
    expect(listingRef('100001')).toBe(100001);
    for (const bad of ['iphone', '-100001', '100001_x', '100001-Big', '1234567890123456', '']) expect(listingRef(bad), bad).toBeNull();
    expect(categoryPath('NG', 'mobile-phones')).toBe('/ng/c/mobile-phones');
    expect(placePath('NG', { state: 'lagos' })).toBe('/ng/lagos');
    expect(placePath('ng', { state: 'lagos', area: 'ikeja', category: 'mobile-phones' })).toBe('/ng/lagos/ikeja/mobile-phones');
    expect(placePath('ng', { state: 'lagos', area: null, category: 'mobile-phones' })).toBe('/ng/lagos/mobile-phones');
  });
});

describe('prices and words', () => {
  test('money in minor units, kobo only when there are any; prices on request say so', () => {
    expect(shopMoney(52000000, 'NGN')).toBe('₦520,000');
    expect(shopMoney(52000050, 'NGN')).toBe('₦520,000.50');
    expect(shopMoney(1500, 'GHS')).toMatch(/15$/);
    expect(shopPriceText({ kind: 'negotiable', amount: 52000000, currency: 'NGN' })).toBe('₦520,000');
    expect(shopPriceText({ kind: 'on_request', amount: null, currency: 'NGN' })).toBe('Price on request');
  });

  test('feature values with units, yes or no; how long ago; initials', () => {
    expect(featureValueText({ unit: 'GB', value: 256 })).toBe('256 GB');
    expect(featureValueText({ unit: null, value: 12000 })).toBe('12,000');
    expect(featureValueText({ unit: null, value: true })).toBe('Yes');
    expect(featureValueText({ unit: null, value: 'Sierra Blue' })).toBe('Sierra Blue');
    expect(featureValueText({ unit: null, value: null })).toBe('');
    const now = Date.parse('2026-10-25T12:00:00Z');
    expect(postedAgo('2026-10-25T11:59:40Z', now)).toBe('Just now');
    expect(postedAgo('2026-10-25T11:15:00Z', now)).toBe('45 min ago');
    expect(postedAgo('2026-10-25T10:00:00Z', now)).toBe('2 h ago');
    expect(postedAgo('2026-10-24T09:00:00Z', now)).toBe('Yesterday');
    expect(postedAgo('2026-10-21T12:00:00Z', now)).toBe('4 days ago');
    expect(postedAgo('2026-09-01T12:00:00Z', now)).toBe('1 Sept');
    expect(postedAgo(null, now)).toBe('');
    expect(nameInitials('Chinedu O.')).toBe('CO');
    expect(nameInitials('Ada')).toBe('A');
  });
});

describe('descriptions', () => {
  test('paragraphs, bold and italic, bullet and numbered lists, and nothing that could become markup', () => {
    const blocks = descriptionBlocks('Clean phone, **never repaired**.\nFace ID *works*.\n\n- Battery 88%\n- Box and cable\n1. First\n2) Second\n\n<script>alert(1)</script>');
    expect(blocks).toEqual([
      { kind: 'p', spans: [{ text: 'Clean phone, ' }, { text: 'never repaired', bold: true }, { text: '. Face ID ' }, { text: 'works', italic: true }, { text: '.' }] },
      { kind: 'ul', items: [[{ text: 'Battery 88%' }], [{ text: 'Box and cable' }]] },
      { kind: 'ol', items: [[{ text: 'First' }], [{ text: 'Second' }]] },
      { kind: 'p', spans: [{ text: '<script>alert(1)</script>' }] },
    ]);
    expect(descriptionBlocks(null)).toEqual([]);
  });
});
