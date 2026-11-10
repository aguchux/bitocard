import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, StepUp } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { sendPhoto } from './chat-files.js';
import { ConversationsService } from './conversations.service.js';
import { connectInclude } from './connect-shipping.service.js';
import { ListingsService } from './listings.service.js';
import { ModerationService } from './moderation.service.js';
import { SafePayGuardsService } from './safe-pay-guards.service.js';
import { invalid, type ListingStatus, listingStatuses, readSku, skuPrefixPattern } from './rules.js';
import { type ListingReviewCode, listingReviewCodes, reviewCodeText } from '../postings/journeys.service.js';
import { type DisputeDecision, disputeDecisions, type DisputeFault, disputeFaults, SafePayService } from './safe-pay.service.js';
import { ResaleService } from './resale.service.js';
import { ProductOnly } from '../products/product.js';
import { AvatarsService } from '../media/avatars.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { UsernamesService } from './usernames.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class AdminListingsDto {
  @IsOptional() @IsIn(listingStatuses)
  status?: ListingStatus;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;

  @IsOptional() @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class ReasonDto {
  @IsString() @Length(3, 500)
  reason: string;
}

/** A moderator sends an ad back or removes it: why, as a code, and what the seller reads (`note`; `reason` from before). */
class ModerateDto {
  @IsOptional() @IsIn(listingReviewCodes)
  reason_code?: ListingReviewCode;

  @IsOptional() @IsString() @Length(3, 500)
  note?: string;

  @IsOptional() @IsString() @Length(3, 500)
  reason?: string;
}

/** The code and what the seller reads: the note, else the code's own sentence; a note alone (from before codes) is `other`. */
function moderation(body: ModerateDto) {
  const note = body.note?.trim() || body.reason?.trim() || null;
  const code = body.reason_code ?? 'other';
  if (!note && !body.reason_code) throw invalid('parameter_missing', 'Choose why, or write a note for the seller.', 'reason_code');
  if (!note && code === 'other') throw invalid('parameter_missing', 'Write a note saying what the seller should change.', 'note');
  return { code, text: note ?? reviewCodeText[code] };
}

class NoteDto {
  @IsOptional() @IsString() @Length(1, 500)
  note?: string;
}

class ReportsDto {
  @IsOptional() @IsIn(['open', 'dismissed', 'actioned'])
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class ResolveReportDto {
  @IsIn(['dismiss', 'remove_listing'])
  action: 'dismiss' | 'remove_listing';

  @IsString() @Length(3, 500)
  note: string;
}

class WordDto {
  @IsString() @Length(2, 60)
  phrase: string;

  @IsIn(['block', 'review'])
  action: 'block' | 'review';

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string | null;
}

export const queueViews = ['all', 'new_sellers', 'flagged', 'reported'] as const;
type QueueView = (typeof queueViews)[number];

class QueueDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional() @IsIn(queueViews)
  view?: QueueView;
}

class CountryQueryDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

class MarketSettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(365)
  listing_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(10000)
  monthly_listing_limit?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  first_listings_reviewed?: number;

  @IsOptional() @IsInt() @Min(1) @Max(30)
  min_photos?: number;

  @IsOptional() @IsInt() @Min(1) @Max(30)
  max_photos?: number;

  /** Ads a customer must have posted before choosing a username (docs/UDOZO_USERNAMES_PLAN.md). */
  @IsOptional() @IsInt() @Min(0) @Max(100)
  username_min_listings?: number;

  /** Buy orders (docs/UDOZO_RATINGS_PLAN.md phase 0): hours to answer, days to meet, open per buyer, a buyer's per day. */
  @IsOptional() @IsInt() @Min(1) @Max(168)
  buy_request_hours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(30)
  buy_meet_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  buy_open_per_buyer?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  buy_requests_per_day?: number;

  /** Reviews (docs/UDOZO_RATINGS_PLAN.md phase 1): Neutral offered, days to review a purchase, counted reviews before the share shows. */
  @IsOptional() @IsBoolean()
  reviews_neutral?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(180)
  review_window_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(50)
  review_min_shown?: number;

  /** Reminders to finish posting (`classifieds_post_reminders`): hours, 1 to 720 each. */
  @IsOptional() @IsInt() @Min(1) @Max(720)
  unfinished_reminder_hours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(720)
  ready_reminder_1_hours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(720)
  ready_reminder_2_hours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(720)
  ready_reminder_3_hours?: number;

  /** Wanted requests: open requests a buyer may have, requests a day, sellers told per request, requests a seller hears of a day. */
  @IsOptional() @IsInt() @Min(1) @Max(20)
  wanted_open_per_buyer?: number;

  @IsOptional() @IsInt() @Min(1) @Max(50)
  wanted_per_day?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  wanted_sellers_per_request?: number;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  wanted_notices_per_seller_day?: number;
}

class SellersDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  /** A name or email address. */
  @IsOptional() @IsString() @Length(1, 100)
  q?: string;

  @IsOptional() @IsIn(['all', 'suspended'])
  status?: 'all' | 'suspended';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class CategoriesDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country: string;
}

