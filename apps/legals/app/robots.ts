import type { MetadataRoute } from "next";
import { siteUrl } from "@bitocard/ui/site";

export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl(3005);
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", origin).href,
    host: origin.origin,
  };
}
