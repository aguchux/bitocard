import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Square favicon / apple-touch icon from the app's public/bitocard-logo.png, cropped like .brand-icon.
 * Use from an app's icon.tsx or apple-icon.tsx; `padding` leaves breathing room on iOS home screens.
 */
export async function brandIcon(size: number, { padding = 0, background = "transparent" }: { padding?: number; background?: string } = {}) {
  const logo = await readFile(join(process.cwd(), "public/bitocard-logo.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
  const inner = size - padding * 2;
  const scaled = Math.round(inner * 1.42);
  const offset = Math.round(inner * .21);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background }}>
        <div style={{ display: "flex", width: inner, height: inner, overflow: "hidden", position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
          <img src={src} alt="" width={scaled} height={scaled} style={{ position: "absolute", left: -offset, top: -offset }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
