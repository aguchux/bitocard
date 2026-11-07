import "server-only";
import { createHmac } from "node:crypto";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { apiUrl } from "./api";
import { ogFonts } from "./og";

/**
 * Watermarked listing photos (docs/UDOZO_WATERMARK_PLAN.md): udozo.com serves every listing photo at
 * `/img/<media id>.jpg?m=<mark version>[&w=480|960|1600]` (on a reseller's store, its own address with its mark). The
 * original is read from Udozo's API with this server's signature, resized (never larger), and the mark drawn in: the
 * text in the bottom-right corner, and large and faint across the middle the seller's `@username` once they chose one
 * (udozo.com only; `o` in the address), else the same text, from Inter (never the server's fonts). A new text or
 * username has a new address, so every copy is cached for good under its address.
 */

/** Widths a photo is resized to; any other `w` is the original's size. */
export const photoWidths = [480, 960, 1600] as const;
export type PhotoWidth = (typeof photoWidths)[number];

/** Copies never change under their address (it carries the mark's version). */
export const photoCacheControl = "public, max-age=31536000, immutable";
/** Failures are never cached: the next request tries again. */
export const failureCacheControl = "no-store";

/** The header the API reads this server's signature from, for a photo's original. */
export const mediaSignatureHeader = "udozo-media-signature";

const filePattern = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg$/;

/** The media ID an address names (`<uuid>.jpg`, lower case), or null for anything else. */
export function photoIdOf(file: string): string | null {
  return filePattern.exec(file)?.[1] ?? null;
}

/** The width asked for when it is one of the three, else null (the original's size). */
export function photoWidthOf(raw: string | null): PhotoWidth | null {
  const width = Number(raw);
  return raw !== null && (photoWidths as readonly number[]).includes(width) ? (width as PhotoWidth) : null;
}

/** `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<id>" keyed with STORE_SERVER_SECRET>`, as the API checks it. */
export function signMedia(secret: string, id: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${id}`).digest("hex")}`;
}

export type Mark = { text: string; version: string };

/** The mark to draw: a store's own (by its subdomain) when Udozo allows it, else Udozo's. Cached a minute; null when the API cannot answer. */
export async function markFor(store: string | null): Promise<Mark | null> {
  try {
    const res = await fetch(apiUrl(`/v1/classifieds/watermark${store ? `?store=${encodeURIComponent(store)}` : ""}`), { next: { revalidate: 60, tags: ["watermark"] }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { text?: unknown; version?: unknown };
    return typeof body.text === "string" && typeof body.version === "string" ? { text: body.text, version: body.version } : null;
  } catch {
    return null;
  }
}

/** The original's header naming its seller's username (empty: none chosen yet). */
export const photoOwnerHeader = "udozo-photo-owner";

/** A username as Udozo allows them (3 to 24 lower-case letters, digits and underscores, starting with a letter), else "". */
export const ownerOf = (raw: string | null | undefined) => (raw && /^[a-z][a-z0-9_]{2,23}$/.test(raw) ? raw : "");

/**
 * A photo's original from the API (signed) with its seller's username (`owner`, "" when none), "missing" when the API
 * says there is none, null when it cannot answer.
 */
export async function originalFor(id: string, now = Date.now()): Promise<{ bytes: Buffer; owner: string } | "missing" | null> {
  const secret = process.env.STORE_SERVER_SECRET;
  if (!secret) return null;
  try {
    const res = await fetch(apiUrl(`/v1/classifieds/media/${id}/original`), { cache: "no-store", headers: { [mediaSignatureHeader]: signMedia(secret, id, now) }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return "missing";
    if (!res.ok) return null;
    return { bytes: Buffer.from(await res.arrayBuffer()), owner: ownerOf(res.headers.get(photoOwnerHeader)) };
  } catch {
    return null;
  }
}

/** Whose photo it is (signed, never cached): the seller's username, "" before they choose one; "missing" or null as above. */
export async function ownerFor(id: string, now = Date.now()): Promise<string | "missing" | null> {
  const secret = process.env.STORE_SERVER_SECRET;
  if (!secret) return null;
  try {
    const res = await fetch(apiUrl(`/v1/classifieds/media/${id}/owner`), { cache: "no-store", headers: { [mediaSignatureHeader]: signMedia(secret, id, now) }, signal: AbortSignal.timeout(4000) });
    if (res.status === 404) return "missing";
    if (!res.ok) return null;
    const body = (await res.json()) as { username?: unknown };
    return ownerOf(typeof body.username === "string" ? body.username : null);
  } catch {
    return null;
  }
}

/** What goes across a photo's middle: the seller's `@username` once they chose one, else the mark's own text. */
export const centreText = (mark: string, owner: string) => (owner ? `@${owner}` : mark);

/**
 * The mark as a transparent PNG the size of the photo: `text` in the corner, and `middle` (the seller's `@username`, else
 * the same text) faint and slightly turned across the middle.
 */
export async function markOverlay(width: number, height: number, text: string, middle = text): Promise<Buffer> {
  const corner = Math.max(11, Math.round(width * 0.035));
  const pad = Math.max(8, Math.round(width * 0.025));
  // The centre text spans about two thirds of the photo's width, never taller than a fifth of its height.
  const centre = Math.max(14, Math.round(Math.min((width * 0.66) / Math.max(middle.length * 0.56, 1), height * 0.2)));
  const response = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: centre, fontWeight: 800, color: "#ffffff", opacity: 0.16, transform: "rotate(-18deg)", textShadow: "0 0 8px rgba(0,0,0,0.9)", whiteSpace: "nowrap", letterSpacing: -0.5 }}>{middle}</div>
        </div>
        <div style={{ position: "absolute", right: pad, bottom: pad, display: "flex", fontSize: corner, fontWeight: 600, color: "#ffffff", textShadow: "0 1px 4px rgba(0,0,0,0.75)", whiteSpace: "nowrap" }}>{text}</div>
      </div>
    ),
    { width, height, fonts: await ogFonts() },
  );
  return Buffer.from(await response.arrayBuffer());
}

