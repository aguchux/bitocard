import { brandOgImage, ogImageSize } from "@bitocard/ui/og-image";

export const alt = "BitoCard – your digital store for gift cards, airtime and data";
export const size = ogImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return brandOgImage({ eyebrow: "For resellers", title: "Your digital store.", accent: "Ready in minutes.", subtitle: "Gift cards · Airtime · Data — under your own brand" });
}
