import { categoryPath, listingPath, placePath, type ShopSitemap, type ShopSitemapListings } from "@bitocard/api-client/classifieds";
import type { ResaleStoreSitemap } from "@bitocard/api-client/storefront";
import { legalDocuments } from "./legal";
import { resaleListingPath } from "./resale-links";
import { indexFrom } from "./search";

/** One sitemap's limit (the protocol allows 50,000 addresses); beyond it the addresses go on in the next file. */
export const sitemapLimit = 50_000;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type SitemapEntry = { loc: string; lastmod?: string | null; images?: string[] };
const lastmod = (value?: string | null) => (value ? `<lastmod>${escape(value)}</lastmod>` : "");

/** A urlset, with Google's image extension for pages that carry photos (a listing's, at most five). */
export function urlset(entries: SitemapEntry[]) {
  const body = entries
    .map(entry => {
      const images = (entry.images ?? []).filter(url => url.startsWith("https://")).slice(0, 5).map(url => `<image:image><image:loc>${escape(url)}</image:loc></image:image>`).join("");
      return `<url><loc>${escape(entry.loc)}</loc>${lastmod(entry.lastmod)}${images}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`;
}

export function sitemapIndex(locations: Array<string | SitemapEntry>) {
  const body = locations
    .map(location => (typeof location === "string" ? { loc: location } : location))
    .map(entry => `<sitemap><loc>${escape(entry.loc)}</loc>${lastmod(entry.lastmod)}</sitemap>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}

/**
 * A country's pages: its home, every category open there (an empty one is still an indexed page), and every state, area
 * and category in a place with enough listings to be indexed (thinner ones are `noindex`, so a sitemap never names them).
 * Its listings are separate (`listingEntries`), and past one file's limit `countryFiles` makes as many as both need.
 */
export function countryEntries(origin: string, cc: string, sitemap: ShopSitemap) {
  const at = (path: string) => new URL(path, origin).href;
  const entries: SitemapEntry[] = [{ loc: at(`/${cc}`), lastmod: sitemap.updated_at }];
  for (const category of sitemap.categories) entries.push({ loc: at(categoryPath(cc, category.slug)), lastmod: category.updated_at });
  for (const place of sitemap.places) if (place.listings >= indexFrom) entries.push({ loc: at(placePath(cc, { state: place.state, area: place.area })), lastmod: place.updated_at });
  for (const place of sitemap.category_places) if (place.listings >= indexFrom) entries.push({ loc: at(placePath(cc, place)), lastmod: place.updated_at });
  return entries;
}

/** The pages across countries: Start here (sellers' landing page), the Safe Trade Guide, the legal documents, and the showcase and its categories once it is on. */
export function mainEntries(origin: string, showcaseCategories: string[] | null) {
  const entries: SitemapEntry[] = [{ loc: `${origin}/start-here` }, { loc: `${origin}/safe-trade` }, { loc: `${origin}/help/faqs` }, { loc: `${origin}/help/contact` }, { loc: `${origin}/legal` }, ...legalDocuments.map(doc => ({ loc: `${origin}/legal/${doc.slug}` }))];
  return showcaseCategories ? [{ loc: `${origin}/` }, ...entries, ...showcaseCategories.map(slug => ({ loc: `${origin}/c/${slug}` }))] : entries;
}

/** A file of a country's listings (live, or sold in the last 30 days). */
export function listingEntries(origin: string, cc: string, file: ShopSitemapListings): SitemapEntry[] {
  return file.listings.map(listing => ({ loc: new URL(listingPath(cc, listing.ref, listing.slug), origin).href, lastmod: listing.updated_at, images: listing.images }));
}

/** A store's own sitemap: its home, its whole range, each category on sale there and each listing, on the store's own address. */
export function storeEntries(origin: string, sitemap: ResaleStoreSitemap): SitemapEntry[] {
  const at = (path: string) => new URL(path, origin).href;
  const newest = sitemap.listings.map(listing => listing.updated_at).sort().at(-1) ?? null;
  return [
    { loc: at("/"), lastmod: newest },
    { loc: at("/listings"), lastmod: newest },
    ...sitemap.categories.map(slug => ({ loc: at(`/listings?category=${encodeURIComponent(slug)}`) })),
    ...sitemap.listings.map(listing => ({ loc: at(resaleListingPath(listing)), lastmod: listing.updated_at, images: listing.images })),
  ];
}

/** The addresses of a country's sitemap files. `app/sitemaps/[file]` serves them; `readSitemapFile` reads them back. */
const pagesFile = (cc: string, page: number) => `/sitemaps/${cc}-pages-${page}.xml`;
const listingsFile = (cc: string, after: number) => `/sitemaps/${cc}-listings-${after}.xml`;

export type SitemapFile = { cc: string; kind: "pages"; page: number } | { cc: string; kind: "listings"; after: number };

/** Which file an address names, or null: lower-case two-letter countries and plain numbers only. */
export function readSitemapFile(file: string): SitemapFile | null {
  const match = /^([a-z]{2})-(pages|listings)-(\d{1,15})\.xml$/.exec(file);
  if (!match) return null;
  const [, cc, kind, number] = match as unknown as [string, string, "pages" | "listings", string];
  return kind === "pages" ? { cc, kind, page: Number(number) } : { cc, kind, after: Number(number) };
}

/** One file of a country's pages (0 first). */
export const pagesInFile = (entries: SitemapEntry[], page: number) => entries.slice(page * sitemapLimit, (page + 1) * sitemapLimit);

/** Every sitemap file of a country, each with its newest change: as many as its pages and listings need. */
export function countryFiles(origin: string, cc: string, sitemap: ShopSitemap): SitemapEntry[] {
  const pages = Math.max(1, Math.ceil(countryEntries(origin, cc, sitemap).length / sitemapLimit));
  return [
    ...Array.from({ length: pages }, (_, page) => ({ loc: `${origin}${pagesFile(cc, page)}`, lastmod: sitemap.updated_at })),
    ...sitemap.listing_pages.map(file => ({ loc: `${origin}${listingsFile(cc, file.after)}`, lastmod: file.updated_at })),
  ];
}

/**
 * A sitemap: built on each request from live data, and kept an hour by Vercel's CDN (served while it is refreshed, for
 * a day at most), so a new market, category or listing shows within the hour.
 */
export const sitemapResponse = (xml: string) => new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });

/**
 * The API cannot answer. Search engines come back for a 503 and keep what they have; a shorter sitemap, or an empty one,
 * would read as those pages being gone. Never kept by the CDN.
 */
export const sitemapUnavailable = () => new Response("Try again shortly.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "600" } });

export const sitemapMissing = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
