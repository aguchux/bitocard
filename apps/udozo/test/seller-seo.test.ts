// Seller pages in search and sharing: their metadata (the animated card first, then the still one; X's large card), the
// ProfilePage JSON-LD, their place in udozo.com's sitemaps (both forms), and the share images themselves, udozo.com's
// only: a still 1200 × 630 JPEG and an animated GIF within WhatsApp's 300 KB, a single frame without photos.
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopResult, ShopSearch, ShopSellerProfile, ShopSitemap } from "@bitocard/api-client/classifieds";

const market = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 21, safe_pay: true, install_prompt: false };
const profile = (extra: Partial<ShopSellerProfile> = {}): ShopSellerProfile => ({
  object: "classified_seller",
  handle: "a1b2c3d4e5",
  name: "Chinedu O.",
  avatar_url: null,
  country: "NG",
  url: "https://udozo.com/ng/seller/a1b2c3d4e5",
  member_since: "2026-03-02T10:00:00.000Z",
  badges: [],
  response_rate: 92,
  active_listings: 6,
  sold_listings: 4,
  safe_pay_sales: 2,
  last_listed_at: "2026-11-01T10:00:00.000Z",
  categories: [
    { slug: "tvs", name: "TVs", icon: "tv", parent: null, listings: 4 },
    { slug: "mobile-phones", name: "Mobile phones", icon: "smartphone", parent: null, listings: 2 },
  ],
  states: [{ slug: "lagos", name: "Lagos", listings: 6 }],
  contact: { chat: true, phone: false },
  contact_listings: [],
  ...extra,
});
const card = (ref: number, photo: boolean, price: number | null = 25000000): ShopResult => ({
  object: "classified_listing_card",
  id: `0000000${ref}-0000-4000-8000-000000000000`,
  ref,
  title: `Hisense ${ref} inch smart TV, boxed with remote and wall bracket`,
  slug: `hisense-${ref}`,
  country: "NG",
  url: "",
  price: price === null ? { kind: "on_request", amount: null, currency: "NGN" } : { kind: "fixed", amount: price, currency: "NGN" },
  condition: "used",
  category: { slug: "tvs", name: "TVs" },
  area: { slug: "ikeja", name: "Ikeja", state: { slug: "lagos", name: "Lagos" } },
  cover: photo ? { url: `https://media.test/${ref}.jpg`, width: 1600, height: 1200 } : null,
  photo_count: photo ? 3 : 0,
  has_video: false,
  highlights: [],
  delivery: "none",
  seller: { name: "Chinedu O.", handle: "a1b2c3d4e5", badges: [] },
  published_at: "2026-11-01T10:00:00.000Z",
  tier: null,
  delivers_to_you: false,
});
const search = (cards: ShopResult[]): ShopSearch => ({ object: "list", data: cards, total: cards.length, tiers: null, offset: 0, limit: 24, sort: "newest" });

const api = { profile: profile() as ShopSellerProfile | null | "down", search: search([]) as ShopSearch | null, paths: [] as string[] };
vi.mock("@/lib/api", () => ({
  marketFor: async (cc: string) => (cc === "ng" ? market : null),
  shopApi: async (path: string) => {
    api.paths.push(path);
    if (path.startsWith("/v1/classifieds/sellers/")) return api.profile === "down" ? { ok: false, status: 0, code: null } : api.profile ? { ok: true, data: api.profile } : { ok: false, status: 404, code: "resource_missing" };
    if (path.startsWith("/v1/classifieds/listings?")) return api.search ? { ok: true, data: api.search } : { ok: false, status: 0, code: null };
    return { ok: false, status: 404, code: null };
  },
}));
vi.mock("@/lib/customer", () => ({ currentCustomer: async () => null, customerApi: async () => ({ ok: false, status: 404, code: null }), siteOrigin: () => "https://udozo.com" }));
vi.mock("@/lib/listing-actions", () => ({ listingContactState: vi.fn(), saveListing: vi.fn(), reportListing: vi.fn(), requestContact: vi.fn() }));

