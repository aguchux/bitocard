import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ClassifiedHeroSlide, ClassifiedHeroTile, Prisma } from '../generated/prisma/client.js';
import { bannerHrefOk } from './banners.service.js';
import { ShopDirectoryService } from './directory.service.js';
import { shopOrigin } from './listings.service.js';
import { priceText, readSku } from './rules.js';
import { publicName } from './search.service.js';

/**
 * How a hero column is split, top to bottom: one banner over all three rows, a third over two thirds, two thirds over
 * a third, or three thirds. The number of banners each holds is `heroTiles`.
 */
export const heroLayouts = ['full', 'third_two_thirds', 'two_thirds_third', 'thirds'] as const;
export type HeroLayout = (typeof heroLayouts)[number];
export const heroTiles: Record<HeroLayout, number> = { full: 1, third_two_thirds: 2, two_thirds_third: 2, thirds: 3 };

/** Where a hero banner links: a listing, a brand's page, a seller's page, a category or any address (`/…` or https). */
export const heroLinkKinds = ['listing', 'brand', 'seller', 'category', 'url'] as const;
export type HeroLinkKind = (typeof heroLinkKinds)[number];

/** Columns per market (and for every market): the reel never grows past this. */
export const maxHeroSlides = 30;

export type HeroTileInput = { image_url?: string; alt?: string; link?: { kind?: HeroLinkKind; target?: string }; ad?: boolean };
export type HeroSlideInput = {
  country?: string | null;
  layout?: HeroLayout;
  tiles?: HeroTileInput[];
  enabled?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  note?: string | null;
};

export type HeroState = 'showing' | 'off' | 'scheduled' | 'ended';

type SlideRow = ClassifiedHeroSlide & { tiles: ClassifiedHeroTile[] };
type Resolved = { href: string | null; label: string | null; target: string };

