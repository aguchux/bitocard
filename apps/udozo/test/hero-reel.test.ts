// udozo.com's hero reel (8 November 2026): the home page's top below the header, columns three rows high (one banner,
// a third and two thirds either way up, or three thirds), 2 px apart and square-cornered, sliding past and moved by hand.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const answer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/api", () => ({
  query: (params: Record<string, string>) => `?${new URLSearchParams(params)}`,
  shopApi: async (path: string) => (path === "/v1/classifieds/hero-slides?page=NG" && answer.value ? { ok: true, data: answer.value } : { ok: false, status: 0, code: null }),
}));

const { filledSlides, heroSlidesFor, shownSlides } = await import("@/lib/hero");
const { HeroReel } = await import("@/components/home/hero-reel");

const image = (name: string) => `https://cdn.udozo.test/platform/hero/images/${name}.jpg`;
const slides = [
  { object: "hero_slide" as const, id: "s1", layout: "full" as const, tiles: [{ id: "t1", image_url: image("full"), alt: "iPhone 13 deals", href: "/ng/l/100123-iphone-13", ad: true }] },
  {
    object: "hero_slide" as const,
    id: "s2",
    layout: "two_thirds_third" as const,
    tiles: [
      { id: "t2", image_url: image("big"), alt: "Solar panels 20% off", href: "https://partner.example.com/offer", ad: true },
      { id: "t3", image_url: image("small"), alt: "Sell on Udozo", href: null, ad: false },
    ],
  },
  { object: "hero_slide" as const, id: "bad", layout: "thirds" as const, tiles: [{ id: "t4", image_url: image("a"), alt: "x", href: "/ng", ad: true }] },
  { object: "hero_slide" as const, id: "plain", layout: "full" as const, tiles: [{ id: "t5", image_url: "http://insecure.test/a.jpg", alt: "x", href: "/ng", ad: true }] },
  { object: "hero_slide" as const, id: "unsafe", layout: "full" as const, tiles: [{ id: "t6", image_url: image("u"), alt: "Unsafe link", href: "javascript:alert(1)", ad: true }] },
];

describe("the hero reel's columns", () => {
  it("leaves out columns that do not fit their split or whose images are not https, and drops unsafe links", async () => {
    const shown = shownSlides(slides);
    expect(shown.map(slide => slide.id)).toEqual(["s1", "s2", "unsafe"]);
    expect(shown[1]!.tiles.map(tile => tile.link)).toEqual([{ href: "https://partner.example.com/offer", external: true }, null]);
    expect(shown[2]!.tiles[0]!.link).toBeNull();
    answer.value = { object: "list", page: "NG", data: slides };
    expect((await heroSlidesFor("NG")).length).toBe(3);
    // Nothing while the API cannot answer: the page keeps its own hero.
    expect(await heroSlidesFor("GH")).toEqual([]);
  });

  it("few columns are repeated to fill the widest screens", () => {
    expect(filledSlides(["a", "b"]).map(item => `${item.slide}${item.repeat}`)).toEqual(["a0", "b0", "a1", "b1", "a2", "b2"]);
    expect(filledSlides([])).toEqual([]);
    expect(filledSlides([1, 2, 3, 4, 5, 6, 7]).length).toBe(7);
  });

  it("draws three rows a column, 2 px apart, square-cornered, links where they go, Ad in the link's words", () => {
    const html = renderToStaticMarkup(createElement(HeroReel, { slides: shownSlides(slides).slice(0, 2), title: "Udozo Nigeria: buy and sell near you" }));
    expect(html).toContain('<h1 class="sr-only">Udozo Nigeria: buy and sell near you</h1>');
    expect(html).toContain("grid-template-rows:repeat(3, minmax(0, 1fr))");
    expect(html).toMatch(/gap-0\.5/);
    const columns = html.match(/<li[^]*?<\/li>/g) ?? [];
    // 6 columns, and the marquee's copy of them.
    expect(columns.length).toBe(12);
    for (const column of columns) expect(column).not.toMatch(/rounded/);
    // The full banner spans the three rows and opens its listing here; the big one two rows, outside in a new tab.
    expect(html).toMatch(/<a class="relative block min-h-0 overflow-hidden bg-navy-100 row-span-3" href="\/ng\/l\/100123-iphone-13">/);
    expect(html).toMatch(/<a href="https:\/\/partner\.example\.com\/offer" target="_blank" rel="sponsored noopener" class="[^"]*row-span-2"/);
    expect(html).toMatch(/<div class="[^"]*row-span-1"><img[^>]*alt="Sell on Udozo"/);
    expect(html).toMatch(/alt="Solar panels 20% off"[^>]*\/><span[^>]*>Ad<\/span>/);
    // Repeats (filling the screen) are hidden from screen readers and the tab order.
    expect(html).toMatch(/<li aria-hidden="true" data-hero-slide="s1"/);
    expect(html).toMatch(/tabindex="-1"/);
    // The first column's image loads at once; the reel can be paused.
    expect(html).toMatch(/fetchPriority="high"|fetchpriority="high"/);
    expect(html).toMatch(/Pause Featured on Udozo/);
  });

  it("takes the place of the home page's own hero on the market and global home pages", () => {
    const sections = readFileSync("components/home/home-sections.tsx", "utf8");
    expect(sections).toContain("{hero ? hero : leadHero ? (");
    expect(sections).toContain("{hero ? hero : leadHero ? <Hero");
    for (const page of ["app/[cc]/page.tsx", "app/(global)/page.tsx"]) expect(readFileSync(page, "utf8")).toMatch(/hero=\{slides\.length \? <HeroReel/);
  });
});
