import type { MetadataRoute } from "next";
import { siteUrl } from "@bitocard/ui/site";

/** The docs are public and meant to be found. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl(3002);
  return { rules: { userAgent: "*", allow: "/" }, sitemap: new URL("/sitemap.xml", base).href, host: base.origin };
}
