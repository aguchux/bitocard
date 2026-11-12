import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

/** The public site is indexed; the POS itself, signing in and the handoff are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/features", "/pricing", "/download", "/faq"], disallow: ["/app", "/signin", "/signup", "/handoff", "/offline"] },
    sitemap: `${siteOrigin()}/sitemap.xml`,
    host: siteOrigin(),
  };
}
