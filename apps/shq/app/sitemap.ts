import type { MetadataRoute } from "next";
import { publicPaths, shqOrigin } from "@/lib/seo";

/** SHQ's public pages only: sign-up first, as it is the one resellers are looking for. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = shqOrigin();
  return publicPaths.map(path => ({
    url: new URL(path, origin).href,
    changeFrequency: "monthly" as const,
    priority: path === "/signup" ? 1 : 0.6,
    images: [new URL("/opengraph-image", origin).href],
  }));
}
