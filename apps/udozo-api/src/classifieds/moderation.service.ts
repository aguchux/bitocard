import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { ShopEmails } from './shop-emails.service.js';
import { invalid } from './rules.js';

/** Why a listing was sent to a moderator. */
export const reviewFlags = ['first_listings', 'prohibited_words', 'price_low', 'photo_reused', 'posting_fast', 'reported'] as const;
export type ReviewFlag = (typeof reviewFlags)[number];
export const reportReasons = ['scam', 'prohibited', 'wrong_category', 'duplicate', 'sold', 'offensive', 'other'] as const;
export type ReportReason = (typeof reportReasons)[number];

/** A price below this share of the category's usual (median) price looks like bait. */
export const lowPriceShare = 0.3;
/** The usual price is only trusted with at least this many live listings to compare. */
export const minComparable = 8;
/** Listings submitted faster than this by one seller go to review. */
export const fastPosting = { count: 5, windowMs: 10 * 60_000 };
/** Open reports from this many different customers send a live listing back to review. */
export const reportsToReview = 3;

const notFound = (what = 'listing') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

type Checked = { id: string; customerId: string; country: string; categoryId: string | null; title: string | null; description: string | null; priceMinor: bigint | null };

/**
 * BitoCard Shop's trust and safety: the automatic checks every submitted or edited listing goes through (refused
 * words, a price far below the category's usual, a photo another seller used, posting too fast), customers' reports
 * (three send a listing back to review), sellers' suspension, and the moderators' decisions. Every decision is audited.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    private readonly emails: ShopEmails,
  ) {}

  /** `classifieds_suspended` for a suspended seller. */
  async requireNotSuspended(customerId: string) {
    const seller = await this.prisma.classifiedSeller.findUnique({ where: { customerId } });
    if (seller?.suspendedAt) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'classifieds_suspended', 'Your Udozo account is suspended. Contact support if you think this is a mistake.');
  }

  /**
   * The checks on a listing as it is now: refused words throw `listing_prohibited`; anything doubtful comes back as
   * flags, which send the listing to a moderator.
   */
  async check(listing: Checked): Promise<ReviewFlag[]> {
    const flags: ReviewFlag[] = [];
    const values = await this.prisma.classifiedListingFeature.findMany({ where: { listingId: listing.id, valueText: { not: null } }, select: { valueText: true } });
    const text = ` ${[listing.title, listing.description, ...values.map(value => value.valueText)].filter(Boolean).join(' ').toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
    const words = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard', OR: [{ country: null }, { country: listing.country }] } });
    const found = words.filter(word => text.includes(` ${word.phrase.replace(/[^\p{L}\p{N}-]+/gu, ' ')} `));
    if (found.some(word => word.action === 'block')) {
      throw invalid('listing_prohibited', 'This listing mentions something that cannot be sold on Udozo. See the prohibited items in the marketplace terms.', 'title');
    }
    if (found.length) flags.push('prohibited_words');

    if (listing.priceMinor !== null && listing.categoryId) {
      const [usual] = await this.prisma.$queryRaw<{ median: number | null; count: bigint }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "price_minor")::float8 AS median, count(*) AS count
        FROM "classified_listings" WHERE "category_id" = ${listing.categoryId}::uuid AND "country" = ${listing.country} AND "status" = 'active' AND "price_minor" IS NOT NULL AND "id" <> ${listing.id}::uuid`;
      if (usual && Number(usual.count) >= minComparable && usual.median !== null && Number(listing.priceMinor) < usual.median * lowPriceShare) flags.push('price_low');
    }

    const reused = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "classified_media" mine
      JOIN "classified_media" theirs ON theirs."content_hash" = mine."content_hash" AND theirs."listing_id" <> mine."listing_id"
      JOIN "classified_listings" other ON other."id" = theirs."listing_id" AND other."customer_id" <> ${listing.customerId}::uuid AND other."status" <> 'draft'
      WHERE mine."listing_id" = ${listing.id}::uuid AND mine."content_hash" IS NOT NULL`;
    if (Number(reused[0]?.n ?? 0) > 0) flags.push('photo_reused');

    const recent = await this.prisma.classifiedListing.count({ where: { customerId: listing.customerId, id: { not: listing.id }, submittedAt: { gte: new Date(Date.now() - fastPosting.windowMs) } } });
    if (recent >= fastPosting.count) flags.push('posting_fast');
    return flags;
  }

  /** A customer reports a listing; enough different reporters send it back to review. */
  async report(customer: CustomerWithStore, input: { listing_id: string; reason: ReportReason; details?: string }) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id: input.listing_id } });
    if (!listing || !['active', 'sold', 'pending_review'].includes(listing.status) || listing.country !== customer.country) throw notFound();
    if (listing.customerId === customer.id) throw invalid('parameter_invalid', 'You cannot report your own listing.', 'listing_id');
    let report;
    try {
      report = await this.prisma.classifiedReport.create({ data: { listingId: listing.id, reporterId: customer.id, reason: input.reason, details: input.details?.trim() || null } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('already_reported', 'You have already reported this listing. A moderator will look at it.');
      throw error;
    }
    const reporters = await this.prisma.classifiedReport.count({ where: { listingId: listing.id, status: 'open' } });
    if (reporters >= reportsToReview && listing.status === 'active') {
      await this.prisma.classifiedListing.updateMany({ where: { id: listing.id, status: 'active' }, data: { status: 'pending_review', reviewReason: 'reported', reviewFlags: { push: 'reported' } } });
    }
    return { object: 'classified_report' as const, id: report.id, status: report.status, reason: report.reason, created_at: report.createdAt.toISOString() };
  }

  // ---- Moderators ----

  private async listingFor(id: string) {
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id }, include: { customer: { select: { id: true, storeId: true } } } });
    if (!listing) throw notFound();
    return listing;
  }

  private notify(listing: { id: string; title: string | null; customer: { id: string; storeId: string } }, type: 'customer.classifieds.listing_live' | 'customer.classifieds.listing_rejected' | 'customer.classifieds.listing_removed', title: string, body: string) {
    this.emails.customer(listing.customer.id, { title, body, path: '/account/listings', action: 'Open My listings' });
    return this.inbox.customer({ customerId: listing.customer.id, storeId: listing.customer.storeId }, type, { subject: `${listing.id}:${Date.now()}`, title, body, link: '/account/listings' });
  }

  /** A listing waiting for review goes live. */
  async approve(actorId: string | null, id: string, note?: string) {
    const listing = await this.listingFor(id);
    if (listing.status !== 'pending_review') throw conflict('listing_not_in_review', 'This listing is not waiting for review.');
    const settings = await this.prisma.classifiedMarketSettings.findUnique({ where: { country: listing.country } });
    const now = new Date();
    const claimed = await this.prisma.classifiedListing.updateMany({
      where: { id, status: 'pending_review' },
      data: { status: 'active', reviewReason: null, reviewFlags: [], publishedAt: listing.publishedAt ?? now, expiresAt: listing.expiresAt && listing.expiresAt > now ? listing.expiresAt : new Date(now.getTime() + (settings?.listingDays ?? 30) * 86_400_000) },
    });
    if (!claimed.count) throw conflict('listing_not_in_review', 'This listing is not waiting for review.');
    await this.prisma.classifiedReport.updateMany({ where: { listingId: id, status: 'open' }, data: { status: 'dismissed', decidedById: actorId, decidedAt: now, note: note ?? 'Listing approved' } });
    await this.audit.record({ actorId, action: 'classifieds.listing_approved', targetType: 'classified_listing', targetId: id, before: { status: 'pending_review', flags: listing.reviewFlags }, after: { status: 'active', note: note ?? null } });
    await this.notify(listing, 'customer.classifieds.listing_live', 'Your ad is live', `"${listing.title}" is now on Udozo.`);
  }

  /** A listing waiting for review is sent back: the seller fixes it and submits again. */
  async reject(actorId: string | null, id: string, reason: string) {
    const listing = await this.listingFor(id);
    if (listing.status !== 'pending_review') throw conflict('listing_not_in_review', 'This listing is not waiting for review.');
    const claimed = await this.prisma.classifiedListing.updateMany({ where: { id, status: 'pending_review' }, data: { status: 'rejected', reviewReason: reason } });
    if (!claimed.count) throw conflict('listing_not_in_review', 'This listing is not waiting for review.');
    await this.audit.record({ actorId, action: 'classifieds.listing_rejected', targetType: 'classified_listing', targetId: id, before: { status: 'pending_review', flags: listing.reviewFlags }, after: { status: 'rejected', reason } });
    await this.notify(listing, 'customer.classifieds.listing_rejected', 'Your ad needs changes', `"${listing.title}": ${reason}`);
  }

  /** A listing is taken off BitoCard Shop for good (banned goods, a scam), live or not. */
  async remove(actorId: string | null, id: string, reason: string) {
    const listing = await this.listingFor(id);
    if (['removed', 'deleted'].includes(listing.status)) throw conflict('listing_closed', 'This listing is already off Udozo.');
    const now = new Date();
    const claimed = await this.prisma.classifiedListing.updateMany({ where: { id, status: listing.status }, data: { status: 'removed', reviewReason: reason, closedAt: now } });
    if (!claimed.count) throw conflict('listing_closed', 'This listing changed: refresh and try again.');
    await this.prisma.classifiedPriceHistory.updateMany({ where: { listingId: id, to: null }, data: { to: now } });
    await this.prisma.classifiedReport.updateMany({ where: { listingId: id, status: 'open' }, data: { status: 'actioned', decidedById: actorId, decidedAt: now, note: reason } });
    await this.audit.record({ actorId, action: 'classifieds.listing_removed', targetType: 'classified_listing', targetId: id, before: { status: listing.status }, after: { status: 'removed', reason } });
    if (listing.status !== 'draft') await this.notify(listing, 'customer.classifieds.listing_removed', 'Your ad was removed', `"${listing.title}" was removed from Udozo: ${reason}`);
  }

  /** A report decided without removing anything (nothing wrong), or by removing the listing. */
  async resolveReport(actorId: string | null, id: string, input: { action: 'dismiss' | 'remove_listing'; note: string }) {
    const report = await this.prisma.classifiedReport.findUnique({ where: { id } });
    if (!report) throw notFound('report');
    if (report.status !== 'open') throw conflict('report_decided', 'This report was already decided.');
    if (input.action === 'remove_listing') {
      if (!report.listingId) throw invalid('parameter_invalid', 'This report is not about a listing.', 'action');
      await this.remove(actorId, report.listingId, input.note);
    }
    await this.prisma.classifiedReport.updateMany({ where: { id, status: 'open' }, data: { status: input.action === 'dismiss' ? 'dismissed' : 'actioned', decidedById: actorId, decidedAt: new Date(), note: input.note } });
    await this.audit.record({ actorId, action: `classifieds.report_${input.action === 'dismiss' ? 'dismissed' : 'actioned'}`, targetType: 'classified_report', targetId: id, before: { status: 'open' }, after: { note: input.note } });
    return this.presentReport(await this.prisma.classifiedReport.findUniqueOrThrow({ where: { id } }));
  }

  /** A seller is suspended: they cannot post, and their live and waiting listings leave the market. */
  async suspend(actorId: string | null, customerId: string, reason: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw notFound('customer');
    const now = new Date();
    await this.prisma.classifiedSeller.upsert({ where: { customerId }, create: { customerId, suspendedAt: now, suspendedReason: reason, suspendedById: actorId }, update: { suspendedAt: now, suspendedReason: reason, suspendedById: actorId } });
    const removed = await this.prisma.classifiedListing.updateMany({ where: { customerId, status: { in: ['active', 'pending_review'] } }, data: { status: 'removed', reviewReason: 'seller_suspended', closedAt: now } });
    await this.audit.record({ actorId, action: 'classifieds.seller_suspended', targetType: 'customer', targetId: customerId, before: null, after: { reason, listings_removed: removed.count } });
    return { object: 'classified_seller' as const, customer_id: customerId, suspended: true, suspended_reason: reason, listings_removed: removed.count };
  }

  async unsuspend(actorId: string | null, customerId: string, reason: string) {
    const seller = await this.prisma.classifiedSeller.findUnique({ where: { customerId } });
    if (!seller?.suspendedAt) throw conflict('not_suspended', 'This seller is not suspended.');
    await this.prisma.classifiedSeller.update({ where: { customerId }, data: { suspendedAt: null, suspendedReason: null, suspendedById: null } });
    await this.audit.record({ actorId, action: 'classifieds.seller_unsuspended', targetType: 'customer', targetId: customerId, before: { reason: seller.suspendedReason }, after: { reason } });
    return { object: 'classified_seller' as const, customer_id: customerId, suspended: false, suspended_reason: null, listings_removed: 0 };
  }

  async reports(filter: { status?: string; limit?: number; offset?: number }) {
    const rows = await this.prisma.classifiedReport.findMany({
      where: { status: filter.status ?? 'open' },
      include: { listing: { select: { id: true, ref: true, title: true, status: true, country: true } }, reporter: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    });
    return { object: 'list' as const, data: rows.map(row => ({ ...this.presentReport(row), listing: row.listing ? { id: row.listing.id, ref: Number(row.listing.ref), title: row.listing.title, status: row.listing.status, country: row.listing.country } : null, reporter: row.reporter })) };
  }

  presentReport(report: { id: string; listingId: string | null; reportedCustomerId: string | null; conversationId: string | null; reason: string; details: string | null; status: string; note: string | null; decidedAt: Date | null; createdAt: Date }) {
    return {
      object: 'classified_report' as const,
      id: report.id,
      listing_id: report.listingId,
      reported_customer_id: report.reportedCustomerId,
      conversation_id: report.conversationId,
      reason: report.reason,
      details: report.details,
      status: report.status,
      note: report.note,
      decided_at: report.decidedAt?.toISOString() ?? null,
      created_at: report.createdAt.toISOString(),
    };
  }

  // ---- Refused words ----

  async words(country?: string) {
    const rows = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard', ...(country ? { OR: [{ country: null }, { country }] } : {}) }, orderBy: [{ action: 'asc' }, { phrase: 'asc' }] });
    return { object: 'list' as const, data: rows.map(row => ({ object: 'classified_prohibited_word' as const, id: row.id, country: row.country, phrase: row.phrase, action: row.action })) };
  }

  async addWord(actorId: string | null, input: { phrase: string; action: 'block' | 'review'; country?: string | null }) {
    const phrase = input.phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (phrase.length < 2 || phrase.length > 60) throw invalid('parameter_invalid', 'Use 2 to 60 characters.', 'phrase');
    try {
      const row = await this.prisma.classifiedProhibitedWord.create({ data: { phrase, action: input.action, country: input.country ?? null, createdById: actorId } });
      await this.audit.record({ actorId, action: 'classifieds.word_added', targetType: 'classified_prohibited_word', targetId: row.id, before: null, after: { phrase, action: input.action, country: row.country } });
      return { object: 'classified_prohibited_word' as const, id: row.id, country: row.country, phrase: row.phrase, action: row.action };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('word_exists', 'This word is already on the list.');
      throw error;
    }
  }

  async removeWord(actorId: string | null, id: string) {
    const row = await this.prisma.classifiedProhibitedWord.findUnique({ where: { id } });
    // BitoCard's admins remove only BitoCard's words.
    if (!row || row.platform !== 'bitocard') throw notFound('word');
    await this.prisma.classifiedProhibitedWord.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'classifieds.word_removed', targetType: 'classified_prohibited_word', targetId: id, before: { phrase: row.phrase, action: row.action, country: row.country }, after: null });
  }
}
