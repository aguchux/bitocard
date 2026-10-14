/** The API docs, which send resellers to sign in before trying the API, and get them back afterwards. */
export const docsOrigins = ['https://docs.bitocard.com', 'http://localhost:3002'];

/** BitoCard Verify's review console, where registered resellers review their customers' ID checks after signing in. */
export const verifyOrigins = ['https://verify.bitocard.com', 'http://localhost:3006'];

/** Other BitoCard apps sign-in may send a reseller back to. */
export const returnOrigins = [...docsOrigins, ...verifyOrigins];

/**
 * Where to go after signing in: a path in this app, or a page of the API docs or BitoCard Verify. Anything else goes
 * home, so a crafted link cannot send someone to another site after sign-in.
 */
export function safeNext(value: string | null | undefined) {
  if (!value) return '/';
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value;
  try {
    const url = new URL(value);
    return returnOrigins.includes(url.origin) ? url.href : '/';
  } catch {
    return '/';
  }
}

/** Goes to `next`: within the app, or back to the docs or Verify (another origin, so a full page load). */
export function goNext(next: string, router: { replace: (href: string) => void }) {
  if (/^https?:\/\//.test(next)) window.location.assign(next);
  else router.replace(next);
}
