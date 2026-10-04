import { brandOgImage, ogImageSize } from "@bitocard/ui/og-image";

export const alt = "BitoCard – gift cards, airtime, data, bills and more";
export const size = ogImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return brandOgImage({ eyebrow: "Digital marketplace", title: "One marketplace.", accent: "More ways to pay.", subtitle: "Gift cards · Airtime · Data · Bills · eSIMs · Software" });
}