/** Search words as stored: trimmed, lower case, single spaces, without LIKE's wildcards, each once, in the order given. */
export function categoryKeywords(words: string[]) {
  const seen = new Set<string>();
  for (const word of words) {
    // Matched with LIKE, so its wildcards are never kept.
    const clean = word.replace(/[%_\\]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (clean.length >= 2) seen.add(clean);
  }
  return [...seen];
}

class CategoryDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  /** Three capital letters starting the SKUs of its new listings; SKUs already given keep theirs. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'A SKU prefix is three letters.' })
  sku_prefix?: string;

  /** What people call the things sold here, matched as typed (at most 60, each 2 to 40 characters). */
  @IsOptional() @IsArray() @ArrayMaxSize(60) @IsString({ each: true }) @Length(2, 40, { each: true })
  keywords?: string[];

  /** Top categories only: the banner across the top of its pages (an uploaded `classified_category_banner`); null removes it. */
  @IsOptional() @IsString() @Matches(/^https:\/\/\S+$/) @Length(10, 2000)
  banner_url?: string | null;

  /** Top categories only: a cut-out of what is sold there, drawn on a circle (`classified_category_spotlight`); null removes it. */
  @IsOptional() @IsString() @Matches(/^https:\/\/\S+$/) @Length(10, 2000)
  spotlight_url?: string | null;
}

class CategoryCountryDto {
  @IsBoolean()
  open: boolean;
}

const adminInclude = {
  category: { include: { parent: true } },
  area: { include: { parent: true } },
  features: { include: { feature: true } },
  media: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
  customer: { select: { id: true, name: true, email: true, createdAt: true, phoneVerifiedAt: true, classifiedSeller: true } },
  reports: { where: { status: 'open' }, select: { id: true, reason: true, details: true, createdAt: true } },
  ...connectInclude,
} satisfies Prisma.ClassifiedListingInclude;

const sellerSelect = { id: true, name: true, email: true, country: true, createdAt: true, phoneVerifiedAt: true, avatarUrl: true, bannerUrl: true, sellerHandle: true, username: true, classifiedSeller: true } satisfies Prisma.CustomerSelect;

