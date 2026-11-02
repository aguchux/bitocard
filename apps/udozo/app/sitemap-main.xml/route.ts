import type { ShopMarkets, ShopShowcase } from "@bitocard/api-client/classifieds";
import { shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { legalDocuments } from "@/lib/legal";
import { sitemapResponse, sitemapUnavailable, urlset } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/** The pages across countries: Start here (sellers' landing page), the Safe Trade Guide, the legal documents, and the showcase and its categories once it is on. */
export async function GET() {
  const origin = siteOrigin();
  const all = await shopApi<ShopMarkets>("/v1/classifieds/markets", { revalidate: 0 });
  if (!all.ok) return sitemapUnavailable();
  const entries = [{ loc: `${origin}/start-here` }, { loc: `${origin}/safe-trade` }, { loc: `${origin}/help/faqs` }, { loc: `${origin}/help/contact` }, { loc: `${origin}/legal` }, ...legalDocuments.map(doc => ({ loc: `${origin}/legal/${doc.slug}` }))];
  if (all.data.showcase) {
    const showcase = await shopApi<ShopShowcase>("/v1/classifieds/showcase", { revalidate: 0 });
    if (!showcase.ok) return sitemapUnavailable();
    entries.unshift({ loc: `${origin}/` });
    for (const category of showcase.data.categories) entries.push({ loc: `${origin}/c/${category.slug}` });
  }
  return sitemapResponse(urlset(entries));
}
