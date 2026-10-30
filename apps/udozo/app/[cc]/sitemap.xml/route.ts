import type { ShopSitemap } from "@bitocard/api-client/classifieds";
import { marketFor, shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { countryEntries, sitemapLimit, urlset } from "@/lib/sitemap";

export const revalidate = 3600;

/** A country's sitemap: its home, categories, places with enough listings, and every listing. */
export async function GET(_request: Request, { params }: { params: Promise<{ cc: string }> }) {
  const { cc } = await params;
  if (!(await marketFor(cc))) return new Response("Not found", { status: 404 });
  const pages: ShopSitemap[] = [];
  let after = 0;
  for (let count = 0; count < sitemapLimit; ) {
    const result = await shopApi<ShopSitemap>(`/v1/classifieds/sitemap?country=${cc.toUpperCase()}&after=${after}`, { revalidate: 3600 });
    if (!result.ok) break;
    pages.push(result.data);
    count += result.data.listings.length;
    if (result.data.next_after === null) break;
    after = result.data.next_after;
  }
  return new Response(urlset(countryEntries(siteOrigin(), cc, pages)), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
