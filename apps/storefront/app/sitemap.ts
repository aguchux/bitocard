import type { MetadataRoute } from "next";
import { siteUrl } from "@bitocard/ui/site";

// Legal documents are listed in the legals app's own sitemap (legals.bitocard.com).
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteUrl(3000).href, changeFrequency: "monthly", priority: 1 }];
}
