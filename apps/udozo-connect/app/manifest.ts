import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";

/** Lets Udozo Connect be added to a phone's Home Screen: centre staff work from a phone at the counter. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Udozo Connect",
    short_name: "Connect",
    description: "Apply to run a Udozo Connect Centre, and follow your application.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#185174",
    icons: [...manifestIcons],
  };
}
