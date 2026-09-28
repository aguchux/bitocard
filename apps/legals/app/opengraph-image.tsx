import { brandOgImage, ogImageSize } from "@bitocard/ui/og-image";

export const alt = "BitoCard Legals & Compliance – privacy, terms and cookies for every region";
export const size = ogImageSize;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return brandOgImage({ eyebrow: "Legals & Compliance", title: "Plain-English legals.", accent: "For every region.", subtitle: "Privacy · Terms · Cookies · Europe, the Americas, Africa and Asia" });
}
