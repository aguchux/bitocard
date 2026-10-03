import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { categoryName, DataTable, formatBps, formatMoney, formatRelative, LineChart, percentChange, StatusBadge, Trend } from '../src';
import { AdminGate, AdminProviders, AdminShell, can, useAdmin } from '../src/shell';

afterEach(cleanup);

describe('formatting', () => {
  test('money is shown from minor units with the currency code', () => {
    expect(formatMoney(1_234_567, 'NGN')).toBe('NGN 12,345.67');
    expect(formatMoney(500, 'JPY')).toBe('JPY 500');
    expect(formatMoney(250_000_000, 'NGN', { compact: true })).toBe('NGN 2.5M');
    expect(formatMoney(-125_000, 'USD', { compact: true })).toBe('USD -1.3K');
    expect(formatMoney(99_900, 'GHS', { compact: true })).toBe('GHS 999');
    expect(formatMoney(4_200_000_000_000, 'NGN', { compact: true })).toBe('NGN 42B');
  });
  test('changes, rates, names and times', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBeNull();
    expect(formatBps(750)).toBe('7.5%');
    expect(categoryName('pay_tv')).toBe('Pay-TV');
    expect(formatRelative(new Date(Date.now() - 2 * 3600_000).toISOString())).toBe('2 hours ago');
    expect(formatRelative(null)).toBe('never');
  });
});

describe('status and trends', () => {
  test('the same status always has the same colour', () => {
    render(
      <>
        <StatusBadge status="completed" />
        <StatusBadge status="in_review" />
        <StatusBadge status="failed" />
      </>,
    );
    expect(screen.getByText('Completed').className).toMatch(/emerald/);
    expect(screen.getByText('In review').className).toMatch(/amber/);
    expect(screen.getByText('Failed').className).toMatch(/red/);
  });
  test('trends show direction', () => {
    render(<Trend change={-4.25} />);
    expect(screen.getByText('-4.3%').className).toMatch(/red/);
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'name', header: 'Name', cell: (row: { id: string; name: string }) => row.name },
    { key: 'id', header: 'ID', cell: (row: { id: string; name: string }) => row.id, hideOnMobile: true },
  ];

  test('rows render as a table and as stacked cards; rows can be opened by keyboard', () => {
    const open = vi.fn();
    render(<DataTable columns={columns} rows={[{ id: 'a1', name: 'Ada' }]} rowKey={row => row.id} onRowClick={open} caption="People" />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Ada')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'People' })).queryByText('a1')).toBeNull();
    fireEvent.keyDown(within(table).getByText('Ada').closest('tr')!, { key: 'Enter' });
    expect(open).toHaveBeenCalledWith({ id: 'a1', name: 'Ada' });
  });

  test('loading, empty and error states', () => {
    const retry = vi.fn();
    const { rerender } = render(<DataTable columns={columns} rows={undefined} loading rowKey={row => row.id} />);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    rerender(<DataTable columns={columns} rows={[]} rowKey={row => row.id} empty="No orders" />);
    expect(screen.getByText('No orders')).toBeTruthy();
    rerender(<DataTable columns={columns} rows={[]} rowKey={row => row.id} error="Could not load" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('LineChart', () => {
  test('draws each series and describes points for keyboard and screen reader users', () => {
    render(
      <LineChart
        label="Sales"
        labels={['1 Oct', '2 Oct', '3 Oct']}
        series={[
          { name: 'Gross sales', color: '#ff2382', values: [100, 300, 200], format: value => `£${value}` },
          { name: 'Orders', color: '#2563eb', values: [1, 3, 2], format: String, axis: 'right' },
        ]}
      />,
    );
    expect(document.querySelectorAll('polyline')).toHaveLength(2);
    const point = screen.getByLabelText('2 Oct: Gross sales £300, Orders 3');
    fireEvent.focus(point);
    expect(screen.getByRole('status').textContent).toContain('£300');
  });
});

describe('session', () => {
  let assign: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.test';
    assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, pathname: '/orders/42', search: '?tab=attempts', assign });
  });
  afterEach(() => vi.unstubAllGlobals());

  const Name = () => <p>Signed in as {useAdmin().name}</p>;

  test('without a session the browser goes to sign-in, remembering the page', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { type: 'authentication_error', code: 'unauthenticated', message: 'Sign in.' } }, { status: 401 }));
    render(
      <AdminProviders>
        <AdminGate>
          <Name />
        </AdminGate>
      </AdminProviders>,
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/signin?next=%2Forders%2F42%3Ftab%3Dattempts'));
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  test('a signed-in admin sees the shell with the current section marked', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ object: 'admin_session', admin: { object: 'admin', id: 'a1', name: 'Alex Admin', email: 'alex@bitocard.com', roles: ['operations'] } }));
    render(
      <AdminProviders>
        <AdminGate>
          <AdminShell section="orders" current="/orders" crumbs={[{ label: 'Orders', href: '/orders' }, { label: 'Order 42' }]}>
            <Name />
          </AdminShell>
        </AdminGate>
      </AdminProviders>,
    );
    expect(await screen.findByText('Signed in as Alex Admin')).toBeTruthy();
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getByText('Orders').closest('a')!.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Order 42');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
  });

  test('roles: super admins can do everything', () => {
    expect(can({ object: 'admin', id: '1', name: 'A', email: 'a@bitocard.com', roles: ['super_admin'] }, 'finance')).toBe(true);
    expect(can({ object: 'admin', id: '1', name: 'A', email: 'a@bitocard.com', roles: ['support'] }, 'finance', 'operations')).toBe(false);
    expect(can(null, 'support')).toBe(false);
  });
});
