// Brand pages in search and sharing (7 November 2026, the owner's request, as seller pages have): their metadata (the
// animated card first, then the still one; X's large card), the CollectionPage's image, and the share images
// themselves, udozo.com's only: a still 1200 × 630 JPEG of the brand's listings picked at random beside its logo, and an
// animated GIF within WhatsApp's 300 KB, each listing naming its own seller.
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ShopBrandPage, ShopResult, ShopSearch } from "@bitocard/api-client/classifieds";

const market = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 21, safe_pay: true, install_prompt: false };
const brandPage = (extra: Partial<ShopBrandPage> = {}): ShopBrandPage => ({
  object: "classified_brand_page",
  slug: "cantrack",
  name: "Cantrack",
  logo_url: "https://udozo.com/brand-logos/cantrack.svg",
  color: "#376AB3",
  country: "NG",
  url: "https://udozo.com/ng/brand/cantrack",
  listings: 16,
  sellers: 3,
  updated_at: "2026-11-06T10:00:00.000Z",
  categories: [{ slug: "gps-trackers", name: "GPS trackers", icon: "locate-fixed", parent: { slug: "electronics", name: "Electronics" }, listings: 16 }],
  models: [{ name: "GT06", listings: 4 }],
  states: [{ slug: "lagos", name: "Lagos", listings: 16 }],
  ...extra,
});
const card = (ref: number, seller = "Stanley A."): ShopResult => ({
  object: "classified_listing_card",
  id: `0000000${ref}-0000-4000-8000-000000000000`,
  ref,
  title: `Cantrack GT06 vehicle tracker ${ref}, with relay`,
  slug: `cantrack-${ref}`,
  country: "NG",
  url: "",
  price: { kind: "fixed", amount: 3500000, currency: "NGN" },
  condition: "new",
  category: { slug: "gps-trackers", name: "GPS trackers" },
  area: { slug: "ikeja", name: "Ikeja", state: { slug: "lagos", name: "Lagos" } },
  cover: { url: `https://media.test/${ref}.jpg`, width: 1600, height: 1200 },
  photo_count: 3,
  has_video: false,
  highlights: [],
  delivery: "none",
  seller: { name: seller, handle: "a1b2c3d4e5", badges: [] },
  published_at: "2026-11-01T10:00:00.000Z",
  tier: null,
  delivers_to_you: false,
});
const search = (cards: ShopResult[]): ShopSearch => ({ object: "list", data: cards, total: cards.length, tiers: null, offset: 0, limit: 24, sort: "newest" });

const api = { brand: brandPage() as ShopBrandPage | null | "down", search: search([]) as ShopSearch | null, paths: [] as string[] };
vi.mock("@/lib/api", () => ({
  marketFor: async (cc: string) => (cc === "ng" ? market : null),
  shopApi: async (path: string) => {
    api.paths.push(path);
    if (path.startsWith("/v1/classifieds/brands/")) return api.brand === "down" ? { ok: false, status: 0, code: null } : api.brand ? { ok: true, data: api.brand } : { ok: false, status: 404, code: "resource_missing" };
    if (path.startsWith("/v1/classifieds/listings?")) return api.search ? { ok: true, data: api.search } : { ok: false, status: 0, code: null };
    return { ok: false, status: 404, code: null };
  },
}));
vi.mock("@/lib/customer", () => ({ currentCustomer: async () => null, customerApi: async () => ({ ok: false, status: 404, code: null }), siteOrigin: () => "https://udozo.com" }));

const { generateMetadata } = await import("@/app/[cc]/brand/[slug]/page");
const { GET } = await import("@/app/brand-card/[file]/route");
const { brandCardLine, brandCardUrl, cardCategories, readBrandCard } = await import("@/lib/brand-card");
const { gifBudget, jpegBudget } = await import("@/lib/seller-card");
const { brandJsonLd } = await import("@/lib/seo");
const { config } = await import("@/proxy");

