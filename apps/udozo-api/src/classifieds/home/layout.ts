import { z } from 'zod';
import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error.js';
import { base, href, imageUrl, text, trustBar } from '../../storefront/layout.js';
import { conditions } from '../rules.js';

/**
 * udozo.com's home pages (the global one, `/`, and each country's, `/<cc>`): Udozo's own sections, managed by its admins
 * in the home page editor. Kept apart from bitocard.com's and resellers' store sections; they share the grid (`span`),
 * links, image addresses, the trust bar and the `layout_invalid` errors naming the field.
 */

/** Which page a layout is for: every country at once (no prices, cards naming their country) or one country. */
export type HomeScope = 'global' | 'country';

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a category slug such as phones-tablets.').max(80);

/** Where a slide, banner or tile goes: a category (the page's country's, or across countries), a search, or a page. */
export const homeLink = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('category'), slug }),
  z.object({ kind: z.literal('search'), q: text(80).min(1) }),
  z.object({ kind: z.literal('href'), href }),
]);
export type HomeLink = z.infer<typeof homeLink>;

/** The top of the page: the search with a title, a carousel of slides (up to five), or a short welcome. */
const homeHero = z.object({
  ...base,
  type: z.literal('home_hero'),
  style: z.enum(['search', 'carousel', 'minimal']).default('search'),
  title: text(80).min(1),
  accent: text(80).default(''),
  subtitle: text(200).default(''),
  slides: z.array(z.object({ image: imageUrl, title: text(80).min(1), subtitle: text(160).default(''), link: homeLink })).max(5).default([]),
});

export const tileSizes = ['sm', 'wide', 'tall', 'lg'] as const;

/** Categories as a masonry of photo tiles: the ones chosen, in order and size, or (none chosen) the busiest ones. */
const categoryMasonry = z.object({
  ...base,
  type: z.literal('category_masonry'),
  title: text(80).default('Shop by category'),
  tiles: z.array(z.object({ slug, size: z.enum(tileSizes).default('sm'), image: imageUrl.nullable().default(null) })).max(12).default([]),
  /** How many of the busiest categories, when none are chosen. */
  limit: z.number().int().min(4).max(12).default(8),
});

/** Listings whose price came down lately (country pages: prices are each country's own). */
const dealsRail = z.object({
  ...base,
  type: z.literal('deals_rail'),
  title: text(80).default('Trending deals'),
  days: z.number().int().min(7).max(30).default(14),
  limit: z.number().int().min(4).max(24).default(12),
  category: slug.nullable().default(null),
});

/** Listings Udozo's team placed (Sponsored placements), each labelled Sponsored. */
const sponsoredRail = z.object({
  ...base,
  type: z.literal('sponsored_rail'),
  title: text(80).default('Sponsored'),
  limit: z.number().int().min(1).max(12).default(8),
});

/** What sold most through Safe pay in 30 days; while too few have, the most contacted, titled `fallbackTitle`. */
const topSellingRail = z.object({
  ...base,
  type: z.literal('top_selling_rail'),
  title: text(80).default('Top selling'),
  fallbackTitle: text(80).default('Popular'),
  minimum: z.number().int().min(1).max(12).default(4),
  limit: z.number().int().min(4).max(24).default(12),
});

export const groupKinds = ['category', 'area', 'condition', 'newest', 'trending'] as const;

/** A group of listings: a category's, a place's (state or area), a condition's, the newest or the trending ones. */
const listingGroup = z
  .object({
    ...base,
    type: z.literal('listing_group'),
    title: text(80).min(1),
    by: z.enum(groupKinds).default('newest'),
    /** The category's slug, the state's or area's slug, or the condition. */
    value: z.string().trim().toLowerCase().max(80).nullable().default(null),
    display: z.enum(['rail', 'grid']).default('rail'),
    limit: z.number().int().min(4).max(24).default(8),
    viewAll: z.boolean().default(true),
  })
  .superRefine((item, ctx) => {
    if ((item.by === 'category' || item.by === 'area' || item.by === 'condition') && !item.value) ctx.addIssue({ code: 'custom', message: 'Choose which one.', path: ['value'] });
    if (item.by === 'condition' && item.value && !(conditions as readonly string[]).includes(item.value)) ctx.addIssue({ code: 'custom', message: 'Choose new, used, foreign used or for parts.', path: ['value'] });
  });

