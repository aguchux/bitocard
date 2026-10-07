import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { AuditService } from '../audit/audit.service.js';
import { adminId } from '../countries/countries.controller.js';
import { productCategories } from '../countries/countries.service.js';
import type { LedgerMode, ProductCategory } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { PricingService } from './pricing.service.js';
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
  @ApiProperty({ enum: productCategories })
  @IsIn(productCategories)
  category: ProductCategory;

  @ApiPropertyOptional({ description: 'Set for one product; leave out for the whole category.' })
  @IsOptional() @IsUUID()
  product_id?: string;

  @ApiProperty({ description: 'Markup over wholesale price in basis points (1500 = 15%). At most the Markup Protection Scheme cap.', example: 1500 })
  @IsInt() @Min(0) @Max(10_000)
  markup_bps: number;
}

class RemoveMarkupDto {
  @ApiProperty({ enum: productCategories })
  @IsIn(productCategories)
  category: ProductCategory;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  product_id?: string;
}

class PricingRuleDto {
  @IsOptional() @IsIn(productCategories)
  category?: ProductCategory;

  @IsOptional() @Matches(/^[A-Za-z]{2}$/)
  country?: string;

  @IsOptional() @IsUUID()
  product_id?: string;

  @IsInt() @Min(0) @Max(5000)
  margin_bps: number;

  @IsOptional() @IsInt() @Min(0) @Max(3000)
  reseller_discount_bps?: number;
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
  @ApiOperation({ summary: 'Get your pricing', description: 'How you earn on face-value products, the markup cap, and your markups (with the product name for product markups).' })
  @Scopes('catalogue:read')
  @Get()
  get(@CurrentCaller() caller: Caller) {
    return this.pricing.pricingSettings(resellerOf(caller));
  }

  @ApiOperation({ summary: 'Set a markup', description: 'For a whole category, or one product (which overrides its category). Capped by the Markup Protection Scheme.' })
  @Roles('admin')
  @Scopes('stores:manage')
  @Put('markups')
  setMarkup(@CurrentCaller() caller: Caller, @Body() body: MarkupDto) {
    return this.pricing.setMarkup(resellerOf(caller), body);
  }

  @ApiOperation({ summary: 'Remove a markup' })
  @Roles('admin')
  @Scopes('stores:manage')
  @Delete('markups')
  removeMarkup(@CurrentCaller() caller: Caller, @Query() query: RemoveMarkupDto) {
    return this.pricing.removeMarkup(resellerOf(caller), query.category, query.product_id ?? null);
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/pricing-rules')
export class AdminPricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  @AdminRoles('finance', 'operations')
  @Get()
  list() {
    return this.pricing.listRules();
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
