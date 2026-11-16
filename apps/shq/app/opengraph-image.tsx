import { brandOgImage, ogImageSize } from "@bitocard/ui/og-image";

export const alt = "BitoCard SHQ – open your own digital store for gift cards, airtime and data";
export const size = ogImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return brandOgImage({ eyebrow: "BitoCard SHQ", title: "Your digital store.", accent: "Set up in minutes.", subtitle: "Gift cards · Airtime · Data · Bills — under your own brand" });
}
