import type { MetadataRoute } from "next";

/** Private: never indexed. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
