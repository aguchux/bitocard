import { describe, expect, test } from 'vitest';
import { summariseOffers } from '../src/format';

describe('supplier offers on a product', () => {
  test('one entry per supplier, with how many offers and a discount they all share', () => {
    const offers = [
      ...Array.from({ length: 52 }, () => ({ supplier: 'zendit', discount_bps: 0 })),
      { supplier: 'reloadly', discount_bps: 250 },
      { supplier: 'vtpass', discount_bps: 100 },
      { supplier: 'vtpass', discount_bps: 100 },
      { supplier: 'stock', discount_bps: 100 },
      { supplier: 'stock', discount_bps: 200 },
    ];
    expect(summariseOffers(offers)).toEqual(['zendit · 52 offers', 'reloadly (2.5%)', 'vtpass · 2 offers (1%)', 'stock · 2 offers']);
    expect(summariseOffers([])).toEqual([]);
  });
});
