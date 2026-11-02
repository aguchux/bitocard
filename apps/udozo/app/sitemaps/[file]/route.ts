import type { ShopSitemap, ShopSitemapListings } from "@bitocard/api-client/classifieds";
import { shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { countryEntries, listingEntries, pagesInFile, readSitemapFile, sitemapMissing, sitemapResponse, sitemapUnavailable, urlset } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/** A country closed to it (a refusal) is not found; an unreachable API is only unavailable for now. */
const failed = (status: number) => (status >= 400 && status < 500 ? sitemapMissing() : sitemapUnavailable());

/**
 * One file of a country's sitemap (`/sitemaps/ng-pages-0.xml`, `/sitemaps/ng-listings-0.xml`). Never a folder named
 * `sitemap.xml` under `[cc]`: Next.js takes that for its own metadata route and only serves a placeholder, so every
 * real country falls through to the location page and answers 404 in production.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = readSitemapFile((await params).file);
  if (!file) return sitemapMissing();
  const country = file.cc.toUpperCase();
  const origin = siteOrigin();
  if (file.kind === "listings") {
    const result = await shopApi<ShopSitemapListings>(`/v1/classifieds/sitemap/listings?country=${country}&after=${file.after}`, { revalidate: 0 });
    if (!result.ok) return failed(result.status);
    return result.data.listings.length ? sitemapResponse(urlset(listingEntries(origin, file.cc, result.data))) : sitemapMissing();
  }
  const result = await shopApi<ShopSitemap>(`/v1/classifieds/sitemap?country=${country}`, { revalidate: 0 });
  if (!result.ok) return failed(result.status);
  const entries = pagesInFile(countryEntries(origin, file.cc, result.data), file.page);
  return entries.length ? sitemapResponse(urlset(entries)) : sitemapMissing();
}
