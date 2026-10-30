import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { siteTheme } from "@/lib/theme";

/** Installable as an app (standalone, with the service worker at `/sw.js`), in Udozo's theme; visitors are asked where an admin allows it. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { colors } = await siteTheme();
  return {
    id: "/",
    name: "Udozo – Buy and sell near you",
    short_name: "Udozo",
    description: "Buy and sell near you, protected by Safe pay.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    categories: ["shopping"],
    background_color: colors.page,
    theme_color: colors.primary,
    icons: [...manifestIcons],
  };
}
