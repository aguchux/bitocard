import "server-only";
import { query, shopApi } from "./api";
import { safeBannerHref } from "./banners";

/** How a hero column is split, top to bottom, in thirds of its height (the API's `heroLayouts`). */
export type HeroLayout = "full" | "third_two_thirds" | "two_thirds_third" | "thirds";
export const heroRows: Record<HeroLayout, number[]> = { full: [3], third_two_thirds: [1, 2], two_thirds_third: [2, 1], thirds: [1, 1, 1] };

/**
 * A banner: its image, or (none uploaded) `photos` of what it links to (a category's, brand's or seller's live
 * listings, or a listing's own), drawn as a collage under its words.
 */
export type HeroTile = { id: string; image_url: string | null; photos?: string[]; alt: string; href: string | null; ad: boolean };
export type HeroSlide = { object: "hero_slide"; id: string; layout: HeroLayout; tiles: HeroTile[] };

/** A tile as the page draws it: its link a page here or an https address elsewhere (else none). */
export type ShownTile = Omit<HeroTile, "href" | "photos"> & { photos: string[]; link: { href: string; external: boolean } | null };
export type ShownSlide = { id: string; layout: HeroLayout; tiles: ShownTile[] };

/**
 * The hero reel's columns for a home page (`page`: a market's code, or `global`), read from Udozo's API and kept a
 * minute: the market's own first, then those for every market. A column whose banners do not fit its split, or with a
 * banner that has neither an https image nor an https photo of its listings, is left out; a link that is not safe is dropped (the banner shows without one). Empty while
 * there are none or the API cannot answer: the page then keeps its own hero.
 */
export async function heroSlidesFor(page: string): Promise<ShownSlide[]> {
  const result = await shopApi<{ data: HeroSlide[] }>(`/v1/classifieds/hero-slides${query({ page })}`);
  return result.ok ? shownSlides(result.data.data) : [];
}

const https = (url: string | null | undefined): url is string => typeof url === "string" && /^https:\/\//.test(url);

const tileOk = (tile: HeroTile) => (tile.image_url ? https(tile.image_url) : (tile.photos ?? []).some(https));

export function shownSlides(slides: HeroSlide[]): ShownSlide[] {
  return slides
    .filter(slide => heroRows[slide.layout] && slide.tiles.length === heroRows[slide.layout].length && slide.tiles.every(tileOk))
    .map(slide => ({
      id: slide.id,
      layout: slide.layout,
      tiles: slide.tiles.map(({ href, photos, ...tile }) => ({ ...tile, photos: tile.image_url ? [] : (photos ?? []).filter(https), link: href ? safeBannerHref(href) : null })),
    }));
}

/**
 * How many of a banner's photos its collage shows, and how they are laid out, by the banner's rows (a third of the
 * column, two thirds or all of it): as many as fit evenly, never a gap.
 */
const collageGrids: Record<number, Array<[count: number, grid: string]>> = {
  1: [[3, "grid-cols-3"], [2, "grid-cols-2"], [1, "grid-cols-1"]],
  2: [[4, "grid-cols-2 grid-rows-2"], [2, "grid-cols-2"], [1, "grid-cols-1"]],
  3: [[6, "grid-cols-2 grid-rows-3"], [4, "grid-cols-2 grid-rows-2"], [2, "grid-cols-1 grid-rows-2"], [1, "grid-cols-1"]],
};
export function collageOf(photos: string[], rows: number): { photos: string[]; grid: string } {
  const [count, grid] = (collageGrids[rows] ?? collageGrids[1]!).find(([count]) => photos.length >= count) ?? [0, "grid-cols-1"];
  return { photos: photos.slice(0, count), grid };
}

/** Enough columns to fill the widest screens and keep the loop going: the list repeated, each repeat marked. */
export function filledSlides<T>(slides: T[], least = 6): Array<{ slide: T; repeat: number }> {
  if (!slides.length) return [];
  const out: Array<{ slide: T; repeat: number }> = [];
  for (let repeat = 0; out.length < least; repeat += 1) for (const slide of slides) out.push({ slide, repeat });
  return out;
}
