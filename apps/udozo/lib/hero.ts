import "server-only";
import { query, shopApi } from "./api";
import { safeBannerHref } from "./banners";

/** How a hero column is split, top to bottom, in thirds of its height (the API's `heroLayouts`). */
export type HeroLayout = "full" | "third_two_thirds" | "two_thirds_third" | "thirds";
export const heroRows: Record<HeroLayout, number[]> = { full: [3], third_two_thirds: [1, 2], two_thirds_third: [2, 1], thirds: [1, 1, 1] };

export type HeroTile = { id: string; image_url: string; alt: string; href: string | null; ad: boolean };
export type HeroSlide = { object: "hero_slide"; id: string; layout: HeroLayout; tiles: HeroTile[] };

/** A tile as the page draws it: its link a page here or an https address elsewhere (else none). */
export type ShownTile = Omit<HeroTile, "href"> & { link: { href: string; external: boolean } | null };
export type ShownSlide = { id: string; layout: HeroLayout; tiles: ShownTile[] };

/**
 * The hero reel's columns for a home page (`page`: a market's code, or `global`), read from Udozo's API and kept a
 * minute: the market's own first, then those for every market. A column whose images are not https or whose banners
 * do not fit its split is left out; a link that is not safe is dropped (the banner shows without one). Empty while
 * there are none or the API cannot answer: the page then keeps its own hero.
 */
export async function heroSlidesFor(page: string): Promise<ShownSlide[]> {
  const result = await shopApi<{ data: HeroSlide[] }>(`/v1/classifieds/hero-slides${query({ page })}`);
  return result.ok ? shownSlides(result.data.data) : [];
}

export function shownSlides(slides: HeroSlide[]): ShownSlide[] {
  return slides
    .filter(slide => heroRows[slide.layout] && slide.tiles.length === heroRows[slide.layout].length && slide.tiles.every(tile => /^https:\/\//.test(tile.image_url)))
    .map(slide => ({ id: slide.id, layout: slide.layout, tiles: slide.tiles.map(({ href, ...tile }) => ({ ...tile, link: href ? safeBannerHref(href) : null })) }));
}

/** Enough columns to fill the widest screens and keep the loop going: the list repeated, each repeat marked. */
export function filledSlides<T>(slides: T[], least = 6): Array<{ slide: T; repeat: number }> {
  if (!slides.length) return [];
  const out: Array<{ slide: T; repeat: number }> = [];
  for (let repeat = 0; out.length < least; repeat += 1) for (const slide of slides) out.push({ slide, repeat });
  return out;
}
