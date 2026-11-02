import type { ShopMarkets, ShopShowcase } from "@bitocard/api-client/classifieds";
import { shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { mainEntries, sitemapResponse, sitemapUnavailable, urlset } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/** The pages across countries, once the sitemap has outgrown one file and is an index. */
export async function GET() {
  const all = await shopApi<ShopMarkets>("/v1/classifieds/markets", { revalidate: 0 });
  if (!all.ok) return sitemapUnavailable();
  const showcase = all.data.showcase ? await shopApi<ShopShowcase>("/v1/classifieds/showcase", { revalidate: 0 }) : null;
  if (showcase && !showcase.ok) return sitemapUnavailable();
  return sitemapResponse(urlset(mainEntries(siteOrigin(), showcase?.ok ? showcase.data.categories.map(category => category.slug) : null)));
}
