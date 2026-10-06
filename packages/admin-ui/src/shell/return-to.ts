/** The API docs, which send resellers to sign in before trying the API, and get them back afterwards. */
export const docsOrigins = ['https://docs.bitocard.com', 'http://localhost:3002'];

/**
 * Where to go after signing in: a path in this app, or a page of the API docs. Anything else goes home, so a crafted
 * link cannot send someone to another site after sign-in.
 */
export function safeNext(value: string | null | undefined) {
  if (!value) return '/';
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value;
  try {
    const url = new URL(value);
    return docsOrigins.includes(url.origin) ? url.href : '/';
  } catch {
    return '/';
  }
}

/** Goes to `next`: within the app, or back to the docs (another origin, so a full page load). */
export function goNext(next: string, router: { replace: (href: string) => void }) {
  if (/^https?:\/\//.test(next)) window.location.assign(next);
  else router.replace(next);
}
