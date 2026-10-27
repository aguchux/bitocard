import type { MetadataRoute } from "next";
import { appUrl } from "@bitocard/ui/site";

export default function robots(): MetadataRoute.Robots {
  const origin = new URL(appUrl("crypto")).origin;
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${origin}/sitemap.xml`, host: origin };
}
