'use client';

import { useEffect, useState } from 'react';

/** How long typing must pause before a search box asks the API. */
export const searchDelayMs = 300;

/**
 * The value once it has stopped changing for `delay` ms: feed search boxes through it so the API is asked once per
 * pause, not once per keystroke. Clearing the box applies at once.
 */
export function useDebouncedValue<T>(value: T, delay = searchDelayMs): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return value === '' ? value : settled;
}
