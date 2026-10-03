import { Body, Controller, Get, HttpStatus, Param, Patch, type PipeTransform, Post, Put } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import type { ProductCategory } from '../generated/prisma/client.js';
import { CountriesService, presentCountry, presentCountryAdmin, productCategories } from './countries.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class CreateCountryDto {
  @Transform(upper)
  @Matches(/^[A-Z]{2}$/, { message: 'code must be a 2-letter country code' })
  code: string;

  @IsString()
  @Length(2, 80)
  name: string;

  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter currency code' })
  currency: string;

  @IsInt()
  @Min(0)
  min_withdrawal_minor: number;
}

class UpdateCountryDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsBoolean() reseller_signup?: boolean;
  @IsOptional() @IsBoolean() reserved_accounts?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(500) markup_cap_percent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) payout_hold_days?: number;
  @IsOptional() @IsInt() @Min(0) min_withdrawal_minor?: number;
}

class UpdateCategoryDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() customer_verification?: boolean;
  /** BitoCard collects tax on this category here; set only after tax advice. */
  @IsOptional() @IsBoolean() taxable?: boolean;
}

/** The signed-in admin, for the audit log. */
export function adminId(caller: Caller) {
  return caller.kind === 'session' ? caller.userId : null;
}

export class ParseCategoryPipe implements PipeTransform<string, ProductCategory> {
  transform(value: string) {
    if (!(productCategories as string[]).includes(value)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `category must be one of: ${productCategories.join(', ')}`, 'category');
    }
    return value as ProductCategory;
  }
}

/** Markets open to resellers. Public, so sign-up forms and storefronts can show them. */
@ApiTags('Countries')
@Public()
@Controller('countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @ApiOperation({ summary: 'List countries open to resellers', description: 'Each with its currency and the product categories sold there.' })
  @Get()
  async list() {
    return { object: 'list' as const, data: (await this.countries.list(true)).map(presentCountry) };
  }

  @ApiOperation({ summary: 'Retrieve a country' })
  @Get(':code')
  async get(@Param('code') code: string) {
    return presentCountry(await this.countries.get(code));
  }
}

/** Admin: manage markets. Every change is recorded in the audit log. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations')
@Controller('admin/countries')
export class AdminCountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  async list() {
    return { object: 'list' as const, data: (await this.countries.list(false)).map(presentCountryAdmin) };
  }

  @Post()
  async create(@CurrentCaller() caller: Caller, @Body() body: CreateCountryDto) {
    return presentCountryAdmin(await this.countries.create(adminId(caller), body));
  }

  @Patch(':code')
  async update(@CurrentCaller() caller: Caller, @Param('code') code: string, @Body() body: UpdateCountryDto) {
    return presentCountryAdmin(await this.countries.update(adminId(caller), code, body));
  }

  @Put(':code/categories/:category')
  async updateCategory(
    @CurrentCaller() caller: Caller,
    @Param('code') code: string,
    @Param('category', new ParseCategoryPipe()) category: ProductCategory,
    @Body() body: UpdateCategoryDto,
  ) {
    return presentCountryAdmin(await this.countries.updateCategory(adminId(caller), code, category, body));
  }
}
