import type { ResaleStoreSitemap } from "@bitocard/api-client/storefront";
import { shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { sitemapMissing, sitemapResponse, sitemapUnavailable, storeEntries, urlset } from "@/lib/sitemap";
import { currentStoreKey, storefront, storeOrigin } from "@/lib/store";
import { indexable } from "@/lib/store-host";

export const dynamic = "force-dynamic";

/** A store's `/sitemap.xml` (the proxy brings it here): a live store on its own domain; a test store has none. */
export async function GET() {
  const [key, origin] = await Promise.all([currentStoreKey(), storeOrigin()]);
  const store = key ? await storefront(key) : null;
  if (store && !store.ok && (store.status === 0 || store.status >= 500)) return sitemapUnavailable();
  if (!key || !store?.ok || !origin || !indexable(store.data, origin, siteOrigin())) return sitemapMissing();
  const sitemap = await shopApi<ResaleStoreSitemap>(`/v1/store/resale/sitemap?store=${encodeURIComponent(key)}`, { revalidate: 0 });
  return sitemap.ok ? sitemapResponse(urlset(storeEntries(origin, sitemap.data))) : sitemapUnavailable();
}
