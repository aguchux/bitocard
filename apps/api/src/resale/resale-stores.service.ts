import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ShopEmails } from '../classifieds/shop-emails.service.js';
import { ResaleService } from '../classifieds/resale.service.js';
import { featureValueOut, holdingStatuses, invalid, linkPattern, maxPriceMinor } from '../classifieds/rules.js';
import { publicName } from '../classifieds/search.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { breakdown, type FeeRates, priceRange, resellerPrice, type ResaleTerms, termsWith } from './pricing.js';
import { ResaleTradeService } from './resale-trade.service.js';

/** The store template that sells resale listings (stage 3 builds it; stage 2 already requires it). */
export const resaleTemplate = 'resale_shop';
export const maxNote = 140;
const maxRules = 20;
const ruleBatch = 200;

export const resaleListingStatuses = ['active', 'paused', 'removed'] as const;
export type ResaleListingStatus = (typeof resaleListingStatuses)[number];
/** What a store listing can do now; only `selling` is on sale. */
export const resaleStates = ['selling', 'paused', 'removed', 'supplier_stopped', 'unavailable', 'supplier_paused', 'sold_out', 'price_out_of_range'] as const;
export type ResaleState = (typeof resaleStates)[number];

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const unavailable = (message: string, param?: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'resale_unavailable', message, param);

const gateMessages = {
  switch_off: 'Reselling BitoCard Shop listings is not open to your account yet.',
  house_account: 'BitoCard’s own stores do not resell listings.',
  not_verified: 'Finish your verification before reselling listings.',
  no_country: 'Choose your business country before reselling listings.',
  resale_closed: 'Reselling is not open in your country yet.',
} as const;
type GateReason = keyof typeof gateMessages;

const listingSelect = {
  id: true,
  ref: true,
  customerId: true,
  country: true,
  currency: true,
  status: true,
  resale: true,
  resalePausedAt: true,
  stock: true,
  priceMinor: true,
  resaleDiscountBps: true,
  resaleMarkupMaxBps: true,
  title: true,
  slug: true,
  condition: true,
  delivery: true,
  onShop: true,
  publishedAt: true,
  category: { select: { slug: true, name: true } },
  area: { select: { name: true, parent: { select: { name: true } } } },
  media: { where: { kind: 'photo', status: 'ready' }, orderBy: { position: 'asc' }, take: 1, select: { url: true, width: true, height: true } },
  customer: { select: { id: true, name: true, createdAt: true, phoneVerifiedAt: true } },
} satisfies Prisma.ClassifiedListingSelect;
type ListingRow = Prisma.ClassifiedListingGetPayload<{ select: typeof listingSelect }>;

type Deal = { id: string; listingId: string | null; discountBps: number; floorBps: number; endsAt: Date | null };

/** Live on resellers' stores: open to resale by a seller who is not suspended. */
export const resaleWhere = (country: string): Prisma.ClassifiedListingWhereInput => ({
  country,
  status: 'active',
  resale: true,
  resalePausedAt: null,
  priceMinor: { not: null },
  priceKind: { not: 'on_request' },
  customer: { OR: [{ classifiedSeller: { is: null } }, { classifiedSeller: { is: { suspendedAt: null } } }] },
});

/**
 * B2B reselling, stage 2 (`docs/BITOCARD_B2B_RESELLING_PLAN.md`), resellers' side: the catalogue of suppliers' resale
 * listings in their country, adding them to a Resale shop store at a price inside the supplier's limits (a markup that
 * follows the supplier's price, or a fixed price checked again whenever the price or a deal changes), the one note the
 * supplier must approve, auto-listing rules, and the job that keeps stores in step and tells resellers what changed.
 * A store listing holds no words about the item: the store reads the supplier's listing every time.
 */
@Injectable()
export class ResaleStoresService {
  private readonly logger = new Logger(ResaleStoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly resale: ResaleService,
    private readonly trade: ResaleTradeService,
    private readonly inbox: InboxService,
    private readonly emails: ShopEmails,
  ) {}

  // ---- Who may resell ----

  private async gate(resellerId: string): Promise<{ reason: GateReason | null; country: string | null; name: string }> {
    const reseller = await this.prisma.reseller.findUnique({ where: { id: resellerId }, select: { name: true, status: true, country: true, house: true } });
    if (!reseller) throw notFound('reseller');
    const reason: GateReason | null = !(await this.settings.isOn('reseller_resale', resellerId))
      ? 'switch_off'
      : reseller.house
        ? 'house_account'
        : reseller.status !== 'active'
          ? 'not_verified'
          : !reseller.country
            ? 'no_country'
            : !(await this.resale.availability(reseller.country)).open
              ? 'resale_closed'
              : null;
    return { reason, country: reseller.country, name: reseller.name };
  }

