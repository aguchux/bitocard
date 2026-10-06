import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { categoryName, CodeInput, DataTable, formatBps, ImageField, formatMoney, formatRelative, LineChart, percentChange, StatusBadge, Trend } from '../src';
import { useState } from 'react';
import { AdminGate, AdminProviders, AdminShell, can, NotificationBell, NotificationsInbox, PushSettings, useAdmin } from '../src/shell';
import { pushServiceWorker } from '../src/push-worker';

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

  test('a failed refresh keeps the rows shown, with a notice and Retry', () => {
    const retry = vi.fn();
    render(<DataTable columns={columns} rows={[{ id: 'a1', name: 'Ada' }]} rowKey={row => row.id} error="Could not refresh" onRetry={retry} />);
    expect(within(screen.getByRole('table')).getByText('Ada')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Could not refresh');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
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

describe('code input', () => {
  function Harness({ onComplete }: { onComplete: (code: string) => void }) {
    const [value, setValue] = useState('');
    return <CodeInput label="Authentication code" value={value} onChange={setValue} onComplete={onComplete} />;
  }
  const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];

  test('six labelled boxes; typing moves along and completes the code', () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    expect(screen.getByRole('group', { name: 'Authentication code' })).toBeTruthy();
    expect(boxes()).toHaveLength(6);
    expect(boxes()[0].getAttribute('aria-label')).toBe('Digit 1 of 6');
    expect(boxes()[0].getAttribute('autocomplete')).toBe('one-time-code');
    for (const [index, digit] of [...'12345'].entries()) fireEvent.change(boxes()[index], { target: { value: digit } });
    expect(document.activeElement).toBe(boxes()[5]);
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.change(boxes()[5], { target: { value: '6' } });
    expect(boxes().map(box => box.value).join('')).toBe('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  test('pasting or autofilling fills every box; letters are ignored; Backspace goes back', () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    fireEvent.paste(boxes()[0], { clipboardData: { getData: () => '98 76-54' } });
    expect(boxes().map(box => box.value).join('')).toBe('987654');
    expect(onComplete).toHaveBeenCalledWith('987654');

    fireEvent.keyDown(boxes()[5], { key: 'Backspace' });
    expect(boxes()[5].value).toBe('');
    fireEvent.keyDown(boxes()[5], { key: 'Backspace' });
    expect(boxes()[4].value).toBe('');
    expect(document.activeElement).toBe(boxes()[4]);

    fireEvent.change(boxes()[4], { target: { value: 'a' } });
    expect(boxes()[4].value).toBe('');
    // A whole code autofilled into one box spreads across the rest.
    cleanup();
    render(<Harness onComplete={onComplete} />);
    fireEvent.change(boxes()[0], { target: { value: '246810' } });
    expect(boxes().map(box => box.value).join('')).toBe('246810');
  });
});

describe('notifications', () => {
  const item = (id: string, extra: Record<string, unknown> = {}) => ({
    object: 'notification',
    id,
    type: 'admin.order.needs_review',
    severity: 'warning',
    title: `Order ${id} unclear`,
    body: 'Still unconfirmed after every check.',
    link: `/orders/${id}`,
    mode: null,
    read: false,
    read_at: null,
    created_at: new Date().toISOString(),
    ...extra,
  });
  let calls: Array<{ method: string; url: string }>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.test';
    calls = [];
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      calls.push({ method: request.method, url: `${url.pathname}${url.search}` });
      if (url.pathname.endsWith('/unread-count')) return Response.json({ object: 'unread_count', count: 2 });
      if (url.pathname.endsWith('/read-all')) return Response.json({ object: 'notifications_read', updated: 2 });
      if (url.pathname.endsWith('/read')) return Response.json(item('n1', { read: true }));
      if (url.searchParams.get('unread') === 'true') return Response.json({ object: 'list', data: [], has_more: false, unread_count: 0 });
      return Response.json({ object: 'list', data: [item('n1'), item('n2', { severity: 'critical', mode: 'test', read: true, link: null })], has_more: false, unread_count: 2 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test('the bell shows the unread count and the latest notifications; opening one marks it read', async () => {
    render(
      <AdminProviders>
        <NotificationBell realm="admin" />
      </AdminProviders>,
    );
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(calls[0].url).toBe('/v1/admin/notifications/unread-count');
    fireEvent.click(bell);
    const menu = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(await within(menu).findByText('Order n1 unclear')).toBeTruthy();
    expect(within(menu).getByText('Sandbox')).toBeTruthy();
    expect(within(menu).getByLabelText('Urgent')).toBeTruthy();
    expect(within(menu).getAllByLabelText('Unread')).toHaveLength(1);
    expect(within(menu).getByText('See all notifications').closest('a')!.getAttribute('href')).toBe('/notifications');
    fireEvent.click(within(menu).getByText('Order n1 unclear'));
    await waitFor(() => expect(calls.some(call => call.method === 'POST' && call.url === '/v1/admin/notifications/n1/read')).toBe(true));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
  });

  test('the inbox lists everything, filters unread and marks all read', async () => {
    render(
      <AdminProviders>
        <NotificationsInbox realm="reseller" />
      </AdminProviders>,
    );
    expect(await screen.findByText('Order n2 unclear')).toBeTruthy();
    expect(calls.some(call => call.url.startsWith('/v1/notifications?'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(calls.some(call => call.method === 'POST' && call.url === '/v1/notifications/read-all')).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: /Unread/ }));
    expect(await screen.findByText('No unread notifications')).toBeTruthy();
  });
});

describe('push', () => {
  let calls: Array<{ method: string; url: string; body: string }>;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.test';
    calls = [];
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      calls.push({ method: request.method, url: url.pathname, body: request.method === 'GET' ? '' : await request.clone().text() });
      if (url.pathname.endsWith('/push-settings')) return Response.json({ object: 'push_settings', enabled: true, public_key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' });
      if (url.pathname.endsWith('/devices') && request.method === 'GET') {
        return Response.json({ object: 'list', data: [{ object: 'device', id: 'd1', channel: 'web_push', label: 'Chrome on Windows', current: false, last_pushed_at: null, last_seen_at: new Date().toISOString(), created_at: new Date().toISOString() }] });
      }
      if (url.pathname.endsWith('/test')) return Response.json({ object: 'push_test', sent: false, error: 'HTTP 410' });
      if (request.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.pathname.endsWith('/notification-preferences')) {
        return Response.json({
          object: 'list',
          data: [
            { object: 'notification_preference', type: 'top_up.credited', label: 'Wallet topped up', severity: 'success', push: false, default: false, locked: false },
            { object: 'notification_preference', type: 'payout.failed', label: 'Withdrawal failed', severity: 'critical', push: true, default: true, locked: true },
          ],
        });
      }
      return Response.json({ object: 'notification_preference', type: 'top_up.credited', label: 'Wallet topped up', severity: 'success', push: true, default: false, locked: false });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  test('settings list devices and preferences; urgent ones cannot be turned off; devices can be tested and removed', async () => {
    render(
      <AdminProviders>
        <PushSettings realm="reseller" userId="u1" />
      </AdminProviders>,
    );
    expect(await screen.findByText('Chrome on Windows')).toBeTruthy();
    // jsdom has no service workers, like a browser without push support.
    expect(screen.getByText(/This browser cannot receive push notifications/)).toBeTruthy();
    const locked = await screen.findByRole('switch', { name: 'Push “Withdrawal failed”' });
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Push “Wallet topped up”' }));
    await waitFor(() => expect(calls.some(call => call.method === 'PUT' && call.url === '/v1/notification-preferences/top_up.credited' && call.body === '{"push":true}')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('The test push was not accepted (HTTP 410).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Chrome on Windows' }));
    await waitFor(() => expect(calls.some(call => call.method === 'DELETE' && call.url === '/v1/devices/d1')).toBe(true));
  });

  test('the service worker shows each push and opens its page in the right account and mode', async () => {
    const listeners: Record<string, (event: unknown) => void> = {};
    const shown: Array<{ title: string; options: { body: string; tag: string; requireInteraction: boolean; data: { url: string } } }> = [];
    const opened: string[] = [];
    const scope = {
      location: { origin: 'https://shq.bitocard.com' },
      addEventListener: (name: string, listener: (event: unknown) => void) => (listeners[name] = listener),
      skipWaiting: () => undefined,
      registration: { showNotification: async (title: string, options: never) => void shown.push({ title, options }) },
      clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async (url: string) => void opened.push(url) },
    };
    new Function('self', pushServiceWorker)(scope);
    const waits: Array<Promise<unknown>> = [];
    const push = (data: unknown) => listeners.push({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    push({ id: 'n1', title: 'Withdrawal failed', body: 'Back in your earnings.', severity: 'critical', link: '/wallet/payouts', mode: 'test', account: 'r1' });
    push({ id: 'n2', title: 'Evil', body: '', severity: 'info', link: 'https://evil.example/x', mode: null, account: null });
    await Promise.all(waits);
    expect(shown[0]).toMatchObject({ title: 'Withdrawal failed', options: { body: 'Back in your earnings.', tag: 'n1', requireInteraction: true, data: { url: 'https://shq.bitocard.com/wallet/payouts?account=r1&mode=test' } } });
    expect(shown[1].options.data.url).toBe('https://shq.bitocard.com/notifications');
    listeners.notificationclick({ notification: { close: () => undefined, data: shown[0].options.data }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(opened).toEqual(['https://shq.bitocard.com/wallet/payouts?account=r1&mode=test']);
  });
});

describe('image field', () => {
  let calls: Array<{ method: string; url: string; credentials?: RequestCredentials }>;
  let configured: boolean;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.test';
    calls = [];
    configured = true;
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      calls.push({ method: request.method, url: url.origin === 'http://api.test' ? url.pathname : url.href, credentials: init?.credentials ?? request.credentials });
      if (url.origin === 'https://storage.test') return new Response(null, { status: 200 });
      if (url.pathname.endsWith('/settings')) {
        return Response.json({ object: 'media_settings', configured, purposes: [{ purpose: 'brand_logo', label: 'Brand logo', max_bytes: 1024, content_types: ['image/png', 'image/svg+xml'] }] });
      }
      if (url.pathname.endsWith('/uploads')) {
        return Response.json({ object: 'media_upload', id: 'm1', upload: { method: 'PUT', url: 'https://storage.test/b/k', headers: { 'Content-Type': 'image/png' } } }, { status: 201 });
      }
      if (url.pathname.endsWith('/complete')) return Response.json({ object: 'media_asset', id: 'm1', url: 'https://media.test/k.png', status: 'ready' });
      return Response.json({ object: 'list', data: [{ object: 'media_asset', id: 'm0', url: 'https://media.test/old.png', filename: 'old.png' }], has_more: false });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function Harness({ initial = '' }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    return (
      <AdminProviders>
        <ImageField label="Logo" realm="admin" purpose="brand_logo" targetId="amazon" value={value} onChange={setValue} />
        <output data-testid="value">{value}</output>
      </AdminProviders>
    );
  }

  test('uploads a chosen file straight to storage and uses the checked address', async () => {
    render(<Harness />);
    await screen.findByRole('button', { name: 'Upload' });
    expect(screen.getByText('PNG, SVG, up to 1 KB.')).toBeTruthy();
    const file = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Logo file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('https://media.test/k.png'));
    expect(calls.filter(call => call.method !== 'GET').map(call => [call.method, call.url])).toEqual([
      ['POST', '/v1/admin/media/uploads'],
      ['PUT', 'https://storage.test/b/k'],
      ['POST', '/v1/admin/media/m1/complete'],
    ]);
    expect(calls.find(call => call.method === 'PUT')!.credentials).toBe('omit');
    expect(screen.getByAltText('Logo preview').getAttribute('src')).toBe('https://media.test/k.png');
  });

  test('refuses the wrong type or a file too large before uploading', async () => {
    render(<Harness />);
    await screen.findByRole('button', { name: 'Upload' });
    fireEvent.change(screen.getByLabelText('Logo file'), { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    expect(await screen.findByText('Choose a PNG, SVG image.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Logo file'), { target: { files: [new File([new Uint8Array(2048)], 'big.png', { type: 'image/png' })] } });
    expect(await screen.findByText('The image is too large: at most 1 KB.')).toBeTruthy();
    expect(calls.some(call => call.method === 'POST')).toBe(false);
  });

  test('picks a file from the library, removes it, and checks typed addresses', async () => {
    render(<Harness initial="https://media.test/current.png" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Library' }));
    fireEvent.click(await screen.findByTitle('old.png'));
    expect(screen.getByTestId('value').textContent).toBe('https://media.test/old.png');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByTestId('value').textContent).toBe('');
    fireEvent.change(screen.getByLabelText('Logo'), { target: { value: 'http://insecure.test/a.png' } });
    expect(screen.getByText('Use an https:// address.')).toBeTruthy();
  });

  test('without file storage only the address can be typed', async () => {
    configured = false;
    render(<Harness />);
    await waitFor(() => expect(calls.some(call => call.url.endsWith('/settings'))).toBe(true));
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    expect(screen.getByLabelText('Logo')).toBeTruthy();
  });
});
