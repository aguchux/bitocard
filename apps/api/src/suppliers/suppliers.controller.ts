import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller';
import { adminId, ParseCategoryPipe } from '../countries/countries.controller';
import { productCategories } from '../countries/countries.service';
import type { ProductCategory, SupplierStatus } from '../generated/prisma/client';
import { PageDto } from '../ledger/wallet.controller';
import { SuppliersService } from './suppliers.service';

const statuses = ['mvp_live', 'mvp_qualify', 'pilot', 'later', 'backup'] as const;
const nullable = (_dto: unknown, value: unknown) => value !== null;

class UpdateSupplierDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(statuses) status?: SupplierStatus;
  @IsOptional() @ValidateIf(nullable) @IsIn(['prepaid_wallet', 'per_order', 'credit_terms']) billing_model?: string | null;
  @IsOptional() @ValidateIf(nullable) @Matches(/^[A-Za-z]{3}$/) funding_currency?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsInt() @Min(0) min_first_deposit_minor?: number | null;
  @IsOptional() @ValidateIf(nullable) @IsInt() @Min(0) min_top_up_minor?: number | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @Length(0, 1000) fees?: string | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @Length(0, 1000) refunds?: string | null;
  @IsOptional() @IsBoolean() resale_approved?: boolean;
  @IsOptional() @ValidateIf(nullable) @IsBoolean() requires_ip_allowlist?: boolean | null;
  @IsOptional() @ValidateIf(nullable) @IsString() @Length(0, 2000) notes?: string | null;
}

class MarketDto {
  @IsBoolean() enabled: boolean;
}

class ProductFilterDto extends PageDto {
  @IsOptional() @IsIn(productCategories) category?: ProductCategory;
  @IsOptional() @Matches(/^[A-Za-z]{2}$/) country?: string;
  @IsOptional() @IsString() @Length(1, 60) q?: string;
}

class UpdateProductDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @ValidateIf(nullable) @IsString() @Length(0, 2000) description?: string | null;
}

class UpdateOfferDto {
  @IsOptional() @IsInt() @Min(0) @Max(5000) discount_bps?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) priority?: number;
  @IsOptional() @IsBoolean() available?: boolean;
}

/** Supplier registry, markets, catalogue sync and product mapping. Admin only; never in the public API description. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin')
export class AdminSuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @AdminRoles('operations', 'finance')
  @Get('suppliers')
  list() {
    return this.suppliers.list();
  }

  @AdminRoles('operations', 'finance')
  @Get('suppliers/:code')
  get(@Param('code') code: string) {
    return this.suppliers.get(code);
  }

  @AdminRoles('operations')
  @Patch('suppliers/:code')
  update(@CurrentCaller() caller: Caller, @Param('code') code: string, @Body() body: UpdateSupplierDto) {
    return this.suppliers.update(adminId(caller), code, body);
  }

  @AdminRoles('operations')
  @Put('suppliers/:code/markets/:country/:category')
  setMarket(
    @CurrentCaller() caller: Caller,
    @Param('code') code: string,
    @Param('country') country: string,
    @Param('category', new ParseCategoryPipe()) category: ProductCategory,
    @Body() body: MarketDto,
  ) {
    return this.suppliers.setMarket(adminId(caller), code, country.toUpperCase(), category, body.enabled);
  }

  @AdminRoles('operations')
  @Post('suppliers/:code/sync')
  @HttpCode(HttpStatus.OK)
  sync(@Param('code') code: string) {
    return this.suppliers.sync(code);
  }

  @AdminRoles('operations', 'finance', 'support')
  @Get('products')
  products(@Query() filter: ProductFilterDto) {
    return this.suppliers.products(filter);
  }

  @AdminRoles('operations')
  @Patch('products/:id')
  updateProduct(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProductDto) {
    return this.suppliers.updateProduct(adminId(caller), id, body);
  }

  /** Agreed commission (discount), routing priority and availability of one supplier offer. */
  @AdminRoles('finance', 'operations')
  @Patch('supplier-products/:id')
  updateOffer(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateOfferDto) {
    return this.suppliers.updateOffer(adminId(caller), id, body);
  }
}
