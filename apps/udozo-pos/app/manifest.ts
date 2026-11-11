import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";

/** Lets Udozo POS be installed from the browser on a counter PC, tablet or phone, opening straight into the POS. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Udozo POS",
    short_name: "Udozo POS",
    description: "The till for udozo.com sellers: sell in your shop from the same stock you list on Udozo.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#10231C",
    icons: [...manifestIcons],
  };
}
