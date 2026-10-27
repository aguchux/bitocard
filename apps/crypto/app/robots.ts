import type { MetadataRoute } from "next";
import { appUrl } from "@bitocard/ui/site";

export default function robots(): MetadataRoute.Robots {
  const origin = new URL(appUrl("crypto")).origin;
  // Signing in, the handoff and the account's pages are never crawled (each also says noindex).
  const disallow = ["/signin", "/verify", "/handoff", "/go/", "/wallets", "/ads", "/trades", "/confirm", "/deposit", "/withdraw", "/withdrawals", "/cash-out"];
  return { rules: { userAgent: "*", allow: "/", disallow }, sitemap: `${origin}/sitemap.xml`, host: origin };
}
