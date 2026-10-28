import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { brand } from "@/lib/brand";

/** Verify can be added to a Home Screen like the other apps, with its brand's name and mark (Afrippa's icons are served at the same addresses on its deployment). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.product,
    short_name: brand.product,
    description: brand.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#070f4c",
    icons: [...manifestIcons],
  };
}
