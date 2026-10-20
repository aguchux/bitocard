import { Body, Controller, Get, Header, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Matches, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, Roles, Scopes, SessionOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { clientHeader, signedClientIp } from '../common/rate-limit/client-ip.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { StoreHomeService } from './store-home.service.js';
import { maxTrafficDays, StoreVisitsService } from './store-visits.service.js';
import { templateKeys } from './templates.js';
import { StoresService } from './stores.service.js';
import { PlanAccessService } from '../plans/plan-access.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const hex = /^#[0-9a-fA-F]{6}$/;

class ResellerProfileDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional() @Transform(trim) @IsString() @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({ description: 'Business country, if not yet set. Cannot be changed afterwards.', example: 'NG' })
  @IsOptional() @Transform(trim) @Matches(/^[A-Za-z]{2}$/, { message: 'country must be a 2-letter country code' })
  country?: string;
}

class StoreFieldsDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 60, example: 'Ada Digital' })
  @IsOptional() @Transform(trim) @IsString() @Length(2, 60)
  name?: string;

  @ApiPropertyOptional({ description: 'The store address: <subdomain>.bitocard.com.', example: 'adadigital' })
  @IsOptional() @Transform(lower) @IsString() @Length(3, 30)
  subdomain?: string;

  @ApiPropertyOptional({ description: 'HTTPS URL of the logo, or null to remove it.', nullable: true })
  @IsOptional() @ValidateIf((_dto, value) => value !== null) @IsUrl({ protocols: ['https'], require_protocol: true })
  logo_url?: string | null;

  @ApiPropertyOptional({ example: '#070f4c' })
  @IsOptional() @Matches(hex, { message: 'primary_color must be a hex colour like #070f4c' })
  primary_color?: string;

  @ApiPropertyOptional({ example: '#ff2382' })
  @IsOptional() @Matches(hex, { message: 'accent_color must be a hex colour like #ff2382' })
  accent_color?: string;

  @ApiPropertyOptional({ enum: ['test', 'live'], description: 'Customer checkout: `test` (sandbox) or `live` (real payments; needs a verified business).' })
  @IsOptional() @IsIn(['test', 'live'])
  checkout_mode?: 'test' | 'live';

  @ApiPropertyOptional({ enum: ['rail', 'bottom'], nullable: true, description: 'Your customers’ account app menu on desktop: a side `rail` or the `bottom` bar; null follows BitoCard’s default. Phones and tablets always use the bottom bar.' })
  @IsOptional() @ValidateIf((_dto, value) => value !== null) @IsIn(['rail', 'bottom'])
  desktop_nav?: 'rail' | 'bottom' | null;

  @ApiPropertyOptional({ description: 'Ask your store’s customers for the identity check where BitoCard’s market rules require one (`true`, the default), or never (`false`: you take responsibility for knowing your customers). You can also turn it off for one customer in SHQ.' })
  @IsOptional() @IsBoolean()
  customer_verification?: boolean;

  @ApiPropertyOptional({ description: 'The store template: what the store sells and the sections its editor offers (`GET /v1/store-templates`). Changing it starts the home page again from the new template’s design.', enum: templateKeys })
  @IsOptional() @IsIn(templateKeys)
  template?: string;

  @ApiPropertyOptional({ description: 'The template’s design variant; default its first. Keeps the home page.', example: 'classic' })
  @IsOptional() @IsString() @Length(2, 40)
  variant?: string;

  @ApiPropertyOptional({ description: 'The variant’s colour theme; default its first. Sets the store’s primary and accent colours unless you send your own.', example: 'navy_pink' })
  @IsOptional() @IsString() @Length(2, 40)
  theme?: string;

  @ApiPropertyOptional({ description: 'Single product stores: the product key it sells (one you have listed).', example: 'esim:WW:global:10gb-30d' })
  @IsOptional() @ValidateIf((_object, value) => value !== null) @IsString() @Length(3, 200)
  focus?: string | null;
}

class CreateStoreDto extends StoreFieldsDto {
  @ApiProperty({ minLength: 2, maxLength: 60, example: 'Ada Digital' })
  @Transform(trim) @IsString() @Length(2, 60)
  declare name: string;

