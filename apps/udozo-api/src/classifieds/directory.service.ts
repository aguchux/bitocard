import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { WatermarkService } from '../watermarks/watermarks.service.js';
import { ListingsService, shopOrigin } from './listings.service.js';
import { onShopWhere } from './rules.js';
import { ListingSearchService, soldVisibleMs } from './search.service.js';

/** The global showcase opens with the second market (owner's decision: Nigeria first, without it). */
export const showcaseFrom = 2;
/** Listing addresses per sitemap file. */
export const sitemapPage = 5000;
/** A category in a place joins the sitemap from this many live listings there (udozo.com's `indexFrom`: thinner pages are `noindex`). */
export const sitemapPlaceFrom = 5;

type ListingPageRow = { last_ref: bigint | number; listings: bigint | number; updated_at: Date };
type SellerRow = { handle: string; listings: bigint | number; updated_at: Date };

/** Each file of a country's listings: the number it starts after (the last one of the file before), its size and its newest change. */
export const listingPages = (rows: ListingPageRow[]) => rows.map((row, index) => ({ after: index ? Number(rows[index - 1]!.last_ref) : 0, listings: Number(row.listings), updated_at: row.updated_at.toISOString() }));

const showcaseCards = 12;
const sectionCards = 8;
const trendingDays = 14;

/** Requests and orders still holding a listing for a buyer (the listing page's Buy with Safe pay continues them). */
const openOrders = ['requested', 'awaiting_payment', 'paid', 'sent', 'disputed'] as const;

/**
 * BitoCard Shop across its markets, for shop.bitocard.com: which countries it is open in, the price-free global showcase
 * (from the second market), what each country's sitemap lists, and what a signed-in buyer already has with a listing.
 */
