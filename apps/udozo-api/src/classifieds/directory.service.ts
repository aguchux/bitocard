import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';
import { ListingsService, shopOrigin } from './listings.service.js';
import { onShopWhere } from './rules.js';
import { ListingSearchService, soldVisibleMs } from './search.service.js';

/** The global showcase opens with the second market (owner's decision: Nigeria first, without it). */
export const showcaseFrom = 2;
/** Listing addresses per sitemap page. */
export const sitemapPage = 5000;
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
    const rows = await this.prisma.$queryRaw<{ top: string; listings: bigint; url: string | null; width: number | null; height: number | null; title: string | null }[]>`
      WITH live AS (
        SELECT l."id", l."title", COALESCE(c."parent_id", c."id") AS top
        FROM "classified_listings" l JOIN "classified_categories" c ON c."id" = l."category_id"
        WHERE l."country" = ${country} AND l."status" = 'active' AND l."on_shop"
      )
      SELECT counts.top, counts.listings, pick.url, pick.width, pick.height, pick.title
      FROM (SELECT top, count(*) AS listings FROM live GROUP BY top) counts
      LEFT JOIN LATERAL (
        SELECT cover."url", cover."width", cover."height", live."title"
        FROM live
        JOIN LATERAL (
          SELECT m."url", m."width", m."height" FROM "classified_media" m
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
          photo: row?.url ? { url: row.url, width: row.width, height: row.height, alt: row.title ?? category.name } : null,
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
   * What a country's sitemap lists: live listing counts per category (a top category counts its subcategories) and per
   * state and area, and the listings themselves (live, or sold within the last 30 days), by number, a page at a time.
   */
  async sitemap(country: string, after = 0) {
    const code = country.toUpperCase();
    await this.listings.requireOpen(code);
    const [categories, byCategory, byPlace, areas, rows] = await Promise.all([
      this.prisma.classifiedCategory.findMany({ where: { enabled: true, countries: { some: { country: code, enabled: true } } }, select: { id: true, slug: true, parentId: true } }),
      this.prisma.classifiedListing.groupBy({ by: ['categoryId'], where: { country: code, ...onShopWhere }, _count: { _all: true } }),
      this.prisma.classifiedListing.groupBy({ by: ['stateId', 'areaId'], where: { country: code, ...onShopWhere }, _count: { _all: true } }),
      this.prisma.classifiedArea.findMany({ where: { country: code, enabled: true }, select: { id: true, slug: true } }),
      this.prisma.classifiedListing.findMany({
        where: { country: code, onShop: true, ref: { gt: BigInt(after) }, OR: [{ status: 'active' }, { status: 'sold', soldAt: { gt: new Date(Date.now() - soldVisibleMs) } }] },
        select: { ref: true, slug: true, updatedAt: true },
        orderBy: { ref: 'asc' },
        take: sitemapPage + 1,
      }),
    ]);
    const counted = new Map(byCategory.map(row => [row.categoryId, row._count._all]));
    const slugOf = new Map(areas.map(area => [area.id, area.slug]));
    const states = new Map<string, number>();
    const places: { state: string; area: string | null; listings: number }[] = [];
    for (const row of byPlace) {
      const state = row.stateId ? slugOf.get(row.stateId) : undefined;
      if (!state) continue;
      states.set(state, (states.get(state) ?? 0) + row._count._all);
      const area = row.areaId ? slugOf.get(row.areaId) : undefined;
      if (area) places.push({ state, area, listings: row._count._all });
    }
    const page = rows.slice(0, sitemapPage);
    return {
      object: 'classified_sitemap' as const,
      country: code,
      categories: categories
        .map(category => ({
          slug: category.slug,
          listings: (counted.get(category.id) ?? 0) + categories.filter(child => child.parentId === category.id).reduce((sum, child) => sum + (counted.get(child.id) ?? 0), 0),
        }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
      places: [...[...states].map(([state, listings]) => ({ state, area: null, listings })), ...places].sort((a, b) => a.state.localeCompare(b.state) || (a.area ?? '').localeCompare(b.area ?? '')),
      listings: page.map(row => ({ ref: Number(row.ref), slug: row.slug, updated_at: row.updatedAt.toISOString() })),
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
}
