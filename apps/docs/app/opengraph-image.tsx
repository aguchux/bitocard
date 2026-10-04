import { brandOgImage, ogImageSize } from "@bitocard/ui/og-image";

export const alt = "BitoCard Documentation – guides and the API reference";
export const size = ogImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return brandOgImage({ eyebrow: "Documentation", title: "Build with BitoCard.", accent: "One API for everything.", subtitle: "Guides · API reference · Webhooks · Sandbox" });
}
