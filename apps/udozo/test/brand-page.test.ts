// @vitest-environment jsdom
// A brand's public page on udozo.com (`/ng/brand/hp`): its logo and name, how much is for sale under it and from how
// many sellers, its categories and models filtering its listings, where they are, its listings with a sort and pages,
// what it shows with nothing for sale, its metadata and JSON-LD, and its sitemap entry.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopBrandPage, ShopResult, ShopSearch, ShopSitemap } from "@bitocard/api-client/classifieds";

const market = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 21, safe_pay: true, install_prompt: false };
const brand = (extra: Partial<ShopBrandPage> = {}): ShopBrandPage => ({
  object: "classified_brand_page",
  slug: "hp",
  name: "HP",
  logo_url: "https://udozo.com/brand-logos/hp.svg",
  color: "#0096D6",
  country: "NG",
  url: "https://udozo.com/ng/brand/hp",
  listings: 30,
  sellers: 7,
  updated_at: "2026-11-05T10:00:00.000Z",
  categories: [
    { slug: "laptops", name: "Laptops", icon: "laptop", parent: { slug: "electronics", name: "Electronics" }, listings: 26 },
    { slug: "printers", name: "Printers and scanners", icon: "printer", parent: { slug: "electronics", name: "Electronics" }, listings: 4 },
  ],
  models: [
    { name: "EliteBook 840 G5", listings: 9 },
    { name: "ProBook 450 G8", listings: 5 },
  ],
  states: [
    { slug: "lagos", name: "Lagos", listings: 20 },
    { slug: "fct", name: "FCT", listings: 10 },
  ],
  ...extra,
});
const card = (ref: number, title: string): ShopResult => ({
  object: "classified_listing_card",
  id: `0000000${ref}-0000-4000-8000-000000000000`,
  ref,
  title,
  slug: title.toLowerCase().replace(/\s+/g, "-"),
  country: "NG",
  url: "",
  price: { kind: "fixed", amount: 45000000, currency: "NGN" },
  condition: "used",
  category: { slug: "laptops", name: "Laptops" },
  area: { slug: "ikeja", name: "Ikeja", state: { slug: "lagos", name: "Lagos" } },
  cover: null,
  photo_count: 4,
  has_video: false,
  highlights: [],
  delivery: "none",
  seller: { name: "Chinedu O.", handle: "a1b2c3d4e5", badges: [] },
  published_at: "2026-11-01T10:00:00.000Z",
  tier: null,
  delivers_to_you: false,
});

