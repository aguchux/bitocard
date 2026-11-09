import { ogImageSize } from "@bitocard/ui/og-image";
import { marketFor } from "@/lib/api";
import { textCard } from "@/lib/og";

export const alt = "Udozo: buy and sell near you, protected by UdozoPay";
export const size = ogImageSize;
export const contentType = "image/png";

/** A market's social preview (also its places and searches): Udozo in that country. */
export default async function MarketImage({ params }: { params: Promise<{ cc: string }> }) {
  const { cc } = await params;
  const market = await marketFor(cc);
  return textCard({ eyebrow: market ? `Udozo ${market.name}` : "Udozo", title: "Buy and sell near you, protected by UdozoPay.", line: "Phones · Electronics · Vehicles · Property · Fashion · Home" });
}
