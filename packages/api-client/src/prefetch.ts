import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { bitocardApi, revalidateAfterSeconds } from './base';

type Dispatch = (action: unknown) => unknown;

/**
 * Fetches an endpoint's data into the cache ahead of time, unless it was fetched in the last 30 seconds. Returns false
 * for an endpoint no module has injected (nothing is asked for).
 */
export function prefetchQuery(dispatch: Dispatch, endpoint: string, arg: unknown) {
  if (!(endpoint in bitocardApi.endpoints)) return false;
  // Endpoints are injected per app, so the slice's own types do not list them; the name is checked above.
  const prefetch = bitocardApi.util.prefetch as unknown as (name: string, arg: unknown, options: { ifOlderThan: number }) => unknown;
  dispatch(prefetch(endpoint, arg, { ifOlderThan: revalidateAfterSeconds }));
  return true;
}

/**
 * Fetches a screen's data before the person opens it (when the pointer reaches a row, or a row takes focus), so the
 * detail page draws from the cache at once. The endpoint is named as the detail page's hook is (`order` for
 * `useOrderQuery`).
 */
export function usePrefetchQuery(endpoint: string) {
  const dispatch = useDispatch();
  return useCallback((arg: unknown) => void prefetchQuery(dispatch as Dispatch, endpoint, arg), [dispatch, endpoint]);
}