const api = { brand: brand() as ShopBrandPage | null, search: null as ShopSearch | null, paths: [] as string[] };
vi.mock("@/lib/api", () => ({
  marketFor: async (cc: string) => (cc === "ng" ? market : null),
  shopApi: async (path: string) => {
    api.paths.push(path);
    if (path.startsWith("/v1/classifieds/brands/")) return api.brand ? { ok: true, data: api.brand } : { ok: false, status: 404, code: "resource_missing" };
    if (path.startsWith("/v1/classifieds/listings?")) return api.search ? { ok: true, data: api.search } : { ok: false, status: 0, code: null };
    return { ok: false, status: 404, code: null };
  },
}));
vi.mock("@/lib/customer", () => ({ siteOrigin: () => "https://udozo.com" }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  usePathname: () => "/ng/brand/hp",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: BrandPage, generateMetadata } = await import("@/app/[cc]/brand/[slug]/page");
const { brandHref, brandIn, brandListingsQuery, brandStats, categoriesText, readBrandFilters } = await import("@/lib/brand-page");
const { countryEntries } = await import("@/lib/sitemap");

beforeEach(() => {
  api.brand = brand();
  api.search = { object: "list", data: [card(101, "HP EliteBook 840 G5"), card(102, "HP ProBook 450")], total: 30, tiers: null, offset: 0, limit: 24, sort: "newest" };
  api.paths = [];
});

const page = async (slug = "hp", query: Record<string, string> = {}, cc = "ng") => {
  const element = await BrandPage({ params: Promise.resolve({ cc, slug }), searchParams: Promise.resolve(query) });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};
const hrefs = (host: HTMLElement, selector: string) => [...host.querySelectorAll(selector)].map(link => link.getAttribute("href"));

describe("a brand's page", () => {
  it("shows the brand, its figures, categories, models, places and listings", async () => {
    const html = await page();
    expect(html.querySelector("h1")?.textContent).toBe("HP");
    expect(html.querySelector('img[alt="HP logo"]')?.getAttribute("src")).toBe("https://udozo.com/brand-logos/hp.svg");
    expect(html.textContent).toContain("30 HP listings for sale in Nigeria, from 7 sellers on Udozo.");
    expect([...html.querySelectorAll("dl dd")].map(item => item.textContent)).toEqual(["30", "7", "2", "2"]);
    expect(hrefs(html, '[aria-labelledby="by-category"] a')).toEqual(["/ng/brand/hp?category=laptops#listings", "/ng/brand/hp?category=printers#listings"]);
    expect(hrefs(html, '[aria-labelledby="models"] a')).toEqual(["/ng/brand/hp?model=EliteBook+840+G5#listings", "/ng/brand/hp?model=ProBook+450+G8#listings"]);
    // The models are one row slid sideways by hand (9 November 2026, the owner's request), never wrapping down the page.
    const models = html.querySelector('[aria-labelledby="models"] ul[aria-label="Popular HP models"]');
    expect(models?.className).toContain("overflow-x-auto");
    expect(models?.className).not.toContain("flex-wrap");
    // Its places open the state's page with the brand filter on.
    expect(hrefs(html, '[aria-labelledby="where"] a')).toEqual(["/ng/lagos?f=brand%3Ahp", "/ng/fct?f=brand%3Ahp"]);
    expect(html.querySelector("#listings-heading")?.textContent).toBe("All HP (30)");
    expect(hrefs(html, "#listings a[data-listing-ref]")).toEqual(["/ng/l/101-hp-elitebook-840-g5", "/ng/l/102-hp-probook-450"]);
    expect(html.querySelector('[aria-label="Pages"]')?.textContent).toContain("Page 1 of 2");
    expect(api.paths).toContain("/v1/classifieds/listings?country=NG&brand=hp&sort=newest&limit=24");
    // Never presented as the brand's own store.
    expect(html.textContent).toContain("Udozo is not HP's official store");
    const scripts = [...html.querySelectorAll('script[type="application/ld+json"]')].map(script => JSON.parse(script.textContent ?? "{}"));
    const collection = scripts.find(data => data["@type"] === "CollectionPage");
    expect(collection).toMatchObject({ url: "https://udozo.com/ng/brand/hp", about: { "@type": "Brand", name: "HP", logo: "https://udozo.com/brand-logos/hp.svg" }, mainEntity: { numberOfItems: 30 } });
    expect(scripts.some(data => data["@type"] === "Organization")).toBe(false);
    expect(scripts.some(data => data["@type"] === "BreadcrumbList")).toBe(true);
    expect(scripts.some(data => data["@type"] === "ItemList" && data.itemListElement?.length === 2)).toBe(true);
  });

  it("wears the banner Udozo's admins gave the brand, else the drawn one", async () => {
    const drawn = await page();
    expect(drawn.querySelector("section[aria-labelledby=brand-name] > div:first-child img")).toBeNull();
    api.brand = { ...api.brand!, banner_url: "https://media.test/hp-banner.jpg" };
    const html = await page();
    const banner = html.querySelector("section[aria-labelledby=brand-name] > div:first-child");
    expect(banner?.querySelector("img")?.getAttribute("src")).toBe("https://media.test/hp-banner.jpg");
    expect(banner?.className).toContain("aspect-[4/1]");
  });

  it("narrows by its own categories and models only, keeping the sort and resetting the page", async () => {
    const html = await page("hp", { category: "laptops", model: "elitebook 840 g5", sort: "price_asc", page: "2" });
    expect(api.paths).toContain("/v1/classifieds/listings?country=NG&brand=hp&sort=price_asc&limit=24&category=laptops&f=model%3Aelitebook+840+g5&offset=24");
    expect(html.querySelector("#listings-heading")?.textContent).toBe("EliteBook 840 G5 · Laptops (30)");
    expect(html.querySelector('[aria-labelledby="by-category"] a[aria-current="true"]')?.getAttribute("href")).toBe("/ng/brand/hp?category=laptops&model=EliteBook+840+G5&sort=price_asc#listings");
    // Choosing the chosen model again takes it off.
    expect(html.querySelector('[aria-labelledby="models"] a[aria-current="true"]')?.getAttribute("href")).toBe("/ng/brand/hp?category=laptops&sort=price_asc#listings");
    expect(hrefs(html, "#listings p a")).toContain("/ng/c/laptops?f=brand%3Ahp");

    const filters = readBrandFilters({ category: "phones", model: "Nokia 3310", sort: "best", page: "999" }, brand());
    expect(filters).toEqual({ category: null, model: null, sort: "newest", page: 42 });
    expect(readBrandFilters({}, brand({ categories: [{ ...brand().categories[0]!, listings: 0 }] }))).toEqual({ category: null, model: null, sort: "newest", page: 1 });
    expect(readBrandFilters({ category: "laptops" }, brand({ categories: [{ ...brand().categories[0]!, listings: 0 }] })).category).toBeNull();
  });

  it("with nothing for sale, points to selling one and the categories it sells in", async () => {
    api.brand = brand({ listings: 0, sellers: 0, models: [], states: [], categories: [{ slug: "laptops", name: "Laptops", icon: "laptop", parent: null, listings: 0 }] });
    const html = await page();
    expect(html.querySelector("#none-yet")?.textContent).toBe("No HP for sale in Nigeria yet");
    expect(hrefs(html, '[aria-labelledby="none-yet"] a')).toEqual(["/sell?from=direct", "/ng", "/ng/c/laptops"]);
    expect(html.querySelector("dl")).toBeNull();
    expect(api.paths.some(path => path.startsWith("/v1/classifieds/listings?"))).toBe(false);
  });

  it("is not found for an unknown brand, an address that cannot be one, or a closed market", async () => {
    api.brand = null;
    await expect(page("no-such")).rejects.toThrow("not-found");
    api.brand = brand();
    api.paths = [];
    await expect(page("NOT_A_SLUG")).rejects.toThrow("not-found");
    expect(api.paths).toEqual([]);
    await expect(page("hp", {}, "zz")).rejects.toThrow("not-found");
  });

  it("is indexed once enough is for sale, never filtered", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ cc: "ng", slug: "hp" }), searchParams: Promise.resolve({}) });
    expect(meta.title).toBe("HP for sale in Nigeria: 30 listings on Udozo");
    expect(meta.description).toContain("laptops and printers and scanners");
    expect(meta.alternates?.canonical).toBe("/ng/brand/hp");
    expect(meta.robots).toBeUndefined();
    expect((await generateMetadata({ params: Promise.resolve({ cc: "ng", slug: "hp" }), searchParams: Promise.resolve({ model: "x" }) })).robots).toEqual({ index: false, follow: true });
    api.brand = brand({ listings: 4 });
    expect((await generateMetadata({ params: Promise.resolve({ cc: "ng", slug: "hp" }), searchParams: Promise.resolve({}) })).robots).toEqual({ index: false, follow: true });
  });
});