/** One or two banners, each with an optional photo, linking to a category, a search or a page. */
const banner = z.object({
  ...base,
  type: z.literal('banner'),
  items: z
    .array(z.object({ image: imageUrl.nullable().default(null), title: text(80).min(1), body: text(160).default(''), link: homeLink, tone: z.enum(['navy', 'brand', 'light']).default('navy') }))
    .min(1)
    .max(2),
});

/** The global page's countries: each open market with its flag and listings, choosing it (remembered) when opened. */
const countryTiles = z.object({
  ...base,
  type: z.literal('country_tiles'),
  title: text(80).default('Shop by country'),
  /** Only these, in this order; none: every open market. */
  countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a country code such as NG.')).max(20).default([]),
});

/** A listing's number on udozo.com (its ref), as admins pick it: digits only. */
const listingRef = z.string().trim().regex(/^\d{1,18}$/, 'Choose a listing.');
const speed = z.enum(['slow', 'normal', 'fast']).default('normal');
const direction = z.enum(['left', 'right']).default('left');

export const marqueeFills = ['none', 'newest', 'trending', 'category', 'deals'] as const;

/**
 * Listings sliding past on their own (a marquee): the ones admins picked, in their order (a sold or expired one drops
 * out), topped up from a source to `limit`. Pausable, and still for visitors who ask for reduced motion.
 */
const listingMarquee = z
  .object({
    ...base,
    type: z.literal('listing_marquee'),
    title: text(80).default(''),
    picks: z.array(listingRef).max(24).default([]),
    fill: z.object({ by: z.enum(marqueeFills).default('trending'), value: slug.nullable().default(null) }).default({ by: 'trending', value: null }),
    limit: z.number().int().min(6).max(30).default(12),
    speed,
    direction,
    cards: z.enum(['standard', 'compact']).default('standard'),
  })
  .superRefine((item, ctx) => {
    if (item.fill.by === 'category' && !item.fill.value) ctx.addIssue({ code: 'custom', message: 'Choose the category to fill from.', path: ['fill', 'value'] });
    if (item.fill.by === 'none' && item.picks.length === 0) ctx.addIssue({ code: 'custom', message: 'Pick listings, or choose where to fill it from.', path: ['picks'] });
  });

export const storeFills = ['none', 'most_listings', 'newest'] as const;

/** Resellers' stores (Resale shops live on their own domain) sliding past: the ones admins picked, topped up to `limit`. */
const storeMarquee = z
  .object({
    ...base,
    type: z.literal('store_marquee'),
    title: text(80).default('Shops on Udozo'),
    picks: z.array(z.string().uuid('Choose a store.')).max(24).default([]),
    fill: z.enum(storeFills).default('most_listings'),
    limit: z.number().int().min(3).max(24).default(12),
    speed,
    direction,
  })
  .superRefine((item, ctx) => {
    if (item.fill === 'none' && item.picks.length === 0) ctx.addIssue({ code: 'custom', message: 'Pick stores, or choose how to fill it.', path: ['picks'] });
  });

/** A masonry of tiles of any kind: a category, a listing, or a photo linking where the page's links may go. */
const masonryTile = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('category'), slug, size: z.enum(tileSizes).default('sm'), image: imageUrl.nullable().default(null) }),
  z.object({ kind: z.literal('listing'), ref: listingRef, size: z.enum(tileSizes).default('sm') }),
  z.object({ kind: z.literal('image'), image: imageUrl, title: text(80).default(''), link: homeLink, size: z.enum(tileSizes).default('sm') }),
]);
const masonryGrid = z.object({
  ...base,
  type: z.literal('masonry_grid'),
  title: text(80).default(''),
  tiles: z.array(masonryTile).min(1, 'Add a tile.').max(16),
});