const { generateMetadata } = await import("@/app/[cc]/seller/[handle]/page");
const { GET } = await import("@/app/seller-card/[file]/route");
const { collageTiles, gifBudget, jpegBudget, pickRandom, readSellerCard } = await import("@/lib/seller-card");
const { sellerJsonLd } = await import("@/lib/seo");
const { countryEntries, countryFiles, pagesInFile, sitemapLimit } = await import("@/lib/sitemap");
const { config } = await import("@/proxy");

/** Busy, photo-like images (a gradient under noise compresses as badly as real photos do in a GIF), one per listing. */
const photos = new Map<string, Buffer>();
async function photo(ref: number) {
  const noise = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#000000", noise: { type: "gaussian", mean: 120 + (ref % 5) * 10, sigma: 40 } } }).png().toBuffer();
  const tint = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: (ref * 47) % 255, g: (ref * 91) % 255, b: (ref * 13) % 255 } } })
    .composite([{ input: noise, blend: "overlay" }])
    .jpeg({ quality: 80 })
    .toBuffer();
  return tint;
}

beforeEach(async () => {
  api.profile = profile();
  api.search = search([]);
  api.paths = [];
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  for (const ref of [101, 102, 103, 104, 105, 106]) if (!photos.has(`https://media.test/${ref}.jpg`)) photos.set(`https://media.test/${ref}.jpg`, await photo(ref));
  vi.stubGlobal("fetch", async (url: string) => {
    const bytes = photos.get(url);
    return bytes ? new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }) : new Response("missing", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const get = (file: string, host = "udozo.com") => GET(new NextRequest(`https://${host}/seller-card/${file}`, { headers: { host } }), { params: Promise.resolve({ file }) });

describe("metadata", () => {
  test("shares the animated card first, then the still one, and gives X the still one as a large card", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ cc: "ng", handle: "a1b2c3d4e5" }), searchParams: Promise.resolve({}) });
    const og = meta.openGraph as { type: string; images: Array<{ url: string; width: number; height: number; type: string; alt: string }> };
    expect(og.type).toBe("profile");
    expect(og.images.map(image => [image.url, image.type, image.width, image.height])).toEqual([
      ["https://udozo.com/seller-card/a1b2c3d4e5.gif", "image/gif", 800, 420],
      ["https://udozo.com/seller-card/a1b2c3d4e5.jpg", "image/jpeg", 1200, 630],
    ]);
    expect(og.images.every(image => image.alt.includes("Chinedu O."))).toBe(true);
    const twitter = meta.twitter as { card: string; images: Array<{ url: string }> };
    expect(twitter.card).toBe("summary_large_image");
    expect(twitter.images.map(image => image.url)).toEqual(["https://udozo.com/seller-card/a1b2c3d4e5.jpg"]);
    expect(meta.alternates?.canonical).toBe("/ng/seller/a1b2c3d4e5");
    expect(meta.robots).toBeUndefined();
    // Filtered views and sellers with nothing for sale stay out of the index, as before.
    expect((await generateMetadata({ params: Promise.resolve({ cc: "ng", handle: "a1b2c3d4e5" }), searchParams: Promise.resolve({ sort: "price_asc" }) })).robots).toEqual({ index: false, follow: true });
    api.profile = profile({ active_listings: 0 });
    expect((await generateMetadata({ params: Promise.resolve({ cc: "ng", handle: "a1b2c3d4e5" }), searchParams: Promise.resolve({}) })).robots).toEqual({ index: false, follow: true });
  });

  test("the ProfilePage names when they joined, and the seller with their handle, page, photo (else the card) and live listings", () => {
    const url = "https://udozo.com/ng/seller/a1b2c3d4e5";
    const data = sellerJsonLd(profile(), url, "https://udozo.com/seller-card/a1b2c3d4e5.jpg");
    expect(data).toMatchObject({ "@context": "https://schema.org", "@type": "ProfilePage", url, dateCreated: "2026-03-02T10:00:00.000Z" });
    expect(data.mainEntity).toEqual({
      "@type": "Person",
      "@id": `${url}#seller`,
      name: "Chinedu O.",
      identifier: "a1b2c3d4e5",
      url,
      image: "https://udozo.com/seller-card/a1b2c3d4e5.jpg",
      agentInteractionStatistic: { "@type": "InteractionCounter", interactionType: "https://schema.org/WriteAction", userInteractionCount: 6 },
    });
    const withPhoto = sellerJsonLd(profile({ avatar_url: "https://media.test/me.jpg", active_listings: 0 }), url, "https://udozo.com/seller-card/a1b2c3d4e5.jpg");
    expect(withPhoto.mainEntity.image).toBe("https://media.test/me.jpg");
    expect(withPhoto.mainEntity).not.toHaveProperty("agentInteractionStatistic");
  });
});

