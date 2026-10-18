import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StoreCustomerView } from '../src';

afterEach(cleanup);

const customer = (status: 'active' | 'disabled') => ({
  id: 'cus_1',
  name: 'Ada Obi',
  email: 'ada@example.com',
  email_confirmed: true,
  status,
  identity_check: true,
  identity_checked: false,
  purchases: 0,
  created_at: '2026-10-01T09:00:00.000Z',
  last_sign_in_at: null,
  locked_until: null,
  signed_in_sessions: 2,
  disputes: 0,
  identity_case: null,
  wallet: [],
  purchases_list: [],
});

const view = (status: 'active' | 'disabled', onUpdate = vi.fn()) =>
  render(<StoreCustomerView customer={customer(status) as never} canChange canUnlock busy={false} error={null} onUpdate={onUpdate} onUnlock={vi.fn()} onSignOut={vi.fn()} orderLink={() => null} />);

describe('suspending a store customer', () => {
  test('Suspend asks first, then suspends (the API calls it disabled)', async () => {
    const onUpdate = vi.fn();
    view('active', onUpdate);
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(onUpdate).not.toHaveBeenCalled();
    const dialog = document.querySelector('dialog') as HTMLElement;
    expect(await within(dialog).findByText(/signed out everywhere/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend', hidden: true }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ status: 'disabled' }));
  });

  test('a suspended customer is shown as suspended and Unsuspend restores them at once', () => {
    const onUpdate = vi.fn();
    view('disabled', onUpdate);
    expect(screen.getByText('Suspended: cannot sign in or buy.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unsuspend' }));
    expect(onUpdate).toHaveBeenCalledWith({ status: 'active' });
  });
});
