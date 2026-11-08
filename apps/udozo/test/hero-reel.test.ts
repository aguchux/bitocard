// udozo.com's hero reel (8 November 2026): the home page's top below the header, columns three rows high (one banner,
// a third and two thirds either way up, or three thirds), 6 px apart on white with small rounded corners, sliding past and moved by hand.
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

const { collageOf, filledSlides, heroSlidesFor, shownSlides } = await import("@/lib/hero");
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

  it("draws three rows a column, 6 px apart on white, small rounded corners, links where they go, Ad in the link's words", () => {
    const html = renderToStaticMarkup(createElement(HeroReel, { slides: shownSlides(slides).slice(0, 2), title: "Udozo Nigeria: buy and sell near you" }));
    expect(html).toContain('<h1 class="sr-only">Udozo Nigeria: buy and sell near you</h1>');
    expect(html).toContain("grid-template-rows:repeat(3, minmax(0, 1fr))");
    // White behind the columns, 6 px between them and between their banners, so the gaps show.
    expect(html).toMatch(/<section aria-label="Featured" class="bg-white py-1\.5">/);
    expect(html).toMatch(/class="flex shrink-0 gap-1\.5 pr-1\.5/);
    expect(html).toMatch(/<li data-hero-slide="s1" class="grid [^"]*gap-1\.5/);
    const columns = html.match(/<li[^]*?<\/li>/g) ?? [];
    // 6 columns, and the marquee's copy of them.
    expect(columns.length).toBe(12);
    // Each banner has small rounded corners (6 px, as wide as the gaps).
    for (const column of columns) expect(column).toMatch(/class="relative block min-h-0 overflow-hidden rounded-md /);
    // The full banner spans the three rows and opens its listing here; the big one two rows, outside in a new tab.
    expect(html).toMatch(/<a class="relative block min-h-0 overflow-hidden rounded-md bg-navy-100 group row-span-3" href="\/ng\/l\/100123-iphone-13">/);
    // Each linked banner fades and its colours shift under the pointer or keyboard focus; one without a link stays still.
    expect(html).toMatch(/alt="iPhone 13 deals"[^>]*class="[^"]*group-hover:opacity-85 group-hover:saturate-150 group-hover:hue-rotate-15[^"]*motion-reduce|motion-reduce[^"]*group-hover:opacity-85/);
    expect(html).toMatch(/class="size-full object-cover select-none "[^>]*alt="Sell on Udozo"|alt="Sell on Udozo"[^>]*class="size-full object-cover select-none "/);
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

  it("a banner without an image shows photos of its listings under its words, as many as fit its size evenly", () => {
    const photo = (n: number) => `https://media.udozo.test/l/${n}.jpg`;
    const bare = [
      {
        object: "hero_slide" as const,
        id: "c1",
        layout: "third_two_thirds" as const,
        tiles: [
          { id: "p1", image_url: null, photos: [1, 2, 3, 4, 5].map(photo), alt: "Mobile phones", href: "/ng/c/mobile-phones", ad: false },
          { id: "p2", image_url: null, photos: [6, 7, 8, 9, 10].map(photo), alt: "Samsung", href: "/ng/brand/samsung", ad: true },
        ],
      },
      // No photos (nothing for sale there) and no image: left out.
      { object: "hero_slide" as const, id: "empty", layout: "full" as const, tiles: [{ id: "p3", image_url: null, photos: [], alt: "Nothing", href: "/ng/c/x", ad: false }] },
      // Photos that are not https are dropped, never drawn.
      { object: "hero_slide" as const, id: "mixed", layout: "full" as const, tiles: [{ id: "p4", image_url: null, photos: ["http://plain.test/a.jpg", photo(11)], alt: "Adaeze", href: "/ng/seller/adaeze", ad: false }] },
    ];
    const shown = shownSlides(bare);
    expect(shown.map(slide => slide.id)).toEqual(["c1", "mixed"]);
    expect(shown[1]!.tiles[0]!.photos).toEqual([photo(11)]);
    // A third of the column: up to three across; two thirds: four, two by two; the whole column: six, two by three.
    expect(collageOf([1, 2, 3, 4, 5].map(photo), 1)).toEqual({ photos: [1, 2, 3].map(photo), grid: "grid-cols-3" });
    expect(collageOf([1, 2, 3].map(photo), 2)).toEqual({ photos: [1, 2].map(photo), grid: "grid-cols-2" });
    expect(collageOf([1, 2, 3, 4, 5].map(photo), 3).photos.length).toBe(4);
    expect(collageOf([1, 2, 3, 4, 5, 6, 7].map(photo), 3)).toEqual({ photos: [1, 2, 3, 4, 5, 6].map(photo), grid: "grid-cols-2 grid-rows-3" });
    expect(collageOf([photo(1)], 3)).toEqual({ photos: [photo(1)], grid: "grid-cols-1" });

    const html = renderToStaticMarkup(createElement(HeroReel, { slides: shown.slice(0, 1), title: "Udozo" }));
    expect(html).toMatch(/<span data-hero-collage="3" class="grid size-full gap-px bg-white grid-cols-3">/);
    expect(html).toMatch(/<span data-hero-collage="4" class="grid size-full gap-px bg-white grid-cols-2 grid-rows-2">/);
    // The photos are the background: the banner's words name the link, with Ad at the top when it is one.
    expect(html).toMatch(/<a class="[^"]*row-span-1" href="\/ng\/c\/mobile-phones"><span data-hero-collage[^]*?<img src="https:\/\/media\.udozo\.test\/l\/1\.jpg" alt=""/);
    expect(html).toMatch(/>Mobile phones<\/span><\/a>/);
    expect(html).toMatch(/>Samsung<\/span><span class="absolute top-1\.5 left-1\.5[^"]*">Ad<\/span>/);
  });

  it("takes the place of the home page's own hero on the market and global home pages", () => {
    const sections = readFileSync("components/home/home-sections.tsx", "utf8");
    expect(sections).toContain("{hero ? hero : leadHero ? (");
    expect(sections).toContain("{hero ? hero : leadHero ? <Hero");
    for (const page of ["app/[cc]/page.tsx", "app/(global)/page.tsx"]) expect(readFileSync(page, "utf8")).toMatch(/hero=\{slides\.length \? <HeroReel/);
  });
});