/** The moderators' reads: listings with their seller (email included, admins only), flags and open reports. */
@Injectable()
export class ClassifiedsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly audit: AuditService,
    private readonly guards: SafePayGuardsService,
  ) {}

  private present(row: Prisma.ClassifiedListingGetPayload<{ include: typeof adminInclude }>, counts?: Map<string, number>) {
    return {
      ...this.listings.present(row),
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      reviewed_by: row.reviewedById,
      seller: {
        id: row.customer.id,
        name: row.customer.name,
        email: row.customer.email,
        member_since: row.customer.createdAt.toISOString(),
        phone_confirmed: Boolean(row.customer.phoneVerifiedAt),
        suspended: Boolean(row.customer.classifiedSeller?.suspendedAt),
        published_listings: counts?.get(row.customerId) ?? null,
      },
      open_reports: row.reports.map(report => ({ id: report.id, reason: report.reason, details: report.details, created_at: report.createdAt.toISOString() })),
    };
  }

  private async sellerCounts(customerIds: string[]) {
    const rows = await this.prisma.classifiedListing.groupBy({ by: ['customerId'], where: { customerId: { in: [...new Set(customerIds)] }, publishedAt: { not: null } }, _count: { _all: true } });
    return new Map(rows.map(row => [row.customerId, row._count._all]));
  }

  /**
   * Listings waiting for review, oldest submission first: all of them, a new seller's first ads, those the automatic
   * checks flagged, or those customers reported. `stats` counts the whole queue and today's decisions (UTC).
   */
  async queue(country?: string, view: QueueView = 'all') {
    const inMarket = country ? { country } : {};
    const flagged: Prisma.ClassifiedListingWhereInput = {
      all: {},
      new_sellers: { reviewFlags: { has: 'first_listings' } },
      flagged: { reviewFlags: { hasSome: ['prohibited_words', 'price_low', 'photo_reused', 'posting_fast'] } },
      reported: { reviewFlags: { has: 'reported' } },
    }[view];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [rows, waiting, oldest, decided] = await Promise.all([
      this.prisma.classifiedListing.findMany({ where: { status: 'pending_review', ...inMarket, ...flagged }, include: adminInclude, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], take: 100 }),
      this.prisma.classifiedListing.count({ where: { status: 'pending_review', ...inMarket } }),
      this.prisma.classifiedListing.findFirst({ where: { status: 'pending_review', ...inMarket }, orderBy: { submittedAt: 'asc' }, select: { submittedAt: true } }),
      this.prisma.auditLog.findMany({ where: { action: { in: ['classifieds.listing_approved', 'classifieds.listing_rejected', 'classifieds.listing_removed'] }, createdAt: { gte: today } }, select: { action: true, targetId: true } }),
    ]);
    // Decisions in the market asked for: the audit log names the listing, not its country.
    const markets = country ? new Set((await this.prisma.classifiedListing.findMany({ where: { id: { in: [...new Set(decided.map(row => row.targetId))] }, country }, select: { id: true } })).map(row => row.id)) : null;
    const count = (action: string) => decided.filter(row => row.action === action && (!markets || markets.has(row.targetId))).length;
    const counts = await this.sellerCounts(rows.map(row => row.customerId));
    return {
      object: 'list' as const,
      data: rows.map(row => this.present(row, counts)),
      stats: {
        waiting,
        oldest_submitted_at: oldest?.submittedAt?.toISOString() ?? null,
        approved_today: count('classifieds.listing_approved'),
        sent_back_today: count('classifieds.listing_rejected'),
        removed_today: count('classifieds.listing_removed'),
      },
    };
  }

  async list(filter: AdminListingsDto) {
    const where: Prisma.ClassifiedListingWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.country ? { country: filter.country } : {}),
      ...(filter.customer_id ? { customerId: filter.customer_id } : {}),
      ...(filter.q ? { OR: [{ title: { contains: filter.q, mode: 'insensitive' } }, ...(/^\d+$/.test(filter.q) ? [{ ref: BigInt(filter.q) }] : []), ...(readSku(filter.q) ? [{ sku: readSku(filter.q)! }] : []), { customer: { email: { contains: filter.q, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.classifiedListing.findMany({ where, include: adminInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: filter.limit ?? 50, skip: filter.offset ?? 0 }),
      this.prisma.classifiedListing.count({ where }),
    ]);
    const counts = await this.sellerCounts(rows.map(row => row.customerId));
    return { object: 'list' as const, data: rows.map(row => this.present(row, counts)), total };
  }

  async get(id: string) {
    const row = await this.prisma.classifiedListing.findUnique({ where: { id }, include: adminInclude });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');
    return this.present(row, await this.sellerCounts([row.customerId]));
  }

  // ---- Sellers ----

  /** Customers who have put up a listing (anything but a draft) or have a BitoCard Shop record, newest first. */
  async sellers(filter: SellersDto) {
    const insensitive = 'insensitive' as const;
    const where: Prisma.CustomerWhereInput = {
      AND: [
        { OR: [{ classifiedListings: { some: { status: { not: 'draft' } } } }, { classifiedSeller: { isNot: null } }] },
        ...(filter.country ? [{ country: filter.country }] : []),
        ...(filter.status === 'suspended' ? [{ classifiedSeller: { is: { suspendedAt: { not: null } } } }] : []),
        ...(filter.q ? [{ OR: [{ email: { contains: filter.q, mode: insensitive } }, { name: { contains: filter.q, mode: insensitive } }] }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({ where, select: sellerSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: filter.limit ?? 50, skip: filter.offset ?? 0 }),
      this.prisma.customer.count({ where }),
    ]);
    const stats = await this.sellerStats(rows.map(row => row.id));
    return { object: 'list' as const, data: rows.map(row => this.presentSeller(row, stats)), total };
  }

  /** One seller: their listings by status, reports about them or their listings, and their UdozoPay standing. */
  async seller(id: string) {
    const row = await this.prisma.customer.findUnique({ where: { id }, select: sellerSelect });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such seller.');
    const [stats, reports, bought, standing] = await Promise.all([
      this.sellerStats([id]),
      this.prisma.classifiedReport.findMany({
        where: { OR: [{ reportedCustomerId: id }, { listing: { customerId: id } }] },
        include: { listing: { select: { id: true, ref: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.classifiedOrder.count({ where: { buyerId: id, status: { in: ['released', 'partly_refunded'] } } }),
      row.country ? this.guards.standing(id, row.country) : null,
    ]);
    return {
      ...this.presentSeller(row, stats),
      safe_pay: { bought, ...(standing ?? { strikes: 0, strike_limit: null, limited: false, cancelled_after_accepting: 0, not_handed_over: 0, disputes_lost: 0, resale_not_accepted: 0, cleared_at: null }) },
      reports: reports.map(report => ({
        id: report.id,
        reason: report.reason,
        details: report.details,
        status: report.status,
        note: report.note,
        listing: report.listing ? { id: report.listing.id, ref: Number(report.listing.ref), title: report.listing.title } : null,
        conversation_id: report.conversationId,
        created_at: report.createdAt.toISOString(),
      })),
    };
  }

  private async sellerStats(ids: string[]) {
    const [listings, reports, sales] = await Promise.all([
      this.prisma.classifiedListing.groupBy({ by: ['customerId', 'status'], where: { customerId: { in: ids } }, _count: { _all: true } }),
      this.prisma.classifiedReport.findMany({ where: { status: 'open', OR: [{ reportedCustomerId: { in: ids } }, { listing: { customerId: { in: ids } } }] }, select: { reportedCustomerId: true, listing: { select: { customerId: true } } } }),
      this.prisma.classifiedOrder.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids }, status: { in: ['released', 'partly_refunded'] } }, _count: { _all: true } }),
    ]);
    const openReports = new Map<string, number>();
    for (const report of reports) {
      const about = report.reportedCustomerId ?? report.listing?.customerId;
      if (about) openReports.set(about, (openReports.get(about) ?? 0) + 1);
    }
    return { listings, openReports, sales: new Map(sales.map(row => [row.sellerId, row._count._all])) };
  }

  private presentSeller(row: Prisma.CustomerGetPayload<{ select: typeof sellerSelect }>, stats: Awaited<ReturnType<ClassifiedsAdminService['sellerStats']>>) {
    const count = (status: string) => stats.listings.find(item => item.customerId === row.id && item.status === status)?._count._all ?? 0;
    const seller = row.classifiedSeller;
    return {
      object: 'classified_seller' as const,
      id: row.id,
      name: row.name,
      email: row.email,
      country: row.country,
      member_since: row.createdAt.toISOString(),
      phone_confirmed: Boolean(row.phoneVerifiedAt),
      /** Their profile photo and the handle of their public seller page (`/<cc>/seller/<handle>`). */
      avatar_url: row.avatarUrl,
      /** Their profile cover on their seller page, or null. */
      banner_url: row.bannerUrl,
      handle: row.sellerHandle,
      /** Their chosen username (their page's address once set), or null. */
      username: row.username,
      suspended: Boolean(seller?.suspendedAt),
      suspended_reason: seller?.suspendedReason ?? null,
      suspended_at: seller?.suspendedAt?.toISOString() ?? null,
      /** New buy orders on their listings are refused until then (buyers' voids, or an admin). */
      buy_orders_paused_until: seller?.buyOrdersPausedUntil && seller.buyOrdersPausedUntil > new Date() ? seller.buyOrdersPausedUntil.toISOString() : null,
      buy_orders_paused_reason: seller?.buyOrdersPausedUntil && seller.buyOrdersPausedUntil > new Date() ? seller.buyOrdersPausedReason : null,
      /** They cannot write reviews until then (a fake or extorting reviewer). */
      reviews_blocked_until: seller?.reviewsBlockedUntil && seller.reviewsBlockedUntil > new Date() ? seller.reviewsBlockedUntil.toISOString() : null,
      listings: {
        active: count('active'),
        pending_review: count('pending_review'),
        sold: count('sold'),
        removed: count('removed'),
        total: stats.listings.filter(item => item.customerId === row.id && item.status !== 'draft' && item.status !== 'deleted').reduce((sum, item) => sum + item._count._all, 0),
      },
      open_reports: stats.openReports.get(row.id) ?? 0,
      safe_pay_sales: stats.sales.get(row.id) ?? 0,
    };
  }

  // ---- Categories ----

  /** Every category (switched off ones too), top categories with their subcategories, open or not in the country. */
  async categories(country: string) {
    await this.requireCountry(country);
    const [rows, counts] = await Promise.all([
      this.prisma.classifiedCategory.findMany({ include: { countries: { where: { country } } }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
      this.prisma.classifiedListing.groupBy({ by: ['categoryId'], where: { country, status: 'active' }, _count: { _all: true } }),
    ]);
    const live = new Map(counts.map(row => [row.categoryId, row._count._all]));
    const present = (row: (typeof rows)[number]) => ({
      object: 'classified_admin_category' as const,
      id: row.id,
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      b2b: row.b2b,
      enabled: row.enabled,
      sku_prefix: row.skuPrefix,
      keywords: row.keywords,
      banner_url: row.bannerUrl,
      spotlight_url: row.spotlightUrl,
      open: row.countries[0]?.enabled ?? false,
      active_listings: live.get(row.id) ?? 0,
    });
    const data = rows
      .filter(row => !row.parentId)
      .map(top => {
        const children = rows.filter(row => row.parentId === top.id).map(present);
        return { ...present(top), active_listings: children.reduce((sum, child) => sum + child.active_listings, live.get(top.id) ?? 0), children };
      });
    return { object: 'list' as const, country, data };
  }

  /**
   * Switches a category off everywhere (or back on): no new listings in it; live ones stay until they end. Or gives it
   * another SKU prefix: its new listings' SKUs start with it, those given keep theirs, and a prefix any category has had
   * stays that category's, so no other can take it and no SKU is ever given twice. Or, for a top category, sets or
   * removes its banner and spotlight image on udozo.com.
   */
  async setCategory(actorId: string | null, id: string, input: { enabled?: boolean; sku_prefix?: string; keywords?: string[]; banner_url?: string | null; spotlight_url?: string | null }) {
    const row = await this.prisma.classifiedCategory.findUnique({ where: { id } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such category.');
    if (input.enabled === undefined && input.sku_prefix === undefined && input.keywords === undefined && input.banner_url === undefined && input.spotlight_url === undefined) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Say what to change.', 'enabled');
    }
    for (const field of ['banner_url', 'spotlight_url'] as const) {
      if (input[field] !== undefined && row.parentId) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Only top categories have a banner and a spotlight image; subcategories show the banner of their top category.', field);
    }
    const pictures = {
      ...(input.banner_url !== undefined && input.banner_url !== row.bannerUrl ? { bannerUrl: input.banner_url } : {}),
      ...(input.spotlight_url !== undefined && input.spotlight_url !== row.spotlightUrl ? { spotlightUrl: input.spotlight_url } : {}),
    };
    const keywords = input.keywords === undefined ? undefined : categoryKeywords(input.keywords);
    const keywordsChanged = keywords !== undefined && keywords.join('\n') !== row.keywords.join('\n');
    const prefix = input.sku_prefix !== undefined && input.sku_prefix !== row.skuPrefix ? input.sku_prefix : undefined;
    if (prefix !== undefined) {
      if (!skuPrefixPattern.test(prefix)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'A SKU prefix is three letters.', 'sku_prefix');
      const holder = await this.prisma.classifiedCategorySkuPrefix.findUnique({ where: { prefix }, include: { category: { select: { name: true } } } });
      if (holder && holder.categoryId !== id) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'sku_prefix_taken', `${prefix} is already ${holder.category.name}'s, now or before. Choose another.`, 'sku_prefix');
    }
    const enabled = input.enabled ?? row.enabled;
    await this.prisma.$transaction(async tx => {
      await tx.classifiedCategory.update({ where: { id }, data: { enabled, ...(prefix ? { skuPrefix: prefix } : {}), ...(keywordsChanged ? { keywords } : {}), ...pictures } });
      if (prefix) await tx.classifiedCategorySkuPrefix.upsert({ where: { prefix }, create: { prefix, categoryId: id }, update: {} });
    });
    await this.audit.record({
      actorId,
      action: 'classifieds.category_changed',
      targetType: 'classified_category',
      targetId: id,
      before: {
        enabled: row.enabled,
        ...(prefix ? { sku_prefix: row.skuPrefix } : {}),
        ...(keywordsChanged ? { keywords: row.keywords } : {}),
        ...('bannerUrl' in pictures ? { banner_url: row.bannerUrl } : {}),
        ...('spotlightUrl' in pictures ? { spotlight_url: row.spotlightUrl } : {}),
      },
      after: {
        enabled,
        ...(prefix ? { sku_prefix: prefix } : {}),
        ...(keywordsChanged ? { keywords } : {}),
        ...('bannerUrl' in pictures ? { banner_url: pictures.bannerUrl } : {}),
        ...('spotlightUrl' in pictures ? { spotlight_url: pictures.spotlightUrl } : {}),
      },
    });
    return {
      object: 'classified_admin_category' as const,
      id,
      slug: row.slug,
      enabled,
      sku_prefix: prefix ?? row.skuPrefix,
      keywords: keywordsChanged ? keywords : row.keywords,
      banner_url: pictures.bannerUrl !== undefined ? pictures.bannerUrl : row.bannerUrl,
      spotlight_url: pictures.spotlightUrl !== undefined ? pictures.spotlightUrl : row.spotlightUrl,
    };
  }

  /** Opens or closes a category in one country (a top category closes all of its subcategories there). */
  async setCategoryCountry(actorId: string | null, id: string, country: string, open: boolean) {
    await this.requireCountry(country);
    const row = await this.prisma.classifiedCategory.findUnique({ where: { id }, include: { countries: { where: { country } } } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such category.');
    await this.prisma.classifiedCategoryCountry.upsert({ where: { categoryId_country: { categoryId: id, country } }, create: { categoryId: id, country, enabled: open }, update: { enabled: open } });
    await this.audit.record({ actorId, action: 'classifieds.category_country_changed', targetType: 'classified_category', targetId: id, before: { country, open: row.countries[0]?.enabled ?? false }, after: { country, open } });
    return { object: 'classified_admin_category' as const, id, slug: row.slug, country, open };
  }

  private async requireCountry(country: string) {
    if (!(await this.prisma.country.findUnique({ where: { code: country } }))) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such country.');
  }

  async marketSettings(country: string) {
    const row = await this.listings.marketSettings(country);
    return { object: 'classified_market_settings' as const, country, listing_days: row.listingDays, monthly_listing_limit: row.monthlyListingLimit, first_listings_reviewed: row.firstListingsReviewed, min_photos: row.minPhotos, max_photos: row.maxPhotos, username_min_listings: row.usernameMinListings,
      buy_request_hours: row.buyRequestHours, buy_meet_days: row.buyMeetDays, buy_open_per_buyer: row.buyOpenPerBuyer, buy_requests_per_day: row.buyRequestsPerDay,
      reviews_neutral: row.reviewsNeutral, review_window_days: row.reviewWindowDays, review_min_shown: row.reviewMinShown,
      unfinished_reminder_hours: row.unfinishedReminderHours, ready_reminder_1_hours: row.readyReminder1Hours, ready_reminder_2_hours: row.readyReminder2Hours, ready_reminder_3_hours: row.readyReminder3Hours,
      wanted_open_per_buyer: row.wantedOpenPerBuyer, wanted_per_day: row.wantedPerDay, wanted_sellers_per_request: row.wantedSellersPerRequest, wanted_notices_per_seller_day: row.wantedNoticesPerSellerDay };
  }

  async setMarketSettings(actorId: string | null, country: string, input: MarketSettingsDto) {
    if (!(await this.prisma.country.findUnique({ where: { code: country } }))) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such country.');
    const before = await this.marketSettings(country);
    const min = input.min_photos ?? before.min_photos;
    const max = input.max_photos ?? before.max_photos;
    if (min > max) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'The most photos cannot be fewer than the least.', 'max_photos');
    const data = {
      ...(input.listing_days !== undefined ? { listingDays: input.listing_days } : {}),
      ...(input.monthly_listing_limit !== undefined ? { monthlyListingLimit: input.monthly_listing_limit } : {}),
      ...(input.first_listings_reviewed !== undefined ? { firstListingsReviewed: input.first_listings_reviewed } : {}),
      ...(input.min_photos !== undefined ? { minPhotos: input.min_photos } : {}),
      ...(input.max_photos !== undefined ? { maxPhotos: input.max_photos } : {}),
      ...(input.username_min_listings !== undefined ? { usernameMinListings: input.username_min_listings } : {}),
      ...(input.buy_request_hours !== undefined ? { buyRequestHours: input.buy_request_hours } : {}),
      ...(input.buy_meet_days !== undefined ? { buyMeetDays: input.buy_meet_days } : {}),
      ...(input.buy_open_per_buyer !== undefined ? { buyOpenPerBuyer: input.buy_open_per_buyer } : {}),
      ...(input.buy_requests_per_day !== undefined ? { buyRequestsPerDay: input.buy_requests_per_day } : {}),
      ...(input.reviews_neutral !== undefined ? { reviewsNeutral: input.reviews_neutral } : {}),
      ...(input.review_window_days !== undefined ? { reviewWindowDays: input.review_window_days } : {}),
      ...(input.review_min_shown !== undefined ? { reviewMinShown: input.review_min_shown } : {}),
      ...(input.unfinished_reminder_hours !== undefined ? { unfinishedReminderHours: input.unfinished_reminder_hours } : {}),
      ...(input.ready_reminder_1_hours !== undefined ? { readyReminder1Hours: input.ready_reminder_1_hours } : {}),
      ...(input.ready_reminder_2_hours !== undefined ? { readyReminder2Hours: input.ready_reminder_2_hours } : {}),
      ...(input.ready_reminder_3_hours !== undefined ? { readyReminder3Hours: input.ready_reminder_3_hours } : {}),
      ...(input.wanted_open_per_buyer !== undefined ? { wantedOpenPerBuyer: input.wanted_open_per_buyer } : {}),
      ...(input.wanted_per_day !== undefined ? { wantedPerDay: input.wanted_per_day } : {}),
      ...(input.wanted_sellers_per_request !== undefined ? { wantedSellersPerRequest: input.wanted_sellers_per_request } : {}),
      ...(input.wanted_notices_per_seller_day !== undefined ? { wantedNoticesPerSellerDay: input.wanted_notices_per_seller_day } : {}),
    };
    await this.prisma.classifiedMarketSettings.upsert({ where: { country }, create: { country, ...data }, update: data });
    const after = await this.marketSettings(country);
    await this.audit.record({ actorId, action: 'classifieds.market_settings_changed', targetType: 'country', targetId: country, before, after });
    return after;
  }
}

/** Admin Classifieds: the moderation queue and decisions, listings, reports, refused words, sellers and market rules. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminClassifiedsController {
  constructor(
    private readonly admin: ClassifiedsAdminService,
    private readonly moderation: ModerationService,
    private readonly conversations: ConversationsService,
    private readonly avatars: AvatarsService,
    private readonly audit: AuditService,
    private readonly usernames: UsernamesService,
    private readonly inbox: InboxService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Takes a seller's username away (abuse, impersonation): their page goes back to its handle, the username is held for
   * 90 days, and they are told; audited.
   */
  @Post('sellers/:customer/username/remove')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async removeUsername(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    await this.admin.seller(customer);
    await this.usernames.remove(adminId(caller), customer, body.reason);
    return this.admin.seller(customer);
  }

  /** Takes a seller's profile photo off (an abusive or misleading picture): their initials show again; audited. */
  @Post('sellers/:customer/avatar/remove')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async removeAvatar(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    const row = await this.admin.seller(customer);
    await this.avatars.remove({ kind: 'customer', id: customer });
    await this.audit.record({ actorId: adminId(caller), action: 'classifieds.seller_avatar_removed', targetType: 'customer', targetId: customer, before: { avatar_url: row.avatar_url }, after: { avatar_url: null, reason: body.reason } });
    const seller = await this.prisma.customer.findUnique({ where: { id: customer }, select: { storeId: true } });
    if (seller) await this.inbox.customer({ customerId: customer, storeId: seller.storeId }, 'customer.classifieds.avatar_removed', { subject: `avatar_removed:${Date.now()}`, title: 'Udozo removed your profile photo', body: `Why: ${body.reason} You can choose another that follows Udozo’s rules.`, link: '/account/profile' });
    return this.admin.seller(customer);
  }

  /** Takes a seller's profile cover off (an abusive or misleading picture): Udozo's own banner shows again; audited. */
  @Post('sellers/:customer/banner/remove')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async removeBanner(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    const row = await this.admin.seller(customer);
    await this.avatars.removeBanner({ kind: 'customer', id: customer });
    await this.audit.record({ actorId: adminId(caller), action: 'classifieds.seller_banner_removed', targetType: 'customer', targetId: customer, before: { banner_url: row.banner_url }, after: { banner_url: null, reason: body.reason } });
    const seller = await this.prisma.customer.findUnique({ where: { id: customer }, select: { storeId: true, sellerHandle: true, username: true, country: true } });
    if (seller) await this.inbox.customer({ customerId: customer, storeId: seller.storeId }, 'customer.classifieds.banner_removed', { subject: `banner_removed:${Date.now()}`, title: 'Udozo removed your profile cover', body: `Why: ${body.reason} You can choose another that follows Udozo’s rules.`, link: `/${seller.country?.toLowerCase() ?? 'ng'}/seller/${seller.username ?? seller.sellerHandle}` });
    return this.admin.seller(customer);
  }

  /** A reported chat, read in full (only once someone has reported it; every read is audited). */
  @Get('conversations/:id')
  conversation(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.adminGet(adminId(caller), id);
  }

  @Get('conversations/:id/photos/:message')
  async conversationPhoto(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('message', ParseUUIDPipe) message: string, @Res() res: Response) {
    sendPhoto(res, await this.conversations.adminPhoto(adminId(caller), id, message));
  }

  @Get('queue')
  queue(@Query() query: QueueDto) {
    return this.admin.queue(query.country, query.view);
  }

  @Get('listings')
  listings(@Query() query: AdminListingsDto) {
    return this.admin.list(query);
  }

  @Get('listings/:id')
  listing(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.get(id);
  }

  @Post('listings/:id/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async approve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoteDto) {
    await this.moderation.approve(adminId(caller), id, body.note);
    return this.admin.get(id);
  }

  @Post('listings/:id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async reject(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ModerateDto) {
    const { code, text } = moderation(body);
    await this.moderation.reject(adminId(caller), id, text, code);
    return this.admin.get(id);
  }

  @Post('listings/:id/remove')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ModerateDto) {
    const { code, text } = moderation(body);
    await this.moderation.remove(adminId(caller), id, text, code);
    return this.admin.get(id);
  }

  @Get('reports')
  reports(@Query() query: ReportsDto) {
    return this.moderation.reports(query);
  }

  @Post('reports/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  resolve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveReportDto) {
    return this.moderation.resolveReport(adminId(caller), id, body);
  }

  @Get('sellers')
  sellers(@Query() query: SellersDto) {
    return this.admin.sellers(query);
  }

  @Get('sellers/:customer')
  seller(@Param('customer', ParseUUIDPipe) customer: string) {
    return this.admin.seller(customer);
  }

  @Post('sellers/:customer/suspend')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  suspend(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    return this.moderation.suspend(adminId(caller), customer, body.reason);
  }

  @Post('sellers/:customer/unsuspend')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  unsuspend(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    return this.moderation.unsuspend(adminId(caller), customer, body.reason);
  }

  @Get('categories')
  categories(@Query() query: CategoriesDto) {
    return this.admin.categories(query.country);
  }

  @Patch('categories/:id')
  @AdminRoles('operations')
  setCategory(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CategoryDto) {
    return this.admin.setCategory(adminId(caller), id, body);
  }

  @Put('categories/:id/countries/:country')
  @AdminRoles('operations')
  setCategoryCountry(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('country') country: string, @Body() body: CategoryCountryDto) {
    return this.admin.setCategoryCountry(adminId(caller), id, country.toUpperCase(), body.open);
  }

  @Get('prohibited-words')
  words(@Query() query: CountryQueryDto) {
    return this.moderation.words(query.country);
  }

  @Post('prohibited-words')
  @AdminRoles('operations')
  addWord(@CurrentCaller() caller: Caller, @Body() body: WordDto) {
    return this.moderation.addWord(adminId(caller), body);
  }

  @Delete('prohibited-words/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AdminRoles('operations')
  async removeWord(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    await this.moderation.removeWord(adminId(caller), id);
  }

  @Get('market-settings/:country')
  marketSettings(@Param('country') country: string) {
    return this.admin.marketSettings(country.toUpperCase());
  }

  @Put('market-settings/:country')
  @AdminRoles('operations')
  setMarketSettings(@CurrentCaller() caller: Caller, @Param('country') country: string, @Body() body: MarketSettingsDto) {
    return this.admin.setMarketSettings(adminId(caller), country.toUpperCase(), body);
  }
}

class AdminOrdersDto {
  @IsOptional() @IsIn(['requested', 'declined', 'lapsed', 'awaiting_payment', 'cancelled', 'locked', 'paid', 'sent', 'at_centre', 'disputed', 'released', 'refunded', 'partly_refunded'])
  status?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  /** An order number (SP-100001) or a buyer's or seller's email. */
  @IsOptional() @IsString() @Length(1, 100)
  q?: string;

  /** Sellers' payouts waiting for finance (`pending`), or decided. */
  @IsOptional() @IsIn(['pending', 'approved', 'rejected'])
  payout_review?: string;

  /** BitoCard Shop's own sales (`direct`) or those on resellers' Resale shops (`resale`). */
  @IsOptional() @IsIn(['direct', 'resale'])
  kind?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class AdminDisputesDto {
  @IsOptional() @IsIn(['open', 'decided'])
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class DisputeBodyDto {
  @IsString() @Length(1, 2000)
  body: string;
}

class DecideDto {
  @IsIn(disputeDecisions)
  decision: DisputeDecision;

  /** For `partial`: what goes back to the buyer, in minor units, less than the price. */
  @IsOptional() @IsInt() @Min(1)
  refund?: number;

  @IsString() @Length(3, 500)
  note: string;

  /** Whose strike an upheld dispute is: `supplier` (default), `reseller` (a resale order's store misled the buyer) or `none`. */
  @IsOptional() @IsIn(disputeFaults)
  fault?: DisputeFault;
}

class SafePaySettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(2000)
  buyer_fee_bps?: number;

  @IsOptional() @IsInt() @Min(0)
  buyer_fee_cap?: number;

  @IsOptional() @IsInt() @Min(0) @Max(2000)
  seller_fee_bps?: number;

  @IsOptional() @IsInt() @Min(0)
  seller_fee_cap?: number;

  @IsOptional() @IsInt() @Min(1)
  new_seller_order_limit?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(168)
  accept_hours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(168)
  pay_hours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(30)
  handover_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(30)
  confirm_days?: number;

  @IsOptional() @IsInt() @Min(1) @Max(20)
  strike_limit?: number;

  /** The longest a parcel may take once shipped. */
  @IsOptional() @IsInt() @Min(1) @Max(60)
  transit_days?: number;

  /** The couriers offered (replacing the list): a name each and an https tracking link with `{tracking}`, or null. */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CourierDto)
  couriers?: CourierDto[];
}

class CourierDto {
  @IsString() @MaxLength(60)
  name: string;

  @IsOptional() @IsString() @MaxLength(300)
  tracking_url: string | null;
}

class ResaleSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(10000)
  discount_min_bps?: number;

  @IsOptional() @IsInt() @Min(0) @Max(10000)
  discount_max_bps?: number;

  @IsOptional() @IsInt() @Min(0) @Max(20000)
  markup_max_bps?: number;

  @IsOptional() @IsInt() @Min(0) @Max(5000)
  reseller_fee_bps?: number;

  @IsOptional() @IsInt() @Min(0)
  reseller_fee_cap?: number;

  @IsOptional() @IsInt() @Min(1) @Max(168)
  accept_hours?: number;

  @IsOptional() @IsInt() @Min(1) @Max(20)
  reseller_strike_limit?: number;
}

class PayoutReviewDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @IsString() @Length(3, 500)
  note: string;
}

/** Admin Classifieds: UdozoPay orders, disputes and their decisions, and UdozoPay settings per country. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/classifieds')
@ProductOnly('udozo')
export class AdminSafePayController {
  constructor(
    private readonly safePay: SafePayService,
    private readonly resale: ResaleService,
  ) {}

  @Get('orders')
  orders(@Query() query: AdminOrdersDto) {
    return this.safePay.adminList(query);
  }

  /** One order; a resale order's buyer details are shown, and the view logged. */
  @Get('orders/:id')
  order(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.adminGet(id, adminId(caller));
  }

  @Get('orders/:id/dispatch-photos/:photo')
  async dispatchPhoto(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('photo', ParseUUIDPipe) photo: string, @Res() res: Response) {
    sendPhoto(res, await this.safePay.adminDispatchPhoto(adminId(caller), id, photo));
  }

  @Get('disputes')
  disputes(@Query() query: AdminDisputesDto) {
    return this.safePay.adminDisputes(query);
  }

  @Get('orders/:id/dispute/photos/:message')
  async disputePhoto(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('message', ParseUUIDPipe) message: string, @Res() res: Response) {
    sendPhoto(res, await this.safePay.adminDisputePhoto(adminId(caller), id, message));
  }

  @Post('orders/:id/dispute/messages')
  @AdminRoles('support', 'operations', 'finance')
  disputeMessage(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DisputeBodyDto) {
    return this.safePay.adminDisputeMessage(adminId(caller), id, body.body);
  }

  /** Decides an open dispute: release (operations or finance), or a full or part refund (finance). */
  @Post('orders/:id/dispute/decide')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations', 'finance')
  @StepUp()
  decide(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideDto) {
    return this.safePay.decide(adminId(caller), caller.kind === 'session' ? caller.adminRoles : [], id, body);
  }

  /** Finance approves a seller's payout held because the buyer paid from a recent card top-up, or keeps it held. */
  @Post('orders/:id/payout-review')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('finance')
  @StepUp()
  payoutReview(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PayoutReviewDto) {
    return this.safePay.decidePayoutReview(adminId(caller), id, body);
  }

  /** A seller's UdozoPay strikes and whether they can take orders. */
  @Get('sellers/:customer/safe-pay')
  standing(@Param('customer', ParseUUIDPipe) customer: string) {
    return this.safePay.sellerStanding(customer);
  }

  /** Lifts a seller's UdozoPay limit (strikes so far no longer count). */
  @Post('sellers/:customer/safe-pay/clear')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  clearStrikes(@CurrentCaller() caller: Caller, @Param('customer', ParseUUIDPipe) customer: string, @Body() body: ReasonDto) {
    return this.safePay.clearStrikes(adminId(caller), customer, body.reason);
  }

  @Get('safe-pay-settings/:country')
  settings(@Param('country') country: string) {
    return this.safePay.adminSettings(country.toUpperCase());
  }

  /** Each side's fee (rate and cap), the new-seller limit and the time limits: new requests use them. */
  @Put('safe-pay-settings/:country')
  @AdminRoles('finance')
  @StepUp()
  updateSettings(@CurrentCaller() caller: Caller, @Param('country') country: string, @Body() body: SafePaySettingsDto) {
    return this.safePay.updateSettings(adminId(caller), country.toUpperCase(), body);
  }

  /** BitoCard's resale limits in a country (B2B reselling), and whether resale is open there. */
  @Get('resale-settings/:country')
  resaleSettings(@Param('country') country: string) {
    return this.resale.adminSettings(country.toUpperCase());
  }

  /** What suppliers may offer resellers, BitoCard's capped fee on resellers' margins, and resale's limits. */
  @Put('resale-settings/:country')
  @AdminRoles('finance')
  @StepUp()
  updateResaleSettings(@CurrentCaller() caller: Caller, @Param('country') country: string, @Body() body: ResaleSettingsDto) {
    return this.resale.updateSettings(adminId(caller), country.toUpperCase(), body);
  }
}
