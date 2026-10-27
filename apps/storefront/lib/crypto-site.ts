import "server-only";
import type { StoreApp } from "@bitocard/api-client/storefront";
import { appUrl } from "@bitocard/ui/site";
import { storeApi } from "@/lib/api";
import { currentStore } from "@/lib/store";

/** Whether this store hands its Crypto tab over to BitoCard Crypto (`crypto_site`: BitoCard's own stores, while it is live). */
export async function cryptoSite() {
  const { store } = await currentStore();
  const app = store ? store.app : await storeApi<StoreApp>("/v1/store/app").then(result => (result.ok ? result.data : undefined));
  return app?.crypto_site === true;
}

/**
 * BitoCard Crypto's page for the market asked (`?market=GH` its country page; `WW` or none, the global market's root),
 * reached through this site's handoff, so the customer arrives signed in.
 */
export function cryptoSiteHref(params: { market?: string | string[] }) {
  const asked = typeof params.market === "string" && /^[A-Za-z]{2}$/.test(params.market) ? params.market.toUpperCase() : "";
  const path = asked && asked !== "WW" ? `/${asked.toLowerCase()}` : "/";
  return `/handoff/go?${new URLSearchParams({ to: new URL(appUrl("crypto")).origin, next: path })}`;
}
