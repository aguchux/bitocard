import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogImageSize = { width: 1200, height: 630 };

type OgFont = { name: string; data: Buffer; weight: 600 | 800; style: "normal" };

/**
 * Inter 600/800 (SIL OFL, packages/ui/assets/fonts). Images render at build time from the app folder,
 * so the path is resolved from process.cwd(). Falls back to the built-in font rather than failing the build.
 */
async function loadFonts(): Promise<OgFont[] | undefined> {
  const dir = join(process.cwd(), "../../packages/ui/assets/fonts");
  try {
    const [semibold, extrabold] = await Promise.all([
      readFile(join(dir, "inter-latin-600-normal.woff")),
      readFile(join(dir, "inter-latin-800-normal.woff")),
    ]);
    return [
      { name: "Inter", data: semibold, weight: 600, style: "normal" },
      { name: "Inter", data: extrabold, weight: 800, style: "normal" },
    ];
  } catch (error) {
    console.warn("[og-image] Inter fonts not found; using the default font.", error);
    return undefined;
  }
}

async function loadLogo() {
  const logo = await readFile(join(process.cwd(), "public/bitocard-logo.png"));
  return `data:image/png;base64,${logo.toString("base64")}`;
}

/** Cropped logo mark, matching the .brand-icon crop used on the sites. */
function LogoMark({ src, size }: { src: string; size: number }) {
  const scaled = Math.round(size * 1.42);
  const offset = Math.round(size * .21);
  return (
    <div style={{ display: "flex", width: size, height: size, overflow: "hidden", position: "relative" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
      <img src={src} alt="" width={scaled} height={scaled} style={{ position: "absolute", left: -offset, top: -offset }} />
    </div>
  );
}

/** Light 1200x630 social preview (storefront). */
export async function brandOgImage({ eyebrow, title, accent, subtitle }: { eyebrow: string; title: string; accent: string; subtitle: string }) {
  const [logoSrc, fonts] = await Promise.all([loadLogo(), loadFonts()]);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "#fcfdff", color: "#070f4c", fontFamily: "Inter, sans-serif" }}>
        <div style={{ position: "absolute", right: -160, top: 150, width: 720, height: 560, borderRadius: 400, background: "linear-gradient(110deg, #ffeaf6, #ffc4e5)", transform: "rotate(-25deg)" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <LogoMark src={logoSrc} size={84} />
            <div style={{ display: "flex", fontSize: 60, fontWeight: 800, letterSpacing: -2 }}>
              <span>Bito</span><span style={{ color: "#ff2382" }}>Card</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignSelf: "flex-start", padding: "10px 22px", borderRadius: 30, background: "#fcecf8", fontSize: 20, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase" }}>{eyebrow}</div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05 }}>{title}</div>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, color: "#ff2382" }}>{accent}</div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 28, fontWeight: 600, color: "#414f77" }}>{subtitle}</div>
          </div>
        </div>
      </div>
    ),
    { ...ogImageSize, fonts },
  );
}

/**
 * Gradient banner 1200x630 social preview, matching the legals PageBanner:
 * logo lockup, breadcrumb trail, eyebrow, title (optional pink accent), subtitle and topic chips.
 */
export async function bannerOgImage({ tagline, crumbs, eyebrow, title, accent, subtitle, chips = [] }: {
  tagline: string; crumbs: string[]; eyebrow: string; title: string; accent?: string; subtitle: string; chips?: string[];
}) {
  const [logoSrc, fonts] = await Promise.all([loadLogo(), loadFonts()]);
  const stacked = Boolean(accent) && title.length + (accent?.length ?? 0) > 26;

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", color: "white", fontFamily: "Inter, sans-serif",
        // Glows are layered into the background (not separate shapes) so they fade out without visible edges.
        backgroundImage: [
          "radial-gradient(circle at 88% 8%, rgba(255,35,130,.45) 0%, rgba(255,35,130,0) 42%)",
          "radial-gradient(circle at 4% 100%, rgba(36,119,255,.25) 0%, rgba(36,119,255,0) 38%)",
          "linear-gradient(118deg, #070f4c 0%, #151a68 48%, #7a1160 88%, #c51065 115%)",
        ].join(", "),
      }}>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", padding: "56px 72px 60px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 76, height: 76, borderRadius: 20, background: "white" }}>
              <LogoMark src={logoSrc} size={58} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 44, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1 }}>
                <span>Bito</span><span style={{ color: "#ffb3d6" }}>Card</span>
              </div>
              <div style={{ display: "flex", marginTop: 6, fontSize: 20, fontWeight: 600, color: "#c9d1ee" }}>{tagline}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 22, fontWeight: 600, color: "#b9c2e6" }}>
              {crumbs.map((crumb, index) => (
                <div key={crumb} style={{ display: "flex", alignItems: "center", gap: 12, color: index === crumbs.length - 1 ? "white" : "#b9c2e6" }}>
                  {index > 0 ? <span style={{ color: "#8591c2" }}>›</span> : null}
                  <span>{crumb}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignSelf: "flex-start", marginTop: 22, padding: "9px 20px", borderRadius: 30, background: "rgba(255,255,255,.14)", fontSize: 18, fontWeight: 800, letterSpacing: 3.5, textTransform: "uppercase" }}>{eyebrow}</div>
            {/* Short title + accent share a line; longer ones stack so the accent never wraps awkwardly. */}
            <div style={{ display: "flex", flexDirection: stacked ? "column" : "row", marginTop: 18, fontSize: stacked ? 72 : 80, fontWeight: 800, letterSpacing: -3, lineHeight: 1.04 }}>
              <span>{title}</span>{accent ? <span style={{ marginLeft: stacked ? 0 : 22, color: "#ffb3d6" }}>{accent}</span> : null}
            </div>
            <div style={{ display: "flex", marginTop: 18, maxWidth: 940, fontSize: 28, fontWeight: 600, lineHeight: 1.35, color: "#d7dcf2" }}>{subtitle}</div>
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            {chips.map(chip => (
              <div key={chip} style={{ display: "flex", padding: "8px 18px", borderRadius: 30, border: "2px solid rgba(255,255,255,.28)", fontSize: 20, fontWeight: 600, color: "#eef1fb" }}>{chip}</div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...ogImageSize, fonts },
  );
}