  /** Whether the reseller can resell now (their store sells nothing otherwise). */
  async canResell(resellerId: string) {
    const { reason, country } = await this.gate(resellerId);
    return reason ? null : country;
  }

  /**
   * A store's listings on sale now (state `selling`): its active store listings whose supplier still offers them, with
   * stock left and the price inside the limits, newest first. At most 1,000, for the store's own pages.
   */
  async onSale(storeId: string, country: string, filter: { categoryIds?: string[]; q?: string; listingRef?: bigint } = {}) {
    const rows = await this.prisma.resaleListing.findMany({
      where: {
        storeId,
        status: 'active',
        relationship: { supplierBlockedAt: null },
        listing: {
          ...resaleWhere(country),
          ...(filter.categoryIds ? { categoryId: { in: filter.categoryIds } } : {}),
          ...(filter.q ? { title: { contains: filter.q.trim().slice(0, 100), mode: 'insensitive' } } : {}),
          ...(filter.listingRef !== undefined ? { ref: filter.listingRef } : {}),
        },
      },
      include: this.storeListingInclude,
      orderBy: [{ listing: { publishedAt: 'desc' } }, { id: 'asc' }],
      take: 1000,
    });
    return (await this.evaluate(rows)).filter(item => item.state === 'selling');
  }

  /** The reseller's country, or `resale_unavailable` saying why they cannot resell. */
  async requireReseller(resellerId: string) {
    const { reason, country } = await this.gate(resellerId);
    if (reason) throw unavailable(gateMessages[reason]);
    return country!;
  }

