import { categoryPath, listingPath, placePath, type ShopSitemap } from "@bitocard/api-client/classifieds";
import { indexFrom } from "./search";

/** One sitemap's limit (the protocol allows 50,000 addresses). */
export const sitemapLimit = 50_000;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type SitemapEntry = { loc: string; lastmod?: string; images?: string[] };

/** A urlset, with Google's image extension for pages that carry photos (a listing's, at most five). */
export function urlset(entries: SitemapEntry[]) {
  const body = entries
    .map(entry => {
      const images = (entry.images ?? []).filter(url => url.startsWith("https://")).slice(0, 5).map(url => `<image:image><image:loc>${escape(url)}</image:loc></image:image>`).join("");
      return `<url><loc>${escape(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${escape(entry.lastmod)}</lastmod>` : ""}${images}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`;
}

export function sitemapIndex(locations: string[]) {
  const body = locations.map(loc => `<sitemap><loc>${escape(loc)}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}

/**
 * A country's addresses: its home, every category with live listings, every state and area with enough of them to be
 * indexed (thinner ones are `noindex`), and its listings (live, or sold in the last 30 days), from the API's pages.
 */
export function countryEntries(origin: string, cc: string, pages: ShopSitemap[]) {
  const first = pages[0];
  const at = (path: string) => new URL(path, origin).href;
  const entries: SitemapEntry[] = [{ loc: at(`/${cc}`) }];
  if (!first) return entries;
  for (const category of first.categories) if (category.listings > 0) entries.push({ loc: at(categoryPath(cc, category.slug)) });
  for (const place of first.places) if (place.listings >= indexFrom) entries.push({ loc: at(placePath(cc, { state: place.state, area: place.area })) });
  for (const page of pages) for (const listing of page.listings) entries.push({ loc: at(listingPath(cc, listing.ref, listing.slug)), lastmod: listing.updated_at, images: listing.images });
  return entries.slice(0, sitemapLimit);
}
