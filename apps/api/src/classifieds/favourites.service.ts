import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { ListingsService } from './listings.service.js';
import { invalid } from './rules.js';
import { ListingSearchService, soldVisibleMs } from './search.service.js';

/** A buyer keeps at most this many saved listings. */
export const maxFavourites = 500;

/**
 * A buyer's saved listings in BitoCard Shop: each shows whether it is still live, sold (for 30 days) or gone, and a
 * price drop since it was saved.
 */
@Injectable()
export class FavouritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly search: ListingSearchService,
  ) {}

  async list(customer: CustomerWithStore, page: { limit?: number; offset?: number }) {
    await this.listings.sellerCountry(customer);
    const limit = page.limit ?? 50;
    const offset = page.offset ?? 0;
    const [rows, total] = await Promise.all([
      this.prisma.classifiedFavourite.findMany({
        where: { customerId: customer.id },
        include: { listing: { select: { id: true, status: true, soldAt: true, priceMinor: true } } },
        orderBy: [{ createdAt: 'desc' }, { listingId: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.classifiedFavourite.count({ where: { customerId: customer.id } }),
    ]);
    const live = (row: (typeof rows)[number]) => row.listing.status === 'active' || (row.listing.status === 'sold' && row.listing.soldAt !== null && Date.now() - row.listing.soldAt.getTime() <= soldVisibleMs);
    const cards = await this.search.cards(rows.filter(live).map(row => row.listingId));
    return {
      object: 'list' as const,
      data: rows.map(row => {
        const state = !live(row) ? 'gone' : row.listing.status === 'sold' ? 'sold' : 'live';
        const drop = state === 'live' && row.savedPriceMinor !== null && row.listing.priceMinor !== null && row.listing.priceMinor < row.savedPriceMinor;
        return {
          object: 'classified_favourite' as const,
          listing_id: row.listingId,
          state,
          saved_at: row.createdAt.toISOString(),
          saved_price: row.savedPriceMinor === null ? null : Number(row.savedPriceMinor),
          price_drop: drop ? Number(row.savedPriceMinor! - row.listing.priceMinor!) : null,
          listing: state === 'gone' ? null : (cards.get(row.listingId) ?? null),
        };
      }),
      total,
    };
  }

  /** Saves a live listing (saving it again changes nothing). */
  async add(customer: CustomerWithStore, listingId: string) {
    const country = await this.listings.sellerCountry(customer);
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId } });
    if (!listing || listing.status !== 'active' || listing.country !== country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');
    if (listing.customerId === customer.id) throw invalid('parameter_invalid', 'You cannot save your own listing.', 'listing_id');
    if ((await this.prisma.classifiedFavourite.count({ where: { customerId: customer.id } })) >= maxFavourites) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'too_many_favourites', `You can save up to ${maxFavourites} listings. Remove some first.`);
    }
    await this.prisma.classifiedFavourite.upsert({
      where: { customerId_listingId: { customerId: customer.id, listingId } },
      create: { customerId: customer.id, listingId, savedPriceMinor: listing.priceMinor },
      update: {},
    });
    return { object: 'classified_favourite' as const, listing_id: listingId, saved: true };
  }

  async remove(customer: CustomerWithStore, listingId: string) {
    await this.listings.sellerCountry(customer);
    await this.prisma.classifiedFavourite.deleteMany({ where: { customerId: customer.id, listingId } });
  }
}
