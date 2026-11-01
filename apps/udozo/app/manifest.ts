import type { MetadataRoute } from "next";
import { manifestIcons } from "@bitocard/ui/site";
import { siteTheme } from "@/lib/theme";

/** Installable as an app (standalone, with the service worker at `/sw.js`), in Udozo's theme; visitors are asked where an admin allows it. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { colors } = await siteTheme();
  return {
    id: "/",
    name: "Udozo – Buy and sell near you",
    short_name: "Udozo",
    description: "Buy and sell near you, protected by Safe pay.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en-GB",
    dir: "ltr",
    categories: ["shopping"],
    shortcuts: [
      { name: "Sell something", short_name: "Sell", url: "/sell", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Messages", url: "/account/messages", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "My listings", short_name: "Listings", url: "/account/listings", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    background_color: colors.page,
    theme_color: colors.primary,
    icons: [...manifestIcons],
  };
}
