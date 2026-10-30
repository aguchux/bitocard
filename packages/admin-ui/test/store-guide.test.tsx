import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StoreGuideDialog, storeGuideSteps } from '../src';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

describe('StoreGuideDialog', () => {
  test('walks through every step, back and forth, then starts New store', () => {
    const onStart = vi.fn();
    render(<StoreGuideDialog open onClose={() => {}} onStart={onStart} />);
    expect(screen.getByRole('heading', { name: 'Create your first store' })).toBeTruthy();
    expect(screen.getByText(`Step 1 of ${storeGuideSteps.length}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create my store' })).toBeNull();

    for (const step of storeGuideSteps.slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(screen.getByRole('heading', { name: step.title })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: `Step ${storeGuideSteps.length}: ${storeGuideSteps.at(-1)!.title}` }).getAttribute('aria-current')).toBe('step');

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByRole('heading', { name: storeGuideSteps.at(-2)!.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Step ${storeGuideSteps.length}: ${storeGuideSteps.at(-1)!.title}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Create my store' }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  test('closes with Maybe later or the close button, and says so on its last showing', () => {
    const onClose = vi.fn();
    const { rerender } = render(<StoreGuideDialog open onClose={onClose} onStart={() => {}} />);
    expect(screen.queryByText(/won’t see this again/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(<StoreGuideDialog open onClose={onClose} onStart={() => {}} last />);
    expect(screen.getByText(/won’t see this again/)).toBeTruthy();
  });
});
