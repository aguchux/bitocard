import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { brandInitials, brandInk, brandTint, type ShopBrandPage, type ShopSearch } from "@bitocard/api-client/classifieds";
import { marketFor, shopApi } from "./api";
import { Lockup, navy, ogClip, ogFonts, ogMark, ogMoney, pink, slate } from "./og";
import { cardCacheControl, cardJpeg, cardSize, collage, collagePhotos, failure, gifListings, photoBytes, pickRandom, sellerGif, type CardListing } from "./seller-card";

/**
 * A brand page's share images (`/brand-card/<cc>-<slug>.jpg` and `.gif`), udozo.com's only, made as a seller page's
 * are (`lib/seller-card.tsx`): the still card is a collage of up to four of the brand's live listings in that market,
 * **picked at random** on each request, beside its logo (or initials on its colour), how much is for sale there, from
 * how many sellers and in which categories; the GIF opens on the same card, then shows a few more of its listings at
 * random, each naming its own seller. The CDN keeps a pick for hours, so what is shown changes a few times a day. Never
 * the brand's official image: the card is Udozo's, about what is for sale on it.
 */

export type BrandCardKind = "jpg" | "gif";

const filePattern = /^([a-z]{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.(jpg|gif)$/;

/** The market, brand and kind an address names (`ng-cantrack.gif`), or null for anything else. */
export function readBrandCard(file: string): { country: string; slug: string; kind: BrandCardKind } | null {
  const match = filePattern.exec(file);
  if (!match || match[2]!.length > 80) return null;
  return { country: match[1]!, slug: match[2]!, kind: match[3] as BrandCardKind };
}

/** The share images' addresses, from the site's own origin. */
export const brandCardUrl = (origin: string, country: string, slug: string, kind: BrandCardKind) => new URL(`/brand-card/${country.toLowerCase()}-${slug}.${kind}`, origin).href;

export type BrandCardData = { brand: ShopBrandPage; market: string; listings: CardListing[] };

/**
 * The brand in a market and up to 24 of its live listings with a photo (https only), each with its seller. "missing" for
 * a market Udozo is not open in or a brand the registry does not have there, null when the API cannot answer (never
 * cached).
 */
export async function brandCardData(country: string, slug: string): Promise<BrandCardData | "missing" | null> {
  const market = await marketFor(country);
  if (!market) return "missing";
  const page = await shopApi<ShopBrandPage>(`/v1/classifieds/brands/${slug}?country=${country.toUpperCase()}`);
  if (!page.ok) return page.status >= 400 && page.status < 500 ? "missing" : null;
  if (!page.data.listings) return { brand: page.data, market: market.name, listings: [] };
  const search = await shopApi<ShopSearch>(`/v1/classifieds/listings?${new URLSearchParams({ country: country.toUpperCase(), brand: slug, sort: "newest", limit: "24" })}`);
  if (!search.ok) return null;
  const listings = search.data.data.flatMap(card => {
    const photo = card.cover?.url;
    if (!photo?.startsWith("https://")) return [];
    const price = card.price.kind === "on_request" || card.price.amount === null ? "Price on request" : ogMoney(card.price.amount, card.price.currency);
    return [{ photo, title: card.title, price, by: card.seller.name }];
  });
  return { brand: page.data, market: market.name, listings };
}

/**
 * The brand's logo as a PNG data address on white, or null for its initials: a logo bundled with udozo.com
 * (`/brand-logos/<slug>.svg`) read from this site's own files, any other only over https; sharp draws SVGs too.
 */
async function logo(url: string | null): Promise<string | null> {
  if (!url) return null;
  let bytes: Buffer | null = null;
  try {
    const path = new URL(url, "https://udozo.com").pathname;
    const bundled = /^\/brand-logos\/([a-z0-9-]+)\.svg$/.exec(path);
    bytes = bundled ? await readFile(join(process.cwd(), "public/brand-logos", `${bundled[1]}.svg`)).catch(() => null) : null;
  } catch {
    bytes = null;
  }
  bytes ??= await photoBytes(url);
  if (!bytes) return null;
  try {
    const png = await sharp(bytes, { failOn: "none", density: 300 }).resize(200, 200, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

/** The brand's mark on the card: its logo on a white tile, else its initials on its colour. */
function BrandTile({ brand, picture, size }: { brand: ShopBrandPage; picture: string | null; size: number }) {
  const tint = brandTint(brand);
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: size * 0.22,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        background: picture ? "#ffffff" : tint,
        color: brandInk(tint),
        fontSize: size * 0.36,
        fontWeight: 800,
        border: "4px solid #e4f1f9",
        padding: picture ? size * 0.1 : 0,
        flexShrink: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
      {picture ? <img src={picture} alt="" width={size * 0.8} height={size * 0.8} style={{ width: size * 0.8, height: size * 0.8, objectFit: "contain" }} /> : brandInitials(brand.name)}
    </div>
  );
}

/** "GPS trackers, CCTV and 2 more": the categories it is for sale in, named as written (a card's line, never lower-cased). */
export function cardCategories(categories: Array<{ name: string }>, shown = 2) {
  const names = categories.slice(0, shown).map(item => item.name);
  if (!names.length) return null;
  const rest = categories.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
}

/** "12 listings for sale in Nigeria", or that nothing is yet. */
export function brandCardLine(brand: Pick<ShopBrandPage, "listings">, market: string) {
  return brand.listings ? `${brand.listings.toLocaleString("en-GB")} listing${brand.listings === 1 ? "" : "s"} for sale in ${market}` : `Sell yours on Udozo in ${market}`;
}

/**
 * The still card (1200 × 630) as a PNG: up to four of the brand's listings' photos on the left (with none, its tile on
 * Udozo's blue), and on the right Udozo's mark, the brand, how much is for sale and from how many sellers, and its
 * categories.
 */
export async function brandStill(data: BrandCardData, photos: Buffer[]): Promise<Buffer> {
  const left = 660;
  const { brand } = data;
  const [fonts, mark, picture, tile] = await Promise.all([ogFonts(), ogMark(), collage(photos.slice(0, collagePhotos), left, cardSize.height), logo(brand.logo_url)]);
  const selling = brand.categories.filter(item => item.listings > 0);
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
            <BrandTile brand={brand} picture={tile} size={250} />
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0, padding: "48px 48px 44px" }}>
          <Lockup mark={mark} size={40} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {picture ? <BrandTile brand={brand} picture={tile} size={104} /> : null}
            <div style={{ display: "flex", fontSize: 54, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.05 }}>{ogClip(brand.name, 20)}</div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: pink }}>{ogClip(brandCardLine(brand, data.market), 34)}</div>
            {brand.sellers ? <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: slate }}>{`From ${brand.sellers.toLocaleString("en-GB")} seller${brand.sellers === 1 ? "" : "s"}`}</div> : null}
            {selling.length ? <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: slate }}>{ogClip(`In ${cardCategories(selling)}`, 36)}</div> : null}
          </div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: slate }}>{ogClip(`${brand.name} for sale on Udozo, not its official store`, 50)}</div>
        </div>
      </div>
    ),
    { ...cardSize, fonts },
  );
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The images for a brand: four listings picked at random for the collage, and for the GIF up to five more at random
 * (only with two or more). Every photo is read once, all at the same time.
 */
