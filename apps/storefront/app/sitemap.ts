import type { MetadataRoute } from "next";
import type { StoreCategory, StoreList, StoreProduct } from "@bitocard/api-client/storefront";
import { siteUrl } from "@bitocard/ui/site";
import { storeApi } from "@/lib/api";

export const revalidate = 3600;

// Legal documents are listed in the legals app's own sitemap (legals.bitocard.com).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl(3000);
  const url = (path: string) => new URL(path, origin).href;
  const entries: MetadataRoute.Sitemap = [
    { url: origin.href, changeFrequency: "daily", priority: 1 },
    { url: url("/resellers"), changeFrequency: "weekly", priority: 0.8 },
    { url: url("/catalogs"), changeFrequency: "daily", priority: 0.8 },
  ];
  // The store's categories and products, when the API is reachable (a build without it still gets the pages above).
  const categories = await storeApi<StoreList<StoreCategory>>("/v1/store/categories");
  if (categories.ok) for (const item of categories.data.data) entries.push({ url: url(`/catalogs/${item.category}`), changeFrequency: "daily", priority: 0.7 });
  for (let offset = 0; offset < 2000; offset += 60) {
    const page = await storeApi<StoreList<StoreProduct>>(`/v1/store/products?sort=name&limit=60&offset=${offset}`);
    if (!page.ok) break;
    for (const product of page.data.data) entries.push({ url: url(`/p/${encodeURIComponent(product.key)}`), changeFrequency: "weekly", priority: 0.6 });
    if (!page.data.has_more) break;
  }
  return entries;
}
