import type { MetadataRoute } from "next";
import { siteUrl } from "@bitocard/ui/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteUrl(3000).href, changeFrequency: "monthly", priority: 1 }];
}
