import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";

/** Lets Udozo Seller HQ be added to a phone's Home Screen as an app. The icons are Udozo's mark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Udozo Seller HQ",
    short_name: "Seller HQ",
    description: "Udozo's Seller HQ: stores, resale listings, orders, domains, wallet and payouts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#070f4c",
    icons: [...manifestIcons],
  };
}
