import type { MetadataRoute } from "next";
import { brand, manifestIcons } from "@bitocard/ui/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitoCard – Gift cards, airtime, data and bills",
    short_name: brand.name,
    description: "Shop gift cards, top up mobile, pay bills and explore digital essentials, delivered digitally.",
    start_url: "/",
    display: "browser",
    background_color: "#fcfdff",
    theme_color: "#fcfdff",
    icons: [...manifestIcons],
  };
}