describe("the sitemap", () => {
  const sitemap = (sellers: ShopSitemap["sellers"]): ShopSitemap => ({ object: "classified_sitemap", country: "NG", updated_at: "2026-11-01T09:00:00.000Z", categories: [], places: [], category_places: [], listing_pages: [], sellers });

  test("lists seller pages with something for sale, dated by their newest listing change", () => {
    const entries = countryEntries("https://udozo.com", "ng", sitemap([{ handle: "a1b2c3d4e5", listings: 3, updated_at: "2026-11-02T08:00:00.000Z" }, { handle: "zz9yy8xx7w", listings: 0, updated_at: "2026-10-01T08:00:00.000Z" }]));
    expect(entries).toContainEqual({ loc: "https://udozo.com/ng/seller/a1b2c3d4e5", lastmod: "2026-11-02T08:00:00.000Z" });
    expect(entries.some(entry => entry.loc.includes("zz9yy8xx7w"))).toBe(false);
    // An API from before sellers were listed still makes a sitemap.
    expect(countryEntries("https://udozo.com", "ng", sitemap(undefined))).toEqual([{ loc: "https://udozo.com/ng", lastmod: "2026-11-01T09:00:00.000Z" }]);
  });

  test("past one file's limit, seller pages go on in the country's pages files, none left out", () => {
    const many = Array.from({ length: sitemapLimit + 10 }, (_, index) => ({ handle: `s${String(index).padStart(9, "0")}`, listings: 1, updated_at: "2026-11-01T00:00:00.000Z" }));
    const big = sitemap(many);
    const files = countryFiles("https://udozo.com", "ng", big);
    expect(files.map(file => file.loc)).toEqual(["https://udozo.com/sitemaps/ng-pages-0.xml", "https://udozo.com/sitemaps/ng-pages-1.xml"]);
    const all = countryEntries("https://udozo.com", "ng", big);
    expect(pagesInFile(all, 0).length + pagesInFile(all, 1).length).toBe(sitemapLimit + 11);
    expect(pagesInFile(all, 1).at(-1)?.loc).toBe(`https://udozo.com/ng/seller/s${String(sitemapLimit + 9).padStart(9, "0")}`);
  });
});

