import "server-only";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { ogImageSize } from "@bitocard/ui/og-image";
import type { ShopSearch, ShopSellerProfile } from "@bitocard/api-client/classifieds";
import { shopApi } from "./api";
import { Lockup, navy, ogClip, ogFonts, ogMark, ogMoney, pink, slate } from "./og";
import { isSellerKey, placesText, sinceText } from "./seller";

/**
 * A seller page's share images (`/seller-card/<username or handle>.jpg` and `.gif`), udozo.com's only: the still card, a collage of
 * up to four of their photos beside who they are, and an animated GIF that opens on the same card and then shows a few
 * of their listings, chosen at random on each request (the CDN keeps a pick for hours, so it changes a few times a day).
 * WhatsApp shows no preview for heavy images and only ever the first frame, so the GIF stays within `gifBudget` and its
 * first frame is the card. Drawn with Inter (never the server's fonts) and finished by sharp.
 */

export type SellerCardKind = "jpg" | "gif";

/** The still card's size (Open Graph's 1200 × 630) and the GIF's, largest first: never smaller than the last. */
export const cardSize = ogImageSize;
export const gifSizes = [
  { width: 800, height: 420 },
  { width: 600, height: 315 },
] as const;
/** The GIF's ceiling in bytes, and the still card's. */
export const gifBudget = 300 * 1024;
export const jpegBudget = 250 * 1024;
/** Listings the GIF shows after the card, and the photos the collage draws. */
export const gifListings = 5;
export const collagePhotos = 4;
/** How long the card stays, then each listing. */
export const cardDelay = 2500;
export const frameDelay = 1800;

/** Kept for a few hours by the CDN (a fresh random pick each time it is redrawn), served while it is redrawn. */
export const cardCacheControl = "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400";
export const failureCacheControl = "no-store";

const filePattern = /^([a-z0-9_]+)\.(jpg|gif)$/;

/** The seller (their username or handle, as the page's address names them) and kind an address names (`chinedu_o.gif`, `a1b2c3d4e5.gif`), or null for anything else. */
export function readSellerCard(file: string): { key: string; kind: SellerCardKind } | null {
  const match = filePattern.exec(file);
  return match && isSellerKey(match[1]!) ? { key: match[1]!, kind: match[2] as SellerCardKind } : null;
}

/** The share images' addresses, from the site's own origin, named as the seller's page is (`sellerSlug`). */
export const sellerCardUrl = (origin: string, slug: string, kind: SellerCardKind) => new URL(`/seller-card/${slug}.${kind}`, origin).href;

