import type { MetadataRoute } from "next";
import { appUrl } from "@bitocard/ui/site";

export default function robots(): MetadataRoute.Robots {
  const origin = new URL(appUrl("crypto")).origin;
  // Signing in and the handoff are never crawled (each also says noindex).
  return { rules: { userAgent: "*", allow: "/", disallow: ["/signin", "/verify", "/handoff"] }, sitemap: `${origin}/sitemap.xml`, host: origin };
}
