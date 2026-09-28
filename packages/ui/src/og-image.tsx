import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogImageSize = { width: 1200, height: 630 };

/**
 * Branded 1200x630 social preview used by each app's opengraph-image.tsx.
 * Reads the logo from the calling app's public/ folder at build time.
 */
export async function brandOgImage({ eyebrow, title, accent, subtitle }: { eyebrow: string; title: string; accent: string; subtitle: string }) {
  const logo = await readFile(join(process.cwd(), "public/bitocard-logo.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "#fcfdff", color: "#070f4c", fontFamily: "sans-serif" }}>
        <div style={{ position: "absolute", right: -160, top: 150, width: 720, height: 560, borderRadius: 400, background: "linear-gradient(110deg, #ffeaf6, #ffc4e5)", transform: "rotate(-25deg)" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", width: 84, height: 84, overflow: "hidden", position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
              <img src={logoSrc} alt="" width={120} height={120} style={{ position: "absolute", left: -18, top: -18 }} />
            </div>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 800, letterSpacing: -2 }}>
              <span>Bito</span><span style={{ color: "#ff2382" }}>Card</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignSelf: "flex-start", padding: "10px 22px", borderRadius: 30, background: "#fcecf8", fontSize: 22, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>{eyebrow}</div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 78, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05 }}>{title}</div>
            <div style={{ display: "flex", fontSize: 78, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, color: "#ff2382" }}>{accent}</div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 30, color: "#414f77" }}>{subtitle}</div>
          </div>
        </div>
      </div>
    ),
    ogImageSize,
  );
}
