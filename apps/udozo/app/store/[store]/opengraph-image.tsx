import { ImageResponse } from "next/og";
import { ogImageSize } from "@bitocard/ui/og-image";
import { storefront } from "@/lib/store";

export const alt = "A store on Udozo";
export const size = ogImageSize;
export const contentType = "image/png";

/** A store's social preview: its name in its colours, and Udozo's promise (the payment held until the buyer has the item). */
export default async function StoreOpenGraphImage({ params }: { params: Promise<{ store: string }> }) {
  const result = await storefront((await params).store);
  const store = result.ok ? result.data : null;
  const colors = store?.design?.colors;
  const from = colors?.heroFrom ?? "#070f4c";
  const to = colors?.heroTo ?? "#1b2a8a";
  const ink = colors?.heroInk ?? "#ffffff";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: `linear-gradient(135deg, ${from}, ${to})`, color: ink, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05 }}>{store?.name ?? "Udozo store"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700 }}>Shop items from Udozo&apos;s sellers.</div>
          <div style={{ display: "flex", fontSize: 28, opacity: 0.85 }}>Your payment is held by Udozo until you have the item.</div>
        </div>
      </div>
    ),
    ogImageSize,
  );
}
