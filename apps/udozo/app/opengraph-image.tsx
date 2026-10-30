import { brandOgImage, ogImageSize } from "@bitocard/ui/og-image";

export const alt = "BitoCard Shop – buy and sell near you, protected by Safe pay";
export const size = ogImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return brandOgImage({ eyebrow: "BitoCard Shop", title: "Buy and sell near you.", accent: "Protected by Safe pay.", subtitle: "Phones · Vehicles · Property · Electronics · Fashion · Jobs" });
}
