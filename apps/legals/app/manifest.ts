import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { siteName } from "@/components/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteName,
    short_name: "BitoCard Legal",
    description: "BitoCard's privacy notice, terms of use, cookie notice and legal notice for every region.",
    start_url: "/",
    display: "browser",
    background_color: "#fcfdff",
    theme_color: "#fcfdff",
    icons: [...manifestIcons],
  };
}