@Injectable()
export class ShopDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly listings: ListingsService,
    private readonly search: ListingSearchService,
    private readonly watermarks: WatermarkService,
  ) {}

  /**
   * Countries where BitoCard Shop is open, by name, with their live listings, whether Safe pay is open there (its
   * switch on and finance having set both fees; buyers' wallets are checked when they ask) and whether the site asks
   * visitors to install it as an app (`classifieds_install_prompt`).
   */
  async markets() {
    const countries = await this.prisma.country.findMany({ orderBy: { name: 'asc' } });
    const open = (await Promise.all(countries.map(async country => ((await this.settings.isOnForCountry('classifieds', country.code)) ? country : null)))).filter(country => country !== null);
    const codes = open.map(country => country.code);
    const [counts, safePay, installPrompt, fees] = await Promise.all([
      codes.length ? this.prisma.classifiedListing.groupBy({ by: ['country'], where: { country: { in: codes }, ...onShopWhere }, _count: { _all: true } }) : [],
      Promise.all(codes.map(code => this.settings.isOnForCountry('classifieds_safe_pay', code))),
      Promise.all(codes.map(code => this.settings.isOnForCountry('classifieds_install_prompt', code))),
      this.prisma.classifiedSafePaySettings.findMany({ where: { country: { in: codes } } }),
    ]);
    const feesSet = (code: string) => {
      const row = fees.find(item => item.country === code);
      return Boolean(row && row.buyerFeeBps !== null && row.buyerFeeCapMinor !== null && row.sellerFeeBps !== null && row.sellerFeeCapMinor !== null);
    };
    return {
      object: 'list' as const,
      data: open.map((country, index) => ({
        object: 'classified_market' as const,
        country: country.code,
        name: country.name,
        currency: country.currency,
        listings: counts.find(row => row.country === country.code)?._count._all ?? 0,
        safe_pay: safePay[index]! && feesSet(country.code),
        install_prompt: installPrompt[index]!,
      })),
      showcase: open.length >= showcaseFrom,
    };
  }

  /**
   * A country's top categories for bitocard.com's BitoCard Shop band: each with its live listings and, where it has
   * any with a photo, the cover photo of one chosen at random (answers are cached a minute, so the pick changes about
   * that often). The listing named is only where the photo came from: the band links to the category.
   */
  async categoryCovers(country: string) {
    await this.listings.requireOpen(country);
    const categories = await this.prisma.classifiedCategory.findMany({
      where: { enabled: true, parentId: null, countries: { some: { country, enabled: true } } },
      select: { id: true, slug: true, name: true, icon: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    // Listings sit in a category or its subcategory; each counts towards its top category.
    const rows = await this.prisma.$queryRaw<{ top: string; listings: bigint; media_id: string | null; url: string | null; width: number | null; height: number | null; title: string | null }[]>`
      WITH live AS (
        SELECT l."id", l."title", COALESCE(c."parent_id", c."id") AS top
        FROM "classified_listings" l JOIN "classified_categories" c ON c."id" = l."category_id"
        WHERE l."country" = ${country} AND l."status" = 'active' AND l."on_shop"
      )
      SELECT counts.top, counts.listings, pick.media_id, pick.url, pick.width, pick.height, pick.title
      FROM (SELECT top, count(*) AS listings FROM live GROUP BY top) counts
      LEFT JOIN LATERAL (
        SELECT cover."id" AS media_id, cover."url", cover."width", cover."height", live."title"
        FROM live
        JOIN LATERAL (
          SELECT m."id", m."url", m."width", m."height" FROM "classified_media" m
          WHERE m."listing_id" = live."id" AND m."kind" = 'photo' AND m."status" = 'ready' AND m."url" IS NOT NULL
          ORDER BY m."position" LIMIT 1
        ) cover ON true
        WHERE live.top = counts.top
        ORDER BY random() LIMIT 1
      ) pick ON true`;
    const byTop = new Map(rows.map(row => [row.top, row]));
    const cc = country.toLowerCase();
    return {
      object: 'list' as const,
      country,
      url: `${shopOrigin}/${cc}`,
      data: categories.map(category => {
        const row = byTop.get(category.id);
        return {
          object: 'classified_category_cover' as const,
          slug: category.slug,
          name: category.name,
          icon: category.icon,
          listings: Number(row?.listings ?? 0),
          url: `${shopOrigin}/${cc}/c/${category.slug}`,
          photo: row?.url && row.media_id ? { url: this.watermarks.url({ id: row.media_id, url: row.url }, 960), width: row.width, height: row.height, alt: row.title ?? category.name } : null,
        };
      }),
    };
  }

  /**
   * The global showcase: every open country with its listings, the categories across them, and recent and trending
   * listings, never with a price (prices belong to each country's own pages). With `category`, a section per country.
   */
  async showcase(category?: string) {
    const markets = await this.markets();
    if (!markets.showcase) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'showcase_unavailable', 'Udozo opens across countries with its second market.');
    const codes = markets.data.map(market => market.country);

    const categories = await this.prisma.classifiedCategory.findMany({
      where: { enabled: true, parentId: null, countries: { some: { country: { in: codes }, enabled: true } } },
      include: { children: { where: { enabled: true }, select: { id: true } }, countries: { where: { enabled: true, country: { in: codes } }, select: { country: true } } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const chosen = category ? categories.find(row => row.slug === category) : undefined;
    if (category && !chosen) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such category.');

    const live = await this.prisma.classifiedListing.groupBy({ by: ['country', 'categoryId'], where: { country: { in: codes }, ...onShopWhere }, _count: { _all: true } });
    const countIn = (row: (typeof categories)[number], country: string) => {
      const ids = new Set([row.id, ...row.children.map(child => child.id)]);
      return live.filter(item => item.country === country && item.categoryId && ids.has(item.categoryId)).reduce((sum, item) => sum + item._count._all, 0);
    };

    const where = (country?: string) => ({
      ...onShopWhere,
      country: country ? country : { in: codes },
      ...(chosen ? { categoryId: { in: [chosen.id, ...chosen.children.map(child => child.id)] } } : {}),
    });
    // Cards in the order asked, each without its price.
    const priceless = async (ids: string[]) => {
      const cards = await this.search.cards(ids);
      return ids.flatMap(id => {
        const card = cards.get(id);
        return card ? [Object.fromEntries(Object.entries(card).filter(([key]) => key !== 'price')) as Omit<typeof card, 'price'>] : [];
      });
    };
    const ids = async (query: Omit<Prisma.ClassifiedListingFindManyArgs, 'select' | 'include'>) => (await this.prisma.classifiedListing.findMany({ ...query, select: { id: true } })).map(row => row.id);

    const [recent, trending, sections] = await Promise.all([
      ids({ where: where(), orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: showcaseCards }).then(priceless),
      ids({ where: { ...where(), publishedAt: { gt: new Date(Date.now() - trendingDays * 86_400_000) } }, orderBy: [{ leads: 'desc' }, { views: 'desc' }, { publishedAt: 'desc' }], take: showcaseCards }).then(priceless),
      chosen
        ? Promise.all(
            markets.data.map(async market => ({
              country: market.country,
              name: market.name,
              listings: countIn(chosen, market.country),
              cards: await priceless(await ids({ where: where(market.country), orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }], take: sectionCards })),
            })),
          )
        : Promise.resolve(null),
    ]);

    return {
      object: 'classified_showcase' as const,
      markets: markets.data,
      category: chosen ? { slug: chosen.slug, name: chosen.name, icon: chosen.icon } : null,
      categories: categories.map(row => ({
        slug: row.slug,
        name: row.name,
        icon: row.icon,
        countries: row.countries.map(link => link.country).sort(),
        listings: Object.fromEntries(codes.map(code => [code, countIn(row, code)])),
      })),
      recent,
      trending,
      sections,
    };
  }

  /**
   * What a country's sitemap lists, each with its count of live listings and when they last changed: its categories (a
   * top category counts its subcategories), states and areas, a category in a state or area once it has enough there to
   * be indexed, and the files its listings come in (`sitemapListings`). Places count as their pages do, so the two agree
   * on what is indexed: a state's page also shows listings delivered nationwide, an area's only its own. Seller pages
   * (`/<cc>/seller/<handle>`) are listed for every usable account of this market with a live listing here (their page
   * is indexed only then), each with that count and their newest listing change.
   */
  async sitemap(country: string) {
    const code = country.toUpperCase();
    await this.listings.requireOpen(code);
    const [categories, groups, areas, pages, sellers] = await Promise.all([
      this.prisma.classifiedCategory.findMany({ where: { enabled: true, countries: { some: { country: code, enabled: true } } }, select: { id: true, slug: true, parentId: true } }),
      this.prisma.classifiedListing.groupBy({ by: ['categoryId', 'stateId', 'areaId', 'delivery'], where: { country: code, ...onShopWhere }, _count: { _all: true }, _max: { updatedAt: true } }),
      this.prisma.classifiedArea.findMany({ where: { country: code, enabled: true }, select: { id: true, slug: true, parentId: true } }),
      this.prisma.$queryRaw<ListingPageRow[]>`
        SELECT max("ref") AS last_ref, count(*) AS listings, max("updated_at") AS updated_at
        FROM (
          SELECT "ref", "updated_at", row_number() OVER (ORDER BY "ref") AS place
          FROM "classified_listings"
          WHERE "country" = ${code} AND "on_shop" AND ("status" = 'active' OR ("status" = 'sold' AND "sold_at" > ${new Date(Date.now() - soldVisibleMs)}::timestamptz))
        ) listed
        GROUP BY (place - 1) / ${sitemapPage}::bigint
        ORDER BY 1`,
      // A seller's page lives in their own market and counts only their live listings there (`SellerProfilesService`);
      // a suspended account has no page.
      this.prisma.$queryRaw<SellerRow[]>`
        SELECT c."seller_handle" AS handle, count(*) AS listings, max(l."updated_at") AS updated_at
        FROM "classified_listings" l
        JOIN "customers" c ON c."id" = l."customer_id"
        WHERE l."country" = ${code} AND l."status" = 'active' AND l."on_shop" AND c."status" = 'active' AND c."country" = ${code}
        GROUP BY c."seller_handle"
        ORDER BY 1`,
    ]);
    const categoryOf = new Map(categories.map(category => [category.id, category]));
    const areaOf = new Map(areas.map(area => [area.id, area]));
    const states = areas.filter(area => !area.parentId);
    const tally = new Map<string, { listings: number; updated: Date | null }>();
    const add = (key: string, listings: number, updated: Date | null) => {
      const seen = tally.get(key);
      tally.set(key, { listings: (seen?.listings ?? 0) + listings, updated: seen?.updated && updated ? (seen.updated > updated ? seen.updated : updated) : (seen?.updated ?? updated) });
    };
    const placeKey = (state: string, area: string | null, category: string | null) => [state, area ?? '', category ?? ''].join('/');
    for (const group of groups) {
      const listings = group._count._all;
      const updated = group._max.updatedAt;
      const category = group.categoryId ? categoryOf.get(group.categoryId) : undefined;
      const parent = category?.parentId ? categoryOf.get(category.parentId) : undefined;
      const slugs = [category?.slug, parent?.slug].filter((slug): slug is string => Boolean(slug));
      for (const slug of slugs) add(`category:${slug}`, listings, updated);
      const state = group.stateId ? areaOf.get(group.stateId) : undefined;
      const area = group.areaId ? areaOf.get(group.areaId) : undefined;
      const within = state && area?.parentId === state.id ? area.slug : null;
      const shownIn = group.delivery === 'nationwide' ? states : state ? [state] : [];
      for (const slug of [null, ...slugs]) {
        for (const shown of shownIn) add(placeKey(shown.slug, null, slug), listings, updated);
        if (state && within) add(placeKey(state.slug, within, slug), listings, updated);
      }
    }
    // An address's second part is an area of the state when one has that name, so that category has no page there.
    const areaNames = new Set(areas.flatMap(area => (area.parentId ? [`${areaOf.get(area.parentId)?.slug}/${area.slug}`] : [])));
    const places = [...tally].flatMap(([key, { listings, updated }]) => {
      if (key.startsWith('category:')) return [];
      const [state, area, category] = key.split('/') as [string, string, string];
      return [{ state, area: area || null, category: category || null, listings, updated_at: updated?.toISOString() ?? null }];
    });
    const byPlace = (a: (typeof places)[number], b: (typeof places)[number]) => a.state.localeCompare(b.state) || (a.area ?? '').localeCompare(b.area ?? '') || (a.category ?? '').localeCompare(b.category ?? '');
    const newest = [...tally.values()].reduce<Date | null>((latest, { updated }) => (updated && (!latest || updated > latest) ? updated : latest), null);
    return {
      object: 'classified_sitemap' as const,
      country: code,
      updated_at: newest?.toISOString() ?? null,
      categories: categories
        .map(category => {
          const seen = tally.get(`category:${category.slug}`);
          return { slug: category.slug, listings: seen?.listings ?? 0, updated_at: seen?.updated?.toISOString() ?? null };
        })
        .sort((a, b) => a.slug.localeCompare(b.slug)),
      places: places.filter(place => !place.category).map(({ state, area, listings, updated_at }) => ({ state, area, listings, updated_at })).sort((a, b) => a.state.localeCompare(b.state) || (a.area ?? '').localeCompare(b.area ?? '')),
      category_places: places.filter(place => place.category && place.listings >= sitemapPlaceFrom && (place.area || !areaNames.has(`${place.state}/${place.category}`))).sort(byPlace),
      listing_pages: listingPages(pages),
      sellers: sellers.map(row => ({ handle: row.handle, listings: Number(row.listings), updated_at: row.updated_at.toISOString() })),
    };
  }

  /** One file of a country's listings (live, or sold within the last 30 days), by number, each with its title and up to five ready photos (for the image sitemap). */
  async sitemapListings(country: string, after = 0) {
    const code = country.toUpperCase();
    await this.listings.requireOpen(code);
    const rows = await this.prisma.classifiedListing.findMany({
      where: { country: code, onShop: true, ref: { gt: BigInt(after) }, OR: [{ status: 'active' }, { status: 'sold', soldAt: { gt: new Date(Date.now() - soldVisibleMs) } }] },
      select: { ref: true, slug: true, title: true, updatedAt: true, media: { where: { kind: 'photo', status: 'ready', url: { not: null } }, orderBy: { position: 'asc' }, take: 5, select: { id: true, url: true } } },
      orderBy: { ref: 'asc' },
      take: sitemapPage + 1,
    });
    const page = rows.slice(0, sitemapPage);
    return {
      object: 'classified_sitemap_listings' as const,
      country: code,
      listings: page.map(row => ({ ref: Number(row.ref), slug: row.slug, title: row.title ?? '', updated_at: row.updatedAt.toISOString(), images: row.media.flatMap(media => (media.url ? [this.watermarks.url(media, 1600)!] : [])) })),
      next_after: rows.length > sitemapPage ? Number(page.at(-1)!.ref) : null,
    };
  }

  /**
   * What the signed-in buyer already has with a listing, for its page: their own listing, saved, a chat about it, an open
   * Safe pay request or order, and whether they can contact the seller at all (live, and in their own country).
   */
  async viewer(customer: CustomerWithStore, listingId: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId }, select: { id: true, customerId: true, country: true, status: true, onShop: true } });
    if (!listing || !listing.onShop || ['draft', 'pending_review', 'deleted'].includes(listing.status)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');
    const own = listing.customerId === customer.id;
    const [favourite, chat, order] = await Promise.all([
      this.prisma.classifiedFavourite.findUnique({ where: { customerId_listingId: { customerId: customer.id, listingId } }, select: { listingId: true } }),
      own ? null : this.prisma.classifiedConversation.findUnique({ where: { listingId_buyerId: { listingId, buyerId: customer.id } }, select: { id: true } }),
      own ? null : this.prisma.classifiedOrder.findFirst({ where: { listingId, buyerId: customer.id, status: { in: [...openOrders] } }, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, status: true } }),
    ]);
    return {
      object: 'classified_listing_viewer' as const,
      listing_id: listingId,
      own,
      favourite: Boolean(favourite),
      conversation_id: chat?.id ?? null,
      order: order ? { id: order.id, number: `SP-${order.number}`, status: order.status } : null,
      can_contact: !own && listing.status === 'active' && customer.country === listing.country,
    };
  }

  /** Who sells a listing and how they take contact (for the viewer's contact and call state). */
  contactOf(listingId: string) {
    return this.prisma.classifiedListing.findUniqueOrThrow({ where: { id: listingId }, select: { id: true, customerId: true, contact: true } });
  }
}
