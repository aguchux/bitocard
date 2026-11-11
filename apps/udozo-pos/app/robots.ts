import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

/** The public site is indexed; the POS itself, signing in and the handoff are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/pricing", "/download"], disallow: ["/app", "/signin", "/signup", "/handoff"] },
    sitemap: `${siteOrigin()}/sitemap.xml`,
    host: siteOrigin(),
  };
}
