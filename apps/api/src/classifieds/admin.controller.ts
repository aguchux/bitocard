import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { sendPhoto } from './chat-files.js';
import { ConversationsService } from './conversations.service.js';
import { ListingsService } from './listings.service.js';
import { ModerationService } from './moderation.service.js';
import { type ListingStatus, listingStatuses } from './rules.js';

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

const adminInclude = {
  category: { include: { parent: true } },
  area: { include: { parent: true } },
  features: { include: { feature: true } },
  media: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
  customer: { select: { id: true, name: true, email: true, createdAt: true, phoneVerifiedAt: true, classifiedSeller: true } },
  reports: { where: { status: 'open' }, select: { id: true, reason: true, details: true, createdAt: true } },
} satisfies Prisma.ClassifiedListingInclude;

/** The moderators' reads: listings with their seller (email included, admins only), flags and open reports. */
@Injectable()
export class ClassifiedsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly audit: AuditService,
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

  /** Listings waiting for review, oldest submission first. */
  async queue(country?: string) {
    const rows = await this.prisma.classifiedListing.findMany({ where: { status: 'pending_review', ...(country ? { country } : {}) }, include: adminInclude, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], take: 100 });
    const counts = await this.sellerCounts(rows.map(row => row.customerId));
    return { object: 'list' as const, data: rows.map(row => this.present(row, counts)) };
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
  queue(@Query() query: CountryQueryDto) {
    return this.admin.queue(query.country);
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