  @ApiProperty({ description: 'The store address: <subdomain>.bitocard.com.', example: 'adadigital' })
  @Transform(lower) @IsString() @Length(3, 30)
  declare subdomain: string;
}

class StoreHomeDraftDto {
  @ApiProperty({ description: 'The page’s sections in order (see the store home page).', type: 'array', items: { type: 'object' } })
  @IsArray()
  sections!: unknown[];
}

class StoreHomeRestoreDto {
  @ApiProperty({ description: 'The published version to copy into the draft.', example: 3 })
  @IsInt() @Min(1)
  version!: number;
}

class AdminStoreStatusDto {
  @IsIn(['suspended', 'draft'])
  status: 'suspended' | 'draft';
}

function resellerOf(caller: Caller) {
  if (!caller.resellerId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Choose a reseller account first.');
  return caller.resellerId;
}

@ApiTags('Account')
@Controller('reseller')
export class ResellerController {
  constructor(private readonly stores: StoresService) {}

  @ApiOperation({ summary: 'Update business details', description: 'The business name, and the country if it is not yet set.' })
  @SessionOnly()
  @Roles('admin')
  @Patch()
  update(@CurrentCaller() caller: Caller, @Body() body: ResellerProfileDto) {
    if (caller.kind !== 'session') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Sign in to change business details.');
    return this.stores.updateReseller(resellerOf(caller), body);
  }
}

/** Hosted storefronts. Usable from the dashboard (owners and admins) or with an API key holding stores:manage. */
@ApiTags('Stores')
@ApiBearerAuth()
@Roles('admin')
@Scopes('stores:manage')
@Controller('stores')
export class StoresController {
  constructor(
    private readonly stores: StoresService,
    private readonly visits: StoreVisitsService,
    private readonly home: StoreHomeService,
    private readonly planAccess: PlanAccessService,
  ) {}

  @ApiOperation({ summary: 'Get a store’s home page editor', description: 'The draft (else what is published, else the design’s starting page), what is published, and the sections the store’s template offers.' })
  @Get(':id/home')
  @SessionOnly()
  getHome(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.home.get(resellerOf(caller), id);
  }

  @ApiOperation({ summary: 'Save a store’s home page draft', description: 'Validated against the store’s template; shoppers see nothing until it is published.' })
  @Put(':id/home/draft')
  @SessionOnly()
  saveHome(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: StoreHomeDraftDto) {
    return this.home.saveDraft(resellerOf(caller), id, body.sections);
  }

  @ApiOperation({ summary: 'Publish a store’s home page', description: 'The draft becomes the next version; the store shows it within a minute.' })
  @Post(':id/home/publish')
  @HttpCode(HttpStatus.OK)
  @SessionOnly()
  publishHome(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.home.publish(resellerOf(caller), id, caller.kind === 'session' ? caller.userId : null);
  }

  @ApiOperation({ summary: 'Start a store’s home page again', description: 'The draft becomes the design’s starting page; what is published stays until the next publish.' })
  @Post(':id/home/reset')
  @HttpCode(HttpStatus.OK)
  @SessionOnly()
  resetHome(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.home.reset(resellerOf(caller), id);
  }

  @ApiOperation({ summary: 'List a store’s published home page versions' })
  @Get(':id/home/versions')
  @SessionOnly()
  homeVersions(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.home.versions(resellerOf(caller), id);
  }

  @ApiOperation({ summary: 'Restore a published version into the draft' })
  @Post(':id/home/restore')
  @HttpCode(HttpStatus.OK)
  @SessionOnly()
  restoreHome(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: StoreHomeRestoreDto) {
    return this.home.restore(resellerOf(caller), id, body.version);
  }

  @ApiOperation({ summary: 'Preview a store’s home page draft', description: 'A link to the draft on the store’s own address, valid 30 minutes.' })
  @Post(':id/home/preview')
  @HttpCode(HttpStatus.OK)
  @SessionOnly()
  previewHome(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.home.preview(resellerOf(caller), id);
  }

  @ApiOperation({ summary: 'Check whether a store address is free' })
  @Get('subdomains/:subdomain')
  availability(@Param('subdomain') subdomain: string) {
    return this.stores.availability(subdomain);
  }

  @ApiOperation({ summary: 'Create a store', description: 'Starts as a draft on <subdomain>.bitocard.com. One store per reseller for now.' })
  @Post()
  create(@CurrentCaller() caller: Caller, @Body() body: CreateStoreDto) {
    return this.stores.create(resellerOf(caller), body);
  }

  @ApiOperation({ summary: 'List stores' })
  @Get()
  list(@CurrentCaller() caller: Caller) {
    return this.stores.list(resellerOf(caller));
  }

  @ApiOperation({ summary: 'Update a store', description: 'Name and branding any time; the address only while it is a draft.' })
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: StoreFieldsDto) {
    return this.stores.update(resellerOf(caller), id, body);
  }

  @ApiOperation({ summary: 'Publish a store', description: 'Needs a confirmed owner email. Paid checkout also needs funding and verification.' })
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.publish(resellerOf(caller), id);
  }

  @ApiOperation({
    summary: 'Store traffic',
    description: 'Page views and visitors of the store per address (its bitocard.com address and its own domains) and per day, counted without cookies. Needs a plan with store traffic (`plan_feature_required` otherwise).',
  })
  @ApiQuery({ name: 'days', required: false, description: `How many days back, today included (1 to ${maxTrafficDays}; default 30).` })
  @Get(':id/traffic')
  async traffic(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Query('days') days?: string) {
    const store = await this.stores.get(resellerOf(caller), id);
    await this.planAccess.requireForStore(store.id, 'store_traffic');
    return this.visits.traffic(store.id, Number(days ?? 30));
  }

  @ApiOperation({ summary: 'Unpublish a store' })
  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.unpublish(resellerOf(caller), id);
  }
}

