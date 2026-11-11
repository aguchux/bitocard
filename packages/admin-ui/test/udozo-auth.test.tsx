// Udozo's sign-in pages (Seller HQ and admin.udozo.com) wear their own layout, never BitoCard's navy split screen: the
// lockup in a top bar at every width, the product named beside it, one card with the form and Udozo's blue panel.
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Store } from 'lucide-react';
import { UdozoAuthLayout } from '../src/shell';

afterEach(cleanup);

const page = () =>
  render(
    <UdozoAuthLayout brand={<span>Udozo</span>} product="Seller HQ" title="Run your stores" lead="In one place." features={[{ icon: Store, label: 'Your own stores' }]} aside={<a href="https://udozo.com">udozo.com</a>}>
      <h1>Sign in</h1>
    </UdozoAuthLayout>,
  );

describe("Udozo's auth layout", () => {
  test('the lockup and product in the top bar, the form, and the panel with its features', () => {
    const { container } = page();
    const header = container.querySelector('header')!;
    expect(header.textContent).toContain('Udozo');
    expect(header.textContent).toContain('Seller HQ');
    expect(screen.getByRole('link', { name: 'udozo.com' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 }), "the form's heading is the page's only one").toHaveLength(1);
    const panel = screen.getByRole('complementary', { name: 'Udozo Seller HQ' });
    expect(panel.textContent).toContain('Run your stores');
    expect(panel.textContent).toContain('Your own stores');
  });

  test("never BitoCard's navy split screen", () => {
    const { container } = page();
    expect(container.querySelector('[data-auth="udozo"]')).toBeTruthy();
    expect(container.innerHTML).not.toContain('bg-navy-950');
    expect(container.innerHTML).not.toContain('#ff2382');
  });
});
