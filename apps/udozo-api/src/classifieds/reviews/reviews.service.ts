import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ApiError } from '../../common/errors/api-error.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { InboxService } from '../../notifications/inbox.service.js';
import { WatermarkService } from '../../watermarks/watermarks.service.js';
import { listingPath } from '../contact.service.js';
import { cleanMessage } from '../conversations.service.js';
import { ListingsService } from '../listings.service.js';
import { invalid } from '../rules.js';
import { SafePayGuardsService } from '../safe-pay-guards.service.js';
import { publicName } from '../search.service.js';
import { ShopEmails } from '../shop-emails.service.js';
import { ShopTermsService } from '../terms.service.js';
import { productKeyOf } from './purchases.js';
import { ReviewStatsService } from './stats.service.js';

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const yearMs = 365 * dayMs;

export const reviewRatings = ['positive', 'neutral', 'negative'] as const;
export type ReviewRating = (typeof reviewRatings)[number];
export const reviewAspects = ['described', 'communication', 'handover'] as const;
export const reviewStances = ['agree', 'disagree', 'context'] as const;
export const reviewReportReasons = ['fake', 'not_a_buyer', 'offensive', 'personal_info', 'contact_or_links', 'threat_or_extortion', 'off_topic', 'other'] as const;
export type ReviewReportReason = (typeof reviewReportReasons)[number];

export const maxReviewBody = 1000;
export const maxPostBody = 600;
/** A negative review says why: at least this many characters, or an aspect marked down. */
export const negativeMinChars = 20;
export const maxEdits = 3;
export const editWindowMs = 30 * dayMs;
export const postEditMs = 15 * minuteMs;
export const postCaps = { reviewer: 5, seller: 5, buyer: 3 } as const;
export const postsPerThread = 50;
export const postsPerDay = 20;
/** A thread closes this long after its review. */
export const threadOpenMs = yearMs;
/** Open reports that put a review on the moderators' list (any threat or extortion report does at once). */
export const reportsToFlag = 3;
/** Reviewers caught faking or extorting are blocked this long. */
export const blockDays = 180;
/** Reviews from accounts younger than this, or of buy orders completed this soon after acceptance, wait for a moderator. */
export const newAccountMs = 7 * dayMs;
export const quickSaleMs = hourMs;
/** Reminders to review, after completion. */
export const remindAfterMs = [2 * dayMs, 7 * dayMs] as const;
/** On lists, the first posts of each conversation. */
export const listPosts = 2;

