import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Product, ProductCategory } from '../generated/prisma/client.js';
import { minor } from '../ledger/mode.js';
import { type PricingContext, PricingService, type ProductWithOffers, worldwideCategories } from './pricing.service.js';

/** At most this many denominations are priced in a catalogue listing; quotes price any valid value. */
const maxListedValues = 20;

export const offersInclude = { supplierProducts: { where: { available: true }, include: { supplier: true } } } as const;

export function presentProductBase(product: Product) {
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
    logo_url: product.logoUrl,
  };
}

/** The catalogue as one reseller sees it: products they can sell, with their wholesale cost and their price. */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  private async present(ctx: PricingContext, product: ProductWithOffers) {
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
      ...presentProductBase(product),
      pricing: {
        currency: ctx.currency,
        /** Prices per denomination, before any tax added at checkout. Quotes lock the exact price. */
        denominations,
      },
    };
  }

  async list(resellerId: string, mode: LedgerMode, filter: { category?: ProductCategory; country?: string; q?: string; limit?: number; starting_after?: string }) {
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
        ],
      },
      include: offersInclude,
      orderBy: { key: 'asc' },
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const data = [];
    for (const product of products.slice(0, limit)) {
      const presented = await this.present(ctx, product);
      if (presented) data.push(presented);
    }
    return { object: 'list' as const, data, has_more: products.length > limit, next_cursor: products.length > limit ? products[limit - 1].id : null };
  }

  async get(resellerId: string, mode: LedgerMode, id: string) {
    const ctx = await this.pricing.context(resellerId, mode);
    const product = await this.prisma.product.findUnique({ where: { id }, include: offersInclude });
    const missing = new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such product.');
    if (!product) throw missing;
    const reason = this.pricing.unavailableReason(ctx, product);
    if (reason) throw reason;
    const presented = await this.present(ctx, product);
    if (!presented) throw missing;
    return presented;
  }
}