/** Up to two initials from a public name ("Chinedu O." is CO). */
export function initialsOf(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  return (words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}` : words[0]![0]!).toUpperCase();
}

/** A listing the GIF can show: its photo, title and price as the card writes them. */
export type CardListing = { photo: string; title: string; price: string };

export type SellerCardData = { profile: ShopSellerProfile; listings: CardListing[] };

/**
 * The seller and up to 24 of their live listings with a photo (https only). "missing" for a username or handle the API
 * does not know (or a suspended account), null when the API cannot answer (never cached). An old username still in its
 * 90 days answers its seller, so a card shared before a change keeps working.
 */
export async function sellerCardData(key: string): Promise<SellerCardData | "missing" | null> {
  const profile = await shopApi<ShopSellerProfile>(`/v1/classifieds/sellers/${key}`);
  if (!profile.ok) return profile.status >= 400 && profile.status < 500 ? "missing" : null;
  const query = new URLSearchParams({ country: profile.data.country, seller: profile.data.handle, sort: "newest", limit: "24" });
  const search = await shopApi<ShopSearch>(`/v1/classifieds/listings?${query}`);
  if (!search.ok) return null;
  const listings = search.data.data.flatMap(card => {
    const photo = card.cover?.url;
    if (!photo?.startsWith("https://")) return [];
    const price = card.price.kind === "on_request" || card.price.amount === null ? "Price on request" : ogMoney(card.price.amount, card.price.currency);
    return [{ photo, title: card.title, price }];
  });
  return { profile: profile.data, listings };
}

/** Up to `count` items picked at random (`random` as Math.random), in their picked order. */
export function pickRandom<T>(items: T[], count: number, random = Math.random): T[] {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [pool[index], pool[other]] = [pool[other]!, pool[index]!];
  }
  return pool.slice(0, count);
}

/** A photo's bytes, or null: only https, at most 6 MB, within 4 seconds; a photo that fails is left out, never the image. */
export async function photoBytes(url: string | null | undefined): Promise<Buffer | null> {
  if (!url?.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > 6 * 1024 * 1024) return null;
    // Only what sharp can read (it reads JPEG, PNG, WebP and AVIF; the card's renderer only JPEG and PNG).
    await sharp(bytes, { failOn: "none" }).metadata();
    return bytes;
  } catch {
    return null;
  }
}

/** A photo cut to fill a box (centred, turned upright), as a PNG for the renderer or the GIF. */
const cover = (bytes: Buffer, width: number, height: number) => sharp(bytes, { failOn: "none" }).rotate().resize(width, height, { fit: "cover" }).flatten({ background: "#ffffff" });

/** Where each of up to four photos sits in the collage (one large and the rest beside it, or two halves, or one). */
export function collageTiles(count: number, width: number, height: number, gap = 6) {
  if (count <= 1) return [{ left: 0, top: 0, width, height }];
  if (count === 2) {
    const half = Math.floor((width - gap) / 2);
    return [
      { left: 0, top: 0, width: half, height },
      { left: half + gap, top: 0, width: width - half - gap, height },
    ];
  }
  const big = Math.round(width * (2 / 3));
  const side = width - big - gap;
  const rows = count - 1;
  const each = Math.floor((height - gap * (rows - 1)) / rows);
  return [{ left: 0, top: 0, width: big, height }, ...Array.from({ length: rows }, (_, row) => ({ left: big + gap, top: row * (each + gap), width: side, height: row === rows - 1 ? height - row * (each + gap) : each }))];
}

/** The collage as a JPEG data address, or null without photos. */
async function collage(photos: Buffer[], width: number, height: number): Promise<string | null> {
  if (!photos.length) return null;
  const tiles = collageTiles(photos.length, width, height);
  const parts = await Promise.all(photos.map(async (photo, index) => ({ input: await cover(photo, tiles[index]!.width, tiles[index]!.height).png().toBuffer(), left: tiles[index]!.left, top: tiles[index]!.top })));
  const image = await sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).composite(parts).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${image.toString("base64")}`;
}

/** The seller's photo, round, as a JPEG data address (or null for their initials). */
async function avatar(url: string | null | undefined): Promise<string | null> {
  const bytes = await photoBytes(url);
  if (!bytes) return null;
  try {
    return `data:image/jpeg;base64,${(await cover(bytes, 240, 240).jpeg({ quality: 88 }).toBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

function Face({ name, photo, size, ring }: { name: string; photo: string | null; size: number; ring: string }) {
  return (
    <div style={{ display: "flex", width: size, height: size, borderRadius: size, overflow: "hidden", alignItems: "center", justifyContent: "center", background: navy, color: "#ffffff", fontSize: size * 0.4, fontWeight: 800, letterSpacing: -1, border: `4px solid ${ring}`, flexShrink: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
      {photo ? <img src={photo} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "cover" }} /> : initialsOf(name)}
    </div>
  );
}

/**
 * The still card (1200 × 630) as a PNG: up to four of the seller's photos on the left (with none, their photo or
 * initials on Udozo's blue), and on the right Udozo's mark, the seller, how many listings, since when, what and where.
 */
export async function stillCard(profile: ShopSellerProfile, photos: Buffer[]): Promise<Buffer> {
  const left = 660;
  const [fonts, mark, picture, face] = await Promise.all([ogFonts(), ogMark(), collage(photos.slice(0, collagePhotos), left, cardSize.height), avatar(profile.avatar_url)]);
  const where = placesText(profile.states);
  const count = profile.active_listings;
  const response = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ffffff", fontFamily: "Inter, sans-serif", color: navy }}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements
          <img src={picture} alt="" width={left} height={cardSize.height} style={{ width: left, height: cardSize.height }} />
        ) : (
          <div style={{ display: "flex", position: "relative", overflow: "hidden", width: left, height: cardSize.height, alignItems: "center", justifyContent: "center", background: `linear-gradient(135deg, #10212e, ${navy} 55%, ${pink})` }}>
            <div style={{ position: "absolute", right: -90, top: -110, width: 380, height: 380, borderRadius: 380, background: "rgba(255,255,255,0.10)" }} />
            <div style={{ position: "absolute", left: 70, bottom: -140, width: 320, height: 320, borderRadius: 320, background: "rgba(255,255,255,0.08)" }} />
            <Face name={profile.name} photo={face} size={260} ring="rgba(255,255,255,0.85)" />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0, padding: "48px 48px 44px" }}>
          <Lockup mark={mark} size={40} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {picture ? <Face name={profile.name} photo={face} size={104} ring="#e4f1f9" /> : null}
            <div style={{ display: "flex", fontSize: 50, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05 }}>{ogClip(profile.name, 22)}</div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: pink }}>{`${count.toLocaleString("en-GB")} listing${count === 1 ? "" : "s"} for sale`}</div>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: slate }}>{`On Udozo since ${sinceText(profile.member_since)}`}</div>
            {where ? <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: slate }}>{ogClip(`Sells in ${where}`, 34)}</div> : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {profile.categories.slice(0, 3).map(category => (
              <div key={category.slug} style={{ display: "flex", padding: "7px 16px", borderRadius: 999, background: "#e4f1f9", color: navy, fontSize: 21, fontWeight: 600 }}>
                {ogClip(category.name, 20)}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...cardSize, fonts },
  );
  return Buffer.from(await response.arrayBuffer());
}

