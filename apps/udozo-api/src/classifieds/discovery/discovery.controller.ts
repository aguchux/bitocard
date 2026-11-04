import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow, ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { AdminRoles, Public, RealmOnly } from '../../auth/caller.js';
import { SkipIdempotency } from '../../common/idempotency/idempotency.interceptor.js';
import { CurrentCustomer, type CustomerCaller, customerFor, CustomerGuard } from '../../customers/customer-session.js';
import { CustomersService } from '../../customers/customers.service.js';
import { ProductOnly } from '../../products/product.js';
import { invalid } from '../rules.js';
import { DiscoveryAdminService } from './discovery-admin.service.js';
import { DiscoveryService } from './discovery.service.js';
import { type Asker, DiscoveryRecorder } from './recorder.service.js';
import { type BrowserEventKind, browserEventKinds, type PersonalRowKind, personalRowKinds, visitorHeader, visitorIdPattern } from './rules.js';

const countryCode = /^[A-Za-z]{2}$/;

class EventDto {
  @IsIn(browserEventKinds) kind: BrowserEventKind;
  @IsOptional() @IsInt() @Min(1) listing?: number;
  @IsOptional() @IsString() @MaxLength(100) query?: string;
  /** Checked key by key by the recorder (strings, or lists of strings). */
  @IsOptional() @Allow() filters?: unknown;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) results?: number;
  @IsOptional() @IsString() @MaxLength(20) sort?: string;
  @IsOptional() @IsString() @MaxLength(40) source?: string;
  @IsOptional() @IsInt() @Min(0) @Max(500) position?: number;
  @IsOptional() @IsInt() @Min(0) @Max(600) seconds?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) photos?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) depth?: number;
  @IsOptional() @IsISO8601() at?: string;
}

class EventsDto {
  @IsString() @Matches(countryCode, { message: 'Use a country code such as NG.' }) country: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,40}$/, { message: 'Send the visit’s id.' }) session: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => EventDto) events: EventDto[];
}

class ForYouQueryDto {
  @IsString() @Matches(countryCode) country: string;
  /** Comma separated: for_you, recent, searched, price_drops (default all four). */
  @IsOptional() @IsString() @MaxLength(60) kinds?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) limit?: number;
}

class LimitDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) limit?: number;
}

class CountryQueryDto {
  @IsString() @Matches(countryCode) country: string;
}

class SearchQueryDto {
  @IsString() @MaxLength(200) q: string;
}

class PersonalisationDto {
  @IsBoolean() enabled: boolean;
}

class MergeDto {
  @IsString() @Matches(visitorIdPattern, { message: 'Send the visitor id.' }) visitor: string;
}

class SummaryQueryDto {
  @IsOptional() @IsString() @Matches(countryCode) country?: string;
  @IsOptional() @Type(() => Number) @IsIn([7, 30, 90]) days?: number;
}

/**
 * udozo.com's personalised discovery (docs/UDOZO_PERSONALISATION_PLAN.md): what a visit records, the rows chosen for the
 * person, their history and searches. The person is their customer session, else (only after Accept all) the visitor ID
 * udozo.com's server sends in `Udozo-Visitor`; never anyone else.
 */
@ApiExcludeController()
@Public()
@Controller('classifieds')
@ProductOnly('udozo')
export class DiscoveryController {
  constructor(
    private readonly recorder: DiscoveryRecorder,
    private readonly discovery: DiscoveryService,
    private readonly customers: CustomersService,
  ) {}

  private async asker(req: Request): Promise<Asker> {
    const session = await customerFor(this.customers, req).catch(() => null);
    const visitor = req.get(visitorHeader) ?? null;
    return { customer: session ? session.customer : null, visitorId: visitor && visitorIdPattern.test(visitor) ? visitor : null };
  }

  /** What the page saw and did (udozo.com's `/api/events`): always 204, kept or not. */
  @Post('events')
  @SkipIdempotency()
  @HttpCode(HttpStatus.NO_CONTENT)
  async events(@Body() body: EventsDto, @Req() req: Request) {
    await this.recorder.recordBatch(body, await this.asker(req), req.get('user-agent') ?? '');
  }

  @Get('for-you')
  async forYou(@Query() query: ForYouQueryDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const kinds = query.kinds ? query.kinds.split(',').map(kind => kind.trim()) : [...personalRowKinds];
    for (const kind of kinds) if (!(personalRowKinds as readonly string[]).includes(kind)) throw invalid('parameter_invalid', 'Rows are for_you, recent, searched and price_drops.', 'kinds');
    return this.discovery.forYou(query.country, await this.asker(req), [...new Set(kinds)] as PersonalRowKind[], query.limit ?? 12);
  }

  @Get('listings/:ref/also-viewed')
  async alsoViewed(@Param('ref', ParseIntPipe) ref: number, @Query() query: LimitDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return this.discovery.alsoViewed(ref, query.limit ?? 8);
  }

  @Get('history')
  async history(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.discovery.history(await this.asker(req));
  }

  @Delete('history')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@Req() req: Request) {
    await this.discovery.clear(await this.asker(req));
  }

  @Delete('history/listings/:ref')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeListing(@Param('ref', ParseIntPipe) ref: number, @Req() req: Request) {
    await this.discovery.removeListing(await this.asker(req), ref);
  }

  @Delete('history/searches')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSearch(@Query() query: SearchQueryDto, @Req() req: Request) {
    await this.discovery.removeSearch(await this.asker(req), query.q);
  }

  @Get('search/recent')
  async recent(@Query() query: CountryQueryDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.discovery.recentSearches(query.country, await this.asker(req));
  }

  @Get('search/popular')
  async popular(@Query() query: CountryQueryDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=600');
    return this.discovery.popularSearches(query.country);
  }
}

/** The signed-in customer's own choices: Personalise what I see, and folding a visit's history into the account. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
@ProductOnly('udozo')
export class DiscoveryAccountController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Put('me/personalisation')
  personalisation(@CurrentCustomer() session: CustomerCaller, @Body() body: PersonalisationDto) {
    return this.discovery.setPersonalisation(session.customer.id, body.enabled);
  }

  @Post('history/merge')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  merge(@CurrentCustomer() session: CustomerCaller, @Body() body: MergeDto) {
    return this.discovery.merge(session.customer, body.visitor);
  }
}

/** Admins: Reports > Discovery. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/classifieds/discovery')
@ProductOnly('udozo')
export class AdminDiscoveryController {
  constructor(private readonly reports: DiscoveryAdminService) {}

  @AdminRoles('operations', 'support')
  @Get()
  summary(@Query() query: SummaryQueryDto) {
    return this.reports.summary(query);
  }
}