const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const imageOk = (url: string) => {
  try {
    return url.length <= 500 && new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};
const scopeOf = (country: string | null) => country ?? 'global';

/**
 * udozo.com's hero reel: the home page's top, below the header, a row of columns sliding past (and moved by hand), each
 * three rows high holding one, two or three banners. Udozo's team places them for one market or every market, in their
 * order, switched on and off, optionally between two dates. Each banner links to a listing, a brand, a seller or any
 * address; links are worked out when udozo.com reads them, so a renamed listing or seller still leads to the right page
 * (one gone or suspended is shown without a link). Every change is audited, and udozo.com reads them within a minute.
 */
@Injectable()
export class HeroSlidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly directory: ShopDirectoryService,
  ) {}

  stateOf(row: Pick<ClassifiedHeroSlide, 'enabled' | 'startsAt' | 'endsAt'>, now = new Date()): HeroState {
    if (row.endsAt && row.endsAt <= now) return 'ended';
    if (!row.enabled) return 'off';
    return row.startsAt && row.startsAt > now ? 'scheduled' : 'showing';
  }

  // ---- Links ----

  /** Every tile's link worked out at once: where it goes on udozo.com (`market` for brands' pages), and what it is. */
  private async resolve(tiles: Pick<ClassifiedHeroTile, 'id' | 'linkKind' | 'linkTarget'>[], market: string | null) {
    const ids = (kind: HeroLinkKind) => [...new Set(tiles.filter(tile => tile.linkKind === kind).map(tile => tile.linkTarget))];
    const listingIds = ids('listing');
    const brandSlugs = ids('brand');
    const sellerIds = ids('seller');
    const categorySlugs = ids('category');
    const [listings, brands, sellers, firstMarket, categories] = await Promise.all([
      listingIds.length ? this.prisma.classifiedListing.findMany({ where: { id: { in: listingIds } }, select: { id: true, ref: true, slug: true, country: true, title: true, status: true } }) : [],
      brandSlugs.length ? this.prisma.classifiedBrand.findMany({ where: { slug: { in: brandSlugs } }, select: { slug: true, name: true, enabled: true } }) : [],
      sellerIds.length
        ? this.prisma.customer.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true, country: true, status: true, sellerHandle: true, username: true, classifiedSeller: { select: { suspendedAt: true } } } })
        : [],
      !market && brandSlugs.length ? this.directory.markets().then(list => list.data[0]?.country ?? null) : Promise.resolve(market),
      categorySlugs.length ? this.prisma.classifiedCategory.findMany({ where: { slug: { in: categorySlugs } }, select: { slug: true, name: true, enabled: true } }) : [],
    ]);
    const out = new Map<string, Resolved>();
    for (const tile of tiles) {
      const target = tile.linkTarget;
      if (tile.linkKind === 'url') out.set(tile.id, { href: target, label: target, target });
      else if (tile.linkKind === 'category') {
        // The market's category page, or the page across countries (`/c/<slug>`).
        const category = categories.find(item => item.slug === target);
        out.set(tile.id, category?.enabled ? { href: market ? `/${market.toLowerCase()}/c/${category.slug}` : `/c/${category.slug}`, label: category.name, target } : { href: null, label: category?.name ?? null, target });
      }
      else if (tile.linkKind === 'listing') {
        const listing = listings.find(item => item.id === target);
        out.set(tile.id, listing && listing.status !== 'deleted' ? { href: `/${listing.country.toLowerCase()}/l/${listing.ref}${listing.slug ? `-${listing.slug}` : ''}`, label: listing.title, target: String(listing.ref) } : { href: null, label: null, target });
      } else if (tile.linkKind === 'brand') {
        const brand = brands.find(item => item.slug === target);
        const cc = market ?? firstMarket;
        out.set(tile.id, brand?.enabled && cc ? { href: `/${cc.toLowerCase()}/brand/${brand.slug}`, label: brand.name, target } : { href: null, label: brand?.name ?? null, target });
      } else {
        const seller = sellers.find(item => item.id === target);
        const live = seller && seller.status === 'active' && !seller.classifiedSeller?.suspendedAt && seller.country;
        const slug = seller ? (seller.username ?? seller.sellerHandle) : target;
        out.set(tile.id, live ? { href: `/${seller.country!.toLowerCase()}/seller/${slug}`, label: publicName(seller.name), target: slug } : { href: null, label: seller ? publicName(seller.name) : null, target: slug });
      }
    }
    return out;
  }

  /** What an admin typed for a link, checked and kept as what it points at (a listing's id, a seller's customer id). */
  private async linkOf(kind: HeroLinkKind | undefined, raw: string | undefined, param: string): Promise<{ kind: HeroLinkKind; target: string }> {
    if (!kind || !heroLinkKinds.includes(kind)) throw invalid('parameter_missing', 'Choose what it links to.', `${param}.kind`);
    const text = (raw ?? '').trim();
    if (!text) throw invalid('parameter_missing', 'Say which one it links to.', `${param}.target`);
    if (kind === 'url') {
      if (!bannerHrefOk(text)) throw invalid('parameter_invalid', 'Link to a page on udozo.com (starting with /) or an https address.', `${param}.target`);
      return { kind, target: text };
    }
    if (kind === 'listing') {
      // A listing's number (from its address), or its SKU.
      const number = /^\d{1,15}$/.test(text) ? BigInt(text) : (/\/l\/(\d{1,15})/.exec(text)?.[1] ?? null);
      const sku = number === null ? readSku(text) : null;
      const listing = number !== null ? await this.prisma.classifiedListing.findUnique({ where: { ref: BigInt(number) }, select: { id: true, status: true } }) : sku ? await this.prisma.classifiedListing.findUnique({ where: { sku }, select: { id: true, status: true } }) : null;
      if (!listing || listing.status === 'deleted') throw invalid('listing_unknown', 'No listing has that number or SKU.', `${param}.target`);
      return { kind, target: listing.id };
    }
    if (kind === 'category') {
      const slug = text.toLowerCase().replace(/^.*\/c\//, '').replace(/[/?#].*$/, '');
      const category = await this.prisma.classifiedCategory.findUnique({ where: { slug }, select: { slug: true } });
      if (!category) throw invalid('category_unknown', 'No category has that slug.', `${param}.target`);
      return { kind, target: category.slug };
    }
    if (kind === 'brand') {
      const slug = text.toLowerCase().replace(/^.*\/brand\//, '').replace(/[/?#].*$/, '');
      const brand = await this.prisma.classifiedBrand.findUnique({ where: { slug }, select: { slug: true } });
      if (!brand) throw invalid('brand_unknown', 'No brand in the registry has that slug.', `${param}.target`);
      return { kind, target: brand.slug };
    }
    // A seller by their handle or username, or their page's address.
    const key = text.replace(/^.*\/seller\//, '').replace(/[/?#].*$/, '').replace(/^@/, '');
    const seller = await this.prisma.customer.findFirst({ where: { OR: [{ sellerHandle: key }, { username: key.toLowerCase() }] }, select: { id: true } });
    if (!seller) throw invalid('seller_unknown', 'No seller has that handle or username.', `${param}.target`);
    return { kind, target: seller.id };
  }

  /**
   * Admins: what a link may point at, as they type (`q`, up to 8): listings by number, SKU or title (live first, the
   * market's when `scope` is one), brands by name or slug, sellers by username, handle or name, categories by name,
   * slug or search word. `value` is what goes in
   * the link's target; `label`, `detail` and `image_url` are for the list.
   */
  async suggest(kind: Exclude<HeroLinkKind, 'url'>, raw: string, scope: string) {
    const q = raw.trim().slice(0, 80);
    const country = scope === 'global' ? null : scope.toUpperCase();
    const take = 8;
    let data: Array<{ value: string; label: string; detail: string | null; image_url: string | null }> = [];
    if (kind === 'listing') {
      const number = /^\d{1,15}$/.test(q) ? BigInt(q) : null;
      const sku = readSku(q);
      const rows = await this.prisma.classifiedListing.findMany({
        where: {
          status: { notIn: ['deleted', 'draft'] },
          ...(country ? { country } : {}),
          ...(q ? { OR: [...(number !== null ? [{ ref: number }] : []), ...(sku ? [{ sku }] : []), { title: { contains: q, mode: 'insensitive' as const } }, { sku: { startsWith: q.toUpperCase() } }] } : {}),
        },
        select: { ref: true, sku: true, title: true, status: true, country: true, currency: true, priceKind: true, priceMinor: true },
        orderBy: [{ updatedAt: 'desc' }],
        take: take * 3,
      });
      // Live ones first, then the rest as they came.
      const live = (row: { status: string }) => (row.status === 'active' ? 0 : 1);
      data = rows
        .sort((a, b) => live(a) - live(b))
        .slice(0, take)
        .map(row => ({
          value: String(row.ref),
          label: row.title ?? `Listing ${row.ref}`,
          detail: [`No. ${row.ref}`, row.sku, row.priceKind !== 'on_request' && row.priceMinor !== null ? priceText(row.priceMinor, row.currency) : null, row.status === 'active' ? null : row.status, row.country].filter(Boolean).join(' · '),
          image_url: null,
        }));
    } else if (kind === 'category') {
      const rows = await this.prisma.classifiedCategory.findMany({
        where: { enabled: true, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { startsWith: q.toLowerCase() } }, { keywords: { has: q.toLowerCase() } }] } : { parentId: null }) },
        select: { slug: true, name: true, parent: { select: { name: true } } },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        take: take * 3,
      });
      const starts = (name: string) => (name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1);
      data = rows
        .sort((a, b) => starts(a.name) - starts(b.name))
        .slice(0, take)
        .map(row => ({ value: row.slug, label: row.name, detail: row.parent ? `In ${row.parent.name} · ${row.slug}` : `Top category · ${row.slug}`, image_url: null }));
    } else if (kind === 'brand') {
      const rows = await this.prisma.classifiedBrand.findMany({
        where: { enabled: true, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { startsWith: q.toLowerCase() } }, { aliases: { has: q.toLowerCase() } }] } : {}) },
        select: { slug: true, name: true, logoUrl: true, logoFile: true },
        orderBy: [{ name: 'asc' }],
        take: take * 3,
      });
      // Names starting with what was typed first.
      const starts = (name: string) => (name.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1);
      data = rows
        .sort((a, b) => starts(a.name) - starts(b.name))
        .slice(0, take)
        .map(row => ({ value: row.slug, label: row.name, detail: row.slug, image_url: row.logoUrl ?? (row.logoFile ? `${shopOrigin}/brand-logos/${row.logoFile}.svg` : null) }));
    } else {
      const key = q.replace(/^@/, '');
      const rows = await this.prisma.customer.findMany({
        where: {
          status: 'active',
          classifiedListings: { some: { status: { notIn: ['deleted', 'draft'] } } },
          ...(country ? { country } : {}),
          ...(key ? { OR: [{ username: { startsWith: key.toLowerCase() } }, { sellerHandle: { startsWith: key } }, { name: { contains: key, mode: 'insensitive' } }] } : {}),
        },
        select: { name: true, username: true, sellerHandle: true, country: true, avatarUrl: true },
        orderBy: [{ updatedAt: 'desc' }],
        take,
      });
      data = rows.map(row => ({ value: row.username ?? row.sellerHandle, label: row.name, detail: [row.username ? `@${row.username}` : `Handle ${row.sellerHandle}`, row.country].filter(Boolean).join(' · '), image_url: row.avatarUrl }));
    }
    return { object: 'list' as const, kind, data };
  }

  // ---- Reading ----

  async present(row: SlideRow, links?: Map<string, Resolved>) {
    const resolved = links ?? (await this.resolve(row.tiles, row.country));
    return {
      object: 'hero_slide' as const,
      id: row.id,
      /** A market's code, or null for every market. */
      country: row.country,
      layout: row.layout as HeroLayout,
      position: row.position,
      tiles: [...row.tiles]
        .sort((a, b) => a.slot - b.slot)
        .map(tile => {
          const link = resolved.get(tile.id);
          return { id: tile.id, slot: tile.slot, image_url: tile.imageUrl, alt: tile.alt, ad: tile.ad, link: { kind: tile.linkKind as HeroLinkKind, target: link?.target ?? tile.linkTarget, label: link?.label ?? null, href: link?.href ?? null } };
        }),
      enabled: row.enabled,
      state: this.stateOf(row),
      starts_at: row.startsAt?.toISOString() ?? null,
      ends_at: row.endsAt?.toISOString() ?? null,
      note: row.note,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** Admins: one market's columns (`global`: those for every market), in their order. */
  async list(scope: string) {
    const country = scope === 'global' ? null : scope.toUpperCase();
    const rows = await this.prisma.classifiedHeroSlide.findMany({ where: { country }, include: { tiles: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    const links = await this.resolve(rows.flatMap(row => row.tiles), country);
    return { object: 'list' as const, scope: scopeOf(country), data: await Promise.all(rows.map(row => this.present(row, links))) };
  }

  /**
   * What udozo.com's home page shows (`page`: a market's code, or `global` for the page across countries): the market's
   * own columns showing now, then those for every market, each in its order. Only what the page needs (never the note);
   * a banner whose link is gone is shown without one.
   */
  async showing(page: string) {
    const now = new Date();
    const country = page === 'global' ? null : page.toUpperCase();
    const live: Prisma.ClassifiedHeroSlideWhereInput = {
      enabled: true,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    };
    const rows = await this.prisma.classifiedHeroSlide.findMany({
      where: { ...live, OR: country ? [{ country }, { country: null }] : [{ country: null }] },
      include: { tiles: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      take: maxHeroSlides * 2,
    });
    // The market's own first.
    const ordered = [...rows.filter(row => row.country !== null), ...rows.filter(row => row.country === null)].filter(row => row.tiles.length === heroTiles[row.layout as HeroLayout]);
    const links = await this.resolve(ordered.flatMap(row => row.tiles), country);
    return {
      object: 'list' as const,
      page: country ?? 'global',
      data: ordered.map(row => ({
        object: 'hero_slide' as const,
        id: row.id,
        layout: row.layout as HeroLayout,
        tiles: [...row.tiles].sort((a, b) => a.slot - b.slot).map(tile => ({ id: tile.id, image_url: tile.imageUrl, alt: tile.alt, href: links.get(tile.id)?.href ?? null, ad: tile.ad })),
      })),
    };
  }

  private async one(id: string) {
    const row = await this.prisma.classifiedHeroSlide.findUnique({ where: { id }, include: { tiles: true } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such hero column.');
    return row;
  }

  // ---- Changing ----

  /** The column's fields and banners checked, merged over what it had. */
  private async fields(input: HeroSlideInput, before?: SlideRow) {
    const date = (value: string | null | undefined, param: string, otherwise: Date | null) => {
      if (value === undefined) return otherwise;
      if (value === null || value === '') return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw invalid('parameter_invalid', 'Use a date and time.', param);
      return parsed;
    };
    const country = input.country === undefined ? (before?.country ?? null) : input.country === null ? null : input.country.toUpperCase();
    if (country !== null && !(await this.directory.markets()).data.some(market => market.country === country)) throw invalid('market_unavailable', 'Udozo is not open in that country.', 'country');
    const layout = input.layout ?? (before?.layout as HeroLayout | undefined);
    if (!layout || !heroLayouts.includes(layout)) throw invalid('parameter_missing', 'Choose how the column is split.', 'layout');
    let tiles: Omit<ClassifiedHeroTile, 'id' | 'slideId'>[] | null = null;
    if (input.tiles !== undefined) {
      if (input.tiles.length !== heroTiles[layout]) throw invalid('tiles_mismatch', `This split holds ${heroTiles[layout]} banner${heroTiles[layout] === 1 ? '' : 's'}.`, 'tiles');
      tiles = [];
      for (const [slot, tile] of input.tiles.entries()) {
        const param = `tiles[${slot}]`;
        const imageUrl = (tile.image_url ?? '').trim();
        if (!imageUrl) throw invalid('parameter_missing', 'Add the banner’s image.', `${param}.image_url`);
        if (!imageOk(imageUrl)) throw invalid('parameter_invalid', 'Upload the image, or use an https address.', `${param}.image_url`);
        const alt = (tile.alt ?? '').trim();
        if (!alt) throw invalid('parameter_missing', 'Describe the banner for people who cannot see it.', `${param}.alt`);
        if (alt.length > 120) throw invalid('parameter_invalid', 'Keep the description to 120 characters.', `${param}.alt`);
        const link = await this.linkOf(tile.link?.kind, tile.link?.target, `${param}.link`);
        tiles.push({ slot, imageUrl, alt, linkKind: link.kind, linkTarget: link.target, ad: tile.ad ?? true });
      }
    } else if (!before || before.tiles.length !== heroTiles[layout]) {
      throw invalid('tiles_mismatch', `This split holds ${heroTiles[layout]} banner${heroTiles[layout] === 1 ? '' : 's'}: send them all.`, 'tiles');
    }
    const startsAt = date(input.starts_at, 'starts_at', before?.startsAt ?? null);
    const endsAt = date(input.ends_at, 'ends_at', before?.endsAt ?? null);
    if (startsAt && endsAt && !(endsAt > startsAt)) throw invalid('parameter_invalid', 'End it after it starts.', 'ends_at');
    const note = input.note === undefined ? (before?.note ?? null) : input.note?.trim() || null;
    return { slide: { country, layout, enabled: input.enabled ?? before?.enabled ?? true, startsAt, endsAt, note }, tiles };
  }

  async create(actorId: string | null, input: HeroSlideInput) {
    if (input.tiles === undefined) throw invalid('parameter_missing', 'Add the column’s banners.', 'tiles');
    const { slide, tiles } = await this.fields(input);
    const row = await this.prisma.$transaction(async tx => {
      const count = await tx.classifiedHeroSlide.count({ where: { country: slide.country } });
      if (count >= maxHeroSlides) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'too_many_slides', `A market holds at most ${maxHeroSlides} columns. Delete one first.`);
      const last = await tx.classifiedHeroSlide.aggregate({ where: { country: slide.country }, _max: { position: true } });
      return tx.classifiedHeroSlide.create({ data: { ...slide, position: (last._max.position ?? -1) + 1, createdById: actorId, updatedById: actorId, tiles: { create: tiles! } }, include: { tiles: true } });
    });
    await this.audit.record({ actorId, action: 'hero_slide.created', targetType: 'hero_slide', targetId: row.id, after: row });
    return this.present(row);
  }

  /** Changes a column: `enabled` alone is the on and off switch; `tiles` replaces its banners. Moving it to another market puts it last there. */
  async update(actorId: string | null, id: string, input: HeroSlideInput) {
    const before = await this.one(id);
    const { slide, tiles } = await this.fields(input, before);
    const moved = slide.country !== before.country;
    const row = await this.prisma.$transaction(async tx => {
      let position = before.position;
      if (moved) {
        const last = await tx.classifiedHeroSlide.aggregate({ where: { country: slide.country }, _max: { position: true } });
        position = (last._max.position ?? -1) + 1;
      }
      if (tiles) await tx.classifiedHeroTile.deleteMany({ where: { slideId: id } });
      return tx.classifiedHeroSlide.update({ where: { id }, data: { ...slide, position, updatedById: actorId, ...(tiles ? { tiles: { create: tiles } } : {}) }, include: { tiles: true } });
    });
    await this.audit.record({ actorId, action: 'hero_slide.updated', targetType: 'hero_slide', targetId: id, before, after: row });
    return this.present(row);
  }

  async remove(actorId: string | null, id: string) {
    const before = await this.one(id);
    await this.prisma.classifiedHeroSlide.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'hero_slide.deleted', targetType: 'hero_slide', targetId: id, before });
    return { object: 'hero_slide' as const, id, deleted: true };
  }

  /** A market's columns (`global`: every market's) in a new order: `ids` must be all of them, each once. */
  async reorder(actorId: string | null, scope: string, ids: string[]) {
    const country = scope === 'global' ? null : scope.toUpperCase();
    const rows = await this.prisma.classifiedHeroSlide.findMany({ where: { country }, select: { id: true, position: true }, orderBy: { position: 'asc' } });
    const known = new Set(rows.map(row => row.id));
    if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) {
      throw invalid('order_mismatch', 'Send every column of this market once, in the new order.', 'ids');
    }
    await this.prisma.$transaction(ids.map((id, position) => this.prisma.classifiedHeroSlide.update({ where: { id }, data: { position, updatedById: actorId } })));
    await this.audit.record({ actorId, action: 'hero_slide.reordered', targetType: 'hero_slide', targetId: scopeOf(country), before: rows.map(row => row.id), after: ids });
    return this.list(scopeOf(country));
  }
}
