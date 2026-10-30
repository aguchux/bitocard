import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { ogImageSize, pngRatio } from "@bitocard/ui/og-image";

export const alt = "Udozo – buy and sell near you, protected by Safe pay";
export const size = ogImageSize;
export const contentType = "image/png";

const navy = "#070f4c";
const pink = "#d6136a";

/** Inter 600 and 800 (SIL OFL, shared with every app); the built-in font if they cannot be read. */
async function fonts() {
  const dir = join(process.cwd(), "../../packages/ui/assets/fonts");
  try {
    const [semibold, extrabold] = await Promise.all([readFile(join(dir, "inter-latin-600-normal.woff")), readFile(join(dir, "inter-latin-800-normal.woff"))]);
    return [
      { name: "Inter", data: semibold, weight: 600 as const, style: "normal" as const },
      { name: "Inter", data: extrabold, weight: 800 as const, style: "normal" as const },
    ];
  } catch {
    return undefined;
  }
}

/** Udozo's own social preview: the "u" mark and the name, then what Udozo is (the shared helper draws BitoCard's). */
export default async function OpenGraphImage() {
  const [file, loaded] = await Promise.all([readFile(join(process.cwd(), "public/udozo-mark.png")), fonts()]);
  const mark = `data:image/png;base64,${file.toString("base64")}`;
  const height = 74;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "#ffffff", color: navy, fontFamily: "Inter, sans-serif" }}>
        <div style={{ position: "absolute", right: -160, top: 150, width: 720, height: 560, borderRadius: 400, background: "linear-gradient(110deg, #fdeaf2, #f9c2d9)", transform: "rotate(-25deg)" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 64, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
            <img src={mark} alt="" width={Math.round(height * pngRatio(mark))} height={height} />
            <span>Udozo</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05 }}>Buy and sell near you.</div>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, color: pink }}>Protected by Safe pay.</div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 28, fontWeight: 600, color: "#414f77" }}>Phones · Vehicles · Property · Electronics · Fashion · Jobs</div>
          </div>
        </div>
      </div>
    ),
    { ...ogImageSize, fonts: loaded },
  );
}
