import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { apiUrl } from "./api";

/**
 * Resellers' hosted stores are this same app on `<subdomain>.bitocard.com` (and `<subdomain>.localhost` in development,
 * which browsers send to this machine). bitocard.com itself, and `www`, are BitoCard's own store.
 */
const storeHostPattern = /^([a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9]))\.(?:bitocard\.com|localhost)(?::\d+)?$/;
const ownHosts = new Set(["www", "bitocard"]);

export type HostedStore = {
  object: "storefront";
  name: string;
  subdomain: string;
  branding: { logo_url: string | null; primary_color: string; accent_color: string };
  country: string | null;
  currency: string | null;
  /** `test` while the store's checkout is the sandbox: orders are simulated and nothing is charged. */
  checkout_mode: "test" | "live";
  /** The customer account app: its menu on desktop (the store's choice, else BitoCard's default). */
  app?: { desktop_nav: "rail" | "bottom" };
  /** The store's own main domain while it works, else null. */
  domain?: string | null;
};

/** BitoCard's own hosts (its domain, local development and Vercel previews): never a reseller's own domain. */
const ownDomain = /(^|\.)(bitocard\.com|localhost|vercel\.app)$/;
const domainHost = /^(?=.{4,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

/**
 * Which reseller store this request's host serves: `<subdomain>.bitocard.com`, or a reseller's own domain, which the API
 * confirms (active domains of published stores only; cached a minute). `domain` is set on a reseller's own domain.
 */
export const storeHost = cache(async (): Promise<{ subdomain: string; domain: string | null } | null> => {
  let host = "";
  try {
    const list = await headers();
    host = (list.get("x-forwarded-host") ?? list.get("host") ?? "").toLowerCase();
  } catch {
    return null;
  }
  const match = storeHostPattern.exec(host);
  if (match) return ownHosts.has(match[1]) ? null : { subdomain: match[1], domain: null };
  const name = host.replace(/:\d+$/, "");
  if (!domainHost.test(name) || ownDomain.test(name)) return null;
  try {
    const res = await fetch(apiUrl(`/v1/storefronts/domains/${encodeURIComponent(name)}`), { next: { revalidate: 60, tags: ["store"] } });
    if (!res.ok) return null;
    const found = (await res.json()) as { subdomain?: string; domain?: string };
    return found.subdomain ? { subdomain: found.subdomain, domain: found.domain ?? name } : null;
  } catch {
    return null;
  }
});

/** The reseller store this request is for (its subdomain), or null on bitocard.com. Null outside a request (builds). */
export const storeSubdomain = cache(async (): Promise<string | null> => (await storeHost())?.subdomain ?? null);

/** The reseller's own domain this request came in on, or null (bitocard.com or a BitoCard subdomain). */
export const customDomain = cache(async (): Promise<string | null> => (await storeHost())?.domain ?? null);

/**
 * The reseller store this request is for: `{ store }` when it is published, `{ store: null, missing: true }` when the
 * address names a store that is not open, and `{ store: null }` on bitocard.com.
 */
export const currentStore = cache(async (): Promise<{ store: HostedStore | null; missing?: boolean }> => {
  const subdomain = await storeSubdomain();
  if (!subdomain) return { store: null };
  try {
    const res = await fetch(apiUrl(`/v1/storefronts/${encodeURIComponent(subdomain)}`), { next: { revalidate: 60, tags: ["store"] } });
    if (res.ok) return { store: (await res.json()) as HostedStore };
    return { store: null, missing: res.status === 404 };
  } catch {
    return { store: null };
  }
});

/** True on a reseller's store (BitoCard's own pages, such as the reseller landing page, are not shown there). */
export async function onResellerStore() {
  return Boolean(await storeSubdomain());
}
