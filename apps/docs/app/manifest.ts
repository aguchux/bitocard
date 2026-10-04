import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitoCard Documentation",
    short_name: "BitoCard Docs",
    description: "Guides and the API reference for building your BitoCard business.",
    start_url: "/",
    display: "browser",
    background_color: "#fcfdff",
    theme_color: "#fcfdff",
    icons: [...manifestIcons],
  };
}
