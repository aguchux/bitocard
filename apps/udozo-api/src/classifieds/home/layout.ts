import { z } from 'zod';
import { base, href, imageUrl, invalidLayout, text, trustBar } from '../../storefront/layout.js';
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
    if (item.by === 'condition' && item.value && !(conditions as readonly string[]).includes(item.value)) ctx.addIssue({ code: 'custom', message: 'Choose new, used, untested or for parts.', path: ['value'] });
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

export const homeSection = z.discriminatedUnion('type', [homeHero, categoryMasonry, dealsRail, sponsoredRail, topSellingRail, listingGroup, banner, countryTiles, trustBar]);
export type HomeSection = z.infer<typeof homeSection>;
export type HomeSectionType = HomeSection['type'];
export const homeSectionTypes = ['home_hero', 'category_masonry', 'deals_rail', 'sponsored_rail', 'top_selling_rail', 'listing_group', 'banner', 'country_tiles', 'trust_bar'] as const satisfies readonly HomeSectionType[];

/** What each page offers: no deals across countries (they have no prices), country tiles only there. */
export const sectionsFor = (scope: HomeScope): readonly HomeSectionType[] => homeSectionTypes.filter(type => (scope === 'global' ? type !== 'deals_rail' : type !== 'country_tiles'));

export const homeSections = z
  .array(homeSection)
  .max(30)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((item, index) => {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', message: 'Each section needs its own id.', path: [index, 'id'] });
      seen.add(item.id);
    });
  });

type Issue = { code: 'custom'; message: string; path: PropertyKey[] };

/** Links a page can follow: across countries there is no search to send people to, so only categories and pages. */
function linkIssues(link: HomeLink, path: PropertyKey[], scope: HomeScope): Issue[] {
  return scope === 'global' && link.kind === 'search' ? [{ code: 'custom', message: 'Across countries, link to a category or a page: searches belong to a country.', path: [...path, 'kind'] }] : [];
}

/** The page's own rules on top of the schema: its sections, its links and (across countries) which groups. */
function scopeIssues(list: HomeSection[], scope: HomeScope): Issue[] {
  const allowed = sectionsFor(scope);
  return list.flatMap((item, index): Issue[] => {
    if (!allowed.includes(item.type)) return [{ code: 'custom', message: scope === 'global' ? 'This section needs a country page.' : 'This section is for the page across countries.', path: [index, 'type'] }];
    if (item.type === 'home_hero') return item.slides.flatMap((slide, n) => linkIssues(slide.link, [index, 'slides', n, 'link'], scope));
    if (item.type === 'banner') return item.items.flatMap((entry, n) => linkIssues(entry.link, [index, 'items', n, 'link'], scope));
    if (item.type === 'listing_group' && scope === 'global' && item.by !== 'newest' && item.by !== 'trending') return [{ code: 'custom', message: 'Across countries, group the newest or the trending listings.', path: [index, 'by'] }];
    return [];
  });
}

/** Parses a page's sections (defaults filled in) or throws `layout_invalid` naming the field, as `sections[2].title`. */
export function parseHomeSections(input: unknown, scope: HomeScope): HomeSection[] {
  const parsed = homeSections.safeParse(input);
  if (!parsed.success) throw invalidLayout(parsed.error.issues);
  const issues = scopeIssues(parsed.data, scope);
  if (issues.length) throw invalidLayout(issues);
  return parsed.data;
}
