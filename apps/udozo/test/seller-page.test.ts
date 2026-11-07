// @vitest-environment jsdom
// Every account's public seller page on udozo.com (`/ng/seller/<handle>`): who they are as their listings show them,
// their figures, what they sell and where, their listings by category with a sort and pages, and the contact panel,
// about the listing the buyer chooses; a seller from another market is sent to their own, an unknown one is not found.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopResult, ShopSearch, ShopSellerProfile, ShopViewer } from "@bitocard/api-client/classifieds";

const market = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 21, safe_pay: true, install_prompt: false };
const profile = (extra: Partial<ShopSellerProfile> = {}): ShopSellerProfile => ({
  object: "classified_seller",
  handle: "a1b2c3d4e5",
  name: "Chinedu O.",
  country: "NG",
  url: "https://udozo.com/ng/seller/a1b2c3d4e5",
  member_since: "2026-03-02T10:00:00.000Z",
  badges: ["phone_confirmed", "id_checked"],
  response_rate: 92,
  active_listings: 3,
  sold_listings: 4,
  safe_pay_sales: 2,
  last_listed_at: "2026-11-01T10:00:00.000Z",
  categories: [
    { slug: "tvs", name: "TVs", icon: "tv", parent: { slug: "electronics", name: "Electronics" }, listings: 2 },
    { slug: "mobile-phones", name: "Mobile phones", icon: "smartphone", parent: { slug: "phones-tablets", name: "Phones and tablets" }, listings: 1 },
  ],
  states: [
    { slug: "lagos", name: "Lagos", listings: 2 },
    { slug: "ogun", name: "Ogun", listings: 1 },
  ],
  contact: { chat: true, phone: true },
  contact_listings: [
    { id: "11111111-1111-4111-8111-111111111111", ref: 101, title: "Hisense 50 inch TV", slug: "hisense-50-inch-tv", currency: "NGN", chat: true, phone: true },
    { id: "22222222-2222-4222-8222-222222222222", ref: 102, title: "Tecno Spark 20", slug: "tecno-spark-20", currency: "NGN", chat: true, phone: false },
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
  price: { kind: "fixed", amount: 25000000, currency: "NGN" },
  condition: "used",
  category: { slug: "tvs", name: "TVs" },
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

const api = { profile: profile() as ShopSellerProfile | null, search: null as ShopSearch | null, paths: [] as string[], signedIn: false, viewer: null as ShopViewer | null };
vi.mock("@/lib/api", () => ({
  marketFor: async (cc: string) => (cc === "ng" ? market : null),
  shopApi: async (path: string) => {
    api.paths.push(path);
    if (path.startsWith("/v1/classifieds/sellers/")) return api.profile ? { ok: true, data: api.profile } : { ok: false, status: 404, code: "resource_missing" };
    if (path.startsWith("/v1/classifieds/listings?")) return api.search ? { ok: true, data: api.search } : { ok: false, status: 0, code: null };
    return { ok: false, status: 404, code: null };
  },
}));
const contactState = vi.fn(async (id: string) => ({ ok: true as const, data: { viewer: { ...viewer(), listing_id: id }, chat: null } }));
vi.mock("@/lib/customer", () => ({
  currentCustomer: async () => (api.signedIn ? { id: "c1", phone: "+2348031234567", phone_verified: true } : null),
  customerApi: async () => (api.viewer ? { ok: true, data: api.viewer } : { ok: false, status: 404, message: "No", code: null }),
  siteOrigin: () => "https://udozo.com",
}));
vi.mock("@/lib/listing-actions", () => ({ listingContactState: (id: string) => contactState(id), saveListing: vi.fn(), reportListing: vi.fn(), requestContact: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  permanentRedirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  usePathname: () => "/ng/seller/a1b2c3d4e5",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function viewer(extra: Partial<ShopViewer> = {}): ShopViewer {
  return { object: "classified_listing_viewer", listing_id: "11111111-1111-4111-8111-111111111111", own: false, favourite: false, conversation_id: null, order: null, can_contact: true, contact: { available: true, shared: null, request: null }, callback: { available: true, request: null }, seller_online: true, calls: false, ...extra };
}

const { default: SellerPage } = await import("@/app/[cc]/seller/[handle]/page");
const { SellerContactPanel } = await import("@/components/seller-contact");
const { placesText, readSellerFilters, sellerHref, sellerListingsQuery, sellerStats } = await import("@/lib/seller");

beforeEach(() => {
  api.profile = profile();
  api.search = { object: "list", data: [card(101, "Hisense 50 inch TV"), card(103, "LG 43 inch TV")], total: 30, tiers: null, offset: 0, limit: 24, sort: "newest" };
  api.paths = [];
  api.signedIn = false;
  api.viewer = null;
});

const page = async (handle = "a1b2c3d4e5", query: Record<string, string> = {}, cc = "ng") => {
  const element = await SellerPage({ params: Promise.resolve({ cc, handle }), searchParams: Promise.resolve(query) });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};

describe("a seller's page", () => {
  it("shows who they are, their figures, what they sell and where, and their listings", async () => {
    const html = await page();
    expect(html.querySelector("h1")?.textContent).toBe("Chinedu O.");
    // Initials until they add a photo, drawn above the banner (a positioned block), never under it.
    const head = html.querySelector('[aria-labelledby="seller-name"] .-mt-12');
    expect(head?.className.split(" ")).toEqual(expect.arrayContaining(["relative", "z-10"]));
    expect(head?.textContent).toContain("CO");
    expect(html.textContent).toContain("On Udozo since March 2026");
    expect(html.textContent).toContain("Sells in Lagos and Ogun");
    expect([...html.querySelectorAll('[aria-label="Checks"] li')].map(item => item.textContent?.trim())).toEqual(["Phone confirmed", "ID checked"]);
    expect([...html.querySelectorAll("dl dd")].map(item => item.textContent)).toEqual(["3", "4", "2", "92%"]);
    expect([...html.querySelectorAll('[aria-labelledby="sells"] a')].map(link => link.getAttribute("href"))).toEqual(["/ng/seller/a1b2c3d4e5?category=tvs#listings", "/ng/seller/a1b2c3d4e5?category=mobile-phones#listings"]);
    expect([...html.querySelectorAll('[aria-labelledby="where"] a')].map(link => link.getAttribute("href"))).toEqual(["/ng/lagos", "/ng/ogun"]);
    expect(html.querySelector("#listings-heading")?.textContent).toBe("All listings (30)");
    expect([...html.querySelectorAll("#listings a[data-listing-ref]")].map(link => link.getAttribute("href"))).toEqual(["/ng/l/101-hisense-50-inch-tv", "/ng/l/103-lg-43-inch-tv"]);
    expect(html.querySelector('[aria-label="Pages"]')?.textContent).toContain("Page 1 of 2");
    expect(html.querySelector('[aria-label="Pages"] a')?.getAttribute("href")).toBe("/ng/seller/a1b2c3d4e5?page=2#listings");
    expect(api.paths).toContain("/v1/classifieds/listings?country=NG&seller=a1b2c3d4e5&sort=newest&limit=24");
    // Signed out, the ways in ask to sign in first; the buyer picks which listing it is about.
    expect(html.querySelector('[aria-labelledby="contact"] select')?.querySelectorAll("option")).toHaveLength(2);
    expect(html.textContent).toContain("Chat with seller");
    // Reporting is for a listing's own page, not the seller's.
    expect([...html.querySelectorAll('[aria-labelledby="contact"] .hidden')].some(node => node.textContent?.includes("Report this listing"))).toBe(true);
    const scripts = [...html.querySelectorAll('script[type="application/ld+json"]')].map(script => JSON.parse(script.textContent ?? "{}"));
    expect(scripts.some(data => data["@type"] === "ProfilePage" && data.mainEntity.name === "Chinedu O.")).toBe(true);
  });

  it("shows their photo when they have one", async () => {
    api.profile = profile({ avatar_url: "https://media.test/me.jpg" });
    const html = await page();
    expect(html.querySelector('[aria-labelledby="seller-name"] img')?.getAttribute("src")).toBe("https://media.test/me.jpg");
    expect(html.querySelector('[aria-labelledby="seller-name"] img')?.getAttribute("alt")).toBe("Chinedu O.'s photo");
  });

  it("shows their own cover across the top when they have one, else Udozo's banner", async () => {
    api.profile = profile({ banner_url: "https://media.test/cover.jpg", avatar_url: "https://media.test/me.jpg" });
    const html = await page();
    const images = [...html.querySelectorAll('[aria-labelledby="seller-name"] img')].map(img => img.getAttribute("src"));
    expect(images).toEqual(["https://media.test/cover.jpg", "https://media.test/me.jpg"]);
    api.profile = profile();
    expect((await page()).querySelector('img[src="https://media.test/cover.jpg"]')).toBeNull();
  });

  it("filters by one of their categories with a sort and a page, and ignores anything else in the address", async () => {
    const html = await page("a1b2c3d4e5", { category: "tvs", sort: "price_asc", page: "2" });
    expect(api.paths).toContain("/v1/classifieds/listings?country=NG&seller=a1b2c3d4e5&sort=price_asc&limit=24&category=tvs&offset=24");
    expect(html.querySelector("#listings-heading")?.textContent).toBe("TVs (30)");
    expect(html.querySelector('[aria-label="Sort"] [aria-current]')?.textContent).toBe("Lowest price");
    expect(readSellerFilters({ category: "cars", sort: "cheapest", page: "-3" }, profile())).toEqual({ category: null, sort: "newest", page: 1 });
  });

  it("says when nothing is for sale; an unknown seller is not found; another market's seller is sent to theirs", async () => {
    api.profile = profile({ active_listings: 0, categories: [], states: [], contact_listings: [] });
    api.search = { object: "list", data: [], total: 0, tiers: null, offset: 0, limit: 24, sort: "newest" };
    const empty = await page();
    expect(empty.textContent).toContain("Nothing for sale right now");
    expect(empty.textContent).toContain("Chinedu O. has sold 4 on Udozo.");
    expect(empty.textContent).toContain("has nothing for sale to ask about right now");

    api.profile = null;
    await expect(page()).rejects.toThrow("not-found");
    await expect(page("NOT_A_HANDLE")).rejects.toThrow("not-found");
    api.profile = profile({ country: "GH" });
    await expect(page()).rejects.toThrow("redirect:/gh/seller/a1b2c3d4e5");
  });
});

describe("the contact panel", () => {
  const mounted: Array<() => void> = [];
  afterEach(() => {
    mounted.splice(0).forEach(unmount => unmount());
    document.body.innerHTML = "";
    contactState.mockClear();
  });
  const mount = (props: Partial<Parameters<typeof SellerContactPanel>[0]> = {}) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(SellerContactPanel, { cc: "ng", seller: "Chinedu O.", listings: profile().contact_listings, first: { viewer: viewer(), chat: null }, signedIn: true, myPhone: null, ...props })));
    mounted.push(() => act(() => root.unmount()));
    return host;
  };

  it("asks about the listing the buyer chooses, reading what they have with it", async () => {
    const host = mount();
    expect(host.textContent).toContain("Chat with seller");
    expect(host.textContent).toContain("Request call back");
    expect(host.querySelector(".hidden")?.textContent).toContain("Report this listing");
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "22222222-2222-4222-8222-222222222222";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(contactState).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
    expect(host.textContent).toContain("Chat with seller");
  });

  it("tells sellers it is their own page", () => {
    const host = mount({ first: { viewer: viewer({ own: true }), chat: null } });
    expect(host.textContent).toContain("This is your seller page");
  });
});

describe("the page's helpers", () => {
  it("words places and figures", () => {
    expect(placesText([{ slug: "lagos", name: "Lagos", listings: 3 }])).toBe("Lagos");
    expect(placesText(profile().states)).toBe("Lagos and Ogun");
    expect(placesText([...profile().states, { slug: "oyo", name: "Oyo", listings: 1 }, { slug: "fct", name: "FCT", listings: 1 }])).toBe("Lagos, Ogun and 2 more");
    expect(placesText([])).toBeNull();
    expect(sellerStats(profile({ response_rate: null, active_listings: 1 })).map(stat => [stat.value, stat.label])).toEqual([
      ["1", "Listing for sale"],
      ["4", "Sold on Udozo"],
      ["2", "Safe pay sales"],
      ["New", "Too few chats to say"],
    ]);
    expect(sellerHref("NG", "a1b2c3d4e5", { category: "tvs", sort: "price_desc", page: 3 })).toBe("/ng/seller/a1b2c3d4e5?category=tvs&sort=price_desc&page=3");
    expect(sellerListingsQuery("ng", "a1b2c3d4e5", { category: null, sort: "newest", page: 1 })).toBe("/v1/classifieds/listings?country=NG&seller=a1b2c3d4e5&sort=newest&limit=24");
  });
});