/** The still card as a progressive JPEG, its quality lowered until it is within `jpegBudget`. */
export async function cardJpeg(card: Buffer): Promise<Buffer> {
  let bytes = Buffer.alloc(0);
  for (const quality of [82, 74, 66, 58]) {
    bytes = await sharp(card).flatten({ background: "#ffffff" }).jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer();
    if (bytes.length <= jpegBudget) break;
  }
  return bytes;
}

/** A listing's band over its photo (transparent elsewhere): Udozo's mark, then the title, price and seller. */
async function band(listing: CardListing, seller: string, width: number, height: number): Promise<Buffer> {
  const scale = width / gifSizes[0].width;
  const [fonts, mark] = await Promise.all([ogFonts(), ogMark()]);
  const px = (value: number) => Math.round(value * scale);
  const response = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", fontFamily: "Inter, sans-serif" }}>
        <div style={{ display: "flex", padding: `${px(18)}px ${px(20)}px` }}>
          <div style={{ display: "flex", padding: `${px(7)}px ${px(14)}px`, borderRadius: 999, background: "#ffffff" }}>
            <Lockup mark={mark} size={px(26)} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: px(6), padding: `${px(64)}px ${px(28)}px ${px(22)}px`, background: "linear-gradient(180deg, rgba(16,33,46,0), rgba(16,33,46,0.82) 45%, rgba(16,33,46,0.92))", color: "#ffffff" }}>
          <div style={{ display: "flex", fontSize: px(32), fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.1 }}>{ogClip(listing.title, 46)}</div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: px(16) }}>
            <div style={{ display: "flex", fontSize: px(30), fontWeight: 800, color: "#9fd4f5" }}>{listing.price}</div>
            <div style={{ display: "flex", fontSize: px(20), fontWeight: 600, color: "#dbe7ee" }}>{ogClip(`Sold by ${seller}`, 30)}</div>
          </div>
        </div>
      </div>
    ),
    { width, height, fonts },
  );
  return Buffer.from(await response.arrayBuffer());
}

/** A listing's frame: its photo filling the frame with the band drawn over it. */
async function listingFrame(photo: Buffer, listing: CardListing, seller: string, width: number, height: number): Promise<Buffer> {
  const overlay = await band(listing, seller, width, height);
  return cover(photo, width, height).composite([{ input: overlay, top: 0, left: 0 }]).png({ compressionLevel: 1 }).toBuffer();
}

type GifLevel = { width: number; height: number; colours: number; least: number };

const gifOptions = (colours: number) => ({ colours, dither: colours > 16 ? 1 : 0.5, effort: 4, loop: 0 });

/** Frames as an animated GIF (or a still one for a single frame), the card first and longest. */
export async function encodeGif(frames: Buffer[], colours: number): Promise<Buffer> {
  const delay = frames.map((_, index) => (index ? frameDelay : cardDelay));
  if (frames.length === 1) return sharp(frames[0]).gif(gifOptions(colours)).toBuffer();
  return sharp(frames, { join: { animated: true } }).gif({ ...gifOptions(colours), delay }).toBuffer();
}

