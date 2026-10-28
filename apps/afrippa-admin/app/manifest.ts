import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";

/** Lets Afrippa's admin be added to a phone's Home Screen as an app. The icons are Afrippa's "a" mark. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Afrippa Admin",
    short_name: "Afrippa Admin",
    description: "Afrippa's operations: orders and appeals, traders, crypto, help and settings.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#070f4c",
    icons: [...manifestIcons],
  };
}
