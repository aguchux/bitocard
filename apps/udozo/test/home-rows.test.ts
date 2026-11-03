// udozo.com's home pages in rows (docs/UDOZO_HOME_ROWS_PLAN.md): each row with its background, heading and "See all";
// marquees sliding their items twice (the copy hidden and inert) with a Pause button; resellers' stores opening their
// own site; banners opening their category; the editor's preview marks (only in preview) and its framing (only there).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClassifiedHome, HomeCard, ResolvedHomeRow, ResolvedHomeSection } from "@bitocard/api-client/home";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { HomeSections } = await import("@/components/home/home-sections");
const { isEditorMessage, previewParents } = await import("@/lib/preview");

const span = { lg: 12 as const, md: 6 as const, rows: 1 as const };
const half = { lg: 6 as const, md: 3 as const, rows: 1 as const };
const card = (id: string): HomeCard =>
  ({
    object: "classified_listing_card",
    id,
    ref: 1,
    title: `Item ${id}`,
    slug: "item",
    country: "NG",
    url: `/ng/l/1-${id}`,
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
  }) as HomeCard;

const row = (id: string, blocks: ResolvedHomeSection[], extra: Partial<ResolvedHomeRow> = {}): ResolvedHomeRow => ({
  id,
  hidden: false,
  title: "",
  subtitle: "",
  viewAll: null,
  view_all_href: null,
  background: "none",
  image: null,
  width: "contained",
  spacing: "normal",
  blocks,
  ...extra,
});
const page = (rows: ResolvedHomeRow[]): ClassifiedHome => ({
  object: "classified_home",
  page: "NG",
  name: "Nigeria",
  scope: "country",
  layout: "marketplace",
  look: { hero: "navy", cards: "standard", corners: "soft", density: "comfortable" },
  source: "published",
  version: 1,
  rows,
  sections: rows.flatMap(item => item.blocks),
});
const marquee = (id: string, items: HomeCard[]): ResolvedHomeSection => ({ id, type: "listing_marquee", span, hidden: false, title: "Trending", picks: [], fill: { by: "trending", value: null }, limit: 12, speed: "fast", direction: "right", cards: "standard", data: { items } });
const html = (home: ClassifiedHome, preview = false) => renderToStaticMarkup(createElement(HomeSections, { home, preview }));

describe("rows", () => {
  it("draws each row with its background, heading and See all; rows with nothing to show are left out; a hero row runs edge to edge", () => {
    const out = html(
      page([
        row("h", [{ id: "hero", type: "home_hero", span, hidden: false, style: "search", title: "Buy and sell near you", accent: "", subtitle: "", slides: [], data: { slides: [] } }], { width: "full" }),
        row("r1", [marquee("m", [card("a"), card("b")])], { title: "Trending now", subtitle: "What people look at", background: "navy", view_all_href: "/ng/search" }),
        row("empty", [marquee("m2", [])], { title: "Nothing" }),
      ]),
    );
    expect(out).toContain("Buy and sell near you");
    expect(out).toContain("Trending now");
    expect(out).toContain("What people look at");
    expect(out).toMatch(/class="[^"]*bg-navy-900 text-white/);
    expect(out).toContain('href="/ng/search"');
    expect(out).not.toContain("Nothing");
    expect(out).not.toContain("data-home-block", "never marked outside the editor's preview");
  });

  it("marks rows and blocks for the editor only in its preview", () => {
    const out = html(page([row("r1", [marquee("m", [card("a")])])]), true);
    expect(out).toContain('data-home-row="r1"');
    expect(out).toContain('data-home-block="m"');
  });
});

describe("marquees", () => {
  it("slide their items twice, the copy hidden and inert, with a Pause button, its speed and direction", () => {
    const out = html(page([row("r1", [marquee("m", [card("a"), card("b"), card("c")])])]));
    expect(out.match(/Item a/g)).toHaveLength(2);
    expect(out).toMatch(/<ul aria-hidden="true" inert=""[^>]*class="marquee-copy/);
    expect(out).toContain('data-direction="right"');
    expect(out).toContain("--marquee-duration:12s");
    expect(out).toContain("Pause Trending");
  });

  it("show resellers' stores opening their own site, initials where there is no logo", () => {
    const stores: ResolvedHomeSection = {
      id: "s",
      type: "store_marquee",
      span,
      hidden: false,
      title: "Shops on Udozo",
      picks: [],
      fill: "most_listings",
      limit: 12,
      speed: "normal",
      direction: "left",
      data: { stores: [{ object: "home_store", id: "s1", name: "Gadget Hub", logo_url: null, primary_color: "#123456", url: "https://gadgethub.ng", country: "NG", listings: 14 }] },
    };
    const out = html(page([row("r", [stores])]));
    expect(out).toContain('href="https://gadgethub.ng"');
    expect(out).toContain(">GH<");
    expect(out).toContain("14 listings");
  });
});

describe("category banners and masonry grids", () => {
  it("a banner opens its category with its name, count and call; a masonry grid links each tile", () => {
    const out = html(
      page([
        row("r", [
          { id: "b", type: "category_banner", span: half, hidden: false, category: "phones-tablets", title: "", body: "Near you", image: null, tone: "brand", style: "split", cta: "Shop phones", showCount: true, data: { category: { slug: "phones-tablets", name: "Phones and tablets", icon: "smartphone", listings: 1200 }, title: "Phones and tablets", image: null, href: "/ng/c/phones-tablets" } },
          { id: "g", type: "masonry_grid", span: half, hidden: false, title: "Picked for you", tiles: [], data: { tiles: [{ kind: "image", size: "wide", title: "Sell now", image: "https://media.test/p.jpg", href: "/sell" }] } },
        ]),
      ]),
    );
    expect(out).toContain('href="/ng/c/phones-tablets"');
    expect(out).toContain("Phones and tablets");
    expect(out).toContain("1,200 listings");
    expect(out).toContain("Shop phones");
    expect(out).toContain('href="/sell"');
    expect(out).toContain("col-span-2");
  });

  it("a banner whose category is not open shows nothing", () => {
    const out = html(page([row("r", [{ id: "b", type: "category_banner", span, hidden: false, category: "gone", title: "Gone", body: "", image: null, tone: "navy", style: "split", cta: "", showCount: true, data: { category: null } }], { title: "Hidden row" })]));
    expect(out).not.toContain("Hidden row");
  });
});

describe("the editor's preview", () => {
  it("is framed only on /home-preview and only by Udozo's admin", async () => {
    const config = (await import("../next.config")).default;
    const headers = await config.headers!();
    const preview = headers.filter(entry => entry.source === "/home-preview").flatMap(entry => entry.headers);
    expect(preview.find(header => header.key === "Content-Security-Policy")?.value).toContain("frame-ancestors 'self' https://admin.udozo.com");
    expect(headers.filter(entry => entry.source === "/:path*").flatMap(entry => entry.headers).some(header => header.key === "Content-Security-Policy")).toBe(false);
  });

  it("follows only the editor's own messages, from Udozo's admin", () => {
    expect(previewParents({ NODE_ENV: "production" })).toEqual(["https://admin.udozo.com"]);
    expect(previewParents({ NODE_ENV: "development" })).toContain("http://localhost:3012");
    expect(isEditorMessage({ source: "udozo-editor", type: "refresh" })).toBe(true);
    expect(isEditorMessage({ source: "udozo-editor", type: "focus", id: "abc" })).toBe(true);
    expect(isEditorMessage({ source: "udozo-editor", type: "navigate", href: "https://evil.test" })).toBe(false);
    expect(isEditorMessage({ source: "someone", type: "refresh" })).toBe(false);
  });
});
