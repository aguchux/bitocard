import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PostingJourneysService } from '../../postings/journeys.service.js';
import { isOnShop } from '../rules.js';

/** One view per visitor and listing in this window (per server instance). */
const windowMs = 30 * 60_000;
const rememberAtMost = 50_000;
const robots = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|monitor/i;

/**
 * Counts a listing's page views (udozo.com tells the API as the page opens): the listing's total (`views`, shown to its
 * seller) and the day's count (`classified_listing_view_days`, which trending ranks by). Robots and the listing's own
 * seller are not counted, and a visitor counts once per listing in half an hour. Nothing is kept about the visitor:
 * only a hash of their address, browser and the listing, in memory, for that half hour.
 */
@Injectable()
export class ListingViewsService {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly postings: PostingJourneysService,
  ) {}

  async record(ref: number, visitor: { address: string; userAgent: string; customerId: string | null }, now = Date.now()) {
    if (!visitor.userAgent || robots.test(visitor.userAgent)) return false;
    const key = createHash('sha256').update(`${visitor.address}|${visitor.userAgent}|${ref}`).digest('base64url');
    const last = this.seen.get(key);
    if (last && now - last < windowMs) return false;
    const listing = await this.prisma.classifiedListing.findUnique({ where: { ref: BigInt(ref) }, select: { id: true, customerId: true, status: true, onShop: true, views: true } });
    if (!listing || !isOnShop(listing) || listing.customerId === visitor.customerId) return false;
    if (this.seen.size >= rememberAtMost) this.seen.clear();
    this.seen.set(key, now);
    const day = new Date(new Date(now).toISOString().slice(0, 10));
    await this.prisma.$transaction([
      this.prisma.classifiedListingViewDay.upsert({ where: { listingId_day: { listingId: listing.id, day } }, create: { listingId: listing.id, day, views: 1 }, update: { views: { increment: 1 } } }),
      // Raw, so a view never touches the listing's updated time.
      this.prisma.$executeRaw`UPDATE "classified_listings" SET "views" = "views" + 1 WHERE "id" = ${listing.id}::uuid`,
    ]);
    // Its first view, for the seller's posting journey (only ever the first, so it costs nothing after).
    if (listing.views === 0) this.postings.firstView(listing.id);
    return true;
  }
}
