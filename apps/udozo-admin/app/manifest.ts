import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";

/** Lets Udozo Admin be added to a phone's Home Screen as an app. The icons are Udozo's mark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Udozo Admin",
    short_name: "Udozo Admin",
    description: "Udozo's operations: the marketplace, sellers and resellers, Safe pay, plans and fees, theme and settings.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#070f4c",
    icons: [...manifestIcons],
  };
}
