import type { MetadataRoute } from "next";
import { legalDocuments } from "@bitocard/ui/legal";
import { siteUrl } from "@bitocard/ui/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl(3000);
  return [
    { url: origin.href, changeFrequency: "monthly", priority: 1 },
    { url: new URL("/legal", origin).href, changeFrequency: "yearly", priority: 0.3 },
    ...legalDocuments.map(doc => ({ url: new URL(doc.href, origin).href, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
