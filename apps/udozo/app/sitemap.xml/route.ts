import { markets } from "@/lib/api";
import { siteOrigin } from "@/lib/customer";
import { sitemapIndex } from "@/lib/sitemap";

export const revalidate = 3600;

/** One sitemap index: the pages across countries, then a sitemap per open country. */
export async function GET() {
  const origin = siteOrigin();
  const all = await markets();
  const locations = [`${origin}/sitemap-main.xml`, ...all.data.map(market => `${origin}/${market.country.toLowerCase()}/sitemap.xml`)];
  return new Response(sitemapIndex(locations), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
