/**
 * udozo.com's hero reel on Home (apps/udozo/lib/hero.ts): which columns are shown, how each banner's photos are laid
 * out when it has no image, the columns repeated so the reel can loop, and where it moves next. Kept free of React
 * Native so it runs under `node --test`.
 */
import type { ShopHeroLayout, ShopHeroSlide, ShopHeroTile } from '@shared/classifieds';

/** Each banner's share of its column, top to bottom, in thirds (the API's `heroLayouts`). */
export const heroRows: Record<ShopHeroLayout, number[]> = {
  full: [3],
  third_two_thirds: [1, 2],
  two_thirds_third: [2, 1],
  thirds: [1, 1, 1],
};

/** A banner as Home draws it: an https image, or https photos for a collage; a link the app can open, else none. */
export type ShownTile = Omit<ShopHeroTile, 'href' | 'photos'> & {
  photos: string[];
  href: string | null;
  rows: number;
};
export type ShownSlide = {
  id: string;
  layout: ShopHeroLayout;
  tiles: ShownTile[];
};

const https = (url: string | null | undefined): url is string => typeof url === 'string' && /^https:\/\//.test(url);

/** A link Home may open: a page of udozo.com (`/…`, never `//…`), or an https address. */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) return href;
  try {
    return new URL(href).protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

/**
 * The columns Home shows, in the API's order (the market's own first, then every market's). A column whose banners do
 * not fit its split, or with a banner that has neither an https image nor an https photo, is left out; a link that is
 * not safe is dropped (the banner shows without one).
 */
export function shownSlides(slides: ShopHeroSlide[] | null | undefined): ShownSlide[] {
  if (!Array.isArray(slides)) return [];
  return slides
    .filter(
      slide => heroRows[slide.layout] && slide.tiles?.length === heroRows[slide.layout].length && slide.tiles.every(tile => (tile.image_url ? https(tile.image_url) : (tile.photos ?? []).some(https))),
    )
    .map(slide => ({
      id: slide.id,
      layout: slide.layout,
      tiles: slide.tiles.map((tile, at) => ({
        id: tile.id,
        image_url: tile.image_url,
        alt: tile.alt,
        ad: tile.ad,
        photos: tile.image_url ? [] : (tile.photos ?? []).filter(https),
        href: safeHref(tile.href),
        rows: heroRows[slide.layout][at] ?? 1,
      })),
    }));
}

/**
 * A banner's collage by its rows (a third of the column, two thirds or all of it): as many photos as fit evenly, never
 * a gap, in `columns` across and `rows` down.
 */
const collageGrids: Record<number, [count: number, columns: number, rows: number][]> = {
  1: [
    [3, 3, 1],
    [2, 2, 1],
    [1, 1, 1],
  ],
  2: [
    [4, 2, 2],
    [2, 2, 1],
    [1, 1, 1],
  ],
  3: [
    [6, 2, 3],
    [4, 2, 2],
    [2, 1, 2],
    [1, 1, 1],
  ],
};
export function collageOf(photos: string[], rows: number): { photos: string[]; columns: number; rows: number } {
  const [count, columns, down] = (collageGrids[rows] ?? collageGrids[1]!).find(([count]) => photos.length >= count) ?? [0, 1, 1];
  return { photos: photos.slice(0, count), columns, rows: down };
}

/**
 * Enough columns to loop: whole copies of the list, at least `least` columns and always two copies more than one, so a
 * full screen of columns follows the last original whichever column the reel stands on. Each copy is marked; only the
 * first (`repeat` 0) is read by screen readers.
 */
export function filledSlides<T>(slides: T[], least = 6): { slide: T; repeat: number }[] {
  if (!slides.length) return [];
  const want = Math.max(least, slides.length * 3);
  const out: { slide: T; repeat: number }[] = [];
  for (let repeat = 0; out.length < want; repeat += 1) for (const slide of slides) out.push({ slide, repeat });
  return out;
}

/**
 * The reel's next step on its own, from the column it stands on (`index`) with `count` original columns: one column
 * on; past the first copy it first jumps back a copy (`jump`, unseen, as the copies are the same), so it never runs out.
 */
export function reelAdvance(index: number, count: number): { jump: number | null; to: number } {
  if (count <= 0) return { jump: null, to: 0 };
  const at = Math.max(0, Math.round(index));
  if (at >= count) return { jump: at - count, to: at - count + 1 };
  return { jump: null, to: at + 1 };
}

/** Where the reel settles after a swipe: back into the first copy, unseen, once it is past it. */
export const reelSettle = (index: number, count: number) => (count > 0 && index >= count ? index % count : Math.max(0, index));

/** How wide a column is on a screen this wide: most of a phone's width, at most 440 points (udozo.com's `w-[78vw]`). */
export const columnWidth = (screen: number) => Math.round(Math.min(screen * 0.78, 440));
