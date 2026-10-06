import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryView, searchDelayMs, useDebouncedValue } from '../src';

afterEach(cleanup);

const view = (query: Parameters<typeof QueryView<string>>[0]['query']) =>
  render(
    <QueryView query={query} loading={<p>Loading…</p>}>
      {data => <p>{`Data: ${data}`}</p>}
    </QueryView>,
  );

describe('QueryView', () => {
  test('loading until the first answer, then the data', () => {
    const { rerender } = view({ refetch: vi.fn() });
    expect(screen.getByText('Loading…')).toBeTruthy();
    rerender(
      <QueryView query={{ data: 'ready', refetch: vi.fn() }} loading={<p>Loading…</p>}>
        {data => <p>{`Data: ${data}`}</p>}
      </QueryView>,
    );
    expect(screen.getByText('Data: ready')).toBeTruthy();
  });

  test('the error panel only when nothing has loaded, with Try again', () => {
    const refetch = vi.fn();
    view({ error: { message: 'Could not reach BitoCard.' }, refetch });
    expect(screen.getByRole('alert').textContent).toContain('Could not reach BitoCard.');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  test('a failed refresh keeps the data on screen, with a notice and Retry', () => {
    const refetch = vi.fn();
    view({ data: 'last loaded', error: { message: 'BitoCard took too long to answer.' }, isFetching: false, refetch });
    expect(screen.getByText('Data: last loaded')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Showing the last data loaded.');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  test('while retrying, the notice goes and the data stays', () => {
    view({ data: 'last loaded', error: { message: 'Failed.' }, isFetching: true, refetch: vi.fn() });
    expect(screen.getByText('Data: last loaded')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('useDebouncedValue', () => {
  test('a search waits for typing to pause; clearing it applies at once', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), { initialProps: { value: '' } });
    rerender({ value: 'a' });
    rerender({ value: 'am' });
    rerender({ value: 'ama' });
    expect(result.current).toBe('');
    act(() => vi.advanceTimersByTime(searchDelayMs));
    expect(result.current).toBe('ama');
    rerender({ value: '' });
    expect(result.current).toBe('');
    vi.useRealTimers();
  });
});