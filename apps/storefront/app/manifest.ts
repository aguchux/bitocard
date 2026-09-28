import type { MetadataRoute } from "next";
import { brand } from "@bitocard/ui/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitoCard – Digital store in 5 minutes",
    short_name: brand.name,
    description: "Build your own branded store for digital gift cards, mobile airtime and data.",
    start_url: "/",
    display: "browser",
    background_color: "#fcfdff",
    theme_color: "#fcfdff",
    icons: [{ src: brand.logo, sizes: "1280x1280", type: "image/png", purpose: "any" }],
  };
}