const notFound = (what = 'review') => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const conflict = (code: string, message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message, param);
const forbidden = (code: string, message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', code, message);

const emails = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const phones = /\+?\d[\d\s().-]{5,}\d/g;
/** A review's or post's words as kept: links, codes and card numbers hidden as in chats, and phone numbers and emails too. */
export const cleanReviewText = (raw: string, max: number) => cleanMessage(raw).replace(emails, '[email hidden]').replace(phones, '[number hidden]').slice(0, max).trim();

const person = { select: { id: true, name: true, avatarUrl: true, storeId: true, sellerHandle: true, username: true, country: true, createdAt: true } } satisfies Prisma.CustomerDefaultArgs;
const postInclude = { author: person } satisfies Prisma.ClassifiedReviewPostInclude;
const reviewInclude = {
  reviewer: person,
  seller: person,
  posts: { where: { status: { not: 'deleted' } }, orderBy: { createdAt: 'asc' }, include: postInclude },
  listing: { select: { id: true, ref: true, title: true, slug: true, country: true } },
} satisfies Prisma.ClassifiedReviewInclude;
type ReviewRow = Prisma.ClassifiedReviewGetPayload<{ include: typeof reviewInclude }>;
type PostRow = Prisma.ClassifiedReviewPostGetPayload<{ include: typeof postInclude }>;

const purchaseInclude = {
  listing: { select: { id: true, ref: true, title: true, slug: true, country: true, media: { where: { kind: 'photo', status: 'ready' }, orderBy: { position: 'asc' }, take: 1, select: { id: true, url: true } } } },
  seller: person,
  review: { include: reviewInclude },
  buyOrder: { select: { acceptedAt: true, completedAt: true } },
} satisfies Prisma.ClassifiedPurchaseInclude;
type PurchaseRow = Prisma.ClassifiedPurchaseGetPayload<{ include: typeof purchaseInclude }>;

export type ReviewInput = { rating: ReviewRating; aspects?: Record<string, 'up' | 'down'>; body?: string };

/**
 * Udozo's reviews (docs/UDOZO_RATINGS_PLAN.md phase 1). A buyer reviews the seller once per purchase, within the
 * market's window: positive, neutral (where the market allows it) or negative (which says why). Each review is a
 * conversation: the seller replies, and buyers of the same product (brand and model, else listing) from the same seller
 * in the last 12 months agree, disagree or add context. Words are cleaned (links, codes, phone numbers and emails
 * hidden) and checked against the refused words; reviews from new accounts or quick sales wait for a moderator.
 * Nothing is hidden by reports alone: enough of them, or any threat, put a review in front of Udozo's moderators.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly stats: ReviewStatsService,
    private readonly inbox: InboxService,
    private readonly emails: ShopEmails,
    private readonly guards: SafePayGuardsService,
    private readonly terms: ShopTermsService,
    private readonly audit: AuditService,
    private readonly watermarks: WatermarkService,
  ) {}

  private async open(country: string) {
    if (!(await this.stats.open(country))) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'reviews_unavailable', 'Reviews are not open in this country yet.');
  }

  // ---- Purchases ----

  /** The buyer's purchases, newest first: `to_review` those still open for a review. */
  async purchases(customer: CustomerWithStore, query: { state?: 'to_review' | 'all'; order_id?: string; buy_order_id?: string; limit?: number }) {
    const country = await this.listings.sellerCountry(customer);
    const now = new Date();
    const open: Prisma.ClassifiedPurchaseWhereInput = { reviewClosesAt: { gt: now }, review: { is: null } };
    const where: Prisma.ClassifiedPurchaseWhereInput = {
      buyerId: customer.id,
      ...(query.order_id ? { orderId: query.order_id } : {}),
      ...(query.buy_order_id ? { buyOrderId: query.buy_order_id } : {}),
      ...(query.state === 'to_review' ? open : {}),
    };
    const [rows, toReview, neutral] = await Promise.all([
      this.prisma.classifiedPurchase.findMany({ where, include: purchaseInclude, orderBy: { completedAt: 'desc' }, take: Math.min(query.limit ?? 30, 100) }),
      this.prisma.classifiedPurchase.count({ where: { buyerId: customer.id, dismissedAt: null, ...open } }),
      this.neutralAllowed(country),
    ]);
    return { object: 'list' as const, data: rows.map(row => this.presentPurchase(row, customer.id, neutral, now)), to_review: toReview };
  }

  async dismiss(customer: CustomerWithStore, id: string) {
    await this.listings.sellerCountry(customer);
    const purchase = await this.ownPurchase(customer.id, id);
    await this.prisma.classifiedPurchase.updateMany({ where: { id: purchase.id, dismissedAt: null }, data: { dismissedAt: new Date() } });
    return this.presentPurchase(await this.reloadPurchase(id), customer.id, await this.neutralAllowed(purchase.country));
  }

  // ---- Writing ----

  async write(customer: CustomerWithStore, purchaseId: string, input: ReviewInput) {
    await this.listings.sellerCountry(customer);
    const purchase = await this.ownPurchase(customer.id, purchaseId);
    await this.open(purchase.country);
    const now = new Date();
    if (purchase.review) throw conflict('review_given', 'You have already reviewed this purchase. You can edit your review.');
    if (purchase.reviewClosesAt <= now) throw conflict('review_closed', 'Reviews of this purchase have closed.');
    await this.requireNotBlocked(customer.id);
    await this.terms.require(customer.id);
    if (await this.guards.samePerson(customer.id, purchase.sellerId)) throw forbidden('same_person', 'A review is from a buyer to a different seller, so it cannot be written here.');
    const content = await this.checkContent(purchase.country, input, await this.neutralAllowed(purchase.country));
    const reviewer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { createdAt: true } });
    const quick = purchase.buyOrder?.acceptedAt && purchase.buyOrder.completedAt && purchase.buyOrder.completedAt.getTime() - purchase.buyOrder.acceptedAt.getTime() < quickSaleMs;
    const heldReason = content.held ? 'words' : now.getTime() - reviewer.createdAt.getTime() < newAccountMs ? 'new_account' : quick ? 'quick_sale' : null;
    let review;
    try {
      review = await this.prisma.$transaction(async tx => {
        const created = await tx.classifiedReview.create({
          data: {
            purchaseId: purchase.id,
            reviewerId: customer.id,
            sellerId: purchase.sellerId,
            listingId: purchase.listingId,
            country: purchase.country,
            source: purchase.source,
            productKey: purchase.productKey,
            productLabel: purchase.productLabel,
            rating: input.rating,
            aspects: content.aspects,
            body: content.body,
            status: heldReason ? 'held' : 'published',
            heldReason,
          },
        });
        // Reviewing a buy order confirms the buyer bought it.
        if (purchase.buyOrderId) await tx.classifiedBuyOrder.updateMany({ where: { id: purchase.buyOrderId, buyerConfirmedAt: null }, data: { buyerConfirmedAt: now } });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('review_given', 'You have already reviewed this purchase.');
      throw error;
    }
    const full = await this.reload(review.id);
    if (heldReason) {
      await this.inbox.admins('admin.classifieds.review_held', { subject: review.id, title: 'A review waits for a moderator', body: `Held because ${heldReason.replace('_', ' ')}. Publish or remove it.`, link: `/classifieds/reviews/${review.id}` });
    } else {
      await this.tellSeller(full, `${publicName(customer.name)} reviewed you`, `A ${input.rating} review of ${purchase.productLabel}. You can reply on your Reviews page.`);
    }
    return this.present(full, customer.id, { full: true });
  }

  /** The reviewer edits their review: up to 3 times within 30 days; every version is kept for moderators. */
  async edit(customer: CustomerWithStore, id: string, input: Partial<ReviewInput>) {
    await this.listings.sellerCountry(customer);
    const review = await this.reload(id);
    if (review.reviewerId !== customer.id) throw notFound();
    if (!['published', 'held'].includes(review.status)) throw conflict('review_closed', 'This review can no longer be changed.');
    if (review.edits >= maxEdits || Date.now() - review.createdAt.getTime() > editWindowMs) throw conflict('review_edit_closed', `A review can be changed ${maxEdits} times, within 30 days of writing it.`);
    const merged: ReviewInput = { rating: input.rating ?? (review.rating as ReviewRating), aspects: input.aspects ?? (review.aspects as Record<string, 'up' | 'down'>), body: input.body ?? review.body ?? undefined };
    const content = await this.checkContent(review.country, merged, await this.neutralAllowed(review.country));
    const replied = review.posts.some(post => post.role === 'seller');
    const versions = [...((review.versions as unknown[]) ?? []), { rating: review.rating, aspects: review.aspects, body: review.body, at: review.updatedAt.toISOString() }];
    const claimed = await this.prisma.classifiedReview.updateMany({
      where: { id, edits: review.edits, status: { in: ['published', 'held'] } },
      data: {
        rating: merged.rating,
        aspects: content.aspects,
        body: content.body,
        edits: { increment: 1 },
        versions: versions as Prisma.InputJsonValue,
        ...(replied ? { editedAfterReply: true } : {}),
        ...(content.held && review.status === 'published' ? { status: 'held', heldReason: 'words' } : {}),
      },
    });
    if (!claimed.count) throw conflict('review_changed', 'This review changed: refresh and try again.');
    return this.present(await this.reload(id), customer.id, { full: true });
  }

  /** The reviewer withdraws their review (it no longer counts or shows; the conversation goes with it). */
  async withdraw(customer: CustomerWithStore, id: string) {
    await this.listings.sellerCountry(customer);
    const review = await this.reload(id);
    if (review.reviewerId !== customer.id) throw notFound();
    const claimed = await this.prisma.classifiedReview.updateMany({ where: { id, status: { in: ['published', 'held'] } }, data: { status: 'withdrawn' } });
    if (!claimed.count) throw conflict('review_closed', 'This review was already withdrawn or removed.');
    return this.present(await this.reload(id), customer.id, { full: true });
  }

  // ---- Conversations ----

  /** What the signed-in reader can do on a review's conversation. */
  async viewer(customer: CustomerWithStore, id: string) {
    await this.listings.sellerCountry(customer);
    const review = await this.reload(id);
    if (review.status !== 'published' && review.reviewerId !== customer.id && review.sellerId !== customer.id) throw notFound();
    const right = await this.rightOf(review, customer.id);
    return {
      object: 'classified_review_viewer' as const,
      role: right.role,
      can_post: right.ok,
      posts_left: right.left,
      reason: right.reason,
      can_report: review.reviewerId !== customer.id && review.status === 'published',
      own_review: review.reviewerId === customer.id,
      can_edit: review.reviewerId === customer.id && ['published', 'held'].includes(review.status) && review.edits < maxEdits && Date.now() - review.createdAt.getTime() <= editWindowMs,
    };
  }

  async post(customer: CustomerWithStore, id: string, input: { body: string; stance?: string; reply_to?: string }) {
    await this.listings.sellerCountry(customer);
    const review = await this.reload(id);
    if (review.status !== 'published') throw notFound();
    await this.open(review.country);
    const right = await this.rightOf(review, customer.id);
    if (!right.ok) throw forbidden(right.code ?? 'thread_not_allowed', right.reason ?? 'You cannot write in this conversation.');
    if (right.role === 'buyer' && !(reviewStances as readonly string[]).includes(input.stance ?? '')) throw invalid('parameter_missing', 'Say whether you agree, disagree or are adding context.', 'stance');
    const body = cleanReviewText(input.body ?? '', maxPostBody);
    if (!body) throw invalid('parameter_missing', 'Write something.', 'body');
    if (await this.refused(review.country, body)) throw invalid('review_prohibited', 'This cannot be posted on Udozo. Change what you wrote.', 'body');
    const today = await this.prisma.classifiedReviewPost.count({ where: { authorId: customer.id, createdAt: { gt: new Date(Date.now() - dayMs) } } });
    if (today >= postsPerDay) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'thread_post_limit', 'You have written a lot today. Try again tomorrow.');
    if (input.reply_to && !review.posts.some(post => post.id === input.reply_to)) throw invalid('parameter_invalid', 'No such post in this conversation.', 'reply_to');
    const post = await this.prisma.$transaction(async tx => {
      const claimed = await tx.classifiedReview.updateMany({ where: { id, status: 'published', postCount: { lt: postsPerThread } }, data: { postCount: { increment: 1 } } });
      if (!claimed.count) throw conflict('thread_post_limit', 'This conversation is full.');
      return tx.classifiedReviewPost.create({
        data: { reviewId: id, authorId: customer.id, role: right.role!, purchaseId: right.purchaseId, stance: right.role === 'buyer' ? input.stance! : null, replyTo: input.reply_to ?? null, body },
        include: postInclude,
      });
    });
    await this.tellThread(review, customer.id, right.role!);
    return this.presentPost(post, customer.id);
  }

  async editPost(customer: CustomerWithStore, postId: string, input: { body: string }) {
    await this.listings.sellerCountry(customer);
    const post = await this.prisma.classifiedReviewPost.findUnique({ where: { id: postId }, include: { ...postInclude, review: { select: { country: true } } } });
    if (!post || post.authorId !== customer.id || post.status !== 'published') throw notFound('post');
    if (Date.now() - post.createdAt.getTime() > postEditMs) throw conflict('post_edit_closed', 'A post can be changed for 15 minutes after writing it.');
    const body = cleanReviewText(input.body ?? '', maxPostBody);
    if (!body) throw invalid('parameter_missing', 'Write something.', 'body');
    if (await this.refused(post.review.country, body)) throw invalid('review_prohibited', 'This cannot be posted on Udozo. Change what you wrote.', 'body');
    const saved = await this.prisma.classifiedReviewPost.update({ where: { id: postId }, data: { body, editedAt: new Date() }, include: postInclude });
    return this.presentPost(saved, customer.id);
  }

  async deletePost(customer: CustomerWithStore, postId: string) {
    await this.listings.sellerCountry(customer);
    const post = await this.prisma.classifiedReviewPost.findUnique({ where: { id: postId } });
    if (!post || post.authorId !== customer.id || post.status !== 'published') throw notFound('post');
    await this.prisma.classifiedReviewPost.update({ where: { id: postId }, data: { status: 'deleted' } });
    return { object: 'classified_review_post' as const, id: postId, deleted: true };
  }

  /** Reports a review or one of its posts; three open reports, or any threat or extortion report, go to moderators. */
  async report(customer: CustomerWithStore, id: string, input: { reason: ReviewReportReason; details?: string; post_id?: string }) {
    await this.listings.sellerCountry(customer);
    const review = await this.reload(id);
    if (review.status !== 'published' || review.reviewerId === customer.id) throw notFound();
    if (input.post_id && !review.posts.some(post => post.id === input.post_id)) throw invalid('parameter_invalid', 'No such post in this conversation.', 'post_id');
    try {
      await this.prisma.classifiedReviewReport.create({ data: { reviewId: id, postId: input.post_id ?? null, reporterId: customer.id, reason: input.reason, details: input.details?.trim() ? cleanReviewText(input.details, 500) : null } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('report_exists', 'You have already reported this. A moderator will look at it.');
      throw error;
    }
    const open = await this.prisma.classifiedReviewReport.count({ where: { reviewId: id, status: 'open' } });
    if (input.reason === 'threat_or_extortion' || open === reportsToFlag) {
      await this.inbox.admins('admin.classifieds.review_reported', { subject: `${id}:${input.reason === 'threat_or_extortion' ? 'threat' : 'reports'}`, title: input.reason === 'threat_or_extortion' ? 'A review was reported as a threat or extortion' : 'A review was reported several times', body: 'Read it and its conversation, then decide the reports.', link: `/classifieds/reviews/${id}` });
    }
    return { object: 'classified_review_report' as const, review_id: id, post_id: input.post_id ?? null, reason: input.reason, status: 'open' as const };
  }

  // ---- Reading ----

  /** A seller's published reviews (public): the summary, the products reviewed, then a page of reviews with their first posts. */
  async sellerReviews(sellerId: string, country: string, query: { product?: string; rating?: string; source?: string; sort?: 'newest' | 'negative'; limit?: number; offset?: number }, viewerId: string | null = null) {
    await this.open(country);
    const where: Prisma.ClassifiedReviewWhereInput = {
      sellerId,
      status: 'published',
      ...(query.product ? { productKey: query.product } : {}),
      ...(query.rating && (reviewRatings as readonly string[]).includes(query.rating) ? { rating: query.rating } : {}),
      ...(query.source === 'safe_pay' || query.source === 'buy_order' ? { source: query.source } : {}),
    };
    const limit = Math.min(query.limit ?? 10, 50);
    const [summary, products, total, rows] = await Promise.all([
      this.stats.summary(sellerId, country),
      this.prisma.classifiedReview.groupBy({ by: ['productKey', 'productLabel'], where: { sellerId, status: 'published' }, _count: { _all: true } }),
      this.prisma.classifiedReview.count({ where }),
      query.sort === 'negative'
        ? this.prisma.$queryRaw<{ id: string }[]>`
            SELECT r."id" FROM "classified_reviews" r WHERE r."seller_id" = ${sellerId}::uuid AND r."status" = 'published'
              ${query.product ? Prisma.sql`AND r."product_key" = ${query.product}` : Prisma.empty}
              ${query.rating && (reviewRatings as readonly string[]).includes(query.rating) ? Prisma.sql`AND r."rating" = ${query.rating}` : Prisma.empty}
              ${query.source === 'safe_pay' || query.source === 'buy_order' ? Prisma.sql`AND r."source" = ${query.source}` : Prisma.empty}
            ORDER BY CASE r."rating" WHEN 'negative' THEN 0 WHEN 'neutral' THEN 1 ELSE 2 END, r."created_at" DESC
            LIMIT ${limit} OFFSET ${query.offset ?? 0}`.then(found => this.prisma.classifiedReview.findMany({ where: { id: { in: found.map(row => row.id) } }, include: reviewInclude }).then(list => found.map(row => list.find(item => item.id === row.id)!)))
        : this.prisma.classifiedReview.findMany({ where, include: reviewInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: query.offset ?? 0 }),
    ]);
    return {
      object: 'list' as const,
      summary: summary ?? { positive: 0, neutral: 0, negative: 0, counted: 0, positive_pct: null },
      products: products.map(row => ({ key: row.productKey, label: row.productLabel, count: row._count._all })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      data: rows.map(row => this.present(row, viewerId)),
      total,
    };
  }

  /** The latest published reviews of one product from one seller (a listing page's own). */
  async productReviews(sellerId: string, productKey: string, country: string, limit = 3) {
    if (!(await this.stats.open(country))) return [];
    const rows = await this.prisma.classifiedReview.findMany({ where: { sellerId, productKey, status: 'published' }, include: reviewInclude, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(row => this.present(row, null));
  }

  /** A listing's own product reviews (its brand and model, else itself), from its seller. */
  async forListing(listingId: string, limit = 3) {
    const listing = await this.prisma.classifiedListing.findUnique({
      where: { id: listingId },
      select: { id: true, title: true, customerId: true, country: true, features: { where: { feature: { key: { in: ['brand', 'model'] } } }, select: { valueText: true, feature: { select: { key: true } } } } },
    });
    if (!listing) return [];
    const value = (key: string) => listing.features.find(row => row.feature.key === key)?.valueText ?? null;
    return this.productReviews(listing.customerId, productKeyOf(listing, value('brand'), value('model')).key, listing.country, limit);
  }

  /** One review with its whole conversation (public while published; its author and the seller see it however it stands). */
  async get(id: string, viewerId: string | null) {
    const review = await this.reload(id).catch(() => null);
    if (!review) throw notFound();
    const party = viewerId && (review.reviewerId === viewerId || review.sellerId === viewerId);
    if (review.status !== 'published' && !party) throw notFound();
    if (review.status === 'published' && !(await this.stats.open(review.country))) throw notFound();
    return this.present(review, viewerId, { full: true });
  }

  /** The reviews a customer wrote (`given`) or received as a seller (`received`), every status for their own. */
  async mine(customer: CustomerWithStore, role: 'given' | 'received') {
    await this.listings.sellerCountry(customer);
    const rows = await this.prisma.classifiedReview.findMany({
      where: role === 'given' ? { reviewerId: customer.id } : { sellerId: customer.id, status: { in: ['published', 'held'] } },
      include: reviewInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { object: 'list' as const, data: rows.map(row => ({ ...this.present(row, customer.id), listing: { title: row.listing.title, path: listingPath(row.listing) } })) };
  }

  // ---- The job ----

  /**
   * Every 15 minutes, where reviews are open: buyers are reminded to review (2 and 7 days after completing), each
   * reminder claimed once.
   */
  async remind(now = new Date()) {
    let sent = 0;
    for (const [index, after] of remindAfterMs.entries()) {
      const field = index === 0 ? 'remind1At' : 'remind2At';
      const rows = await this.prisma.classifiedPurchase.findMany({
        where: { [field]: null, dismissedAt: null, review: { is: null }, reviewClosesAt: { gt: now }, completedAt: { lte: new Date(now.getTime() - after) } },
        include: { buyer: { select: { id: true, storeId: true } }, seller: { select: { name: true } } },
        take: 200,
      });
      for (const row of rows) {
        if (!(await this.stats.open(row.country))) continue;
        const claimed = await this.prisma.classifiedPurchase.updateMany({ where: { id: row.id, [field]: null }, data: { [field]: now } });
        if (!claimed.count) continue;
        sent += 1;
        const title = `How was buying from ${publicName(row.seller.name)}?`;
        const body = `Rate your purchase of ${row.productLabel}: it helps other buyers.`;
        await this.inbox.customer({ customerId: row.buyer.id, storeId: row.buyer.storeId }, 'customer.classifieds.review_reminder', { subject: `${row.id}:${field}`, title, body, link: '/account/reviews' });
        this.emails.customer(row.buyer.id, { title, body, path: '/account/reviews', action: 'Rate the seller' });
      }
    }
    return { reminded: sent };
  }

  /**
   * Retention (the daily `marketing` job): withdrawn reviews' words after 30 days, removed reviews and posts and decided
   * reports after two years, and purchases never reviewed after 13 months.
   */
  async purge(now = new Date()) {
    const [withdrawn, removed, posts, reports, purchases] = await Promise.all([
      this.prisma.classifiedReview.updateMany({ where: { status: 'withdrawn', body: { not: null }, updatedAt: { lt: new Date(now.getTime() - 30 * dayMs) } }, data: { body: null, versions: [] } }),
      this.prisma.classifiedReview.deleteMany({ where: { status: { in: ['removed', 'withdrawn'] }, updatedAt: { lt: new Date(now.getTime() - 2 * yearMs) } } }),
      this.prisma.classifiedReviewPost.deleteMany({ where: { status: { in: ['removed', 'deleted'] }, createdAt: { lt: new Date(now.getTime() - 2 * yearMs) } } }),
      this.prisma.classifiedReviewReport.deleteMany({ where: { status: { not: 'open' }, createdAt: { lt: new Date(now.getTime() - 2 * yearMs) } } }),
      this.prisma.classifiedPurchase.deleteMany({ where: { review: { is: null }, completedAt: { lt: new Date(now.getTime() - 395 * dayMs) } } }),
    ]);
    return { withdrawn_cleared: withdrawn.count, reviews: removed.count, posts: posts.count, reports: reports.count, purchases: purchases.count };
  }

  /** The review invite after a completed purchase (where reviews are open). */
  async invite(buyer: { id: string; storeId: string }, purchase: { country: string; sellerName: string; productLabel: string; subject: string }) {
    if (!(await this.stats.open(purchase.country))) return;
    const title = `Rate ${publicName(purchase.sellerName)}`;
    const body = `How was buying ${purchase.productLabel}? Your review helps other buyers.`;
    await this.inbox.customer({ customerId: buyer.id, storeId: buyer.storeId }, 'customer.classifieds.review_invite', { subject: purchase.subject, title, body, link: '/account/reviews' });
    this.emails.customer(buyer.id, { title, body, path: '/account/reviews', action: 'Rate the seller' });
  }

  // ---- Moderators ----

  async adminList(filter: { tab?: 'reported' | 'held' | 'removed' | 'all'; country?: string; seller?: string; reviewer?: string; limit?: number; offset?: number }) {
    const where: Prisma.ClassifiedReviewWhereInput = {
      ...(filter.tab === 'reported' ? { reports: { some: { status: 'open' } } } : filter.tab === 'held' ? { status: 'held' } : filter.tab === 'removed' ? { status: 'removed' } : {}),
      ...(filter.country ? { country: filter.country } : {}),
      ...(filter.seller ? { sellerId: filter.seller } : {}),
      ...(filter.reviewer ? { reviewerId: filter.reviewer } : {}),
    };
    const [rows, total, counts] = await Promise.all([
      this.prisma.classifiedReview.findMany({ where, include: { ...reviewInclude, reports: { where: { status: 'open' }, select: { reason: true } } }, orderBy: [{ createdAt: filter.tab === 'held' || filter.tab === 'reported' ? 'asc' : 'desc' }], take: Math.min(filter.limit ?? 50, 100), skip: filter.offset ?? 0 }),
      this.prisma.classifiedReview.count({ where }),
      Promise.all([this.prisma.classifiedReview.count({ where: { reports: { some: { status: 'open' } } } }), this.prisma.classifiedReview.count({ where: { status: 'held' } })]),
    ]);
    return {
      object: 'list' as const,
      counts: { reported: counts[0], held: counts[1] },
      data: rows.map(row => ({ ...this.presentAdmin(row), open_reports: row.reports.length, threat: row.reports.some(report => report.reason === 'threat_or_extortion') })),
      total,
    };
  }

  async adminGet(id: string) {
    const review = await this.prisma.classifiedReview.findUnique({
      where: { id },
      include: {
        ...reviewInclude,
        posts: { orderBy: { createdAt: 'asc' }, include: postInclude },
        reports: { orderBy: { createdAt: 'asc' }, include: { reporter: { select: { id: true, name: true, email: true } } } },
        purchase: { select: { source: true, orderId: true, buyOrderId: true, completedAt: true, order: { select: { number: true } }, buyOrder: { select: { number: true } } } },
      },
    });
    if (!review) throw notFound();
    return {
      ...this.presentAdmin(review),
      versions: review.versions,
      purchase: {
        source: review.purchase.source,
        order: review.purchase.orderId ? { id: review.purchase.orderId, number: `SP-${review.purchase.order?.number}` } : null,
        buy_order: review.purchase.buyOrderId ? { id: review.purchase.buyOrderId, number: `BO-${String(review.purchase.buyOrder?.number ?? '').padStart(6, '0')}` } : null,
        completed_at: review.purchase.completedAt.toISOString(),
      },
      posts: review.posts.map(post => ({ ...this.presentPost(post, null, true), author: { id: post.author.id, name: post.author.name }, status: post.status, removed_reason: post.removedReason })),
      reports: review.reports.map(report => ({ id: report.id, post_id: report.postId, reason: report.reason, details: report.details, status: report.status, note: report.note, reporter: { id: report.reporter.id, name: report.reporter.name, email: report.reporter.email }, decided_at: report.decidedAt?.toISOString() ?? null, created_at: report.createdAt.toISOString() })),
    };
  }

  /** publish (a held review), remove, restore, lock or unlock; audited, the author told when it is removed or restored. */
  async moderate(actorId: string | null, id: string, action: 'publish' | 'remove' | 'restore' | 'lock' | 'unlock', reason: string) {
    const review = await this.reload(id).catch(() => null);
    if (!review) throw notFound();
    const from: Record<typeof action, string[]> = { publish: ['held'], remove: ['published', 'held'], restore: ['removed'], lock: ['published', 'held'], unlock: ['published', 'held'] };
    const data: Prisma.ClassifiedReviewUpdateManyMutationInput =
      action === 'publish' ? { status: 'published', heldReason: null } : action === 'remove' ? { status: 'removed', removedReason: reason } : action === 'restore' ? { status: 'published', removedReason: null } : { lockedAt: action === 'lock' ? new Date() : null };
    const claimed = await this.prisma.classifiedReview.updateMany({ where: { id, status: { in: from[action] } }, data });
    if (!claimed.count) throw conflict('review_changed', `This review is ${review.status}, so it cannot be ${action === 'remove' ? 'removed' : `${action}ed`}.`);
    await this.audit.record({ actorId, action: `classifieds.review_${action === 'publish' ? 'published' : action === 'remove' ? 'removed' : action === 'restore' ? 'restored' : action === 'lock' ? 'locked' : 'unlocked'}`, targetType: 'classified_review', targetId: id, before: { status: review.status, locked: Boolean(review.lockedAt) }, after: { action, reason } });
    if (action === 'remove' || action === 'restore') {
      await this.inbox.customer({ customerId: review.reviewer.id, storeId: review.reviewer.storeId }, 'customer.classifieds.review_removed', {
        subject: `${id}:${action}:${Date.now()}`,
        title: action === 'remove' ? 'Udozo removed your review' : 'Udozo restored your review',
        body: action === 'remove' ? `Your review of ${review.productLabel} broke Udozo's review rules: ${reason}` : `Your review of ${review.productLabel} shows again.`,
        link: '/account/reviews',
      });
    }
    if (action === 'publish') await this.tellSeller(await this.reload(id), `${publicName(review.reviewer.name)} reviewed you`, `A ${review.rating} review of ${review.productLabel}. You can reply on your Reviews page.`);
    return this.adminGet(id);
  }

  async removePost(actorId: string | null, postId: string, reason: string) {
    const post = await this.prisma.classifiedReviewPost.findUnique({ where: { id: postId } });
    if (!post || post.status !== 'published') throw notFound('post');
    await this.prisma.classifiedReviewPost.update({ where: { id: postId }, data: { status: 'removed', removedReason: reason } });
    await this.audit.record({ actorId, action: 'classifieds.review_post_removed', targetType: 'classified_review_post', targetId: postId, before: { status: post.status }, after: { status: 'removed', reason } });
    return this.adminGet(post.reviewId);
  }

  async decideReport(actorId: string | null, reportId: string, decision: 'upheld' | 'dismissed', note: string) {
    const report = await this.prisma.classifiedReviewReport.findUnique({ where: { id: reportId } });
    if (!report) throw notFound('report');
    const claimed = await this.prisma.classifiedReviewReport.updateMany({ where: { id: reportId, status: 'open' }, data: { status: decision, decidedById: actorId, decidedAt: new Date(), note } });
    if (!claimed.count) throw conflict('report_decided', 'This report was already decided.');
    await this.audit.record({ actorId, action: `classifieds.review_report_${decision}`, targetType: 'classified_review_report', targetId: reportId, before: { status: 'open' }, after: { status: decision, note } });
    return this.adminGet(report.reviewId);
  }

  /** Blocks (or unblocks) a customer from writing reviews: a fake or extorting reviewer, for 180 days by default. */
  async block(actorId: string | null, customerId: string, blocked: boolean, reason: string, days = blockDays) {
    const until = blocked ? new Date(Date.now() + days * dayMs) : null;
    await this.prisma.classifiedSeller.upsert({ where: { customerId }, create: { customerId, reviewsBlockedUntil: until }, update: { reviewsBlockedUntil: until } });
    await this.audit.record({ actorId, action: blocked ? 'classifieds.reviewer_blocked' : 'classifieds.reviewer_unblocked', targetType: 'customer', targetId: customerId, before: null, after: { until: until?.toISOString() ?? null, reason } });
    const reviewer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { storeId: true } });
    if (reviewer) {
      await this.inbox.customer({ customerId, storeId: reviewer.storeId }, 'customer.classifieds.reviews_blocked', until
        ? { subject: `reviews_blocked:${until.toISOString()}`, title: 'You cannot write reviews for now', body: `Udozo paused your reviews and replies until ${until.toISOString().slice(0, 10)}. Why: ${reason}`, link: '/account/reviews' }
        : { subject: `reviews_unblocked:${Date.now()}`, title: 'You can write reviews again', body: 'Udozo lifted the pause on your reviews and replies.', link: '/account/reviews' });
    }
    return { reviews_blocked_until: until?.toISOString() ?? null };
  }

  // ---- Helpers ----

  private async neutralAllowed(country: string) {
    return (await this.prisma.classifiedMarketSettings.findUnique({ where: { country }, select: { reviewsNeutral: true } }))?.reviewsNeutral ?? false;
  }

  private async requireNotBlocked(customerId: string) {
    const seller = await this.prisma.classifiedSeller.findUnique({ where: { customerId }, select: { reviewsBlockedUntil: true } });
    if (seller?.reviewsBlockedUntil && seller.reviewsBlockedUntil > new Date()) throw forbidden('reviews_blocked', 'You cannot write reviews just now.');
  }

  private async checkContent(country: string, input: ReviewInput, neutral: boolean) {
    if (!(reviewRatings as readonly string[]).includes(input.rating) || (input.rating === 'neutral' && !neutral)) throw invalid('rating_invalid', neutral ? 'Choose positive, neutral or negative.' : 'Choose positive or negative.', 'rating');
    const aspects: Record<string, 'up' | 'down'> = {};
    for (const [key, value] of Object.entries(input.aspects ?? {})) {
      if (!(reviewAspects as readonly string[]).includes(key) || (value !== 'up' && value !== 'down')) throw invalid('parameter_invalid', 'Mark each part up or down.', 'aspects');
      aspects[key] = value;
    }
    const body = input.body?.trim() ? cleanReviewText(input.body, maxReviewBody) : null;
    if (input.rating === 'negative' && (body?.length ?? 0) < negativeMinChars && !Object.values(aspects).includes('down')) throw invalid('review_reason_required', 'Say what went wrong: a few words, or mark a part down.', 'body');
    const words = body ? await this.wordsIn(country, body) : null;
    if (words === 'block') throw invalid('review_prohibited', 'This cannot be posted on Udozo. Change what you wrote.', 'body');
    return { aspects, body, held: words === 'review' };
  }

  /** The strongest refused word in the text: `block` refuses it, `review` holds it for a moderator. */
  private async wordsIn(country: string, text: string): Promise<'block' | 'review' | null> {
    const words = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard', OR: [{ country: null }, { country }] }, select: { phrase: true, action: true } });
    const normal = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `;
    const found = words.filter(word => normal.includes(` ${word.phrase.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ')} `));
    return found.some(word => word.action === 'block') ? 'block' : found.length ? 'review' : null;
  }

  private async refused(country: string, text: string) {
    return (await this.wordsIn(country, text)) === 'block';
  }

  /**
   * Who may write in a review's conversation: its reviewer and the seller (5 posts each), and buyers of the same product
   * from the same seller in the last 12 months (3 each); never in a locked, closed or full one.
   */
  private async rightOf(review: ReviewRow, customerId: string): Promise<{ ok: boolean; role: 'seller' | 'reviewer' | 'buyer' | null; purchaseId: string | null; left: number; reason: string | null; code: string | null }> {
    const no = (role: 'seller' | 'reviewer' | 'buyer' | null, code: string, reason: string) => ({ ok: false, role, purchaseId: null, left: 0, reason, code });
    let role: 'seller' | 'reviewer' | 'buyer' | null = review.reviewerId === customerId ? 'reviewer' : review.sellerId === customerId ? 'seller' : null;
    let purchaseId: string | null = null;
    if (!role) {
      const bought = await this.prisma.classifiedPurchase.findFirst({
        where: { buyerId: customerId, sellerId: review.sellerId, productKey: review.productKey, id: { not: review.purchaseId }, completedAt: { gt: new Date(Date.now() - yearMs) } },
        select: { id: true },
        orderBy: { completedAt: 'desc' },
      });
      if (bought) [role, purchaseId] = ['buyer', bought.id];
    }
    if (!role) return no(null, 'thread_not_allowed', 'Only the reviewer, the seller and buyers of the same item from this seller can write here.');
    if (review.status !== 'published') return no(role, 'thread_locked', 'This review is not showing, so its conversation is closed.');
    if (review.lockedAt || Date.now() - review.createdAt.getTime() > threadOpenMs) return no(role, 'thread_locked', 'This conversation is closed.');
    if (review.postCount >= postsPerThread) return no(role, 'thread_post_limit', 'This conversation is full.');
    const mine = review.posts.filter(post => post.authorId === customerId && post.status === 'published').length;
    const left = Math.max(postCaps[role] - mine, 0);
    if (!left) return { ...no(role, 'thread_post_limit', `You can write ${postCaps[role]} times here.`), purchaseId };
    return { ok: true, role, purchaseId, left, reason: null, code: null };
  }

  private async tellSeller(review: ReviewRow, title: string, body: string) {
    await this.inbox.customer({ customerId: review.seller.id, storeId: review.seller.storeId }, 'customer.classifieds.review_received', { subject: review.id, title, body, link: '/account/reviews?tab=about' });
  }

  /** Tells the others in the conversation (in the app only, never what was written), at most once every 10 minutes each. */
  private async tellThread(review: ReviewRow, writerId: string, role: string) {
    const people = new Map<string, string>([[review.reviewer.id, review.reviewer.storeId], [review.seller.id, review.seller.storeId]]);
    for (const post of review.posts) people.set(post.author.id, post.author.storeId);
    people.delete(writerId);
    const slot = Math.floor(Date.now() / (10 * minuteMs));
    const who = role === 'seller' ? 'The seller' : role === 'reviewer' ? 'The reviewer' : 'Another buyer';
    for (const [customerId, storeId] of people) {
      await this.inbox.customer({ customerId, storeId }, 'customer.classifieds.review_reply', { subject: `${review.id}:${slot}`, title: `${who} replied on a review`, body: `On the review of ${review.productLabel}.`, link: `/account/reviews?review=${review.id}` });
    }
  }

  private async ownPurchase(customerId: string, id: string) {
    const purchase = await this.prisma.classifiedPurchase.findUnique({ where: { id }, include: purchaseInclude });
    if (!purchase || purchase.buyerId !== customerId) throw notFound('purchase');
    return purchase;
  }

  private reloadPurchase(id: string) {
    return this.prisma.classifiedPurchase.findUniqueOrThrow({ where: { id }, include: purchaseInclude });
  }

  private reload(id: string) {
    return this.prisma.classifiedReview.findUniqueOrThrow({ where: { id }, include: reviewInclude });
  }

  presentPurchase(row: PurchaseRow, viewerId: string, neutral: boolean, now = new Date()) {
    return {
      object: 'classified_purchase' as const,
      id: row.id,
      source: row.source as 'safe_pay' | 'buy_order',
      order_id: row.orderId,
      buy_order_id: row.buyOrderId,
      listing: { id: row.listing.id, title: row.listing.title, path: listingPath(row.listing), cover_url: row.listing.media[0] ? this.watermarks.url(row.listing.media[0], 480) : null },
      seller: { name: publicName(row.seller.name), handle: row.seller.sellerHandle, username: row.seller.username },
      product_label: row.productLabel,
      completed_at: row.completedAt.toISOString(),
      review_closes_at: row.reviewClosesAt.toISOString(),
      can_review: !row.review && row.reviewClosesAt > now,
      dismissed: Boolean(row.dismissedAt),
      neutral_allowed: neutral,
      review: row.review ? this.present(row.review, viewerId, { full: true }) : null,
    };
  }

  presentPost(post: PostRow, viewerId: string | null, admin = false) {
    const removed = post.status === 'removed';
    return {
      id: post.id,
      role: post.role as 'seller' | 'reviewer' | 'buyer',
      name: publicName(post.author.name),
      avatar_url: post.author.avatarUrl,
      stance: (post.stance as 'agree' | 'disagree' | 'context' | null) ?? null,
      reply_to: post.replyTo,
      body: removed && !admin ? null : post.body,
      removed,
      edited: Boolean(post.editedAt),
      ...(viewerId ? { mine: post.authorId === viewerId } : {}),
      created_at: post.createdAt.toISOString(),
    };
  }

  /** A review as the public sees it; its author also sees its status. The reviewer by first name and initial only. */
  present(row: ReviewRow, viewerId: string | null, options: { full?: boolean } = {}) {
    const posts = row.posts.filter(post => post.status !== 'deleted');
    const author = viewerId !== null && (row.reviewerId === viewerId || row.sellerId === viewerId);
    return {
      object: 'classified_review' as const,
      id: row.id,
      rating: row.rating as ReviewRating,
      aspects: row.aspects as Record<string, 'up' | 'down'>,
      body: row.body,
      reviewer: { name: publicName(row.reviewer.name), avatar_url: row.reviewer.avatarUrl },
      seller: { name: publicName(row.seller.name), handle: row.seller.sellerHandle, username: row.seller.username, country: row.seller.country },
      product: { key: row.productKey, label: row.productLabel },
      source: row.source as 'safe_pay' | 'buy_order',
      month: row.createdAt.toISOString().slice(0, 7),
      edited: row.edits > 0,
      edited_after_reply: row.editedAfterReply,
      locked: Boolean(row.lockedAt) || Date.now() - row.createdAt.getTime() > threadOpenMs,
      post_count: posts.length,
      posts: (options.full ? posts : posts.slice(0, listPosts)).map(post => this.presentPost(post, viewerId)),
      ...(author ? { status: row.status as 'published' | 'held' | 'removed' | 'withdrawn' } : {}),
      created_at: row.createdAt.toISOString(),
    };
  }

  private presentAdmin(row: ReviewRow) {
    return {
      object: 'classified_admin_review' as const,
      id: row.id,
      status: row.status,
      held_reason: row.heldReason,
      removed_reason: row.removedReason,
      rating: row.rating,
      aspects: row.aspects,
      body: row.body,
      country: row.country,
      source: row.source,
      product: { key: row.productKey, label: row.productLabel },
      listing: { id: row.listing.id, title: row.listing.title, path: listingPath(row.listing) },
      reviewer: { id: row.reviewer.id, name: row.reviewer.name },
      seller: { id: row.seller.id, name: row.seller.name },
      edits: row.edits,
      edited_after_reply: row.editedAfterReply,
      locked: Boolean(row.lockedAt),
      post_count: row.postCount,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