/** A banner for one category, linking to it: its name, a live listing's photo and its count unless set. */
const categoryBanner = z.object({
  ...base,
  type: z.literal('category_banner'),
  category: slug,
  /** Empty: the category's own name. */
  title: text(80).default(''),
  body: text(160).default(''),
  /** None: a photo of one of its live listings. */
  image: imageUrl.nullable().default(null),
  tone: z.enum(['navy', 'brand', 'light']).default('navy'),
  style: z.enum(['split', 'overlay']).default('split'),
  cta: text(30).default('Shop now'),
  showCount: z.boolean().default(true),
});

/** A block: what a row holds. Every section type of before, and the marquees, masonry grids and category banners. */
export const homeBlock = z.discriminatedUnion('type', [homeHero, categoryMasonry, dealsRail, sponsoredRail, topSellingRail, listingGroup, banner, countryTiles, trustBar, listingMarquee, storeMarquee, masonryGrid, categoryBanner]);
export type HomeBlock = z.infer<typeof homeBlock>;
export type HomeBlockType = HomeBlock['type'];
export const homeBlockTypes = [
  'home_hero',
  'category_masonry',
  'deals_rail',
  'sponsored_rail',
  'top_selling_rail',
  'listing_group',
  'banner',
  'country_tiles',
  'trust_bar',
  'listing_marquee',
  'store_marquee',
  'masonry_grid',
  'category_banner',
] as const satisfies readonly HomeBlockType[];
/** A block is what a section was (the resolver and the old editor's word). */
export type HomeSection = HomeBlock;
export type HomeSectionType = HomeBlockType;

/** What each page offers: no deals across countries (they have no prices), country tiles only there. */
export const blocksFor = (scope: HomeScope): readonly HomeBlockType[] => homeBlockTypes.filter(type => (scope === 'global' ? type !== 'deals_rail' : type !== 'country_tiles'));

export const rowBackgrounds = ['none', 'soft', 'navy', 'brand', 'image'] as const;

/** A row of the page: an optional heading and "See all", its background, width and spacing, and up to six blocks. */
export const homeRow = z
  .object({
    id: z.string().trim().min(1).max(60),
    hidden: z.boolean().default(false),
    title: text(80).default(''),
    subtitle: text(200).default(''),
    viewAll: homeLink.nullable().default(null),
    background: z.enum(rowBackgrounds).default('none'),
    image: imageUrl.nullable().default(null),
    width: z.enum(['contained', 'full']).default('contained'),
    spacing: z.enum(['tight', 'normal', 'loose']).default('normal'),
    blocks: z.array(homeBlock).min(1, 'Add a block to this row, or delete it.').max(6, 'A row holds up to six blocks.'),
  })
  .superRefine((row, ctx) => {
    if (row.background === 'image' && !row.image) ctx.addIssue({ code: 'custom', message: 'Upload the background photo, or choose another background.', path: ['image'] });
  });
export type HomeRow = z.infer<typeof homeRow>;

export const maxRows = 20;
export const maxBlocks = 40;

export const homeRows = z
  .array(homeRow)
  .max(maxRows, `A page holds up to ${maxRows} rows.`)
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    let blocks = 0;
    rows.forEach((row, index) => {
      if (seen.has(row.id)) ctx.addIssue({ code: 'custom', message: 'Each row needs its own id.', path: [index, 'id'] });
      seen.add(row.id);
      row.blocks.forEach((block, n) => {
        blocks += 1;
        if (seen.has(block.id)) ctx.addIssue({ code: 'custom', message: 'Each block needs its own id.', path: [index, 'blocks', n, 'id'] });
        seen.add(block.id);
      });
    });
    if (blocks > maxBlocks) ctx.addIssue({ code: 'custom', message: `A page holds up to ${maxBlocks} blocks.`, path: [] });
  });

type Issue = { code: 'custom'; message: string; path: PropertyKey[] };

/** Links a page can follow: across countries there is no search to send people to, so only categories and pages. */
function linkIssues(link: HomeLink | null, path: PropertyKey[], scope: HomeScope): Issue[] {
  return link && scope === 'global' && link.kind === 'search' ? [{ code: 'custom', message: 'Across countries, link to a category or a page: searches belong to a country.', path: [...path, 'kind'] }] : [];
}