/** The photo resized (never larger, turned upright), the mark drawn in (`middle` across it), as a progressive JPEG. */
export async function watermarkPhoto(original: Buffer, text: string, width: PhotoWidth | null, middle = text): Promise<Buffer> {
  let image = sharp(original, { failOn: "none" }).rotate();
  if (width) image = image.resize({ width, withoutEnlargement: true });
  const { data, info } = await image.flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
  const overlay = await markOverlay(info.width, info.height, text, middle);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();
}

const failure = (status: number) => new Response(null, { status, headers: { "Cache-Control": failureCacheControl } });

/**
 * The photo's address with the current mark's version, on udozo.com its seller's username (`o`, empty when they have
 * none, so the address says it was looked up), and the width.
 */
const photoPath = (id: string, version: string, owner: string | null, width: PhotoWidth | null) =>
  `/img/${id}.jpg?m=${encodeURIComponent(version)}${owner === null ? "" : `&o=${owner}`}${width ? `&w=${width}` : ""}`;

const redirect = (to: string) => new Response(null, { status: 307, headers: { Location: to, "Cache-Control": "public, max-age=60" } });

/**
 * The image route's answer for `file` with its query, on udozo.com (`store` null) or a reseller's store (its subdomain):
 * 404 for an address that is not a photo, a redirect to the current address when `m` is another mark's (a page cached
 * from before a change) or, on udozo.com, when `o` is not the seller's username (none in the address the API gives, or
 * an old one), 502 when the API cannot answer (never cached), else the watermarked JPEG, cached for good. On udozo.com
 * a seller with a username has `@username` across the middle and the mark's text in the corner; the username is in the
 * address so a new one gets new copies, and is checked against the original's own before it is drawn.
 */
export async function servePhoto(file: string, search: URLSearchParams, store: string | null): Promise<Response> {
  const id = photoIdOf(file);
  if (!id) return failure(404);
  const width = photoWidthOf(search.get("w"));
  const mark = await markFor(store);
  if (!mark) return failure(502);
  const given = ownerOf(search.get("o"));
  if (search.get("m") !== mark.version) return redirect(photoPath(id, mark.version, store || !search.has("o") ? null : given, width));
  if (!store && !search.has("o")) {
    // The API's addresses carry no username: find it once (cached a minute with the redirect), then the right address.
    const owner = await ownerFor(id);
    if (owner === "missing") return failure(404);
    if (owner === null) return failure(502);
    return redirect(photoPath(id, mark.version, owner, width));
  }
  const original = await originalFor(id);
  if (original === "missing") return failure(404);
  if (!original) return failure(502);
  // Never draw a name the photo's seller does not have: an address naming another goes to theirs.
  if (!store && original.owner !== given) return redirect(photoPath(id, mark.version, original.owner, width));
  let bytes: Buffer;
  try {
    bytes = await watermarkPhoto(original.bytes, mark.text, width, store ? mark.text : centreText(mark.text, original.owner));
  } catch {
    return failure(502);
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.length), "Cache-Control": photoCacheControl } });
}
