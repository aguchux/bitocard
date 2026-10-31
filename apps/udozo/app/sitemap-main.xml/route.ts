import type { ShopShowcase } from "@bitocard/api-client/classifieds";
import { markets, shopApi } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { legalDocuments } from "@/lib/legal";
import { urlset } from "@/lib/sitemap";

export const revalidate = 3600;

/** The pages across countries: Start here (sellers' landing page), the Safe Trade Guide, the legal documents, and the showcase and its categories once it is on. */
export async function GET() {
  const origin = siteOrigin();
  const all = await markets();
  const entries = [{ loc: `${origin}/start-here` }, { loc: `${origin}/safe-trade` }, { loc: `${origin}/legal` }, ...legalDocuments.map(doc => ({ loc: `${origin}/legal/${doc.slug}` }))];
  if (all.showcase) {
    entries.unshift({ loc: `${origin}/` });
    const showcase = await shopApi<ShopShowcase>("/v1/classifieds/showcase", { revalidate: 3600 });
    if (showcase.ok) for (const category of showcase.data.categories) entries.push({ loc: `${origin}/c/${category.slug}` });
  }
  return new Response(urlset(entries), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
