/**
 * App versions as the API compares them (apps/udozo-api/src/app-config/versions.ts): three whole numbers,
 * `major.minor.patch`. Kept free of React Native so it runs under `node --test`.
 */

export type UpdateState = 'required' | 'available' | 'none';

export const appVersionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Negative when `a` is older than `b`, positive when newer, 0 when the same. */
export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Below the minimum the app must be updated; below the latest an update is offered. */
export function updateState(version: string, min?: string | null, latest?: string | null): UpdateState {
  if (!appVersionPattern.test(version)) return 'none';
  if (min && appVersionPattern.test(min) && compareVersions(version, min) < 0) return 'required';
  if (latest && appVersionPattern.test(latest) && compareVersions(version, latest) < 0) return 'available';
  return 'none';
}