describe("brand page helpers", () => {
  it("builds its addresses and words", () => {
    const filters = readBrandFilters({}, brand());
    expect(brandHref("ng", "hp", filters)).toBe("/ng/brand/hp");
    expect(brandHref("ng", "hp", { ...filters, page: 3 }, { sort: "price_desc" })).toBe("/ng/brand/hp?sort=price_desc#listings");
    expect(brandListingsQuery("ng", "hp", filters)).toBe("/v1/classifieds/listings?country=NG&brand=hp&sort=newest&limit=24");
    expect(brandIn("ng", { name: "Mercedes-Benz" }, { category: "cars" })).toBe("/ng/c/cars?f=brand%3Amercedes-benz");
    expect(brandStats(brand()).map(stat => stat.label)).toEqual(["Listings for sale", "Sellers", "Categories", "Places"]);
    expect(brandStats(brand({ listings: 1, sellers: 1, states: [brand().states[0]!], categories: [brand().categories[0]!] })).map(stat => stat.label)).toEqual(["Listing for sale", "Seller", "Category", "Place"]);
    expect(categoriesText(brand().categories)).toBe("laptops and printers and scanners");
    expect(categoriesText([...brand().categories, { ...brand().categories[0]!, slug: "x", name: "Monitors" }])).toBe("laptops, printers and scanners and 1 more");
    expect(categoriesText([])).toBeNull();
  });

  it("lists brands with enough for sale in the sitemap", () => {
    const sitemap: ShopSitemap = {
      object: "classified_sitemap",
      country: "NG",
      updated_at: "2026-11-01T09:00:00.000Z",
      categories: [],
      places: [],
      category_places: [],
      listing_pages: [],
      brands: [
        { slug: "hp", listings: 30, updated_at: "2026-11-05T10:00:00.000Z" },
        { slug: "dell", listings: 2, updated_at: "2026-11-04T10:00:00.000Z" },
      ],
    };
    expect(countryEntries("https://udozo.com", "ng", sitemap)).toEqual([
      { loc: "https://udozo.com/ng", lastmod: "2026-11-01T09:00:00.000Z" },
      { loc: "https://udozo.com/ng/brand/hp", lastmod: "2026-11-05T10:00:00.000Z" },
    ]);
  });
});
