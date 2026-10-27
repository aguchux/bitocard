import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Receipt, Smartphone } from 'lucide-react';
import { PanelNav, Tabs } from '../src';

afterEach(cleanup);

const items = [
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days', count: 4 },
] as const;

describe("the consoles' tabs are BitoCard's standard underlined tabs", () => {
  test('a grey line under every tab, pink under the selected one, the line running on, sliding sideways', () => {
    const onChange = vi.fn();
    render(<Tabs label="Period" value="month" onChange={onChange} items={[...items]} />);
    const list = screen.getByRole('tablist', { name: 'Period' });
    expect(list.className).toContain('overflow-x-auto');
    expect(list.className).toContain('scroll-smooth');
    expect(list.className).toContain('[scrollbar-width:none]');
    const selected = screen.getByRole('tab', { name: /30 days/ });
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(selected.className).toContain('border-b-2 ');
    expect(selected.className).toContain('border-brand-500 text-ink');
    expect(screen.getByRole('tab', { name: '7 days' }).className).toContain('border-line text-muted');
    expect(list.lastElementChild!.className).toContain('flex-1 border-b-2 border-line');
    fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
    expect(onChange).toHaveBeenCalledWith('week');
  });

  test('pills are underlined on phones and a segmented control from sm up', () => {
    render(<Tabs label="Metric" variant="pills" value="week" onChange={() => undefined} items={[...items]} />);
    const list = screen.getByRole('tablist', { name: 'Metric' });
    expect(list.className).toContain('sm:rounded-lg sm:border sm:border-line');
    const selected = screen.getByRole('tab', { name: '7 days' });
    expect(selected.className).toContain('border-b-2');
    expect(selected.className).toContain('border-brand-500');
    expect(selected.className).toContain('sm:border-b-0');
    expect(selected.className).toContain('sm:bg-brand-500 sm:text-white');
    expect(list.lastElementChild!.className).toContain('sm:hidden');
  });

  test('the market settings jump links are one underlined row on phones, pills from sm up', () => {
    render(<PanelNav items={[{ id: 'tax', label: 'Tax', icon: Receipt }, { id: 'phone', label: 'Phone verification', icon: Smartphone }]} />);
    const nav = screen.getByRole('navigation', { name: 'Market settings' });
    expect(nav.className).toContain('overflow-x-auto');
    expect(nav.className).toContain('sm:flex-wrap');
    const link = screen.getByRole('link', { name: 'Tax' });
    expect(link.className).toContain('border-b-2 border-line');
    expect(link.className).toContain('sm:rounded-full');
  });
});
