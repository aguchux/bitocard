/** App versions are three whole numbers, `major.minor.patch` (what the app's store build reports). */
export const appVersionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Compares two versions: negative when `a` is older, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

export type UpdateState = 'none' | 'available' | 'required';

/** Whether an app at `version` must update (below `min`), may update (below `latest`) or is fine. */
export function updateState(version: string, min?: string | null, latest?: string | null): UpdateState {
  if (min && compareVersions(version, min) < 0) return 'required';
  if (latest && compareVersions(version, latest) < 0) return 'available';
  return 'none';
}
