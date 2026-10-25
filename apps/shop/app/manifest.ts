import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitoCard Shop – Buy and sell near you",
    short_name: "BitoCard Shop",
    description: "Buy and sell near you, protected by Safe pay.",
    start_url: "/",
    display: "browser",
    background_color: colors.page,
    theme_color: colors.navy900,
    icons: [...manifestIcons],
  };
}
