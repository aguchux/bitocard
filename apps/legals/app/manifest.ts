import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";
import { siteName } from "@/components/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteName,
    short_name: "BitoCard Legal",
    description: "BitoCard's privacy notice, terms of use, cookie notice and legal notice for every region.",
    start_url: "/",
    display: "browser",
    background_color: colors.page,
    theme_color: colors.page,
    icons: [...manifestIcons],
  };
}
