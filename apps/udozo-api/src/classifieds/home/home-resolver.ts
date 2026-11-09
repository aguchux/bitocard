import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { WatermarkService } from '../../watermarks/watermarks.service.js';
import { resaleTemplate, resaleWhere } from '../../resale/resale-stores.service.js';
import { onShopWhere } from '../rules.js';
import { ListingSearchService } from '../search.service.js';
import type { HomeLink, HomeRow, HomeScope, HomeSection } from './layout.js';

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
    private readonly watermarks: WatermarkService,
  ) {}

  /**
   * A page's rows, filled: hidden rows and blocks left out, every block filled in the page's order (Sponsored first,
   * as for sections), a listing never shown twice except where admins picked it. Rows keep their own settings.
   */
  async resolveRows(rows: HomeRow[], ctx: HomeContext) {
    const shown = rows.filter(row => !row.hidden).map(row => ({ ...row, blocks: row.blocks.filter(block => !block.hidden) })).filter(row => row.blocks.length > 0);
    const filled = await this.resolve(shown.flatMap(row => row.blocks), ctx);
    let at = 0;
    return shown.map(row => {
      const blocks = filled.slice(at, at + row.blocks.length);
      at += row.blocks.length;
      return { ...row, view_all_href: row.viewAll ? this.href(row.viewAll, ctx) : null, blocks };
    });
  }

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
      case 'listing_marquee':
        return { ...section, data: { items: await this.marquee(section, ctx, taken) } };
      case 'store_marquee':
        return { ...section, data: { stores: await this.storeCards(section, ctx) } };
      case 'masonry_grid':
        return { ...section, data: { tiles: await this.masonry(section, ctx, taken) } };
      case 'personal_rail':
        // Filled for the person by udozo.com after the page loads; the shared (cached) page only holds its place.
        return { ...section, data: { kind: section.kind } };
      case 'category_spotlights':
        return { ...section, data: { tiles: await this.spotlights(section, ctx) } };
      case 'category_banner': {
        const found = await this.categoryCover(section.category, ctx.countries);
        if (!found) return { ...section, data: { category: null } };
        return {
          ...section,
          data: { category: { slug: found.slug, name: found.name, icon: found.icon, listings: found.listings }, title: section.title || found.name, image: section.image ?? found.photo, href: this.href({ kind: 'category', slug: found.slug }, ctx) },
        };
      }
    }
  }

  /** Live listings by their numbers, in the order given (sold, expired or other countries' left out). */
  private async idsByRefs(refs: string[], ctx: HomeContext) {
    if (!refs.length) return [];
    const rows = await this.prisma.classifiedListing.findMany({ where: { ...onShopWhere, country: { in: ctx.countries }, ref: { in: refs.map(ref => BigInt(ref)) } }, select: { id: true, ref: true } });
    const byRef = new Map(rows.map(row => [row.ref.toString(), row.id]));
    return [...new Set(refs.flatMap(ref => (byRef.has(ref) ? [byRef.get(ref)!] : [])))];
  }

  /** A marquee's listings: the picks always (in their order), then its source's not shown yet, up to `limit`. */
  private async marquee(section: Extract<HomeSection, { type: 'listing_marquee' }>, ctx: HomeContext, taken: Set<string>) {
    const picked = (await this.idsByRefs(section.picks, ctx)).slice(0, section.limit);
    for (const id of picked) taken.add(id);
    const room = section.limit - picked.length;
    let fill: string[] = [];
    if (room > 0 && section.fill.by !== 'none') {
      const take = room + taken.size;
      const base = { ...onShopWhere, country: { in: ctx.countries } };
      if (section.fill.by === 'newest') fill = await this.ids(base, [{ publishedAt: 'desc' }, { id: 'asc' }], take);
      else if (section.fill.by === 'trending') fill = await this.trending(ctx, take);
      else if (section.fill.by === 'deals') fill = (await this.deals(ctx, 14, null, take)).map(row => row.id);
      else {
        const categories = await this.categoryIds(section.fill.value!);
        fill = categories ? await this.ids({ ...base, categoryId: { in: categories } }, [{ publishedAt: 'desc' }, { id: 'asc' }], take) : [];
      }
    }
    return this.cards([...picked, ...this.fresh(fill, taken, room)], ctx);
  }

  /**
   * Resellers' stores live on their own domain (published Resale shops of resellers in good standing, in the page's
   * countries): the ones picked, in their order, then the most stocked or newest, up to `limit`. Each with its logo,
   * colour, address and how many listings it sells.
   */
  async storeCards(section: { picks: string[]; fill: string; limit: number }, ctx: Pick<HomeContext, 'countries'>, q?: string) {
    const where = {
      template: resaleTemplate,
      status: 'published' as const,
      checkoutMode: 'live' as const,
      reseller: { house: false, status: { not: 'suspended' as const }, country: { in: ctx.countries } },
      domains: { some: { status: 'active' as const, primary: true } },
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    };
    const select = { id: true, name: true, logoUrl: true, primaryColor: true, createdAt: true, reseller: { select: { country: true } }, domains: { where: { status: 'active' as const, primary: true }, select: { name: true }, take: 1 } };
    const picked = section.picks.length ? await this.prisma.store.findMany({ where: { ...where, id: { in: section.picks } }, select }) : [];
    const ordered = section.picks.flatMap(id => picked.filter(store => store.id === id));
    let rest: typeof picked = [];
    if (section.fill !== 'none' && ordered.length < section.limit) {
      rest = (await this.prisma.store.findMany({ where: { ...where, id: { notIn: ordered.map(store => store.id) } }, select, orderBy: { createdAt: 'desc' }, take: 200 })) as typeof picked;
    }
    const counted = await this.storeListings([...ordered, ...rest].map(store => ({ id: store.id, country: store.reseller.country ?? '' })));
    if (section.fill === 'most_listings') rest = rest.filter(store => (counted.get(store.id) ?? 0) > 0).sort((a, b) => (counted.get(b.id) ?? 0) - (counted.get(a.id) ?? 0));
    return [...ordered, ...rest].slice(0, section.limit).map(store => ({
      object: 'home_store' as const,
      id: store.id,
      name: store.name,
      logo_url: store.logoUrl,
      primary_color: store.primaryColor,
      url: `https://${store.domains[0]!.name}`,
      country: store.reseller.country,
      listings: counted.get(store.id) ?? 0,
    }));
  }

  /** How many listings each store sells now (its active ones whose supplier still offers them, in its country). */
  private async storeListings(stores: Array<{ id: string; country: string }>) {
    const counts = new Map<string, number>();
    for (const store of stores) {
      counts.set(store.id, await this.prisma.resaleListing.count({ where: { storeId: store.id, status: 'active', relationship: { supplierBlockedAt: null }, listing: resaleWhere(store.country) } }));
    }
    return counts;
  }

  /** A masonry grid's tiles in their order: a category's (with a live listing's photo), a listing's, or a photo with its link. */
  private async masonry(section: Extract<HomeSection, { type: 'masonry_grid' }>, ctx: HomeContext, taken: Set<string>) {
    const refs = section.tiles.flatMap(tile => (tile.kind === 'listing' ? [tile.ref] : []));
    const ids = await this.idsByRefs(refs, ctx);
    for (const id of ids) taken.add(id);
    const cards = new Map((await this.cards(ids, ctx)).map(card => [String((card as { ref?: unknown }).ref), card]));
    const out: Array<Record<string, unknown>> = [];
    for (const tile of section.tiles) {
      if (tile.kind === 'category') {
        const found = await this.categoryCover(tile.slug, ctx.countries);
        if (found) out.push({ kind: 'category', size: tile.size, slug: found.slug, title: found.name, listings: found.listings, image: tile.image ?? found.photo, href: this.href({ kind: 'category', slug: found.slug }, ctx) });
      } else if (tile.kind === 'listing') {
        const card = cards.get(tile.ref);
        if (card) out.push({ kind: 'listing', size: tile.size, title: card.title, image: (card.cover as { url?: string | null } | null)?.url?.replace('&w=480', '&w=960') ?? null, href: card.url, listing: card });
      } else {
        out.push({ kind: 'image', size: tile.size, title: tile.title, image: tile.image, href: this.href(tile.link, ctx) });
      }
    }
    return out;
  }

  /** Any open category (top or sub) in the countries: its name, live listings (subcategories counted) and a photo of one. */
  private async categoryCover(slug: string, countries: string[]) {
    const category = await this.prisma.classifiedCategory.findFirst({
      where: { slug, enabled: true, countries: { some: { country: { in: countries }, enabled: true } } },
      select: { id: true, slug: true, name: true, icon: true, children: { where: { enabled: true }, select: { id: true } } },
    });
    if (!category) return null;
    const ids = [category.id, ...category.children.map(child => child.id)];
    const [listings, photo] = await Promise.all([
      this.prisma.classifiedListing.count({ where: { ...onShopWhere, country: { in: countries }, categoryId: { in: ids } } }),
      this.prisma.$queryRaw<{ id: string; url: string }[]>`
        SELECT m."id", m."url" FROM "classified_listings" l
        JOIN LATERAL (SELECT m."id", m."url" FROM "classified_media" m WHERE m."listing_id" = l."id" AND m."kind" = 'photo' AND m."status" = 'ready' AND m."url" IS NOT NULL ORDER BY m."position" LIMIT 1) m ON true
        WHERE l."country" = ANY(${countries}::text[]) AND l."status" = 'active' AND l."on_shop" AND l."category_id" = ANY(${ids}::uuid[])
        ORDER BY random() LIMIT 1`,
    ]);
    return { slug: category.slug, name: category.name, icon: category.icon, listings, photo: photo[0] ? this.watermarks.url(photo[0], 960) : null };
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

  /**
   * The spotlight grid's tiles: the categories chosen (in their order), else every top category open on the page in its
   * own order; each with its spotlight image (null: udozo.com draws its icon) and live listings.
   */
  private async spotlights(section: Extract<HomeSection, { type: 'category_spotlights' }>, ctx: HomeContext) {
    const covers = await this.covers(ctx.countries);
    const chosen = section.categories.length ? section.categories.flatMap(slug => covers.filter(cover => cover.slug === slug)) : covers;
    return chosen.map(cover => ({ slug: cover.slug, name: cover.name, icon: cover.icon, listings: cover.listings, image: cover.spotlight, href: this.href({ kind: 'category', slug: cover.slug }, ctx) }));
  }

  /** Every top category open in the countries, with its live listings (subcategories counted) and a photo of one. */
  private async covers(countries: string[]) {
    const categories = await this.prisma.classifiedCategory.findMany({
      where: { enabled: true, parentId: null, countries: { some: { country: { in: countries }, enabled: true } } },
      select: { id: true, slug: true, name: true, icon: true, spotlightUrl: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    const rows = await this.prisma.$queryRaw<{ top: string; listings: bigint; media_id: string | null; url: string | null }[]>`
      WITH live AS (
        SELECT l."id", COALESCE(c."parent_id", c."id") AS top
        FROM "classified_listings" l JOIN "classified_categories" c ON c."id" = l."category_id"
        WHERE l."country" = ANY(${countries}::text[]) AND l."status" = 'active' AND l."on_shop"
      )
      SELECT counts.top, counts.listings, pick.media_id, pick.url
      FROM (SELECT top, count(*) AS listings FROM live GROUP BY top) counts
      LEFT JOIN LATERAL (
        SELECT cover."id" AS media_id, cover."url" FROM live
        JOIN LATERAL (
          SELECT m."id", m."url" FROM "classified_media" m
          WHERE m."listing_id" = live."id" AND m."kind" = 'photo' AND m."status" = 'ready' AND m."url" IS NOT NULL
          ORDER BY m."position" LIMIT 1
        ) cover ON true
        WHERE live.top = counts.top
        ORDER BY random() LIMIT 1
      ) pick ON true`;
    const byTop = new Map(rows.map(row => [row.top, row]));
    return categories.map(category => ({ slug: category.slug, name: category.name, icon: category.icon, spotlight: category.spotlightUrl, listings: Number(byTop.get(category.id)?.listings ?? 0), photo: this.coverPhoto(byTop.get(category.id)) }));
  }

  /** A category tile's photo: the picked listing's cover, watermarked while watermarks are on. */
  private coverPhoto(row: { media_id: string | null; url: string | null } | undefined) {
    return row?.media_id && row.url ? this.watermarks.url({ id: row.media_id, url: row.url }, 960) : null;
  }
}
