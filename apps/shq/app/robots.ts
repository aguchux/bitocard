import type { MetadataRoute } from "next";
import { publicPaths, shqOrigin } from "@/lib/seo";

/** Only SHQ's public doors (sign-up and sign-in) may be crawled; the back office stays out. */
export default function robots(): MetadataRoute.Robots {
  const origin = shqOrigin();
  return {
    rules: { userAgent: "*", allow: [...publicPaths, "/opengraph-image"], disallow: "/" },
    sitemap: new URL("/sitemap.xml", origin).href,
    host: origin.host,
  };
}
