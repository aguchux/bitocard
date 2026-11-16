import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MoneyInput } from '@bitocard/ui/money-input';

afterEach(cleanup);

describe('MoneyInput', () => {
  test("shows the currency's sign and takes only an amount, grouped as it is typed", () => {
    const changed = vi.fn();
    render(<MoneyInput aria-label="Amount" currency="NGN" name="amount" onValueChange={changed} />);
    expect(screen.getByText('₦')).toBeTruthy();
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zss' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '1234567.891' } });
    expect(input.value).toBe('1,234,567.89');
    expect(changed).toHaveBeenLastCalledWith('1,234,567.89', 123456789);
    expect(input.getAttribute('name')).toBe('amount');
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });

  test('whole-unit currencies take no decimals; a default is cleaned', () => {
    render(<MoneyInput aria-label="Amount" currency="XOF" defaultValue="5000.75" />);
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('5,000');
    expect(screen.getByText('CFA')).toBeTruthy();
  });
});
