import type { MetadataRoute } from "next";

/**
 * Lets SHQ be added to a phone's Home Screen as an app (standalone), which iPhone and iPad need before they show
 * push notifications. The icons are the "b" mark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitoCard SHQ",
    short_name: "SHQ",
    description: "Seller Head Quarters: run your BitoCard store, orders, wallet and team.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#070f4c",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/bitocard-logo.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
    ],
  };
}
