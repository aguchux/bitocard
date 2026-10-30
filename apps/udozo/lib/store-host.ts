/**
 * Which site a request is for (docs/UDOZO_SPINOFF_PLAN.md, step 4). This app serves udozo.com, the marketplace, and
 * every reseller's store: `<store>.udozo.com` (the sandbox, served by Vercel's wildcard) and resellers' own domains
 * (their live stores). Pure, for the proxy and tests.
 */

/** The request header the proxy sets on a store's request (its subdomain); one the browser sent is always removed. */
export const storeHeader = "x-udozo-store";
/** The store's own origin, worked out by the proxy from the store it found, never from what the browser sent. */
export const storeOriginHeader = "x-udozo-store-origin";
/** The path and query the shopper asked for on the store (before the rewrite), so sign-in can bring them back to it. */
export const storePathHeader = "x-udozo-store-path";

/** udozo.com itself, wherever this app runs (a preview or development build is still never a store there). */
const marketplaceHosts = ["udozo.com", "www.udozo.com"];

export type SiteHost = { kind: "marketplace" } | { kind: "subdomain"; subdomain: string } | { kind: "domain"; domain: string };

/** Store subdomains (as the API allows them): lower-case letters, digits and hyphens, 2 to 30 characters. */
const subdomainPattern = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
/** A host name a domain lookup may be asked about: letters, digits, hyphens and dots, at least one dot. */
const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * What a request's host is, given this site's own origin (`siteOrigin()`): the marketplace (udozo.com, its www, and
 * Vercel's preview addresses), a store's subdomain, or a reseller's own domain. Anything that cannot be a store's
 * address (a malformed host, an IP address) is the marketplace, which then answers as udozo.com would.
 */
export function classifyHost(rawHost: string | null, origin: string): SiteHost {
  const site = new URL(origin);
  const host = (rawHost ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || [site.host, `www.${site.host}`, ...marketplaceHosts].includes(host)) return { kind: "marketplace" };
  const name = host.replace(/:\d+$/, "");
  if (name.endsWith(".vercel.app") || name === "localhost") return { kind: "marketplace" };
  const suffix = `.${site.host}`;
  if (host.endsWith(suffix)) {
    const subdomain = host.slice(0, -suffix.length);
    return subdomainPattern.test(subdomain) && subdomain !== "www" ? { kind: "subdomain", subdomain } : { kind: "marketplace" };
  }
  // A store's own domain is served on its standard port only; IP addresses and odd names are never looked up.
  if (host !== name || !domainPattern.test(name)) return { kind: "marketplace" };
  return { kind: "domain", domain: name };
}

/** A store's sandbox address under this site's (`https://gadgets.udozo.com`, `http://gadgets.localhost:3007`). */
export const subdomainOrigin = (subdomain: string, origin: string) => {
  const site = new URL(origin);
  return `${site.protocol}//${subdomain}.${site.host}`;
};

/** The store as the API describes it (`GET /v1/storefronts/:subdomain`), as far as routing needs. */
export type StoreRoute = { subdomain: string; checkout_mode: "test" | "live"; domain: string | null };

/**
 * Where a store's request goes: a live store with a domain is served there only, so its subdomain sends visitors on
 * (308, keeping the path and query); otherwise the store's pages, rewritten to `/store/<subdomain>/…`.
 */
export function storeRoute(host: SiteHost, store: StoreRoute, path: string, search: string): { redirect: string } | { rewrite: string } {
  if (host.kind === "subdomain" && store.checkout_mode === "live" && store.domain) return { redirect: `https://${store.domain}${path}${search}` };
  // Addresses Next.js writes itself (social images, icons) already name the store's folder: never twice.
  const own = `/store/${store.subdomain}`;
  if (path === own || path.startsWith(`${own}/`)) return { rewrite: `${path}${search}` };
  return { rewrite: `${own}${path === "/" ? "" : path}${search}` };
}

/**
 * Whether search engines may index a store at this origin: only a live store on its own domain. Sandbox subdomains are
 * for testing and never indexed (a live store's subdomain only sends visitors on to its domain).
 */
export function indexable(store: Pick<StoreRoute, "checkout_mode">, origin: string, site: string) {
  const host = new URL(origin).host;
  const siteHost = new URL(site).host;
  return store.checkout_mode === "live" && host !== siteHost && !host.endsWith(`.${siteHost}`) && !marketplaceHosts.some(name => host === name || host.endsWith(`.${name}`));
}
