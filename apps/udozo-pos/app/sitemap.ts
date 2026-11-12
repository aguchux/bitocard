import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

/** The public pages only. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/features`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/pricing`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${origin}/download`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/faq`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
