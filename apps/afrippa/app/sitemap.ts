import type { MetadataRoute } from "next";
import { appUrl } from "@bitocard/ui/site";
import { marketPath, markets } from "@/lib/api";

/** Every market Afrippa shows (the global market at the root, each country at its code). Traders' cards are not listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = new URL(appUrl("afrippa")).origin;
  const { data } = await markets();
  const pages = data.length ? data.map(item => marketPath(item.market)) : ["/"];
  return [...new Set(pages)].map(path => ({ url: `${origin}${path}`, changeFrequency: "hourly" as const, priority: path === "/" ? 1 : 0.8 }));
}