const photos = new Map<string, Buffer>();
async function photo(ref: number) {
  const noise = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#000000", noise: { type: "gaussian", mean: 120 + (ref % 5) * 10, sigma: 40 } } }).png().toBuffer();
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: (ref * 47) % 255, g: (ref * 91) % 255, b: (ref * 13) % 255 } } })
    .composite([{ input: noise, blend: "overlay" }])
    .jpeg({ quality: 80 })
    .toBuffer();
}

const fetched: string[] = [];
beforeEach(async () => {
  api.brand = brandPage();
  api.search = search([]);
  api.paths = [];
  fetched.length = 0;
  for (const ref of [101, 102, 103, 104, 105, 106, 107, 108]) if (!photos.has(`https://media.test/${ref}.jpg`)) photos.set(`https://media.test/${ref}.jpg`, await photo(ref));
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    const bytes = photos.get(url);
    return bytes ? new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }) : new Response("missing", { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const get = (file: string, host = "udozo.com") => GET(new NextRequest(`https://${host}/brand-card/${file}`, { headers: { host } }), { params: Promise.resolve({ file }) });
const props = (query: Record<string, string> = {}) => ({ params: Promise.resolve({ cc: "ng", slug: "cantrack" }), searchParams: Promise.resolve(query) });

describe("metadata", () => {
  test("shares the animated card first, then the still one, and gives X the still one as a large card", async () => {
    const meta = await generateMetadata(props());
    const og = meta.openGraph as { images: Array<{ url: string; width: number; height: number; type: string; alt: string }> };
    expect(og.images.map(image => [image.url, image.type, image.width, image.height])).toEqual([
      ["https://udozo.com/brand-card/ng-cantrack.gif", "image/gif", 800, 420],
      ["https://udozo.com/brand-card/ng-cantrack.jpg", "image/jpeg", 1200, 630],
    ]);
    expect(og.images[0]!.alt).toBe("Cantrack on Udozo: 16 listings for sale in Nigeria");
    const twitter = meta.twitter as { card: string; images: Array<{ url: string }> };
    expect([twitter.card, twitter.images.map(image => image.url)]).toEqual(["summary_large_image", ["https://udozo.com/brand-card/ng-cantrack.jpg"]]);
    expect(meta.alternates?.canonical).toBe("/ng/brand/cantrack");
  });

  test("the CollectionPage names the card as the page's image, never as the brand's own", () => {
    const data = brandJsonLd(brandPage(), "Nigeria", "https://udozo.com/ng/brand/cantrack", brandCardUrl("https://udozo.com", "NG", "cantrack", "jpg"));
    expect(data.primaryImageOfPage).toEqual({ "@type": "ImageObject", url: "https://udozo.com/brand-card/ng-cantrack.jpg", width: 1200, height: 630 });
    expect(data.about).toMatchObject({ "@type": "Brand", name: "Cantrack", logo: "https://udozo.com/brand-logos/cantrack.svg" });
    expect(brandJsonLd(brandPage(), "Nigeria", "https://udozo.com/ng/brand/cantrack")).not.toHaveProperty("primaryImageOfPage");
  });
});

describe("the share images", () => {
  test("only <cc>-<slug>.jpg and .gif are addresses, and the proxy sees them (so a store's host never serves them)", async () => {
    expect(readBrandCard("ng-cantrack.gif")).toEqual({ country: "ng", slug: "cantrack", kind: "gif" });
    expect(readBrandCard("gh-ge-healthcare.jpg")).toEqual({ country: "gh", slug: "ge-healthcare", kind: "jpg" });
    for (const file of ["cantrack.gif", "NG-cantrack.gif", "ng-Cantrack.jpg", "ng-cantrack.png", "ng--cantrack.gif", "ng-cantrack-.jpg"]) expect(readBrandCard(file), file).toBeNull();
    expect(config.matcher).toContain("/brand-card/:path*");
    const bad = await get("cantrack.gif");
    expect([bad.status, bad.headers.get("cache-control")]).toEqual([404, "no-store"]);
    expect((await get("ng-cantrack.jpg", "gadgets.udozo.com")).status).toBe(404);
    expect(api.paths).toEqual([]);
  });

  test("an unknown brand or closed market is not found; an API that cannot answer is never cached", async () => {
    expect((await get("zz-cantrack.jpg")).status).toBe(404);
    api.brand = null;
    expect((await get("ng-cantrack.jpg")).status).toBe(404);
    api.brand = "down";
    const down = await get("ng-cantrack.jpg");
    expect([down.status, down.headers.get("cache-control")]).toEqual([502, "no-store"]);
    api.brand = brandPage();
    api.search = null;
    expect((await get("ng-cantrack.jpg")).status).toBe(502);
  });

  test("the still card is a 1200 × 630 JPEG within budget, of four of its listings picked at random; with nothing for sale, its logo alone", async () => {
    api.search = search([101, 102, 103, 104, 105, 106, 107, 108].map(ref => card(ref)));
    const response = await get("ng-cantrack.jpg");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(await sharp(bytes).metadata()).toMatchObject({ format: "jpeg", width: 1200, height: 630 });
    expect(bytes.length).toBeLessThanOrEqual(jpegBudget);
    expect(api.paths).toEqual(["/v1/classifieds/brands/cantrack?country=NG", "/v1/classifieds/listings?country=NG&brand=cantrack&sort=newest&limit=24"]);
    // Four photos, and over a few requests not always the same four: the pick is random.
    const picks = new Set<string>();
    for (let round = 0; round < 4; round += 1) {
      fetched.length = 0;
      await get("ng-cantrack.jpg");
      expect(fetched.filter(url => url.startsWith("https://media.test/"))).toHaveLength(4);
      picks.add(fetched.filter(url => url.startsWith("https://media.test/")).sort().join());
    }
    expect(picks.size).toBeGreaterThan(1);
    // The bundled logo is read from this site's own files, never fetched.
    expect(fetched).not.toContain("https://udozo.com/brand-logos/cantrack.svg");

    api.brand = brandPage({ listings: 0, sellers: 0, categories: [{ slug: "gps-trackers", name: "GPS trackers", icon: "locate-fixed", parent: null, listings: 0 }] });
    api.paths = [];
    const plain = Buffer.from(await (await get("ng-cantrack.jpg")).arrayBuffer());
    expect(await sharp(plain).metadata()).toMatchObject({ format: "jpeg", width: 1200, height: 630 });
    expect(api.paths, "nothing for sale: no search").toEqual(["/v1/classifieds/brands/cantrack?country=NG"]);
    expect(brandCardLine({ listings: 0 }, "Nigeria")).toBe("Sell yours on Udozo in Nigeria");
    expect(brandCardLine({ listings: 1 }, "Nigeria")).toBe("1 listing for sale in Nigeria");
    expect([cardCategories([{ name: "GPS trackers" }]), cardCategories([{ name: "GPS trackers" }, { name: "CCTV" }]), cardCategories([{ name: "GPS trackers" }, { name: "CCTV" }, { name: "TVs" }, { name: "Laptops" }])]).toEqual(["GPS trackers", "GPS trackers and CCTV", "GPS trackers, CCTV and 2 more"]);
  }, 60_000);

  test("the GIF opens on the card, then shows several listings, loops, and stays within 300 KB", async () => {
    api.search = search([101, 102, 103, 104, 105, 106, 107, 108].map((ref, index) => card(ref, index % 2 ? "Bisi A." : "Stanley A.")));
    const response = await get("ng-cantrack.gif");
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "image/gif"]);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBeLessThanOrEqual(gifBudget);
    const meta = await sharp(bytes, { animated: true }).metadata();
    expect(meta.pages).toBeGreaterThanOrEqual(3);
    expect(meta.loop).toBe(0);
  }, 60_000);
});
