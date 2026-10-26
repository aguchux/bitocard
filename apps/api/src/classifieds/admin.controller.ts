import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, StepUp } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { sendPhoto } from './chat-files.js';
import { ConversationsService } from './conversations.service.js';
import { ListingsService } from './listings.service.js';
import { ModerationService } from './moderation.service.js';
import { SafePayGuardsService } from './safe-pay-guards.service.js';
import { type ListingStatus, listingStatuses } from './rules.js';
import { type DisputeDecision, disputeDecisions, SafePayService } from './safe-pay.service.js';
import { ResaleService } from './resale.service.js';

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

class CategoryDto {
  @IsBoolean()
  enabled: boolean;
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
} satisfies Prisma.ClassifiedListingInclude;

const sellerSelect = { id: true, name: true, email: true, country: true, createdAt: true, phoneVerifiedAt: true, classifiedSeller: true } satisfies Prisma.CustomerSelect;

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
      ...(filter.q ? { OR: [{ title: { contains: filter.q, mode: 'insensitive' } }, ...(/^\d+$/.test(filter.q) ? [{ ref: BigInt(filter.q) }] : []), { customer: { email: { contains: filter.q, mode: 'insensitive' } } }] } : {}),
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

  /** One seller: their listings by status, reports about them or their listings, and their Safe pay standing. */
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
      safe_pay: { bought, ...(standing ?? { strikes: 0, strike_limit: null, limited: false, cancelled_after_accepting: 0, not_handed_over: 0, disputes_lost: 0, cleared_at: null }) },
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
      suspended: Boolean(seller?.suspendedAt),
      suspended_reason: seller?.suspendedReason ?? null,
      suspended_at: seller?.suspendedAt?.toISOString() ?? null,
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

  /** Switches a category off everywhere (or back on): no new listings in it; live ones stay until they end. */
  async setCategory(actorId: string | null, id: string, enabled: boolean) {
    const row = await this.prisma.classifiedCategory.findUnique({ where: { id } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such category.');
    await this.prisma.classifiedCategory.update({ where: { id }, data: { enabled } });
    await this.audit.record({ actorId, action: 'classifieds.category_changed', targetType: 'classified_category', targetId: id, before: { enabled: row.enabled }, after: { enabled } });
    return { object: 'classified_admin_category' as const, id, slug: row.slug, enabled };
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
    return { object: 'classified_market_settings' as const, country, listing_days: row.listingDays, monthly_listing_limit: row.monthlyListingLimit, first_listings_reviewed: row.firstListingsReviewed, min_photos: row.minPhotos, max_photos: row.maxPhotos };
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
export class AdminClassifiedsController {
  constructor(
    private readonly admin: ClassifiedsAdminService,
    private readonly moderation: ModerationService,
    private readonly conversations: ConversationsService,
  ) {}

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
  async reject(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    await this.moderation.reject(adminId(caller), id, body.reason);
    return this.admin.get(id);
  }

  @Post('listings/:id/remove')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  async remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    await this.moderation.remove(adminId(caller), id, body.reason);
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
    return this.admin.setCategory(adminId(caller), id, body.enabled);
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
  @IsOptional() @IsIn(['requested', 'declined', 'lapsed', 'awaiting_payment', 'cancelled', 'paid', 'sent', 'disputed', 'released', 'refunded', 'partly_refunded'])
  status?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;

  /** An order number (SP-100001) or a buyer's or seller's email. */
  @IsOptional() @IsString() @Length(1, 100)
  q?: string;

  /** Sellers' payouts waiting for finance (`pending`), or decided. */
  @IsOptional() @IsIn(['pending', 'approved', 'rejected'])
  payout_review?: string;

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

/** Admin Classifieds: Safe pay orders, disputes and their decisions, and Safe pay settings per country. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/classifieds')
export class AdminSafePayController {
  constructor(
    private readonly safePay: SafePayService,
    private readonly resale: ResaleService,
  ) {}

  @Get('orders')
  orders(@Query() query: AdminOrdersDto) {
    return this.safePay.adminList(query);
  }

  @Get('orders/:id')
  order(@Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.adminGet(id);
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

  /** A seller's Safe pay strikes and whether they can take orders. */
  @Get('sellers/:customer/safe-pay')
  standing(@Param('customer', ParseUUIDPipe) customer: string) {
    return this.safePay.sellerStanding(customer);
  }

  /** Lifts a seller's Safe pay limit (strikes so far no longer count). */
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
