import type { MetadataRoute } from "next";
import { appUrl } from "@bitocard/ui/site";

export default function robots(): MetadataRoute.Robots {
  const origin = new URL(appUrl("afrippa")).origin;
  // Signing in and the account's pages are never crawled (each also says noindex).
  const disallow = ["/signin", "/signup", "/verify", "/two-step", "/forgot-password", "/verification", "/wallets", "/ads", "/deposit", "/withdraw", "/withdrawals", "/orders", "/take", "/payment-methods"];
  return { rules: { userAgent: "*", allow: "/", disallow }, sitemap: `${origin}/sitemap.xml`, host: origin };
}
