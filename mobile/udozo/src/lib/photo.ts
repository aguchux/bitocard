/**
 * A listing photo at the width the screen needs: Udozo's photo route (`/img/<id>.jpg`) takes `w` 480, 960 or 1600;
 * other addresses are used as they are.
 */
export function photoUrl(url: string | null | undefined, width: 480 | 960 | 1600 = 480) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/\/img\/[^/]+\.jpg$/.test(parsed.pathname)) return url;
    parsed.searchParams.set('w', String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}
