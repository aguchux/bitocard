export const brand = {
  name: "BitoCard",
  owner: "Golojan Ltd",
  credit: "A Golojan Ltd venture",
  /** The square logo (favicons, app icons, push): the "b" mark with room around it. */
  logo: "/bitocard-logo.png",
  /** The "b" mark, tightly cropped: the first letter of the wordmark. `-light` versions are for navy backgrounds. */
  mark: "/bitocard-mark.png",
  logoLight: "/bitocard-logo-light.png",
  markLight: "/bitocard-mark-light.png",
} as const;

const apps = {
  storefront: { env: "STOREFRONT_URL", production: "https://bitocard.com", localPort: 3000 },
  legals: { env: "LEGALS_URL", production: "https://legals.bitocard.com", localPort: 3005 },
} as const;

/**
 * Origin of another BitoCard app, for cross-app links (server-side only).
 * Priority: its env override (STOREFRONT_URL, LEGALS_URL), then the production domain on any Vercel build, then localhost.
 */
export function appUrl(app: keyof typeof apps, path = "/"): string {
  const { env, production, localPort } = apps[app];
  const origin = process.env[env] ?? (process.env.VERCEL ? production : `http://localhost:${localPort}`);
  return new URL(path, origin).href;
}

/**
 * Canonical origin for metadata (Open Graph, sitemaps, robots).
 * Priority: explicit SITE_URL, then the Vercel production domain, then the deployment URL, then localhost.
 */
export function siteUrl(localPort: number): URL {
  const explicit = process.env.SITE_URL;
  if (explicit) return new URL(explicit);

  const vercelHost =
    process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL;
  return new URL(vercelHost ? `https://${vercelHost}` : `http://localhost:${localPort}`);
}
