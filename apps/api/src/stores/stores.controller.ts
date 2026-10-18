import { Body, Controller, Get, Header, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, Length, Matches, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, Roles, Scopes, SessionOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { clientHeader, signedClientIp } from '../common/rate-limit/client-ip.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { maxTrafficDays, StoreVisitsService } from './store-visits.service.js';
import { StoresService } from './stores.service.js';

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
}

class CreateStoreDto extends StoreFieldsDto {
  @ApiProperty({ minLength: 2, maxLength: 60, example: 'Ada Digital' })
  @Transform(trim) @IsString() @Length(2, 60)
  declare name: string;

  @ApiProperty({ description: 'The store address: <subdomain>.bitocard.com.', example: 'adadigital' })
  @Transform(lower) @IsString() @Length(3, 30)
  declare subdomain: string;
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
  ) {}

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
    description: 'Page views and visitors of the store per address (its bitocard.com address and its own domains) and per day, counted without cookies.',
  })
  @ApiQuery({ name: 'days', required: false, description: `How many days back, today included (1 to ${maxTrafficDays}; default 30).` })
  @Get(':id/traffic')
  async traffic(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Query('days') days?: string) {
    const store = await this.stores.get(resellerOf(caller), id);
    return this.visits.traffic(store.id, Number(days ?? 30));
  }

  @ApiOperation({ summary: 'Unpublish a store' })
  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.unpublish(resellerOf(caller), id);
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
