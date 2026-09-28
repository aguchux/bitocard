import type { MetadataRoute } from "next";
import { legalDocuments } from "@bitocard/ui/legal";
import { siteUrl } from "@bitocard/ui/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl(3005);
  return [
    { url: origin.href, changeFrequency: "yearly", priority: 0.5 },
    ...legalDocuments.map(doc => ({ url: new URL(doc.href, origin).href, changeFrequency: "yearly" as const, priority: 0.5 })),
  ];
}