/** The page's own rules for a block (its path given): its type, its links and (across countries) what it lists. */
function blockIssues(item: HomeBlock, path: PropertyKey[], scope: HomeScope): Issue[] {
  if (!blocksFor(scope).includes(item.type)) return [{ code: 'custom', message: scope === 'global' ? 'This block needs a country page.' : 'This block is for the page across countries.', path: [...path, 'type'] }];
  if (item.type === 'home_hero') return item.slides.flatMap((slide, n) => linkIssues(slide.link, [...path, 'slides', n, 'link'], scope));
  if (item.type === 'banner') return item.items.flatMap((entry, n) => linkIssues(entry.link, [...path, 'items', n, 'link'], scope));
  if (item.type === 'masonry_grid') return item.tiles.flatMap((tile, n) => (tile.kind === 'image' ? linkIssues(tile.link, [...path, 'tiles', n, 'link'], scope) : []));
  if (item.type === 'listing_group' && scope === 'global' && item.by !== 'newest' && item.by !== 'trending') return [{ code: 'custom', message: 'Across countries, group the newest or the trending listings.', path: [...path, 'by'] }];
  if (item.type === 'listing_marquee' && scope === 'global' && (item.fill.by === 'category' || item.fill.by === 'deals')) return [{ code: 'custom', message: 'Across countries, fill from the newest or the trending listings.', path: [...path, 'fill', 'by'] }];
  return [];
}

function rowIssues(rows: HomeRow[], scope: HomeScope): Issue[] {
  return rows.flatMap((row, index) => [...linkIssues(row.viewAll, [index, 'viewAll'], scope), ...row.blocks.flatMap((block, n) => blockIssues(block, [index, 'blocks', n], scope))]);
}

/** A page refused: the first issue, with `param` naming its field (for example `rows[2].blocks[1].title`). */
export function invalidRows(issues: Array<{ path: PropertyKey[]; message: string }>) {
  const first = issues[0]!;
  const param = `rows${first.path.map(part => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('')}`;
  return new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'layout_invalid', first.message, param);
}

/** Parses a page's rows (defaults filled in) or throws `layout_invalid` naming the field, as `rows[2].blocks[0].title`. */
export function parseHomeRows(input: unknown, scope: HomeScope): HomeRow[] {
  const parsed = homeRows.safeParse(input);
  if (!parsed.success) throw invalidRows(parsed.error.issues);
  const issues = rowIssues(parsed.data, scope);
  if (issues.length) throw invalidRows(issues);
  return parsed.data;
}

/** Rows as stored, read with today's rules: blocks a page no longer offers are left out, and rows left empty with them. */
export function readRows(input: unknown, scope: HomeScope): HomeRow[] | null {
  const parsed = homeRows.safeParse(input);
  if (!parsed.success) return null;
  const allowed = blocksFor(scope);
  return parsed.data.map(row => ({ ...row, blocks: row.blocks.filter(block => allowed.includes(block.type)) })).filter(row => row.blocks.length > 0);
}

/** Sections as pages were before rows: a flat list, each on the 12-column grid. */
export const homeSections = z.array(homeBlock).max(30);

/**
 * Pages from before rows, as rows that look the same: sections side by side (their desktop widths adding up to 12 at
 * most) share a row, a full-width one has its own, and a hero is always alone, edge to edge as before. No titles or
 * backgrounds: each section keeps its own heading.
 */
export function rowsFromSections(sections: HomeBlock[]): HomeRow[] {
  const rows: HomeRow[] = [];
  let current: HomeBlock[] = [];
  let width = 0;
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    rows.push({ id: `r-${first.id}`.slice(0, 60), hidden: current.every(block => block.hidden), title: '', subtitle: '', viewAll: null, background: 'none', image: null, width: first.type === 'home_hero' ? 'full' : 'contained', spacing: 'normal', blocks: current });
    current = [];
    width = 0;
  };
  for (const section of sections) {
    if (section.type === 'home_hero' || width + section.span.lg > 12 || current.length === 6) flush();
    current.push(section);
    width += section.span.lg;
    if (section.type === 'home_hero') flush();
  }
  flush();
  return rows;
}

/** Every block of the rows, in order (the page as a flat list, for what still reads one). */
export const blocksOf = (rows: HomeRow[]) => rows.flatMap(row => row.blocks);
