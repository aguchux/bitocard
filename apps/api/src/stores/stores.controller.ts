import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUrl, Length, Matches, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, Roles, Scopes } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
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
  constructor(private readonly stores: StoresService) {}

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
