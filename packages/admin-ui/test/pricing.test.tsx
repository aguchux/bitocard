import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { amountToMinor, bpsToPercent, percentToBps, PriceBreakdown, PricingSchemes } from '../src';

afterEach(cleanup);

describe('pricing inputs', () => {
  test('percentages become basis points, and back', () => {
    expect(percentToBps('1.5')).toBe(150);
    expect(percentToBps(' 12 ')).toBe(1200);
    expect(percentToBps('0.25')).toBe(25);
    expect(percentToBps('1.555')).toBeNull();
    expect(percentToBps('-1')).toBeNull();
    expect(percentToBps('')).toBeNull();
    expect(bpsToPercent(150)).toBe('1.5');
    expect(bpsToPercent(null)).toBe('');
  });

  test('amounts become minor units', () => {
    expect(amountToMinor('12.5')).toBe(1250);
    expect(amountToMinor('12.05')).toBe(1205);
    expect(amountToMinor('7')).toBe(700);
    expect(amountToMinor('1.234')).toBeNull();
    expect(amountToMinor('abc')).toBeNull();
  });
});

describe('PriceBreakdown and PricingSchemes', () => {
  test('lists one sale line by line', () => {
    render(
      <PriceBreakdown
        caption="One sale"
        rows={[
          { label: 'BitoCard charges you', value: '₦980.00' },
          { label: 'You make per sale', value: '₦20.00', tone: 'profit', hint: 'Before tax' },
        ]}
      />,
    );
    const list = screen.getByLabelText('One sale');
    expect(list.querySelectorAll('dt')).toHaveLength(2);
    expect(list.textContent).toContain('You make per sale');
    expect(list.textContent).toContain('Before tax');
    expect(list.textContent).toContain('₦20.00');
  });

  test('explains both schemes to each audience', () => {
    const { rerender } = render(<PricingSchemes audience="admin" />);
    expect(screen.getByText('Discount products')).toBeTruthy();
    expect(document.body.textContent).toContain('BitoCard keeps the rest');
    rerender(<PricingSchemes audience="reseller" />);
    expect(document.body.textContent).toContain('that discount is your profit');
    expect(screen.getByText('Markup products')).toBeTruthy();
  });
});
