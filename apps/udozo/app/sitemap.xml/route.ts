import type { ShopMarkets, ShopShowcase, ShopSitemap, ShopSitemapListings } from "@bitocard/api-client/classifieds";
import { shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { countryEntries, countryFiles, listingEntries, mainEntries, sitemapIndex, sitemapLimit, sitemapResponse, sitemapUnavailable, urlset } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/**
 * The sitemap, from live data: every real page itself while they fit in one file, so a person or a search console opening
 * it sees them. Past the protocol's limit it becomes an index of every country's files (`/sitemaps/…`).
 */
export async function GET() {
  const origin = siteOrigin();
  const all = await shopApi<ShopMarkets>("/v1/classifieds/markets", { revalidate: 0 });
  if (!all.ok) return sitemapUnavailable();
  const showcase = all.data.showcase ? await shopApi<ShopShowcase>("/v1/classifieds/showcase", { revalidate: 0 }) : null;
  if (showcase && !showcase.ok) return sitemapUnavailable();
  const answers = await Promise.all(all.data.data.map(market => shopApi<ShopSitemap>(`/v1/classifieds/sitemap?country=${market.country}`, { revalidate: 0 })));
  const countries = answers.flatMap(answer => (answer.ok ? [{ cc: answer.data.country.toLowerCase(), sitemap: answer.data }] : []));
  if (countries.length < answers.length) return sitemapUnavailable();

  const main = mainEntries(origin, showcase?.ok ? showcase.data.categories.map(category => category.slug) : null);
  const pages = [...main, ...countries.flatMap(({ cc, sitemap }) => countryEntries(origin, cc, sitemap))];
  const listings = countries.reduce((total, { sitemap }) => total + sitemap.listing_pages.reduce((sum, file) => sum + file.listings, 0), 0);
  if (pages.length + listings > sitemapLimit) return sitemapResponse(sitemapIndex([`${origin}/sitemap-main.xml`, ...countries.flatMap(({ cc, sitemap }) => countryFiles(origin, cc, sitemap))]));

  const files = await Promise.all(countries.flatMap(({ cc, sitemap }) => sitemap.listing_pages.map(async file => ({ cc, result: await shopApi<ShopSitemapListings>(`/v1/classifieds/sitemap/listings?country=${cc.toUpperCase()}&after=${file.after}`, { revalidate: 0 }) }))));
  const entries = files.flatMap(({ cc, result }) => (result.ok ? listingEntries(origin, cc, result.data) : []));
  if (files.some(file => !file.result.ok)) return sitemapUnavailable();
  return sitemapResponse(urlset([...pages, ...entries]));
}
