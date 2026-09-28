import type { MetadataRoute } from "next";
import { siteUrl } from "@bitocard/ui/site";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: new URL("/sitemap.xml", siteUrl(3005)).href };
}
