import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { adminId } from '../countries/countries.controller.js';
import { productCategories } from '../countries/countries.service.js';
import type { LedgerMode, ProductCategory } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { maxMarginBps, type PriceKind, priceKinds, PricingService } from './pricing.service.js';
import { maxQuantity, QuotesService } from './quotes.service.js';

class CatalogueFilterDto extends PageDto {
  @ApiPropertyOptional({ enum: productCategories })
  @IsOptional() @IsIn(productCategories)
  category?: ProductCategory;

  @ApiPropertyOptional({ description: 'Where the product is used (the card region, or the network or biller country).', example: 'NG' })
  @IsOptional() @Matches(/^[A-Za-z]{2}$/)
  country?: string;

  @ApiPropertyOptional({ description: 'Search by name or brand.' })
  @IsOptional() @IsString() @Length(1, 60)
  q?: string;

  @ApiPropertyOptional({ description: 'Only products listed (true) or not listed (false) on your BitoCard-hosted store.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  listed?: boolean;
}

class ListingDto {
  @ApiProperty({ description: 'List (true) or unlist (false) on your BitoCard-hosted store.' })
  @IsBoolean()
  listed: boolean;

  @ApiProperty({ description: 'The products, at most 100.', type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  product_ids: string[];
}

class RecipientDto {
  @ApiPropertyOptional({ description: 'Airtime and data: the mobile number to top up.', example: '+2348031234567' })
  @IsOptional() @IsString() @Length(5, 20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Pay-TV and bills: the smartcard, IUC or meter number.' })
  @IsOptional() @IsString() @Length(4, 30)
  account_number?: string;

  @ApiPropertyOptional({ enum: ['change', 'renew'], default: 'change', description: 'Pay-TV: change to this package, or renew it as the current package.' })
  @IsOptional() @IsIn(['change', 'renew'])
  transaction_type?: 'change' | 'renew';

  @ApiPropertyOptional({
    description: 'Gift cards and software licences: your customer’s email address. Once the order is delivered, the codes or licence keys are emailed there under your store’s name, as well as being returned on the order.',
    example: 'ada@example.com',
  })
  @IsOptional() @IsEmail() @Length(3, 254)
  email?: string;
}

class CreateQuoteDto {
  @ApiProperty()
  @IsUUID()
  product_id: string;

  @ApiProperty({ description: 'Face value in minor units of the product face currency: one of its fixed values, or within its range.', example: 100000 })
  @IsInt() @Min(1)
  face_value: number;

  @ApiPropertyOptional({ minimum: 1, maximum: maxQuantity, default: 1, description: 'More than 1 for gift cards only.' })
  @IsOptional() @IsInt() @Min(1) @Max(maxQuantity)
  quantity?: number;

  @ApiPropertyOptional({ type: RecipientDto })
  @IsOptional() @ValidateNested() @Type(() => RecipientDto)
  recipient?: RecipientDto;

  @ApiPropertyOptional({ description: 'Your own reference for the customer or sale. BitoCard never needs your customers to have accounts.' })
  @IsOptional() @IsString() @Length(1, 100)
  customer_reference?: string;
}

class MarkupDto {
  @ApiPropertyOptional({ enum: productCategories, description: 'Set for a whole category; leave out (with no product) for everything.' })
  @IsOptional() @IsIn(productCategories)
  category?: ProductCategory;

  @ApiPropertyOptional({ description: 'Set for one product, which overrides its category and your general settings.' })
  @IsOptional() @IsUUID()
  product_id?: string;

  @ApiPropertyOptional({
    description: 'Markup products: your markup over BitoCard’s price in basis points (1500 = 15%), at most the Markup Protection Scheme cap (100% or lower). `null` clears it.',
    example: 1500,
    nullable: true,
  })
  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  markup_bps?: number | null;

  @ApiPropertyOptional({
    description: 'Discount products: how much of face value you give your customers, in basis points (100 = 1%). Never more than your own discount: the rest is your profit. `null` clears it.',
    example: 50,
    nullable: true,
  })
  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  customer_discount_bps?: number | null;

  @ApiPropertyOptional({
    description: 'Markup products, one product only: your customer price in minor units of your currency, instead of a markup. Never below BitoCard’s price (customers then pay BitoCard’s price). `null` clears it.',
    example: 950000,
    nullable: true,
  })
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  fixed_price?: number | null;
}

class RemoveMarkupDto {
  @ApiPropertyOptional({ enum: productCategories, description: 'The category rule to remove; leave out (with no product) for your general rule.' })
  @IsOptional() @IsIn(productCategories)
  category?: ProductCategory;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  product_id?: string;
}

class PricePreviewDto {
  @ApiPropertyOptional({ description: 'The face value to price, in minor units (default: the product’s first value).' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  face_value?: number;

  @ApiPropertyOptional({ description: 'Try a markup (basis points) without saving it, instead of any fixed price.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000)
  markup_bps?: number;

  @ApiPropertyOptional({ description: 'Try a customer discount (basis points) without saving it.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000)
  customer_discount_bps?: number;

  @ApiPropertyOptional({ description: 'Try a fixed customer price (minor units) without saving it.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  fixed_price?: number;
}

class AdminPreviewDto {
  @IsUUID()
  product_id: string;

  @Matches(/^[A-Za-z]{2}$/)
  country: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  face_value?: number;

  @IsOptional() @IsIn(priceKinds)
  kind?: PriceKind;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(maxMarginBps)
  margin_bps?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000)
  reseller_discount_bps?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  fixed_price?: number;

  @IsOptional() @Matches(/^[A-Za-z]{3}$/)
  fixed_currency?: string;
}

class PricingRuleDto {
  @IsOptional() @IsIn(productCategories)
  category?: ProductCategory;

  @IsOptional() @Matches(/^[A-Za-z]{2}$/)
  country?: string;

  @IsOptional() @Matches(/^[a-z0-9_-]{2,40}$/)
  supplier_code?: string;

  @IsOptional() @IsUUID()
  product_id?: string;

  /** discount (the default scheme), markup (on supplier cost) or fixed (a wholesale price, for a supplier's or one product's single-value items). */
  @IsOptional() @IsIn(priceKinds)
  kind?: PriceKind;

  @IsOptional() @IsInt() @Min(0) @Max(maxMarginBps)
  margin_bps?: number;

  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  reseller_discount_bps?: number;

  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  fixed_price?: number;

  @IsOptional() @Matches(/^[A-Za-z]{3}$/)
  fixed_currency?: string;
}

@ApiTags('Catalogue')
@ApiBearerAuth()
@modeHeader
@Scopes('catalogue:read')
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @ApiOperation({
    summary: 'List products',
    description:
      'Products you can sell in your country, with your wholesale cost and your price for each denomination (fixed values, or the lowest and highest of a range). Prices are in your currency; a quote locks the exact price.',
  })
  @Get('products')
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: CatalogueFilterDto) {
    return this.catalogue.list(resellerOf(caller), mode, filter);
  }

  @ApiOperation({ summary: 'Get a product' })
  @Get('products/:id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalogue.get(resellerOf(caller), mode, id);
  }

  @ApiOperation({
    summary: 'Preview your price and profit',
    description:
      'What one sale of a product earns you: BitoCard’s price, your customer’s price and your profit, under the product’s scheme. `discount` products (airtime, data, bills, gift cards…) sell at face value at most: you earn your discount from BitoCard and may give part of it to your customer (`customer_discount_bps`). `markup` products (numbers, software…) are priced up from BitoCard’s price with your markup or a fixed price. Try settings with the query (nothing is saved); save them with `PUT /v1/pricing/markups`.',
  })
  @Get('products/:id/price-preview')
  async preview(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Query() query: PricePreviewDto) {
    return this.catalogue.preview(resellerOf(caller), mode, id, query);
  }

  @ApiOperation({
    summary: 'List or unlist products on your store',
    description:
      'Chooses what your BitoCard-hosted store shows: products are shown there only once you list them. Your own systems can sell every product in your catalogue, listed or not. Only products available to you can be listed.',
  })
  @Roles('admin')
  @Scopes('stores:manage')
  @Post('listing')
  @HttpCode(HttpStatus.OK)
  setListing(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ListingDto) {
    return this.catalogue.setListing(resellerOf(caller), mode, body.product_ids, body.listed);
  }
}

@ApiTags('Quotes')
@ApiBearerAuth()
@modeHeader
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @ApiOperation({
    summary: 'Create a quote',
    description:
      'Locks the price for 10 minutes: wholesale cost, your price, tax and exchange rate. Airtime and data need the recipient phone number; pay-TV and bills need the smartcard or meter number, which is checked and returns the account name for the customer to confirm.',
  })
  @Scopes('quotes:write')
  @Post()
  create(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: CreateQuoteDto) {
    return this.quotes.create(resellerOf(caller), mode, body);
  }

  @ApiOperation({ summary: 'Get a quote' })
  @Scopes('quotes:write')
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(resellerOf(caller), mode, id);
  }
}

@ApiTags('Catalogue')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** Readable by every team member; only owners and admins change markups. */
  @ApiOperation({
    summary: 'Get your pricing',
    description: 'The markup cap and your pricing settings: general (no category), per category and per product (with the product name). Each setting holds a markup (markup products), a customer discount (discount products) or, per product, a fixed price.',
  })
  @Scopes('catalogue:read')
  @Get()
  get(@CurrentCaller() caller: Caller) {
    return this.pricing.pricingSettings(resellerOf(caller));
  }

  @ApiOperation({
    summary: 'Set your pricing',
    description:
      'For everything (no category or product), a category, or one product (the most specific wins, setting by setting). Only the fields you send change; `null` clears one. Markups are capped by the Markup Protection Scheme; a customer discount never exceeds your own discount.',
  })
  @Roles('admin')
  @Scopes('stores:manage')
  @Put('markups')
  setMarkup(@CurrentCaller() caller: Caller, @Body() body: MarkupDto) {
    return this.pricing.setMarkup(resellerOf(caller), body);
  }

  @ApiOperation({ summary: 'Remove a pricing setting', description: 'Removes your general, category or product setting; the next level up applies again.' })
  @Roles('admin')
  @Scopes('stores:manage')
  @Delete('markups')
  removeMarkup(@CurrentCaller() caller: Caller, @Query() query: RemoveMarkupDto) {
    return this.pricing.removeMarkup(resellerOf(caller), query.category ?? null, query.product_id ?? null);
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/pricing-rules')
export class AdminPricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @AdminRoles('finance', 'operations')
  @Get()
  list() {
    return this.pricing.listRules();
  }

  /** How a product sells in a market under the current rules, or under a trial product rule (nothing saved). */
  @AdminRoles('finance', 'operations')
  @Get('preview')
  async preview(@Query() query: AdminPreviewDto) {
    const product = await this.prisma.product.findUnique({ where: { id: query.product_id }, include: { supplierProducts: { include: { supplier: true } } } });
    if (!product) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such product.', 'product_id');
    return this.pricing.adminPreview(query.country, product, query.face_value === undefined ? null : BigInt(query.face_value), query.kind ? query : null);
  }

  @AdminRoles('finance')
  @Put()
  async set(@CurrentCaller() caller: Caller, @Body() body: PricingRuleDto) {
    const { before, after, presented } = await this.pricing.setRule(body);
    await this.audit.record({ actorId: adminId(caller), action: 'pricing_rule.set', targetType: 'pricing_rule', targetId: after.id, before, after });
    return presented;
  }

  @AdminRoles('finance')
  @Delete(':id')
  async remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    const removed = await this.pricing.deleteRule(id);
    await this.audit.record({ actorId: adminId(caller), action: 'pricing_rule.removed', targetType: 'pricing_rule', targetId: id, before: removed });
    return { object: 'pricing_rule' as const, id, removed: true };
  }
}