describe("the share images", () => {
  test("only <handle>.jpg and <handle>.gif are addresses, and the proxy sees them (so a store's host never serves them)", async () => {
    expect(readSellerCard("a1b2c3d4e5.gif")).toEqual({ handle: "a1b2c3d4e5", kind: "gif" });
    for (const file of ["A1B2C3D4E5.gif", "a1b2c3d4e5.png", "abc.gif", "a1b2c3d4e5.gif.gif", "../a1b2c3d4e5.jpg", "a1b2c3d4e5"]) expect(readSellerCard(file), file).toBeNull();
    expect(config.matcher).toContain("/seller-card/:path*");
    const bad = await get("NOT-A-HANDLE.gif");
    expect([bad.status, bad.headers.get("cache-control")]).toEqual([404, "no-store"]);
    expect(api.paths).toEqual([]);
    const store = await get("a1b2c3d4e5.jpg", "gadgets.udozo.com");
    expect([store.status, store.headers.get("cache-control")]).toEqual([404, "no-store"]);
    const domain = await get("a1b2c3d4e5.jpg", "gadgets.ng");
    expect(domain.status).toBe(404);
    expect(api.paths).toEqual([]);
  });

  test("an unknown or suspended seller is not found; an API that cannot answer is never cached", async () => {
    api.profile = null;
    const missing = await get("a1b2c3d4e5.gif");
    expect([missing.status, missing.headers.get("cache-control")]).toEqual([404, "no-store"]);
    api.profile = "down";
    expect((await get("a1b2c3d4e5.jpg")).status).toBe(502);
    api.profile = profile();
    api.search = null;
    const down = await get("a1b2c3d4e5.jpg");
    expect([down.status, down.headers.get("cache-control")]).toEqual([502, "no-store"]);
  });

  test("the still card is a 1200 × 630 JPEG within budget, with and without photos", async () => {
    api.search = search([101, 102, 103, 104, 105, 106].map(ref => card(ref, true)));
    const response = await get("a1b2c3d4e5.jpg");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(await sharp(bytes).metadata()).toMatchObject({ format: "jpeg", width: 1200, height: 630 });
    expect(bytes.length).toBeLessThanOrEqual(jpegBudget);
    expect(api.paths).toContain("/v1/classifieds/listings?country=NG&seller=a1b2c3d4e5&sort=newest&limit=24");

    api.search = search([]);
    const plain = Buffer.from(await (await get("a1b2c3d4e5.jpg")).arrayBuffer());
    expect(await sharp(plain).metadata()).toMatchObject({ format: "jpeg", width: 1200, height: 630 });
  }, 60_000);

  test("the GIF opens on the card, then shows several listings, loops, and stays within 300 KB", async () => {
    // Photos that fail (one missing) are left out, never the image; a listing without a photo is never shown.
    api.search = search([...[101, 102, 103, 104, 105, 106].map(ref => card(ref, true, ref === 103 ? null : 25000000)), card(107, false), { ...card(108, true), cover: { url: "https://media.test/gone.jpg", width: 1, height: 1 } }]);
    const response = await get("a1b2c3d4e5.gif");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/gif");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBeLessThanOrEqual(gifBudget);
    const meta = await sharp(bytes, { animated: true }).metadata();
    expect(meta.format).toBe("gif");
    expect(meta.pages).toBeGreaterThan(1);
    expect(meta.loop).toBe(0);
    expect(meta.delay?.[0]).toBe(2500);
    expect([800, 600]).toContain(meta.width);
    expect(meta.pageHeight! * 1200).toBe(meta.width! * 630);
  }, 120_000);

  test("a seller with one photo or none gets the card alone, as a single frame", async () => {
    for (const cards of [[], [card(101, true)], [card(101, false), card(102, false)]]) {
      api.search = search(cards);
      const response = await get("a1b2c3d4e5.gif");
      expect(response.status).toBe(200);
      const bytes = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(bytes, { animated: true }).metadata();
      expect([meta.format, meta.pages ?? 1, meta.width, meta.height]).toEqual(["gif", 1, 800, 420]);
      expect(bytes.length).toBeLessThanOrEqual(gifBudget);
    }
  }, 60_000);

  test("listings are picked at random each time; the collage fits its tiles", () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const sequence = [0.9, 0.1, 0.5, 0.3, 0.7, 0.2];
    let at = 0;
    const picked = pickRandom(items, 5, () => sequence[at++ % sequence.length]!);
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    expect(pickRandom(items, 5, () => 0.999)).not.toEqual(pickRandom(items, 5, () => 0));
    for (const count of [1, 2, 3, 4]) {
      const tiles = collageTiles(count, 660, 630);
      expect(tiles).toHaveLength(count);
      for (const tile of tiles) expect(tile.left + tile.width <= 660 && tile.top + tile.height <= 630 && tile.width > 0 && tile.height > 0).toBe(true);
    }
    expect(collageTiles(4, 660, 630).slice(1).at(-1)).toMatchObject({ top: 424, height: 206 });
  });
});
