import type { MetadataRoute } from "next";
import { brand, manifestIcons } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";

/** Installable as an app (standalone, with the service worker at `/sw.js`); shoppers are asked where an admin allows it. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BitoCard – Gift cards, airtime, data and bills",
    short_name: brand.name,
    description: "Shop gift cards, top up mobile, pay bills and explore digital essentials, delivered digitally.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    categories: ["shopping"],
    background_color: colors.page,
    theme_color: colors.page,
    icons: [...manifestIcons],
  };
}
