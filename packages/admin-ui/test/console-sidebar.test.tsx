// Udozo's consoles (Seller HQ and admin.udozo.com) wear their own left column, `variant="sidebar"`: one light column
// with the logo and name side by side, every section a row, the current one open with its pages; BitoCard's navy rail
// and second column stay the default.
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { House, Store, Wallet } from 'lucide-react';
import { ConsoleShell } from '../src/shell';

afterEach(cleanup);

type Key = 'home' | 'market' | 'money';
const sections = [
  { key: 'home' as const, label: 'Home', href: '/', icon: House },
  { key: 'market' as const, label: 'Marketplace', href: '/classifieds', icon: Store },
  { key: 'money' as const, label: 'Money', href: '/money/payouts', icon: Wallet },
];
const menus: Record<Key, { title: string; items: Array<{ label: string; href: string; count?: number }> }> = {
  home: { title: 'Home', items: [{ label: 'Overview', href: '/' }] },
  market: {
    title: 'Marketplace',
    items: [
      { label: 'Moderation', href: '/classifieds', count: 4 },
      { label: 'Listings', href: '/classifieds/listings' },
    ],
  },
  money: {
    title: 'Money',
    items: [
      { label: 'Payouts', href: '/money/payouts' },
      { label: 'Top-ups', href: '/money/top-ups' },
    ],
  },
};
const shell = (variant?: 'rail' | 'sidebar') =>
  render(
    <ConsoleShell<Key> brand="Udozo" tagline="Admin" logo="/udozo-mark.png" variant={variant} sections={sections} menus={menus} section="market" current="/classifieds/listings" crumbs={[{ label: 'Listings' }]} account={<span>me</span>}>
      <p>Page</p>
    </ConsoleShell>,
  );

describe("Udozo's sidebar", () => {
  test('one column: the logo and name, every section, the current one open with its pages and the page marked', () => {
    const { container } = shell('sidebar');
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(main.getAttribute('data-shell')).toBe('sidebar');
    expect(main.textContent).toContain('Udozo');
    expect(main.textContent).toContain('Admin');
    expect(main.querySelector('img')!.getAttribute('src')).toBe('/udozo-mark.png');
    expect(within(main).getByText('Marketplace').closest('a')!.hasAttribute('data-active')).toBe(true);
    expect(within(main).getByText('Marketplace').closest('a')!.getAttribute('aria-current'), 'only the page itself is current').toBeNull();
    expect(within(main).getByText('Listings').closest('a')!.getAttribute('aria-current')).toBe('page');
    expect(within(main).getByText('4')).toBeTruthy();
    expect(within(main).queryByText('Payouts'), 'another section stays closed').toBeNull();
    expect(container.querySelector('aside'), 'no second column').toBeNull();
    expect(container.innerHTML, 'never the navy rail').not.toContain('bg-navy-900');
  });

  test("another section's pages open in place with its chevron, without leaving the page", () => {
    shell('sidebar');
    const main = screen.getByRole('navigation', { name: 'Main' });
    const toggle = within(main).getByRole('button', { name: 'Show Money pages' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(within(main).getByText('Payouts').closest('a')!.getAttribute('href')).toBe('/money/payouts');
    expect(within(main).getByRole('button', { name: 'Hide Money pages' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(main).queryByRole('button', { name: /Home pages/ }), 'a section with one page has no chevron').toBeNull();
  });

  test('on phones the same sidebar opens in a drawer', () => {
    shell('sidebar');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(drawer).getByRole('navigation', { name: 'Main' }).getAttribute('data-shell')).toBe('sidebar');
  });

  test("BitoCard's navy rail and second column stay the default", () => {
    const { container } = shell();
    expect(screen.getByRole('navigation', { name: 'Main' }).className).toContain('bg-navy-900');
    expect(container.querySelector('aside')).toBeTruthy();
  });
});
