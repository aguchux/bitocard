// udozo.com's home pages as Udozo's admins lay them out: the hero first, edge to edge; every section on a grid that is
// one column on phones; empty sections left out; Sponsored listings saying so in their own words (and their link's
// name); deals with their "was" price; masonry tiles sized; countries chosen through /market/<cc>; across countries no
// price; and the plain page whenever the API cannot give the managed one.
import { request } from "./request";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClassifiedHome, HomeCard, ResolvedHomeSection } from "@bitocard/api-client/home";

const api = { home: null as null | ClassifiedHome };
vi.mock("@/lib/api", () => ({
  markets: async () => ({ showcase: true, data: [{ object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 21, safe_pay: false, install_prompt: false }] }),
  marketFor: async (cc: string) => (cc === "ng" ? { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 21, safe_pay: false, install_prompt: false } : null),
  shopApi: async (path: string) => {
    if (path.startsWith("/v1/classifieds/home")) return api.home ? { ok: true, data: api.home } : { ok: false, status: 0, code: null };
    return { ok: true, data: { object: "list", data: [], total: 0 } };
  },
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); }, redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

const { HomeSections, firstListingSection } = await import("@/components/home/home-sections");
const { default: CountryHome } = await import("@/app/[cc]/page");

const span = { lg: 12 as const, md: 6 as const, rows: 1 as const };
const card = (id: string, extra: Partial<HomeCard> = {}): HomeCard =>
  ({
    object: "classified_listing_card",
    id,
    ref: Number(id.replace(/\D/g, "")) || 1,
    title: `Item ${id}`,
    slug: "item",
    country: "NG",
    url: "",
    price: { kind: "fixed", amount: 2000000, currency: "NGN" },
    condition: "used",
    category: null,
    area: { slug: "ikeja", name: "Ikeja", state: { slug: "lagos", name: "Lagos" } },
    cover: null,
    photo_count: 0,
    has_video: false,
    highlights: [],
    delivery: "none",
    seller: { name: "Ada O.", badges: [] },
    published_at: "2026-11-01T10:00:00.000Z",
    ...extra,
  }) as HomeCard;

const home = (sections: ResolvedHomeSection[], scope: "global" | "country" = "country"): ClassifiedHome => ({
  object: "classified_home",
  page: scope === "global" ? "global" : "NG",
  name: scope === "global" ? "All countries" : "Nigeria",
  scope,
  layout: "marketplace",
  look: { hero: "navy", cards: "standard", corners: "soft", density: "comfortable" },
  source: "published",
  version: 1,
  sections,
});

const hero: ResolvedHomeSection = { id: "h", type: "home_hero", span, hidden: false, style: "search", title: "Buy and sell near you", accent: "protected by Safe pay", subtitle: "", slides: [], data: { slides: [] } };

describe("a managed home page", () => {
  it("runs its hero edge to edge, then a grid that is one column on phones; empty sections are left out", () => {
    const html = renderToStaticMarkup(
      createElement(HomeSections, {
        home: home([
          hero,
          { id: "e", type: "sponsored_rail", span, hidden: false, title: "Sponsored", limit: 8, data: { items: [] } },
          { id: "g", type: "listing_group", span: { lg: 6, md: 3, rows: 1 }, hidden: false, title: "Just listed", by: "newest", value: null, display: "rail", limit: 8, viewAll: true, data: { items: [card("l1")], view_all_href: "/ng/search?sort=newest" } },
          { id: "x", type: "listing_group", span, hidden: true, title: "Hidden one", by: "newest", value: null, display: "rail", limit: 8, viewAll: true, data: { items: [card("l2")], view_all_href: null } },
        ]),
      }),
    );
    expect(html).toMatch(/^<div data-home-layout="marketplace"><section class="bg-navy-900 text-white/);
    expect(html).toContain("<h1");
    expect(html).toContain('grid max-w-[1400px] grid-cols-1');
    expect(html).toContain("md:col-span-3 lg:col-span-6");
    expect(html).not.toContain("Sponsored");
    expect(html).not.toContain("Hidden one");
    expect(html).toContain('href="/ng/search?sort=newest"');
  });

  it("labels Sponsored listings in visible words that are part of the link's name, and shows deals' was price", () => {
    const html = renderToStaticMarkup(
      createElement(HomeSections, {
        home: home([
          { id: "s", type: "sponsored_rail", span, hidden: false, title: "Sponsored", limit: 8, data: { items: [card("l3", { sponsored: true })] } },
          { id: "d", type: "deals_rail", span, hidden: false, title: "Trending deals", days: 14, limit: 12, category: null, data: { items: [card("l4", { was_price: 2600000 })], view_all_href: null } },
        ]),
      }),
    );
    // Inside the listing's link: the badge's words, then its price and title.
    expect(html).toMatch(/<a [^>]*href="\/ng\/l\/3-item"[^>]*>(?:(?!<\/a>)[\s\S])*?Sponsored<span class="sr-only">: <\/span><\/span>(?:(?!<\/a>)[\s\S])*?Item l3/);
    expect(html).toMatch(/<s class="text-xs text-navy-500"><span class="sr-only">was <\/span>₦26,000<\/s>/);
  });

  it("sizes masonry tiles, chooses countries through /market/<cc>, and never shows a price across countries", () => {
    const html = renderToStaticMarkup(
      createElement(HomeSections, {
        home: home(
          [
            { id: "m", type: "category_masonry", span, hidden: false, title: "Shop by category", tiles: [], limit: 8, data: { tiles: [{ slug: "phones-tablets", name: "Phones and tablets", icon: "smartphone", listings: 12, size: "lg", image: "https://media.test/p.jpg", href: "/c/phones-tablets" }, { slug: "vehicles", name: "Vehicles", icon: "car", listings: 1, size: "wide", image: null, href: "/c/vehicles" }] } },
            { id: "c", type: "country_tiles", span, hidden: false, title: "Shop by country", countries: [], data: { countries: [{ country: "NG", name: "Nigeria", listings: 21, href: "/market/ng" }] } },
            { id: "t", type: "top_selling_rail", span, hidden: false, title: "Top selling", fallbackTitle: "Popular", minimum: 4, limit: 12, data: { basis: "popular", heading: "Popular", items: [card("l5", { price: undefined, country: "GH" })] } },
          ],
          "global",
        ),
      }),
    );
    expect(html).toMatch(/<li class="col-span-2 md:row-span-2"><a [^>]*href="\/c\/phones-tablets"/);
    expect(html).toMatch(/<li class="col-span-2"><a [^>]*href="\/c\/vehicles"/);
    expect(html).toContain("1 listing<");
    expect(html).toContain('<a href="/market/ng" rel="nofollow"');
    // Top selling while too few have sold: titled as the admins chose, never claiming sales.
    expect(html).toContain(">Popular</h2>");
    expect(html).not.toMatch(/₦|GH₵/);
    expect(html).toMatch(/Ikeja,<\/span><span class="-ml-1 shrink-0">Ghana</);
  });

  it("gives search engines the first ordinary listing section, never the Sponsored one", () => {
    const page = home([
      { id: "s", type: "sponsored_rail", span, hidden: false, title: "Sponsored", limit: 8, data: { items: [card("l6", { sponsored: true })] } },
      { id: "g", type: "listing_group", span, hidden: false, title: "Just listed", by: "newest", value: null, display: "grid", limit: 8, viewAll: true, data: { items: [card("l7")], view_all_href: null } },
    ]);
    expect(firstListingSection(page)).toEqual({ title: "Just listed", cards: [card("l7")] });
  });
});

describe("the country's home page", () => {
  it("shows the managed page, and the plain one whenever the API cannot give it", async () => {
    request.cookies = new Map();
    api.home = home([hero]);
    const managed = renderToStaticMarkup(await CountryHome({ params: Promise.resolve({ cc: "ng" }) }));
    expect(managed).toContain('data-home-layout="marketplace"');
    api.home = null;
    const plain = renderToStaticMarkup(await CountryHome({ params: Promise.resolve({ cc: "ng" }) }));
    expect(plain).not.toContain("data-home-layout");
    expect(plain).toContain("New across Nigeria");
  });
});
