import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ListingsService } from './listings.service.js';

/** Response rates are shown once a seller has had this many chats in 90 days. */
export const minChatsForRate = 5;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');

/**
 * Buyers getting in touch, each counted once as a lead (a chat, or by phone: a call back asked for, or the seller's
 * contact details shared); the seller's figures per listing; and sellers' response rates.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  /** A seller's figures for one of their listings. */
  async stats(customer: CustomerWithStore, listingId: string) {
    await this.listings.sellerCountry(customer);
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: listingId } });
    if (!listing || listing.customerId !== customer.id || listing.status === 'deleted') throw notFound();
    const [phone, chats, offers] = await Promise.all([
      this.prisma.classifiedLead.count({ where: { listingId, kind: 'phone' } }),
      this.prisma.classifiedConversation.count({ where: { listingId } }),
      this.prisma.classifiedOffer.count({ where: { listingId } }),
    ]);
    return { object: 'classified_listing_stats' as const, listing_id: listingId, views: listing.views, leads: listing.leads, phone_reveals: phone, chats, offers };
  }

  /** The share of chats a seller answered in the last 90 days (chats less than a day old not counted yet), or null. */
  async responseRate(sellerId: string) {
    const now = Date.now();
    const where = { sellerId, createdAt: { gt: new Date(now - 90 * 86_400_000), lt: new Date(now - 86_400_000) } };
    const [total, replied] = await Promise.all([this.prisma.classifiedConversation.count({ where }), this.prisma.classifiedConversation.count({ where: { ...where, sellerRepliedAt: { not: null } } })]);
    return total >= minChatsForRate ? Math.round((replied / total) * 100) : null;
  }
}

/**
 * Records a buyer's interest in a listing once per kind; the listing's `leads` counts each buyer once, whichever way
 * they got in touch first. Returns whether this kind was new.
 */
export async function addLead(tx: Prisma.TransactionClient, listingId: string, buyerId: string, kind: 'phone' | 'chat') {
  const before = await tx.classifiedLead.count({ where: { listingId, buyerId } });
  const created = await tx.classifiedLead.createMany({ data: [{ listingId, buyerId, kind }], skipDuplicates: true });
  if (created.count && before === 0) await tx.classifiedListing.update({ where: { id: listingId }, data: { leads: { increment: 1 } } });
  return created.count > 0;
}
