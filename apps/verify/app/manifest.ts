import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";

/** BitoCard Verify can be added to a Home Screen like the other apps. The icons are the "b" mark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitoCard Verify",
    short_name: "BitoCard Verify",
    description: "Check your identity, or your business, for BitoCard and the stores it supplies.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#070f4c",
    icons: [...manifestIcons],
  };
}
