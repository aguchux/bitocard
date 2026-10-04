import { brandIcon } from "@bitocard/ui/icon-image";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return brandIcon(180, { fill: 0.68, background: "#ffffff" });
}
