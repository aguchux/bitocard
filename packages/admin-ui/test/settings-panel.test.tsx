import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Receipt, Smartphone } from 'lucide-react';
import { PanelNav, SettingsPanel } from '../src';

afterEach(cleanup);

describe('settings panels (Settings > Markets)', () => {
  test('each group is its own panel with a heading, found from the jump links', () => {
    render(
      <>
        <PanelNav items={[{ id: 'tax', label: 'Tax', icon: Receipt }, { id: 'phone', label: 'Phone verification', icon: Smartphone }]} />
        <SettingsPanel id="tax" icon={Receipt} title="Tax" description="The rate charged on taxable categories.">
          <p>Rate form</p>
        </SettingsPanel>
        <SettingsPanel id="phone" icon={Smartphone} title="Phone verification">
          <p>Provider</p>
        </SettingsPanel>
      </>,
    );
    const nav = screen.getByRole('navigation', { name: 'Market settings' });
    expect(within(nav).getByRole('link', { name: 'Tax' }).getAttribute('href')).toBe('#tax');
    expect(within(nav).getByRole('link', { name: 'Phone verification' }).getAttribute('href')).toBe('#phone');
    const tax = screen.getByRole('heading', { level: 2, name: 'Tax' }).closest('section')!;
    expect(tax.id).toBe('tax');
    expect(within(tax).getByText('The rate charged on taxable categories.')).toBeTruthy();
    expect(within(tax).getByText('Rate form')).toBeTruthy();
    expect(within(tax).queryByText('Provider')).toBeNull();
  });
});
