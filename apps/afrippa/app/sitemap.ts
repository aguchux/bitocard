import type { MetadataRoute } from "next";
import { appUrl } from "@bitocard/ui/site";
import { marketPath, markets } from "@/lib/api";
import { legalDocuments } from "@/lib/legal";

/** Every market Afrippa shows (the global market at the root, each country at its code). Traders' cards are not listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = new URL(appUrl("afrippa")).origin;
  const { data } = await markets();
  const pages = data.length ? data.map(item => marketPath(item.market)) : ["/"];
  const legal = ["/legal", ...legalDocuments.map(doc => `/legal/${doc.slug}`)].map(path => ({ url: `${origin}${path}`, changeFrequency: "monthly" as const, priority: 0.3 }));
  return [...[...new Set(pages)].map(path => ({ url: `${origin}${path}`, changeFrequency: "hourly" as const, priority: path === "/" ? 1 : 0.8 })), ...legal];
}
