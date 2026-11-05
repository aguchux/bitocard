import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { ogImageSize, pngRatio } from "@bitocard/ui/og-image";

/**
 * Udozo's social previews (Open Graph and X cards, 1200 × 630): the site's, each market's and category's, and each
 * listing's with its own photo and price. Drawn on the server with Inter (SIL OFL, shared with every app); a preview
 * never fails: a photo that cannot be read leaves the card without it.
 */

/** Udozo's logo blue, for headings, and the brighter blue of its default theme, for prices and highlights. */
export const navy = "#185174";
export const pink = "#0e7cc0";
const slate = "#5f6b73";

/** Inter 600 and 800; the built-in font if they cannot be read. */
export async function ogFonts() {
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

/** Udozo's "u" mark as a data address. */
export async function ogMark() {
  return `data:image/png;base64,${(await readFile(join(process.cwd(), "public/udozo-mark.png"))).toString("base64")}`;
}

/**
 * Money as the card writes it: the currency's code, then the amount ("NGN 250,000"). Inter's Latin set has no ₦ or ₵,
 * and a code is never mistaken for another currency.
 */
export function ogMoney(minor: number, currency: string) {
  const value = minor / 100;
  return `${currency} ${value.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Text cut to fit a line or two, at a word where it can be. */
export function ogClip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** What a photo's first bytes say it is: only JPEG and PNG are drawn (the renderer reads no WebP or AVIF). */
export function photoType(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

/** A listing's photo for its card, as a data address, or null: only https, at most 6 MB, within 4 seconds. */
export async function ogPhoto(url: string | null | undefined): Promise<string | null> {
  if (!url || !url.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000), next: { revalidate: 3600 } });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 6 * 1024 * 1024) return null;
    const type = photoType(bytes);
    return type ? `data:${type};base64,${Buffer.from(bytes).toString("base64")}` : null;
  } catch {
    return null;
  }
}

function Lockup({ mark, size = 52 }: { mark: string; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: size * 0.86, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1, color: navy }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
      <img src={mark} alt="" width={Math.round(size * pngRatio(mark))} height={size} />
      <span>Udozo</span>
    </div>
  );
}

function Badge({ children, tone = "mint" }: { children: React.ReactNode; tone?: "mint" | "pink" | "navy" }) {
  const colours = { mint: ["#e6f7ef", "#0b6b45"], pink: ["#e4f1f9", pink], navy: ["#e8eef2", navy] }[tone];
  return <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: colours[0], color: colours[1], fontSize: 24, fontWeight: 600 }}>{children}</div>;
}

/** A listing's card: its photo on the left, then what it is, its price, where, and Safe pay. */
export async function listingCard(listing: { title: string; price: string; place: string; category: string; condition: string | null; sold: boolean; photo: string | null }) {
  const [fonts, mark] = await Promise.all([ogFonts(), ogMark()]);
  const text = (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, padding: "52px 56px", minWidth: 0 }}>
      <Lockup mark={mark} size={44} />
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: slate, textTransform: "uppercase", letterSpacing: 1 }}>{ogClip(listing.category, 34)}</div>
        <div style={{ display: "flex", fontSize: listing.photo ? 50 : 62, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1, color: navy }}>{ogClip(listing.title, listing.photo ? 64 : 80)}</div>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 800, letterSpacing: -1, color: listing.sold ? slate : pink, textDecoration: listing.sold && listing.price !== "Price on request" ? "line-through" : "none" }}>{listing.price}</div>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 600, color: slate }}>{ogClip(listing.place, 46)}</div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {listing.sold ? <Badge tone="navy">Sold</Badge> : <Badge>Safe pay protected</Badge>}
        {listing.condition ? <Badge tone="pink">{listing.condition}</Badge> : null}
      </div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", fontFamily: "Inter, sans-serif" }}>
        {listing.photo ? (
          <div style={{ display: "flex", width: 520, height: "100%", background: "#f3f4f8" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
            <img src={listing.photo} alt="" width={520} height={630} style={{ objectFit: "cover", width: 520, height: 630 }} />
          </div>
        ) : null}
        {text}
      </div>
    ),
    { ...ogImageSize, fonts },
  );
}

/** A market's or category's card: an eyebrow, the headline, a line beneath, on Udozo's grey-blue sweep (the logo's disc). */
export async function textCard({ eyebrow, title, line }: { eyebrow: string; title: string; line: string }) {
  const [fonts, mark] = await Promise.all([ogFonts(), ogMark()]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "#ffffff", color: navy, fontFamily: "Inter, sans-serif" }}>
        <div style={{ position: "absolute", right: -160, top: 150, width: 720, height: 560, borderRadius: 400, background: "linear-gradient(110deg, #eef2f4, #cfdde6)", transform: "rotate(-25deg)" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", width: "100%" }}>
          <Lockup mark={mark} size={60} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: pink, textTransform: "uppercase", letterSpacing: 1.5 }}>{ogClip(eyebrow, 40)}</div>
            <div style={{ display: "flex", marginTop: 12, fontSize: 74, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05, maxWidth: 980 }}>{ogClip(title, 56)}</div>
            <div style={{ display: "flex", marginTop: 24, fontSize: 30, fontWeight: 600, color: slate }}>{ogClip(line, 70)}</div>
          </div>
        </div>
      </div>
    ),
    { ...ogImageSize, fonts },
  );
}
