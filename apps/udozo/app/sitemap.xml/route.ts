import type { ShopMarkets, ShopSitemap } from "@bitocard/api-client/classifieds";
import { shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { countryFiles, sitemapIndex, sitemapResponse, sitemapUnavailable } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/** One sitemap index, from live data: the pages across countries, then every file of every open country. */
export async function GET() {
  const origin = siteOrigin();
  const all = await shopApi<ShopMarkets>("/v1/classifieds/markets", { revalidate: 0 });
  if (!all.ok) return sitemapUnavailable();
  const countries = await Promise.all(all.data.data.map(market => shopApi<ShopSitemap>(`/v1/classifieds/sitemap?country=${market.country}`, { revalidate: 0 })));
  const files = countries.flatMap(country => (country.ok ? countryFiles(origin, country.data.country.toLowerCase(), country.data) : []));
  if (countries.some(country => !country.ok)) return sitemapUnavailable();
  return sitemapResponse(sitemapIndex([`${origin}/sitemap-main.xml`, ...files]));
}
