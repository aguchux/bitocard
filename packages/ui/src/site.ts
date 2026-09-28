export const brand = {
  name: "BitoCard",
  owner: "Golojan Ltd",
  credit: "A Golojan Ltd venture",
  logo: "/bitocard-logo.png",
} as const;

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
