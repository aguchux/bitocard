import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitoCard Documentation",
    short_name: "BitoCard Docs",
    description: "Guides and the API reference for building your BitoCard business.",
    start_url: "/",
    display: "browser",
    background_color: colors.page,
    theme_color: colors.page,
    icons: [...manifestIcons],
  };
}