/**
 * The animated card within `gifBudget`. Each step is tried in turn: 800 × 420 with every frame in about 96 colours, then
 * in 16 (libvips writes anything above 16 colours with an 8-bit palette, so 16 is the real step down), then fewer
 * listings, then 600 × 315 the same way down to the card alone (always well within budget). Each frame's own size is
 * measured first, so only a step that should fit is encoded whole.
 */
export async function sellerGif(card: Buffer, listings: Array<{ listing: CardListing; photo: Buffer }>, seller: string): Promise<Buffer> {
  const frameSets = new Map<number, Promise<Buffer[]>>();
  const framesAt = (width: number, height: number) => {
    if (!frameSets.has(width)) {
      frameSets.set(
        width,
        Promise.all([sharp(card).resize(width, height).png({ compressionLevel: 1 }).toBuffer(), ...listings.map(({ listing, photo }) => listingFrame(photo, listing, seller, width, height).catch(() => null))]).then(frames => frames.filter((frame): frame is Buffer => frame !== null)),
      );
    }
    return frameSets.get(width)!;
  };
  const levels: GifLevel[] = [
    { ...gifSizes[0], colours: 96, least: Infinity },
    { ...gifSizes[0], colours: 16, least: 2 },
    { ...gifSizes[1], colours: 96, least: Infinity },
    { ...gifSizes[1], colours: 16, least: 1 },
  ];
  let last: Buffer | null = null;
  for (const level of levels) {
    const frames = await framesAt(level.width, level.height);
    const sizes = await Promise.all(frames.map(async frame => (await encodeGif([frame], level.colours)).length));
    // As many frames as fit (the card first), with a little room for the animation's own bytes.
    let fit = 0;
    for (let total = 0; fit < frames.length && total + sizes[fit]! <= gifBudget * 0.95; fit += 1) total += sizes[fit]!;
    const least = Math.min(level.least, frames.length);
    for (let count = fit; count >= least && count >= 1; count -= 1) {
      last = await encodeGif(frames.slice(0, count), level.colours);
      if (last.length <= gifBudget) return last;
    }
  }
  // Never reached in practice (the card alone at 600 × 315 in 16 colours is far smaller): the smallest tried.
  return last ?? encodeGif([await sharp(card).resize(gifSizes[1].width, gifSizes[1].height).png().toBuffer()], 16);
}

/** The images for a seller: the still card, and the GIF's listings with their photos (only when there are two or more). */
async function render(data: SellerCardData, kind: SellerCardKind, random: () => number): Promise<Buffer> {
  const collageListings = data.listings.slice(0, collagePhotos);
  const shown = kind === "gif" && data.listings.length >= 2 ? pickRandom(data.listings, gifListings, random) : [];
  // Every photo once, all at the same time.
  const urls = [...new Set([...collageListings, ...shown].map(listing => listing.photo))];
  const fetched = new Map(await Promise.all(urls.map(async url => [url, await photoBytes(url)] as const)));
  const photos = collageListings.flatMap(listing => (fetched.get(listing.photo) ? [fetched.get(listing.photo)!] : []));
  const card = await stillCard(data.profile, photos);
  if (kind === "jpg") return cardJpeg(card);
  const frames = shown.flatMap(listing => (fetched.get(listing.photo) ? [{ listing, photo: fetched.get(listing.photo)! }] : []));
  return sellerGif(card, frames.length >= 2 ? frames : [], data.profile.name);
}

const failure = (status: number) => new Response(null, { status, headers: { "Cache-Control": failureCacheControl } });

/** The route's answer for `file` (`<username or handle>.jpg` or `.gif`): 404 for anything else or an unknown seller, 502 when the API cannot answer. */
export async function serveSellerCard(file: string, random: () => number = Math.random): Promise<Response> {
  const card = readSellerCard(file);
  if (!card) return failure(404);
  const data = await sellerCardData(card.key);
  if (data === "missing") return failure(404);
  if (!data) return failure(502);
  let bytes: Buffer;
  try {
    bytes = await render(data, card.kind, random);
  } catch {
    return failure(502);
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": card.kind === "gif" ? "image/gif" : "image/jpeg", "Content-Length": String(bytes.length), "Cache-Control": cardCacheControl } });
}
