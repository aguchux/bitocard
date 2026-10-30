import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";

/** Installable as an app (standalone, with the service worker at `/sw.js`); visitors are asked where an admin allows it. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BitoCard Shop – Buy and sell near you",
    short_name: "BitoCard Shop",
    description: "Buy and sell near you, protected by Safe pay.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    categories: ["shopping"],
    background_color: colors.page,
    theme_color: colors.navy900,
    icons: [...manifestIcons],
  };
}
