import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { apiUrl } from "./api";

/**
 * Resellers' hosted stores are this same app on `<subdomain>.bitocard.com` (and `<subdomain>.localhost` in development,
 * which browsers send to this machine). bitocard.com itself, and `www`, are BitoCard's own store.
 */
const storeHost = /^([a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9]))\.(?:bitocard\.com|localhost)(?::\d+)?$/;
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
};

/** The reseller store this request is for (its subdomain), or null on bitocard.com. Null outside a request (builds). */
export const storeSubdomain = cache(async (): Promise<string | null> => {
  try {
    const list = await headers();
    const host = (list.get("x-forwarded-host") ?? list.get("host") ?? "").toLowerCase();
    const match = storeHost.exec(host);
    return match && !ownHosts.has(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
});

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