  private async requireStore(resellerId: string, storeId: string, scope?: string) {
    if (scope && scope !== storeId) throw notFound('store');
    const store = await this.prisma.store.findFirst({ where: { id: storeId, resellerId }, select: { id: true, name: true, template: true } });
    if (!store) throw notFound('store');
    if (store.template !== resaleTemplate) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'store_not_resale_shop', 'Resale listings are sold on a store using the Resale shop template.', 'store_id');
    return store;
  }

  /** `GET /v1/resale`: whether the reseller can resell, why not, their Resale shop stores and the country's limits. */
  async account(resellerId: string, scope?: string) {
    const { reason, country } = await this.gate(resellerId);
    const [stores, limits] = await Promise.all([
      this.prisma.store.findMany({ where: { resellerId, template: resaleTemplate, ...(scope ? { id: scope } : {}) }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, subdomain: true, status: true } }),
      country ? this.resale.limits(country) : null,
    ]);
    return {
      object: 'resale_account' as const,
      available: reason === null,
      reason,
      country,
      stores: stores.map(store => ({ id: store.id, name: store.name, subdomain: store.subdomain, published: store.status === 'published' })),
      reseller_fee_bps: limits?.resellerFeeBps ?? null,
      reseller_fee_cap: limits?.resellerFeeCapMinor === null || limits?.resellerFeeCapMinor === undefined ? null : Number(limits.resellerFeeCapMinor),
    };
  }

  // ---- Prices ----

  private async feeRates(country: string): Promise<FeeRates> {
    const [limits, safePay] = await Promise.all([this.resale.limits(country), this.prisma.classifiedSafePaySettings.findUnique({ where: { country } })]);
    return { resellerFeeBps: limits.resellerFeeBps, resellerFeeCapMinor: limits.resellerFeeCapMinor, buyerFeeBps: safePay?.buyerFeeBps ?? null, buyerFeeCapMinor: safePay?.buyerFeeCapMinor ?? null };
  }

  /** Units not yet held by paid orders, per listing. */
  private async available(listings: { id: string; stock: number }[]) {
    if (!listings.length) return new Map<string, number>();
    const held = await this.prisma.classifiedOrder.groupBy({ by: ['listingId'], where: { listingId: { in: listings.map(row => row.id) }, status: { in: holdingStatuses } }, _sum: { quantity: true } });
    const counts = new Map(held.map(row => [row.listingId, row._sum.quantity ?? 0]));
    return new Map(listings.map(row => [row.id, Math.max(row.stock - (counts.get(row.id) ?? 0), 0)]));
  }

  /** A price setting checked against the listing's terms: exactly one of a markup and a fixed price, in range. */
  private checkPrice(supplierPrice: bigint, terms: ResaleTerms, input: { markup_bps?: number | null; fixed_price?: number | null }) {
    const markup = input.markup_bps ?? null;
    const fixed = input.fixed_price ?? null;
    if ((markup === null) === (fixed === null)) throw invalid('parameter_invalid', 'Set your price as a markup (markup_bps) or a fixed price (fixed_price), not both.', markup === null ? 'markup_bps' : 'fixed_price');
    const range = priceRange(supplierPrice, terms);
    if (markup !== null) {
      if (!Number.isInteger(markup) || markup < -terms.floorBps || markup > terms.markupMaxBps) {
        throw invalid('resale_price_out_of_range', `Your markup must be from ${-terms.floorBps / 100}% to ${terms.markupMaxBps / 100}% for this listing.`, 'markup_bps');
      }
      return { markupBps: markup, fixedPriceMinor: null };
    }
    const price = BigInt(fixed!);
    if (price <= 0n || price > maxPriceMinor || price < range.min || price > range.max) {
      throw invalid('resale_price_out_of_range', `Your price must be from ${range.min} to ${range.max} (in minor units) for this listing.`, 'fixed_price');
    }
    return { markupBps: null, fixedPriceMinor: price };
  }

  // ---- The catalogue ----

  supplier(customer: ListingRow['customer'], checked: Set<string>) {
    return {
      id: customer.id,
      name: publicName(customer.name),
      member_since: customer.createdAt.toISOString(),
      badges: [...(customer.phoneVerifiedAt ? ['phone_confirmed'] : []), ...(checked.has(customer.id) ? ['id_checked'] : [])],
    };
  }

  async idChecked(customerIds: string[]) {
    if (!customerIds.length) return new Set<string>();
    const rows = await this.prisma.identityVerification.findMany({ where: { subject: 'customer', mode: 'live', status: 'approved', customerReference: { in: [...new Set(customerIds)] } }, select: { customerReference: true } });
    return new Set(rows.map(row => row.customerReference!));
  }

  /** Each listing's card for resellers, with its terms (and any deal of theirs), range, and stores of theirs carrying it. */
  private async catalogueCards(resellerId: string, rows: ListingRow[], storeId?: string) {
    const [checked, available, deals, carried, fees] = await Promise.all([
      this.idChecked(rows.map(row => row.customerId)),
      this.available(rows),
      this.trade.dealsFor(resellerId, [...new Set(rows.map(row => row.customerId))]),
      this.prisma.resaleListing.findMany({ where: { resellerId, listingId: { in: rows.map(row => row.id) }, status: { not: 'removed' }, ...(storeId ? { storeId } : {}) }, select: { id: true, storeId: true, listingId: true } }),
      rows[0] ? this.feeRates(rows[0].country) : null,
    ]);
    return rows.map(row => {
      const deal = this.dealFor(deals.get(row.customerId) ?? [], row.id);
      const terms = termsWith(row, deal);
      const price = row.priceMinor!;
      const range = priceRange(price, terms);
      const top = fees ? breakdown(price, range.max, terms, fees) : null;
      const cover = row.media[0];
      return {
        object: 'resale_catalogue_listing' as const,
        id: row.id,
        ref: Number(row.ref),
        title: row.title!,
        condition: row.condition,
        category: row.category ? { slug: row.category.slug, name: row.category.name } : null,
        area: row.area ? { name: row.area.name, state: row.area.parent?.name ?? null } : null,
        cover: cover ? { url: cover.url, width: cover.width, height: cover.height } : null,
        delivery: row.delivery,
        currency: row.currency,
        supplier_price: Number(price),
        available: available.get(row.id) ?? 0,
        discount_bps: terms.discountBps,
        floor_bps: terms.floorBps,
        markup_max_bps: terms.markupMaxBps,
        deal_id: deal?.id ?? null,
        price_range: { min: Number(range.min), max: Number(range.max) },
        /** What you would keep at the top of the range, after BitoCard's fee. */
        earnings_at_max: top ? Number(top.earnings) : null,
        supplier: this.supplier(row.customer, checked),
        in_stores: carried.filter(item => item.listingId === row.id).map(item => ({ store_id: item.storeId, resale_listing_id: item.id })),
        published_at: row.publishedAt?.toISOString() ?? null,
      };
    });
  }

  private dealFor(deals: Deal[], listingId: string) {
    const now = Date.now();
    const live = deals.filter(deal => !deal.endsAt || deal.endsAt.getTime() > now);
    return live.find(deal => deal.listingId === listingId) ?? live.find(deal => deal.listingId === null) ?? null;
  }

  /** `GET /v1/resale/catalogue`: suppliers' resale listings in the reseller's country, newest first or by price. */
  async catalogue(
    resellerId: string,
    query: { category?: string; q?: string; min_price?: number; max_price?: number; condition?: string; supplier_id?: string; store_id?: string; sort?: 'newest' | 'price_asc' | 'price_desc'; offset?: number; limit?: number },
    scope?: string,
  ) {
    const country = await this.requireReseller(resellerId);
    if (query.store_id) await this.requireStore(resellerId, query.store_id, scope);
    const blocked = await this.trade.blockedSuppliers(resellerId);
    const category = query.category ? await this.prisma.classifiedCategory.findUnique({ where: { slug: query.category }, select: { id: true } }) : null;
    if (query.category && !category) throw invalid('parameter_invalid', 'No such category.', 'category');
    const where: Prisma.ClassifiedListingWhereInput = {
      ...resaleWhere(country),
      ...(blocked.length ? { customerId: { notIn: blocked } } : {}),
      ...(query.supplier_id ? { customerId: query.supplier_id, ...(blocked.includes(query.supplier_id) ? { id: '00000000-0000-0000-0000-000000000000' } : {}) } : {}),
      ...(category ? { OR: [{ categoryId: category.id }, { category: { parentId: category.id } }] } : {}),
      ...(query.condition ? { condition: query.condition } : {}),
      ...(query.q ? { title: { contains: query.q.trim().slice(0, 100), mode: 'insensitive' } } : {}),
      ...(query.min_price !== undefined || query.max_price !== undefined
        ? { priceMinor: { not: null, ...(query.min_price !== undefined ? { gte: BigInt(query.min_price) } : {}), ...(query.max_price !== undefined ? { lte: BigInt(query.max_price) } : {}) } }
        : {}),
    };
    const orderBy: Prisma.ClassifiedListingOrderByWithRelationInput[] =
      query.sort === 'price_asc' ? [{ priceMinor: 'asc' }, { id: 'asc' }] : query.sort === 'price_desc' ? [{ priceMinor: 'desc' }, { id: 'asc' }] : [{ publishedAt: 'desc' }, { id: 'asc' }];
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 24;
    const [rows, total] = await Promise.all([this.prisma.classifiedListing.findMany({ where, orderBy, skip: offset, take: limit, select: listingSelect }), this.prisma.classifiedListing.count({ where })]);
    return { object: 'list' as const, data: await this.catalogueCards(resellerId, rows, query.store_id), total, offset, limit };
  }

  /** `GET /v1/resale/catalogue/:id`: one resale listing as the supplier wrote it, with its terms for this reseller. */
  async catalogueListing(resellerId: string, id: string) {
    const country = await this.requireReseller(resellerId);
    const row = await this.prisma.classifiedListing.findFirst({ where: { id, ...resaleWhere(country) }, select: listingSelect });
    if (!row || (await this.trade.blockedSuppliers(resellerId)).includes(row.customerId)) throw notFound('resale listing');
    const [card] = await this.catalogueCards(resellerId, [row]);
    const detail = await this.prisma.classifiedListing.findUniqueOrThrow({
      where: { id },
      select: {
        description: true,
        category: { select: { features: { select: { featureId: true, position: true } } } },
        features: { include: { feature: true } },
        media: { where: { status: 'ready' }, orderBy: [{ kind: 'asc' }, { position: 'asc' }], select: { kind: true, url: true, width: true, height: true, posterUrl: true, durationMs: true } },
      },
    });
    const video = detail.media.find(item => item.kind === 'video');
    const order = new Map((detail.category?.features ?? []).map(link => [link.featureId, link.position]));
    return {
      ...card,
      object: 'resale_catalogue_listing_detail' as const,
      description: detail.description,
      features: detail.features
        .filter(value => value.feature.enabled)
        .sort((a, b) => (order.get(a.featureId) ?? 1000) - (order.get(b.featureId) ?? 1000) || a.feature.name.localeCompare(b.feature.name))
        .map(value => ({ key: value.feature.key, name: value.feature.name, unit: value.feature.unit, value: featureValueOut(value.feature.dataType, value) })),
      photos: detail.media.filter(item => item.kind === 'photo').map(item => ({ url: item.url, width: item.width, height: item.height })),
      video: video ? { url: video.url, poster_url: video.posterUrl, duration_ms: video.durationMs } : null,
    };
  }

  /** `GET /v1/resale/price-preview`: what one sale would give at a markup or fixed price, nothing saved. */
  async preview(resellerId: string, input: { listing_id: string; markup_bps?: number; fixed_price?: number }) {
    const country = await this.requireReseller(resellerId);
    const row = await this.prisma.classifiedListing.findFirst({ where: { id: input.listing_id, ...resaleWhere(country) }, select: listingSelect });
    if (!row) throw notFound('resale listing');
    const deal = this.dealFor((await this.trade.dealsFor(resellerId, [row.customerId])).get(row.customerId) ?? [], row.id);
    const terms = termsWith(row, deal);
    const setting = this.checkPrice(row.priceMinor!, terms, input);
    return this.priceOut(row.priceMinor!, resellerPrice(row.priceMinor!, setting), terms, await this.feeRates(country), row.currency, deal);
  }

  private priceOut(supplierPrice: bigint, price: bigint, terms: ResaleTerms, fees: FeeRates, currency: string, deal: Deal | null) {
    const sums = breakdown(supplierPrice, price, terms, fees);
    return {
      object: 'resale_price' as const,
      currency,
      supplier_price: Number(supplierPrice),
      price: Number(price),
      price_range: { min: Number(sums.range.min), max: Number(sums.range.max) },
      in_range: sums.inRange,
      discount_bps: terms.discountBps,
      floor_bps: terms.floorBps,
      markup_max_bps: terms.markupMaxBps,
      deal_id: deal?.id ?? null,
      margin: Number(sums.margin),
      reseller_fee: Number(sums.resellerFee),
      earnings: Number(sums.earnings),
      buyer_fee: Number(sums.buyerFee),
      buyer_pays: Number(price + sums.buyerFee),
    };
  }

  // ---- Store listings ----

  readonly storeListingInclude = {
    listing: { select: listingSelect },
    relationship: { select: { supplierBlockedAt: true } },
    store: { select: { name: true, subdomain: true } },
  } satisfies Prisma.ResaleListingInclude;

  /** What a store listing can do now, and its price. */
  async evaluate(rows: Prisma.ResaleListingGetPayload<{ include: ResaleStoresService['storeListingInclude'] }>[]) {
    if (!rows.length) return [];
    const available = await this.available(rows.map(row => row.listing));
    const dealsByReseller = new Map<string, Map<string, Deal[]>>();
    for (const resellerId of new Set(rows.map(row => row.resellerId))) {
      dealsByReseller.set(resellerId, await this.trade.dealsFor(resellerId, [...new Set(rows.filter(row => row.resellerId === resellerId).map(row => row.listing.customerId))]));
    }
    const fees = new Map<string, FeeRates>();
    for (const country of new Set(rows.map(row => row.listing.country))) fees.set(country, await this.feeRates(country));
    return rows.map(row => {
      const listing = row.listing;
      const deal = this.dealFor(dealsByReseller.get(row.resellerId)?.get(listing.customerId) ?? [], listing.id);
      const terms = termsWith(listing, deal);
      const supplierPrice = listing.priceMinor ?? 0n;
      const price = resellerPrice(supplierPrice, row);
      const sums = breakdown(supplierPrice, price, terms, fees.get(listing.country)!);
      const left = available.get(listing.id) ?? 0;
      const state: ResaleState =
        row.status === 'removed'
          ? 'removed'
          : row.status === 'paused'
            ? 'paused'
            : row.relationship.supplierBlockedAt
              ? 'supplier_stopped'
              : listing.status !== 'active' || !listing.resale || listing.priceMinor === null
                ? 'unavailable'
                : listing.resalePausedAt
                  ? 'supplier_paused'
                  : left <= 0
                    ? 'sold_out'
                    : !sums.inRange
                      ? 'price_out_of_range'
                      : 'selling';
      return { row, deal, terms, price, sums, left, state };
    });
  }

  private present(item: Awaited<ReturnType<ResaleStoresService['evaluate']>>[number], checked: Set<string>) {
    const { row, deal, terms, price, sums, left, state } = item;
    const listing = row.listing;
    const cover = listing.media[0];
    return {
      object: 'resale_listing' as const,
      id: row.id,
      store_id: row.storeId,
      listing_id: row.listingId,
      supplier_relationship_id: row.relationshipId,
      status: row.status as ResaleListingStatus,
      state,
      title: listing.title ?? '',
      cover: cover ? { url: cover.url, width: cover.width, height: cover.height } : null,
      currency: listing.currency,
      supplier_price: listing.priceMinor === null ? null : Number(listing.priceMinor),
      markup_bps: row.markupBps,
      fixed_price: row.fixedPriceMinor === null ? null : Number(row.fixedPriceMinor),
      price: Number(price),
      price_range: { min: Number(sums.range.min), max: Number(sums.range.max) },
      discount_bps: terms.discountBps,
      floor_bps: terms.floorBps,
      markup_max_bps: terms.markupMaxBps,
      deal_id: deal?.id ?? null,
      margin: Number(sums.margin),
      reseller_fee: Number(sums.resellerFee),
      earnings: Number(sums.earnings),
      available: left,
      note: row.note === null ? null : { text: row.note, status: row.noteStatus!, reason: row.noteReason, submitted_at: row.noteSubmittedAt?.toISOString() ?? null, decided_at: row.noteDecidedAt?.toISOString() ?? null },
      supplier: this.supplier(listing.customer, checked),
      rule_id: row.ruleId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private async presentMany(rows: Prisma.ResaleListingGetPayload<{ include: ResaleStoresService['storeListingInclude'] }>[]) {
    const [items, checked] = await Promise.all([this.evaluate(rows), this.idChecked(rows.map(row => row.listing.customerId))]);
    return items.map(item => this.present(item, checked));
  }

  private async own(resellerId: string, id: string, scope?: string) {
    const row = await this.prisma.resaleListing.findFirst({ where: { id, resellerId, ...(scope ? { storeId: scope } : {}) }, include: this.storeListingInclude });
    if (!row) throw notFound('resale listing');
    return row;
  }

  /** `GET /v1/resale/listings`: a store's resale listings (removed ones only when asked). */
  async list(resellerId: string, query: { store_id?: string; status?: ResaleListingStatus; offset?: number; limit?: number }, scope?: string) {
    const storeId = scope ?? query.store_id;
    const where: Prisma.ResaleListingWhereInput = { resellerId, ...(storeId ? { storeId } : {}), status: query.status ?? { not: 'removed' } };
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    const [rows, total] = await Promise.all([
      this.prisma.resaleListing.findMany({ where, include: this.storeListingInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: offset, take: limit }),
      this.prisma.resaleListing.count({ where }),
    ]);
    return { object: 'list' as const, data: await this.presentMany(rows), total, offset, limit };
  }

  async get(resellerId: string, id: string, scope?: string) {
    const [item] = await this.presentMany([await this.own(resellerId, id, scope)]);
    return item;
  }

  /** `POST /v1/resale/listings`: add a supplier's resale listing to a Resale shop store at the reseller's price. */
  async add(resellerId: string, input: { store_id: string; listing_id: string; markup_bps?: number | null; fixed_price?: number | null }, scope?: string, ruleId: string | null = null) {
    const country = await this.requireReseller(resellerId);
    const store = await this.requireStore(resellerId, input.store_id, scope);
    const listing = await this.prisma.classifiedListing.findFirst({ where: { id: input.listing_id, ...resaleWhere(country) }, select: listingSelect });
    if (!listing) throw notFound('resale listing');
    // Everything is checked before the supplier relationship is made, so a refused request never starts one.
    if ((await this.trade.blockedSuppliers(resellerId)).includes(listing.customerId)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'supplier_stopped', 'This supplier has stopped you reselling their listings.', 'listing_id');
    }
    const deal = this.dealFor((await this.trade.dealsFor(resellerId, [listing.customerId])).get(listing.customerId) ?? [], listing.id);
    const setting = this.checkPrice(listing.priceMinor!, termsWith(listing, deal), { markup_bps: input.markup_bps ?? null, fixed_price: input.fixed_price ?? null });
    const existing = await this.prisma.resaleListing.findUnique({ where: { storeId_listingId: { storeId: store.id, listingId: listing.id } } });
    if (existing && existing.status !== 'removed') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'already_in_store', 'This listing is already in the store.', 'listing_id');
    const relationship = await this.trade.relationshipFor(resellerId, listing.customerId);
    const row = existing
      ? await this.prisma.resaleListing.update({ where: { id: existing.id }, data: { ...setting, status: 'active', ruleId, notifiedState: null }, include: this.storeListingInclude })
      : await this.prisma.resaleListing.create({ data: { storeId: store.id, resellerId, listingId: listing.id, relationshipId: relationship.id, ...setting, ruleId }, include: this.storeListingInclude });
    if (relationship.created) await this.trade.tellSupplierAdded(relationship.id);
    const [item] = await this.presentMany([row]);
    return item;
  }

  /** `PATCH /v1/resale/listings/:id`: reprice, pause or put back on sale. */
  async update(resellerId: string, id: string, input: { markup_bps?: number | null; fixed_price?: number | null; status?: 'active' | 'paused' }, scope?: string) {
    await this.requireReseller(resellerId);
    const row = await this.own(resellerId, id, scope);
    if (row.status === 'removed') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'resale_listing_removed', 'This listing was removed from the store; add it again instead.');
    const data: Prisma.ResaleListingUpdateInput = {};
    if (input.markup_bps !== undefined || input.fixed_price !== undefined) {
      const listing = row.listing;
      if (listing.priceMinor === null) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'resale_listing_unavailable', 'This listing is no longer open to resellers.');
      const deal = this.dealFor((await this.trade.dealsFor(resellerId, [listing.customerId])).get(listing.customerId) ?? [], listing.id);
      Object.assign(data, this.checkPrice(listing.priceMinor, termsWith(listing, deal), { markup_bps: input.markup_bps ?? null, fixed_price: input.fixed_price ?? null }));
    }
    if (input.status) data.status = input.status;
    const updated = await this.prisma.resaleListing.update({ where: { id: row.id }, data: { ...data, notifiedState: null }, include: this.storeListingInclude });
    const [item] = await this.presentMany([updated]);
    return item;
  }

  /** `DELETE /v1/resale/listings/:id`: off the store; kept as removed so a rule never adds it back. */
  async remove(resellerId: string, id: string, scope?: string) {
    const row = await this.own(resellerId, id, scope);
    await this.prisma.resaleListing.update({ where: { id: row.id }, data: { status: 'removed' } });
    return { object: 'resale_listing' as const, id: row.id, deleted: true as const };
  }

  // ---- Notes ----

  /** A note in plain words: no links, phone numbers, email addresses or words BitoCard Shop refuses. */
  private async checkNote(value: string, country: string) {
    const note = value.replace(/\s+/g, ' ').trim();
    if (!note.length || note.length > maxNote) throw invalid('parameter_invalid', `A note has 1 to ${maxNote} characters.`, 'note');
    if (linkPattern.test(note) || /[\w.+-]+@[\w-]+\.\w+/.test(note) || /(\d[\s().-]*){7,}/.test(note) || /@\w{3,}/.test(note)) {
      throw invalid('note_refused', 'A note cannot contain links, phone numbers, email addresses or social handles.', 'note');
    }
    const text = ` ${note.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
    const words = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard', OR: [{ country: null }, { country }] } });
    if (words.some(word => text.includes(` ${word.phrase.replace(/[^\p{L}\p{N}-]+/gu, ' ')} `))) throw invalid('note_refused', 'This note uses words BitoCard Shop does not allow.', 'note');
    return note;
  }

  /** `PUT /v1/resale/listings/:id/note`: the note waits for the supplier's approval; any change asks again. */
  async setNote(resellerId: string, id: string, value: string, scope?: string) {
    const country = await this.requireReseller(resellerId);
    const row = await this.own(resellerId, id, scope);
    const note = await this.checkNote(value, country);
    if (row.note === note && row.noteStatus === 'pending') return this.get(resellerId, id, scope);
    const submittedAt = new Date();
    await this.prisma.resaleListing.update({ where: { id: row.id }, data: { note, noteStatus: 'pending', noteReason: null, noteSubmittedAt: submittedAt, noteDecidedAt: null } });
    await this.trade.tellSupplierNote(row.relationshipId, row.id, row.listing.title ?? 'your listing', submittedAt);
    return this.get(resellerId, id, scope);
  }

  async clearNote(resellerId: string, id: string, scope?: string) {
    const row = await this.own(resellerId, id, scope);
    await this.prisma.resaleListing.update({ where: { id: row.id }, data: { note: null, noteStatus: null, noteReason: null, noteSubmittedAt: null, noteDecidedAt: null } });
    return this.get(resellerId, id, scope);
  }

  // ---- Auto-listing rules ----

  private presentRule(rule: Prisma.ResaleRuleGetPayload<{ include: { category: { select: { slug: true; name: true } }; _count: { select: { listings: true } } } }>) {
    return {
      object: 'resale_rule' as const,
      id: rule.id,
      store_id: rule.storeId,
      category: rule.category ? { slug: rule.category.slug, name: rule.category.name } : null,
      markup_bps: rule.markupBps,
      excluded_supplier_ids: rule.excludedSupplierIds,
      active: rule.active,
      listings_added: rule._count.listings,
      last_run_at: rule.lastRunAt?.toISOString() ?? null,
      created_at: rule.createdAt.toISOString(),
    };
  }

  private readonly ruleInclude = { category: { select: { slug: true, name: true } }, _count: { select: { listings: true } } } as const;

  async rules(resellerId: string, scope?: string) {
    const rows = await this.prisma.resaleRule.findMany({ where: { resellerId, ...(scope ? { storeId: scope } : {}) }, include: this.ruleInclude, orderBy: { createdAt: 'asc' } });
    return { object: 'list' as const, data: rows.map(rule => this.presentRule(rule)) };
  }

  /** `POST /v1/resale/rules`: from now on, every matching resale listing is added to the store at this markup. */
  async createRule(resellerId: string, input: { store_id: string; category?: string | null; markup_bps: number; excluded_supplier_ids?: string[] }, scope?: string) {
    await this.requireReseller(resellerId);
    await this.requireStore(resellerId, input.store_id, scope);
    if ((await this.prisma.resaleRule.count({ where: { resellerId } })) >= maxRules) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'too_many_rules', `At most ${maxRules} rules.`);
    const category = input.category ? await this.prisma.classifiedCategory.findUnique({ where: { slug: input.category }, select: { id: true } }) : null;
    if (input.category && !category) throw invalid('parameter_invalid', 'No such category.', 'category');
    const rule = await this.prisma.resaleRule.create({ data: { resellerId, storeId: input.store_id, categoryId: category?.id ?? null, markupBps: input.markup_bps, excludedSupplierIds: [...new Set(input.excluded_supplier_ids ?? [])] } });
    await this.applyRule(rule.id);
    return this.presentRule(await this.prisma.resaleRule.findUniqueOrThrow({ where: { id: rule.id }, include: this.ruleInclude }));
  }

  async updateRule(resellerId: string, id: string, input: { markup_bps?: number; active?: boolean; excluded_supplier_ids?: string[] }, scope?: string) {
    const rule = await this.prisma.resaleRule.findFirst({ where: { id, resellerId, ...(scope ? { storeId: scope } : {}) } });
    if (!rule) throw notFound('rule');
    await this.prisma.resaleRule.update({
      where: { id },
      data: { ...(input.markup_bps !== undefined ? { markupBps: input.markup_bps } : {}), ...(input.active !== undefined ? { active: input.active } : {}), ...(input.excluded_supplier_ids ? { excludedSupplierIds: [...new Set(input.excluded_supplier_ids)] } : {}) },
    });
    if (input.active !== false) await this.applyRule(id);
    return this.presentRule(await this.prisma.resaleRule.findUniqueOrThrow({ where: { id }, include: this.ruleInclude }));
  }

  async deleteRule(resellerId: string, id: string, scope?: string) {
    const rule = await this.prisma.resaleRule.findFirst({ where: { id, resellerId, ...(scope ? { storeId: scope } : {}) } });
    if (!rule) throw notFound('rule');
    await this.prisma.resaleRule.delete({ where: { id } });
    return { object: 'resale_rule' as const, id, deleted: true as const };
  }

  /**
   * Adds the rule's matching listings not yet in the store (in any status: removed ones stay out) at its markup, held
   * to each listing's markup limit. Quietly skips everything when the reseller can no longer resell.
   */
  async applyRule(ruleId: string) {
    const rule = await this.prisma.resaleRule.findUnique({ where: { id: ruleId }, include: { store: { select: { template: true } } } });
    if (!rule || !rule.active || rule.store.template !== resaleTemplate) return 0;
    const { reason, country } = await this.gate(rule.resellerId);
    if (reason) return 0;
    const blocked = await this.trade.blockedSuppliers(rule.resellerId);
    const excluded = [...new Set([...blocked, ...rule.excludedSupplierIds])];
    const rows = await this.prisma.classifiedListing.findMany({
      where: {
        ...resaleWhere(country!),
        ...(excluded.length ? { customerId: { notIn: excluded } } : {}),
        ...(rule.categoryId ? { OR: [{ categoryId: rule.categoryId }, { category: { parentId: rule.categoryId } }] } : {}),
        resaleListings: { none: { storeId: rule.storeId } },
      },
      select: { id: true, resaleMarkupMaxBps: true },
      orderBy: { publishedAt: 'asc' },
      take: ruleBatch,
    });
    let added = 0;
    for (const listing of rows) {
      try {
        await this.add(rule.resellerId, { store_id: rule.storeId, listing_id: listing.id, markup_bps: Math.min(rule.markupBps, listing.resaleMarkupMaxBps ?? 0) }, undefined, rule.id);
        added += 1;
      } catch (error) {
        // Another run added it first, or the listing changed meanwhile: the next run tries again.
        this.logger.debug(`Rule ${rule.id} skipped listing ${listing.id}: ${(error as Error).message}`);
      }
    }
    await this.prisma.resaleRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
    return added;
  }

  // ---- The job ----

  /**
   * Every 15 minutes (the `classifieds` job): ends deals past their time, applies auto-listing rules to listings opened
   * since, and tells resellers once when a store listing stops selling (sold out, paused or stopped by the supplier,
   * gone, or its price outside the limits after a price or deal change).
   */
  async job() {
    const deals = await this.trade.endExpired();
    let added = 0;
    for (const rule of await this.prisma.resaleRule.findMany({ where: { active: true }, select: { id: true }, orderBy: { lastRunAt: { sort: 'asc', nulls: 'first' } }, take: 50 })) {
      added += await this.applyRule(rule.id);
    }
    let told = 0;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.resaleListing.findMany({ where: { status: 'active' }, include: this.storeListingInclude, orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!rows.length) break;
      cursor = rows.at(-1)!.id;
      for (const item of await this.evaluate(rows)) {
        if (item.row.notifiedState === item.state) continue;
        await this.prisma.resaleListing.updateMany({ where: { id: item.row.id, notifiedState: item.row.notifiedState }, data: { notifiedState: item.state } });
        // Selling again needs no notice, and a listing new to the store starts from what it is.
        if (item.state === 'selling' || item.row.notifiedState === null) continue;
        told += 1;
        await this.inbox.reseller(item.row.resellerId, 'resale.listing_unavailable', {
          subject: `${item.row.id}:${item.state}:${Date.now()}`,
          title: `${item.row.listing.title ?? 'A listing'} stopped selling`,
          body: stateText[item.state] ?? 'It is not on sale on your store now.',
          link: `/resale/listings/${item.row.id}`,
        });
        this.emails.reseller(item.row.resellerId, { title: `${item.row.listing.title ?? 'A listing'} stopped selling`, body: stateText[item.state] ?? 'It is not on sale on your store now.', path: `/resale/listings/${item.row.id}` });
      }
      if (rows.length < 200) break;
    }
    return { deals_ended: deals, added_by_rules: added, told };
  }

}


const stateText: Partial<Record<ResaleState, string>> = {
  supplier_stopped: 'The supplier stopped you reselling their listings.',
  unavailable: 'The supplier’s listing is no longer open to resellers.',
  supplier_paused: 'The supplier paused reselling it.',
  sold_out: 'It sold out.',
  price_out_of_range: 'The supplier’s price or your deal changed, so your price is outside the limits. Reprice it to sell it again.',
};
