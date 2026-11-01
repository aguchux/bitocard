import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { onShopWhere } from '../rules.js';
import { ListingSearchService } from '../search.service.js';
import type { HomeLink, HomeScope, HomeSection } from './layout.js';

/** What a page is filled from: across the open markets (no prices) or one country. */
export type HomeContext = {
  scope: HomeScope;
  /** The country's code on a country page; null across countries. */
  country: string | null;
  /** The countries listed from: every open market across them, else the one. */
  countries: string[];
  markets: Array<{ country: string; name: string; listings: number }>;
  now: Date;
};

const day = 86_400_000;
/** Trending counts the last two weeks; top selling the last 30 days; a "was" price is the lowest of the 30 days before. */
const trendingDays = 14;
const salesDays = 30;
const tileSizes = ['lg', 'sm', 'sm', 'wide', 'sm', 'sm', 'tall', 'sm', 'sm', 'wide', 'sm', 'sm'] as const;

type Card = Record<string, unknown> & { id: string };

/**
 * Fills a home page's sections with what they show, when the page is read: Sponsored placements first, then each
 * section in order, never showing a listing twice. Every rail is one bounded query on live listings; a section with
 * nothing to show comes back empty and the page leaves it out. Across countries, cards never carry a price.
 */
@Injectable()
export class HomeResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: ListingSearchService,
  ) {}

  async resolve(sections: HomeSection[], ctx: HomeContext) {
    const taken = new Set<string>();
    const shown = sections.map((section, index) => ({ section, index })).filter(item => !item.section.hidden);
    const out = new Map<number, Record<string, unknown>>();
    // Sponsored listings are placed on purpose, so they take their listings before any other rail.
    for (const item of shown.filter(entry => entry.section.type === 'sponsored_rail')) out.set(item.index, await this.one(item.section, ctx, taken));
    for (const item of shown.filter(entry => entry.section.type !== 'sponsored_rail')) out.set(item.index, await this.one(item.section, ctx, taken));
    return [...out.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
  }

  private async one(section: HomeSection, ctx: HomeContext, taken: Set<string>): Promise<Record<string, unknown>> {
    switch (section.type) {
      case 'home_hero':
        return { ...section, data: { slides: section.slides.map(slide => ({ ...slide, href: this.href(slide.link, ctx) })) } };
      case 'banner':
        return { ...section, data: { items: section.items.map(item => ({ ...item, href: this.href(item.link, ctx) })) } };
      case 'trust_bar':
        return { ...section, data: {} };
      case 'country_tiles': {
        const picked = section.countries.length ? section.countries.flatMap(code => ctx.markets.filter(market => market.country === code)) : ctx.markets;
        return { ...section, data: { countries: picked.map(market => ({ country: market.country, name: market.name, listings: market.listings, href: `/market/${market.country.toLowerCase()}` })) } };
      }
      case 'category_masonry':
        return { ...section, data: { tiles: await this.tiles(section, ctx) } };
      case 'sponsored_rail': {
        const rows = await this.prisma.classifiedSponsoredPlacement.findMany({
          where: { country: ctx.scope === 'global' ? null : ctx.country, endedAt: null, startsAt: { lte: ctx.now }, endsAt: { gt: ctx.now }, listing: { ...onShopWhere, country: { in: ctx.countries } } },
          orderBy: [{ position: 'asc' }, { startsAt: 'desc' }],
          take: section.limit * 2,
          select: { listingId: true },
        });
        const ids = this.fresh([...new Set(rows.map(row => row.listingId))], taken, section.limit);
        return { ...section, data: { items: (await this.cards(ids, ctx)).map(card => ({ ...card, sponsored: true })) } };
      }
      case 'deals_rail': {
        const deals = await this.deals(ctx, section.days, section.category, section.limit + taken.size);
        const ids = this.fresh(deals.map(row => row.id), taken, section.limit);
        const was = new Map(deals.map(row => [row.id, Number(row.was)]));
        return { ...section, data: { items: (await this.cards(ids, ctx)).map(card => ({ ...card, was_price: was.get(card.id) ?? null })), view_all_href: ctx.country ? `/${ctx.country.toLowerCase()}/search` : null } };
      }
      case 'top_selling_rail': {
        const sales = await this.sales(ctx, section.limit + taken.size);
        // Sales only when enough have sold; otherwise the whole rail is the most contacted, titled so (never both).
        if (sales.length >= section.minimum) {
          const ids = this.fresh(sales, taken, section.limit);
          return { ...section, data: { basis: 'sales', heading: section.title, items: await this.cards(ids, ctx) } };
        }
        const popular = await this.ids({ ...onShopWhere, country: { in: ctx.countries }, leads: { gt: 0 } }, [{ leads: 'desc' }, { publishedAt: 'desc' }], section.limit + taken.size);
        const ids = this.fresh(popular, taken, section.limit);
        return { ...section, data: { basis: 'popular', heading: section.fallbackTitle, items: await this.cards(ids, ctx) } };
      }
      case 'listing_group':
        return { ...section, data: await this.group(section, ctx, taken) };
    }
  }

  /** Where a link goes on this page: a category's page (the country's, or across countries), a search, or the page given. */
  href(link: HomeLink, ctx: HomeContext) {
    const cc = ctx.country?.toLowerCase();
    if (link.kind === 'category') return cc ? `/${cc}/c/${link.slug}` : `/c/${link.slug}`;
    if (link.kind === 'search') return cc ? `/${cc}/search?q=${encodeURIComponent(link.q)}` : '/';
    return link.href;
  }

  /** Ids not shown yet, at most `limit`, marked as shown. */
  private fresh(ids: string[], taken: Set<string>, limit: number) {
    const picked = ids.filter(id => !taken.has(id)).slice(0, limit);
    for (const id of picked) taken.add(id);
    return picked;
  }

  private async ids(where: object, orderBy: object[], take: number) {
    return (await this.prisma.classifiedListing.findMany({ where, orderBy, take, select: { id: true } })).map(row => row.id);
  }

  /** Cards in the order asked; across countries without their price. */
  private async cards(ids: string[], ctx: HomeContext): Promise<Card[]> {
    if (!ids.length) return [];
    const cards = await this.search.cards(ids);
    return ids.flatMap(id => {
      const card = cards.get(id);
      if (!card) return [];
      return [(ctx.scope === 'global' ? Object.fromEntries(Object.entries(card).filter(([key]) => key !== 'price')) : { ...card }) as Card];
    });
  }

  /** A category's listings count with its subcategories'. */
  private async categoryIds(slug: string) {
    const category = await this.prisma.classifiedCategory.findFirst({ where: { slug, enabled: true }, select: { id: true, children: { where: { enabled: true }, select: { id: true } } } });
    return category ? [category.id, ...category.children.map(child => child.id)] : null;
  }

  /**
   * Live listings whose price came down within `days`: the current price below the lowest of the 30 days before it
   * changed (a genuine "was" price), ranked by contacts, saves and views since.
   */
  private async deals(ctx: HomeContext, days: number, category: string | null, take: number) {
    if (!ctx.country) return [];
    const since = new Date(ctx.now.getTime() - days * day);
    const categories = category ? await this.categoryIds(category) : null;
    if (category && !categories) return [];
    return this.prisma.$queryRaw<{ id: string; was: bigint }[]>`
      WITH cur AS (
        SELECT h."listing_id", h."price_minor" AS now_minor, h."from" AS dropped_at
        FROM "classified_price_history" h JOIN "classified_listings" l ON l."id" = h."listing_id"
        WHERE h."to" IS NULL AND h."from" >= ${since} AND l."status" = 'active' AND l."on_shop" AND l."country" = ${ctx.country}
          AND (${categories === null} OR l."category_id" = ANY(${categories ?? []}::uuid[]))
      ),
      was AS (
        SELECT cur."listing_id", MIN(p."price_minor") AS was_minor
        FROM cur JOIN "classified_price_history" p ON p."listing_id" = cur."listing_id"
        WHERE p."from" < cur.dropped_at AND (p."to" IS NULL OR p."to" > cur.dropped_at - interval '30 days')
        GROUP BY cur."listing_id"
      )
      SELECT l."id", was.was_minor AS was
      FROM cur
      JOIN was ON was."listing_id" = cur."listing_id"
      JOIN "classified_listings" l ON l."id" = cur."listing_id"
      LEFT JOIN LATERAL (SELECT count(*) AS saves FROM "classified_favourites" f WHERE f."listing_id" = l."id" AND f."created_at" >= ${since}) s ON true
      LEFT JOIN LATERAL (SELECT COALESCE(sum(v."views"), 0) AS views FROM "classified_listing_view_days" v WHERE v."listing_id" = l."id" AND v."day" >= ${since}::date) v ON true
      WHERE was.was_minor > cur.now_minor
      ORDER BY (l."leads" * 3 + s.saves * 2 + v.views / 10.0) DESC, cur.dropped_at DESC, l."id"
      LIMIT ${take}`;
  }

  /** Listings by released Safe pay sales over 30 days, most units first. */
  private async sales(ctx: HomeContext, take: number) {
    const since = new Date(ctx.now.getTime() - salesDays * day);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT o."listing_id" AS id
      FROM "classified_orders" o JOIN "classified_listings" l ON l."id" = o."listing_id"
      WHERE o."status" = 'released' AND o."released_at" >= ${since} AND o."country" = ANY(${ctx.countries}::text[]) AND l."status" = 'active' AND l."on_shop"
      GROUP BY o."listing_id"
      ORDER BY SUM(o."quantity") DESC, MAX(o."released_at") DESC, o."listing_id"
      LIMIT ${take}`;
    return rows.map(row => row.id);
  }

  /** Live listings of the last two weeks ranked by contacts, saves and views. */
  private async trending(ctx: HomeContext, take: number) {
    const since = new Date(ctx.now.getTime() - trendingDays * day);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT l."id"
      FROM "classified_listings" l
      LEFT JOIN LATERAL (SELECT count(*) AS saves FROM "classified_favourites" f WHERE f."listing_id" = l."id" AND f."created_at" >= ${since}) s ON true
      LEFT JOIN LATERAL (SELECT COALESCE(sum(v."views"), 0) AS views FROM "classified_listing_view_days" v WHERE v."listing_id" = l."id" AND v."day" >= ${since}::date) v ON true
      WHERE l."status" = 'active' AND l."on_shop" AND l."country" = ANY(${ctx.countries}::text[]) AND l."published_at" >= ${since}
      ORDER BY (l."leads" * 3 + s.saves * 2 + v.views / 10.0) DESC, l."published_at" DESC, l."id"
      LIMIT ${take}`;
    return rows.map(row => row.id);
  }

  private async group(section: Extract<HomeSection, { type: 'listing_group' }>, ctx: HomeContext, taken: Set<string>) {
    const cc = ctx.country?.toLowerCase();
    const take = section.limit + taken.size;
    const base = { ...onShopWhere, country: { in: ctx.countries } };
    const newest = [{ publishedAt: 'desc' }, { id: 'asc' }];
    let ids: string[] = [];
    let viewAll: string | null = null;
    if (section.by === 'newest') {
      ids = await this.ids(base, newest, take);
      viewAll = cc ? `/${cc}/search?sort=newest` : null;
    } else if (section.by === 'trending') {
      ids = await this.trending(ctx, take);
      viewAll = cc ? `/${cc}/search` : null;
    } else if (section.by === 'category') {
      const categories = await this.categoryIds(section.value!);
      ids = categories ? await this.ids({ ...base, categoryId: { in: categories } }, newest, take) : [];
      viewAll = cc && categories ? `/${cc}/c/${section.value}` : null;
    } else if (section.by === 'area') {
      const place = ctx.country ? await this.prisma.classifiedArea.findFirst({ where: { country: ctx.country, slug: section.value! }, select: { id: true, kind: true, slug: true, parent: { select: { slug: true } } } }) : null;
      if (place) {
        ids = await this.ids({ ...base, ...(place.kind === 'state' ? { stateId: place.id } : { areaId: place.id }) }, newest, take);
        viewAll = place.kind === 'state' || !place.parent ? `/${cc}/${place.slug}` : `/${cc}/${place.parent.slug}/${place.slug}`;
      }
    } else {
      ids = await this.ids({ ...base, condition: section.value! }, newest, take);
      viewAll = cc ? `/${cc}/search?condition=${section.value}` : null;
    }
    return { items: await this.cards(this.fresh(ids, taken, section.limit), ctx), view_all_href: section.viewAll ? viewAll : null };
  }

  /**
   * The masonry's tiles: the categories chosen (in their order and size, an admin's photo over a listing's), or the
   * busiest ones in a set pattern of sizes. Each counts its live listings, with a photo of one of them at random.
   */
  private async tiles(section: Extract<HomeSection, { type: 'category_masonry' }>, ctx: HomeContext) {
    const covers = await this.covers(ctx.countries);
    const cc = ctx.country?.toLowerCase();
    const href = (slug: string) => (cc ? `/${cc}/c/${slug}` : `/c/${slug}`);
    const tile = (cover: (typeof covers)[number], size: string, image: string | null) => ({ slug: cover.slug, name: cover.name, icon: cover.icon, listings: cover.listings, size, image: image ?? cover.photo, href: href(cover.slug) });
    if (section.tiles.length) {
      return section.tiles.flatMap(chosen => {
        const cover = covers.find(item => item.slug === chosen.slug);
        return cover ? [tile(cover, chosen.size, chosen.image)] : [];
      });
    }
    return covers
      .filter(cover => cover.listings > 0)
      .sort((a, b) => b.listings - a.listings)
      .slice(0, section.limit)
      .map((cover, index) => tile(cover, tileSizes[index % tileSizes.length]!, null));
  }

  /** Every top category open in the countries, with its live listings (subcategories counted) and a photo of one. */
  private async covers(countries: string[]) {
    const categories = await this.prisma.classifiedCategory.findMany({
      where: { enabled: true, parentId: null, countries: { some: { country: { in: countries }, enabled: true } } },
      select: { id: true, slug: true, name: true, icon: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const rows = await this.prisma.$queryRaw<{ top: string; listings: bigint; url: string | null }[]>`
      WITH live AS (
        SELECT l."id", COALESCE(c."parent_id", c."id") AS top
        FROM "classified_listings" l JOIN "classified_categories" c ON c."id" = l."category_id"
        WHERE l."country" = ANY(${countries}::text[]) AND l."status" = 'active' AND l."on_shop"
      )
      SELECT counts.top, counts.listings, pick.url
      FROM (SELECT top, count(*) AS listings FROM live GROUP BY top) counts
      LEFT JOIN LATERAL (
        SELECT cover."url" FROM live
        JOIN LATERAL (
          SELECT m."url" FROM "classified_media" m
          WHERE m."listing_id" = live."id" AND m."kind" = 'photo' AND m."status" = 'ready' AND m."url" IS NOT NULL
          ORDER BY m."position" LIMIT 1
        ) cover ON true
        WHERE live.top = counts.top
        ORDER BY random() LIMIT 1
      ) pick ON true`;
    const byTop = new Map(rows.map(row => [row.top, row]));
    return categories.map(category => ({ slug: category.slug, name: category.name, icon: category.icon, listings: Number(byTop.get(category.id)?.listings ?? 0), photo: byTop.get(category.id)?.url ?? null }));
  }
}