async function render(data: BrandCardData, kind: BrandCardKind, random: () => number): Promise<Buffer> {
  const picked = pickRandom(data.listings, data.listings.length, random);
  const collageListings = picked.slice(0, collagePhotos);
  const rest = picked.slice(collagePhotos);
  const shown = kind === "gif" && data.listings.length >= 2 ? [...rest, ...collageListings].slice(0, gifListings) : [];
  const urls = [...new Set([...collageListings, ...shown].map(listing => listing.photo))];
  const fetched = new Map(await Promise.all(urls.map(async url => [url, await photoBytes(url)] as const)));
  const photos = collageListings.flatMap(listing => (fetched.get(listing.photo) ? [fetched.get(listing.photo)!] : []));
  const card = await brandStill(data, photos);
  if (kind === "jpg") return cardJpeg(card);
  const frames = shown.flatMap(listing => (fetched.get(listing.photo) ? [{ listing, photo: fetched.get(listing.photo)! }] : []));
  return sellerGif(card, frames.length >= 2 ? frames : [], data.brand.name);
}

/** The route's answer for `file` (`<cc>-<slug>.jpg` or `.gif`): 404 for anything else or an unknown brand or market, 502 when the API cannot answer. */
export async function serveBrandCard(file: string, random: () => number = Math.random): Promise<Response> {
  const card = readBrandCard(file);
  if (!card) return failure(404);
  const data = await brandCardData(card.country, card.slug);
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
