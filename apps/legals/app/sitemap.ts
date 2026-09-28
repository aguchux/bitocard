import type { MetadataRoute } from "next";
import { legalDocuments, legalUpdatedIso } from "@bitocard/ui/legal";
import { siteUrl } from "@bitocard/ui/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl(3005);
  const page = (path: string, priority: number) => ({ url: new URL(path, origin).href, lastModified: legalUpdatedIso, changeFrequency: "monthly" as const, priority });
  return [
    page("/", 0.8),
    page("/documents", 0.7),
    ...legalDocuments.map(doc => page(doc.href, doc.href === "/documents/privacy" ? 0.7 : 0.5)),
    page("/contact", 0.6),
  ];
}
