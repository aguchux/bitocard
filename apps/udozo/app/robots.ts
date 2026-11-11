import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/customer";

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  // Signing in, the account, the handoff, choosing a country (it sets a cookie), UdozoPay checkouts and this site's own API
  // are never crawled (each also says noindex).
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/signin", "/signup", "/verify", "/forgot-password", "/reset-password", "/account", "/sell", "/handoff", "/i/", "/market/", "/home-preview", "/api/", "/pay/", "/*/l/*/buy"] },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
