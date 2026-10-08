import type { MetadataRoute } from "next";
import { siteUrl } from "@bitocard/ui/site";

export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl(3000);
  // Order pages (`/a/<token>`) are private links: never crawled (each also says noindex).
  return { rules: { userAgent: "*", allow: "/", disallow: ["/a/"] }, sitemap: new URL("/sitemap.xml", origin).href };
}
