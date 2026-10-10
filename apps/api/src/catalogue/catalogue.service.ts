import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Product, ProductCategory } from '../generated/prisma/client.js';
import { minor } from '../ledger/mode.js';
import { StorefrontService } from '../storefront/storefront.service.js';
import { type PricingContext, PricingService, type ProductWithOffers, worldwideCategories } from './pricing.service.js';

/** At most this many denominations are priced in a catalogue listing; quotes price any valid value. */
const maxListedValues = 20;

export const offersInclude = { supplierProducts: { where: { available: true }, include: { supplier: true } } } as const;

/** `logoUrl` must come from BitoCard's own files (`StorefrontService.productArt`), never the supplier's catalogue. */
export function presentProductBase(product: Product, logoUrl: string | null) {
  return {
    object: 'product' as const,
    id: product.id,
    category: product.category,
    country: product.country,
    brand: product.brand,
    name: product.name,
    face_currency: product.faceCurrency,
    denomination:
      product.denominationType === 'fixed'
        ? { type: 'fixed' as const, values: product.fixedValues.map(minor) }
        : { type: 'range' as const, min: minor(product.minValueMinor ?? 0n), max: minor(product.maxValueMinor ?? 0n) },
    /** What the customer must give when buying: phone, smartcard, meter, or none. */
    recipient_type: product.recipientType,
    description: product.description,
    redeem_instructions: product.redeemInstructions,
    logo_url: logoUrl,
    /** What it can do, for example `sms_in` or `app_codes` on a virtual number (see the docs for the list). */
    features: product.features,
  };
}

/** The catalogue as one reseller sees it: products they can sell, with their wholesale cost and their price. */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly storefront: StorefrontService,
  ) {}

  private async present(ctx: PricingContext, product: ProductWithOffers, listed: boolean, art: { image: string | null; logo: string | null } | undefined) {
    const values = product.denominationType === 'fixed' ? product.fixedValues.slice(0, maxListedValues) : [product.minValueMinor ?? 0n, product.maxValueMinor ?? 0n];
    const denominations = [];
    for (const value of values) {
      if (value <= 0n) continue;
      try {
        const priced = await this.pricing.choose(ctx, product, value);
        denominations.push({ face_value: minor(value), wholesale: minor(priced.wholesale), price: minor(priced.price) });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'product_unavailable') continue;
        throw error;
      }
    }
    if (denominations.length === 0) return null;
    return {
      ...presentProductBase(product, art?.logo ?? null),
      /** A picture for the product: its own image, else its brand's gift card design. */
      image_url: art?.image ?? null,
      /** Listed on your BitoCard-hosted store. Your own systems can sell any product here, listed or not. */
      listed,
      pricing: {
        currency: ctx.currency,
        /** Prices per denomination, before any tax added at checkout. Quotes lock the exact price. */
        denominations,
      },
    };
  }

  async list(resellerId: string, mode: LedgerMode, filter: { category?: ProductCategory; country?: string; q?: string; listed?: boolean; limit?: number; starting_after?: string }) {
    const ctx = await this.pricing.context(resellerId, mode);
    const limit = filter.limit ?? 25;
    const categories = ctx.country.categories.filter(c => c.enabled).map(c => c.category);
    const products = await this.prisma.product.findMany({
      where: {
        active: true,
        category: filter.category ? { in: categories.includes(filter.category) ? [filter.category] : [] } : { in: categories },
        country: filter.country?.toUpperCase(),
        ...(ctx.international ? {} : { OR: [{ country: ctx.country.code }, { category: { in: [...worldwideCategories] } }] }),
        AND: [
          // BitoCard's offers, or the reseller's own.
          { OR: [{ supplierProducts: { some: { available: true } } }, { id: { in: [...ctx.own.keys()] } }] },
          ...(filter.q ? [{ OR: [{ name: { contains: filter.q, mode: 'insensitive' as const } }, { brand: { contains: filter.q.toLowerCase() } }] }] : []),
          ...(filter.listed === undefined ? [] : [{ listings: filter.listed ? { some: { resellerId } } : { none: { resellerId } } }]),
        ],
      },
      include: offersInclude,
      orderBy: { key: 'asc' },
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const page = products.slice(0, limit);
    const listings = new Set(
      (await this.prisma.resellerListing.findMany({ where: { resellerId, productId: { in: page.map(product => product.id) } }, select: { productId: true } })).map(row => row.productId),
    );
    const art = await this.storefront.productArt(page);
    const data = [];
    for (const product of page) {
      const presented = await this.present(ctx, product, listings.has(product.id), art.get(product.id));
      if (presented) data.push(presented);
    }
    return { object: 'list' as const, data, has_more: products.length > limit, next_cursor: products.length > limit ? products[limit - 1].id : null };
  }

  /** What one sale earns the reseller, with their settings or ones they are trying. */
  async preview(resellerId: string, mode: LedgerMode, id: string, query: { face_value?: number; markup_bps?: number; customer_discount_bps?: number; fixed_price?: number }) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: offersInclude });
    if (!product) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such product.');
    return this.pricing.preview(resellerId, mode, product, query.face_value === undefined ? null : BigInt(query.face_value), query);
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    const ctx = await this.pricing.context(resellerId, mode);
    const product = await this.prisma.product.findUnique({ where: { id }, include: offersInclude });
    const missing = new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such product.');
    if (!product) throw missing;
    const reason = this.pricing.unavailableReason(ctx, product);
    if (reason) throw reason;
    const listed = await this.prisma.resellerListing.findUnique({ where: { resellerId_productId: { resellerId, productId: id } } });
    const art = await this.storefront.productArt([product]);
    const presented = await this.present(ctx, product, Boolean(listed), art.get(product.id));
    if (!presented) throw missing;
    return presented;
  }

  /**
   * Lists or unlists products on the reseller's BitoCard-hosted store. Only products they can sell can be listed
   * (`product_unavailable` names the first that cannot); unlisting always works. Their API catalogue is not affected.
   */
  async setListing(resellerId: string, mode: LedgerMode, productIds: string[], listed: boolean) {
    const ids = [...new Set(productIds)];
    if (!listed) {
      const removed = await this.prisma.resellerListing.deleteMany({ where: { resellerId, productId: { in: ids } } });
      return { object: 'listing_update' as const, listed, product_ids: ids, updated: removed.count };
    }
    const ctx = await this.pricing.context(resellerId, mode);
    const products = await this.prisma.product.findMany({ where: { id: { in: ids } } });
    for (const id of ids) {
      const product = products.find(row => row.id === id);
      const reason = product ? this.pricing.unavailableReason(ctx, product) : null;
      if (!product || reason) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'product_unavailable', `Product ${id} is not available to you, so it cannot be listed.`, 'product_ids');
      }
    }
    // Discount products that would leave them no discount cannot be listed until BitoCard sets a share.
    const [problem] = await this.pricing.resellerShareProblems(await this.prisma.product.findMany({ where: { id: { in: ids } }, include: offersInclude }), ctx.country.code);
    if (problem) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'reseller_discount_missing', `${problem.name} cannot be listed yet: BitoCard has not set your discount on it. Contact BitoCard support.`, 'product_ids');
    }
    const added = await this.prisma.resellerListing.createMany({ data: ids.map(productId => ({ resellerId, productId })), skipDuplicates: true });
    return { object: 'listing_update' as const, listed, product_ids: ids, updated: added.count };
  }
}
