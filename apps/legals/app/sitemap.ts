import type { MetadataRoute } from "next";
import { legalDocuments, legalUpdatedIso } from "@bitocard/ui/legal";
import { siteUrl } from "@bitocard/ui/site";
import { ogImagePath } from "@/components/seo";

/**
 * Every public page with its last-updated date, its banner image (image sitemap)
 * and en-GB / x-default language alternates.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl(3005);
  const absolute = (path: string) => new URL(path, origin).href;
  const page = (path: string, priority: number, changeFrequency: "weekly" | "monthly" = "monthly") => ({
    url: absolute(path),
    lastModified: legalUpdatedIso,
    changeFrequency,
    priority,
    images: [absolute(ogImagePath(path))],
    alternates: { languages: { "en-GB": absolute(path), "x-default": absolute(path) } },
  });

  return [
    page("/", 1, "weekly"),
    page("/documents", 0.9, "weekly"),
    ...legalDocuments.map(doc => page(doc.href, doc.href === "/documents/privacy" ? 0.9 : 0.7)),
    page("/contact", 0.8),
  ];
}