/** The store templates: what each sells, its design variants and colour themes, and whether it is open to you. */
@ApiTags('Stores')
@ApiBearerAuth()
@Roles('admin')
@Scopes('stores:manage')
@Controller('store-templates')
export class StoreTemplatesController {
  constructor(private readonly stores: StoresService) {}

  @ApiOperation({ summary: 'List store templates', description: 'Every template with its design variants and their colour themes; `available` says whether you can use it now, and `reason` why not.' })
  @Get()
  list(@CurrentCaller() caller: Caller) {
    return this.stores.templates(resellerOf(caller));
  }
}

/** Public: the storefront app resolves a subdomain to the store it should render. */
@ApiTags('Stores')
@Public()
@Controller('storefronts')
export class StorefrontsController {
  constructor(private readonly stores: StoresService) {}

  @ApiOperation({ summary: 'Look up a published store by subdomain' })
  @Get(':subdomain')
  @Header('Cache-Control', 'public, max-age=60')
  storefront(@Param('subdomain') subdomain: string) {
    return this.stores.storefront(subdomain);
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'support')
@Controller('admin/stores')
export class AdminStoresController {
  constructor(private readonly stores: StoresService) {}

  @Patch(':id')
  setStatus(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AdminStoreStatusDto) {
    return this.stores.adminSetStatus(adminId(caller), id, body.status);
  }
}

class VisitDto {
  @IsString() @Length(3, 260)
  host!: string;

  @IsOptional() @IsString() @Length(0, 512)
  user_agent?: string;
}

/**
 * The storefront's server counts a page view of a reseller store (`proxy.ts`). Only with its signed shopper address
 * (`BitoCard-Client`, keyed with STORE_SERVER_SECRET): anything else is accepted and ignored, so it cannot be used to
 * inflate a store's numbers.
 */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('store/visits')
export class StoreVisitsController {
  constructor(
    private readonly visits: StoreVisitsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async record(@Req() req: Request, @Body() body: VisitDto) {
    const ip = signedClientIp(req.get(clientHeader), this.config.STORE_SERVER_SECRET);
    if (ip) await this.visits.record({ host: body.host, ip, userAgent: body.user_agent ?? '' });
  }
}
