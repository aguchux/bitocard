import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { ownerBy, type PosBy } from './actor.js';
import { posCountedStatuses } from './catalogue-rules.js';

/** The highest price a shop may set, in minor units (as listings take). */
export const maxShopPrice = 100_000_000_000;

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `There is no such ${what} on your Udozo POS account.`);

/**
 * Prices per shop (docs/UDOZO_POS_PLAN.md, milestone 9): a shop may sell a product at its own price, which its tills
 * charge (and its offline copy keeps); everywhere else, udozo.com included, the listing's price stands. Setting one needs
 * `prices` for staff; removing it (`price: null`) goes back to the listing's price.
 */
@Injectable()
export class PosShopPricesService {
  constructor(private readonly prisma: PrismaService) {}

  async set(customer: CustomerWithStore, listingId: string, input: { shop_id: string; price: number | null }, by: PosBy = ownerBy(customer)) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, select: { id: true, currency: true } });
    if (!account) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
    const shop = await this.prisma.posShop.findFirst({ where: { id: input.shop_id, accountId: account.id, closedAt: null }, select: { id: true, name: true } });
    if (!shop) throw notFound('shop');
    const listing = await this.prisma.classifiedListing.findFirst({ where: { id: listingId, customerId: customer.id, posEnabledAt: { not: null }, status: { in: posCountedStatuses } }, select: { id: true, priceMinor: true, currency: true } });
    if (!listing) throw notFound('product');
    if (input.price === null) {
      await this.prisma.posShopPrice.deleteMany({ where: { listingId, shopId: shop.id } });
    } else {
      if (!Number.isSafeInteger(input.price) || input.price < 1 || input.price > maxShopPrice) throw invalid('parameter_invalid', 'Give the price in minor units, from 1.', 'price');
      if (listing.currency !== account.currency) throw invalid('product_unavailable', `This product is priced in ${listing.currency}, not your shop's ${account.currency}.`, 'price');
      const data = { priceMinor: BigInt(input.price), byName: by.name.slice(0, 120), updatedAt: new Date() };
      await this.prisma.posShopPrice.upsert({ where: { listingId_shopId: { listingId, shopId: shop.id } }, create: { listingId, shopId: shop.id, ...data }, update: data });
    }
    return this.list(customer, listingId);
  }

  /** A product's price in each shop: its own, or the listing's. */
  async list(customer: CustomerWithStore, listingId: string) {
    const account = await this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, select: { id: true } });
    if (!account) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'pos_account_missing', 'You have not signed up for Udozo POS yet.');
    const listing = await this.prisma.classifiedListing.findFirst({ where: { id: listingId, customerId: customer.id }, select: { id: true, title: true, priceMinor: true, currency: true } });
    if (!listing) throw notFound('product');
    const [shops, prices] = await Promise.all([
      this.prisma.posShop.findMany({ where: { accountId: account.id, closedAt: null }, select: { id: true, name: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.posShopPrice.findMany({ where: { listingId } }),
    ]);
    const own = new Map(prices.map(row => [row.shopId, row]));
    return {
      object: 'pos_shop_prices' as const,
      listing_id: listing.id,
      title: listing.title,
      currency: listing.currency,
      /** The listing's price: udozo.com's, and every shop's without its own. */
      udozo_price: listing.priceMinor === null ? null : Number(listing.priceMinor),
      shops: shops.map(shop => {
        const row = own.get(shop.id);
        return { shop_id: shop.id, name: shop.name, own: Boolean(row), price: row ? Number(row.priceMinor) : listing.priceMinor === null ? null : Number(listing.priceMinor), by: row?.byName ?? null, updated_at: row ? row.updatedAt.toISOString() : null };
      }),
    };
  }
}
