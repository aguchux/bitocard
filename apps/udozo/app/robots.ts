import type { MetadataRoute } from "next";
import { appUrl } from "@bitocard/ui/site";

export default function robots(): MetadataRoute.Robots {
  const origin = new URL(appUrl("shop")).origin;
  // Signing in, the handoff, Safe pay checkouts and this site's own API are never crawled (each also says noindex).
  return { rules: { userAgent: "*", allow: "/", disallow: ["/signin", "/verify", "/handoff", "/api/", "/*/l/*/buy"] }, sitemap: `${origin}/sitemap.xml`, host: origin };
}
