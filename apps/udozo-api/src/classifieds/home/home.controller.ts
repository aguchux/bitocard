import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../../auth/caller.js';
import { SkipIdempotency } from '../../common/idempotency/idempotency.interceptor.js';
import { clientHeader, signedClientIp } from '../../common/rate-limit/client-ip.js';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { adminId } from '../../countries/countries.controller.js';
import { customerFor } from '../../customers/customer-session.js';
import { CustomersService } from '../../customers/customers.service.js';
import { ProductOnly } from '../../products/product.js';
import { HomeService } from './home.service.js';
import { homeLayoutKeys } from './layouts.js';
import { type SponsoredState, SponsoredService } from './sponsored.service.js';
import { ListingViewsService } from './views.service.js';

const page = /^(global|[A-Za-z]{2})$/;

class HomeQueryDto {
  @IsString() @Matches(page, { message: 'Use global or a country code.' }) page: string;
  @IsOptional() @IsString() @MaxLength(200) preview?: string;
}

/** udozo.com's home pages as visitors see them (public; a minute in caches) and its listings' page views. */
@ApiExcludeController()
@Public()
@Controller('classifieds')
@ProductOnly('udozo')
export class ClassifiedHomeController {
  constructor(
    private readonly home: HomeService,
    private readonly views: ListingViewsService,
    private readonly customers: CustomersService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** A home page (`global` or a country's code), filled with listings; `?preview=` shows its draft (never cached). */
  @Get('home')
  async get(@Query() query: HomeQueryDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', query.preview === undefined ? 'public, max-age=60' : 'no-store');
    return this.home.home(query.page, query.preview);
  }

  /** A listing's page was opened (udozo.com's server tells it, signing the visitor's address as for rate limits). */
  @Post('listings/:ref/view')
  @SkipIdempotency()
  @HttpCode(HttpStatus.NO_CONTENT)
  async view(@Param('ref', ParseIntPipe) ref: number, @Req() req: Request) {
    const session = await customerFor(this.customers, req).catch(() => null);
    const address = signedClientIp(req.get(clientHeader), this.config.STORE_SERVER_SECRET) ?? req.ip ?? 'unknown';
    await this.views.record(ref, { address, userAgent: req.get('user-agent') ?? '', customerId: session?.customer.id ?? null });
  }
}

/** The draft's rows; `sections` (the editor of before) are saved as rows that look the same. */
class DraftDto {
  @IsOptional() @IsArray() rows?: unknown[];
  @IsOptional() @IsArray() sections?: unknown[];
}

class ResolveDto {
  @IsOptional() @IsArray() rows?: unknown[];
}

class StoresQueryDto {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
}

class LayoutDto {
  @IsIn(homeLayoutKeys) layout: string;
  @IsOptional() @IsBoolean() replace?: boolean;
}

class RestoreDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

/** Admins: udozo.com's home pages, each with its layout and rows of blocks, drafted, previewed and published. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/classifieds/home')
@ProductOnly('udozo')
export class AdminHomeController {
  constructor(private readonly home: HomeService) {}

  @AdminRoles('operations', 'support')
  @Get()
  list() {
    return this.home.list();
  }

  @AdminRoles('operations', 'support')
  @Get(':page')
  get(@Param('page') pageId: string) {
    return this.home.get(pageId);
  }

  @AdminRoles('operations')
  @Put(':page/draft')
  saveDraft(@CurrentCaller() caller: Caller, @Param('page') pageId: string, @Body() body: DraftDto) {
    return this.home.saveDraft(adminId(caller), pageId, body);
  }

  /** The rows given (or the draft) filled as visitors would see them, for the editor's cards; nothing is saved. */
  @AdminRoles('operations', 'support')
  @SkipIdempotency()
  @Post(':page/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@Param('page') pageId: string, @Body() body: ResolveDto) {
    return this.home.resolveDraft(pageId, body);
  }

  /** Resellers' live stores to pick for a stores marquee on this page. */
  @AdminRoles('operations', 'support')
  @Get(':page/stores')
  stores(@Param('page') pageId: string, @Query() query: StoresQueryDto) {
    return this.home.stores(pageId, query.q);
  }

  @AdminRoles('operations')
  @Post(':page/layout')
  @HttpCode(HttpStatus.OK)
  layout(@CurrentCaller() caller: Caller, @Param('page') pageId: string, @Body() body: LayoutDto) {
    return this.home.setLayout(adminId(caller), pageId, body);
  }

  @AdminRoles('operations', 'support')
  @Post(':page/preview')
  @HttpCode(HttpStatus.OK)
  preview(@Param('page') pageId: string) {
    return this.home.previewToken(pageId);
  }

  @AdminRoles('operations')
  @StepUp()
  @Post(':page/publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentCaller() caller: Caller, @Param('page') pageId: string) {
    return this.home.publish(adminId(caller), pageId);
  }

  @AdminRoles('operations')
  @Post(':page/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentCaller() caller: Caller, @Param('page') pageId: string) {
    return this.home.unpublish(adminId(caller), pageId);
  }

  @AdminRoles('operations')
  @Post(':page/restore')
  @HttpCode(HttpStatus.OK)
  restore(@CurrentCaller() caller: Caller, @Param('page') pageId: string, @Body() body: RestoreDto) {
    return this.home.restore(adminId(caller), pageId, body.version);
  }

  @AdminRoles('operations')
  @Post(':page/reset')
  @HttpCode(HttpStatus.OK)
  reset(@CurrentCaller() caller: Caller, @Param('page') pageId: string) {
    return this.home.reset(adminId(caller), pageId);
  }
}

class SponsoredListDto {
  @IsOptional() @IsString() @Matches(page) country?: string;
  @IsOptional() @IsIn(['active', 'scheduled', 'ended']) state?: SponsoredState;
}

class SponsoredDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) listing_ref?: number;
  /** A country's code, or null for the page across countries. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) country?: string | null;
  @IsOptional() @IsISO8601() starts_at?: string;
  @IsOptional() @IsISO8601() ends_at?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) position?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

/** Admins: Sponsored placements on the home pages (placed by Udozo's team, always labelled Sponsored). */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/classifieds/sponsored')
@ProductOnly('udozo')
export class AdminSponsoredController {
  constructor(private readonly sponsored: SponsoredService) {}

  @AdminRoles('operations', 'support')
  @Get()
  list(@Query() query: SponsoredListDto) {
    return this.sponsored.list(query);
  }

  @AdminRoles('operations')
  @Post()
  create(@CurrentCaller() caller: Caller, @Body() body: SponsoredDto) {
    return this.sponsored.create(adminId(caller), body);
  }

  @AdminRoles('operations')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SponsoredDto) {
    return this.sponsored.update(adminId(caller), id, body);
  }

  @AdminRoles('operations')
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsored.end(adminId(caller), id);
  }
}
