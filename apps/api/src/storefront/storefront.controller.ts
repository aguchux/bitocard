import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsHexColor, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId, ParseCategoryPipe } from '../countries/countries.controller.js';
import { productFeatureKeys } from '../catalogue/features.js';
import type { ProductCategory } from '../generated/prisma/client.js';
import { categoryLabels, navigationGroups } from './layout.js';
import { StorefrontAdminService } from './storefront-admin.service.js';
import { StorefrontService } from './storefront.service.js';

const categories = Object.keys(categoryLabels) as ProductCategory[];
const groups = navigationGroups.map(group => group.key);
const httpsUrl = /^https:\/\/\S+$/;
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Endpoints that only take the store. */
class StoreQueryDto {
  @ApiPropertyOptional({ description: 'A reseller’s hosted store (its subdomain): only the products that reseller listed for their store. Without it, bitocard.com.', example: 'adadigital' })
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,30}$/, { message: 'store must be a store subdomain' })
  store?: string;
}

/** Endpoints that only take the shopper’s market. */
class MarketQueryDto {
  @ApiPropertyOptional({ description: 'The shopper’s market (a 2-letter country code), or global: leaves out other countries’ local products (airtime, data, bills, pay-TV, mobile money); products usable anywhere stay.', example: 'NG' })
  @IsOptional()
  @Matches(/^([A-Za-z]{2}|global)$/, { message: 'market must be a 2-letter code or global' })
  market?: string;

  @ApiPropertyOptional({ description: 'A reseller’s hosted store (its subdomain, as in `<subdomain>.bitocard.com`): only the products that reseller listed for their store, in their country. Without it, bitocard.com.', example: 'adadigital' })
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,30}$/, { message: 'store must be a store subdomain' })
  store?: string;
}

class HomeQueryDto {
  @ApiPropertyOptional({ description: 'The shopper’s market (a 2-letter country code), or global: leaves out other countries’ local products (airtime, data, bills, pay-TV, mobile money); products usable anywhere stay.', example: 'NG' })
  @IsOptional()
  @Matches(/^([A-Za-z]{2}|global)$/, { message: 'market must be a 2-letter code or global' })
  market?: string;

  @ApiPropertyOptional({ description: 'A reseller’s hosted store (its subdomain, as in `<subdomain>.bitocard.com`): only the products that reseller listed for their store, in their country. Without it, bitocard.com.', example: 'adadigital' })
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,30}$/, { message: 'store must be a store subdomain' })
  store?: string;

  @ApiPropertyOptional({ description: 'A preview link token from the Storefront Manager: shows the draft.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preview?: string;
}

class StoreProductsQueryDto {
  @ApiPropertyOptional({ description: 'The shopper’s market (a 2-letter country code), or global: leaves out other countries’ local products (airtime, data, bills, pay-TV, mobile money); products usable anywhere stay.', example: 'NG' })
  @IsOptional()
  @Matches(/^([A-Za-z]{2}|global)$/, { message: 'market must be a 2-letter code or global' })
  market?: string;

  @ApiPropertyOptional({ description: 'A reseller’s hosted store (its subdomain, as in `<subdomain>.bitocard.com`): only the products that reseller listed for their store, in their country. Without it, bitocard.com.', example: 'adadigital' })
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,30}$/, { message: 'store must be a store subdomain' })
  store?: string;

  @ApiPropertyOptional({ enum: categories })
  @IsOptional()
  @IsIn(categories)
  category?: ProductCategory;

  @ApiPropertyOptional({ enum: groups, description: 'A menu group, for example mobile (airtime, data and numbers).' })
  @IsOptional()
  @IsIn(groups)
  group?: string;

  @ApiPropertyOptional({ description: 'ISO country code, or `global` for products usable anywhere.', example: 'US' })
  @IsOptional()
  @Transform(lower)
  @Matches(/^([a-z]{2}|global)$/, { message: 'country must be a 2-letter code or global' })
  country?: string;

  @ApiPropertyOptional({ example: 'amazon-us' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  brand?: string;

  @ApiPropertyOptional({ description: 'Brand tag, for example gaming.' })
  @IsOptional()
  @Transform(lower)
  @IsString()
  @Length(1, 40)
  tag?: string;

  @ApiPropertyOptional({ description: 'Words to match in names, brands and the companies behind them.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['popular', 'name', 'new'], default: 'popular' })
  @IsOptional()
  @IsIn(['popular', 'name', 'new'])
  sort?: 'popular' | 'name' | 'new';

  @ApiPropertyOptional({
    description: `Products that can do all of these, separated by commas: ${productFeatureKeys.join(', ')}. For example virtual numbers that receive SMS and app codes.`,
    example: 'sms_in,app_codes',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) : value))
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(productFeatureKeys, { each: true, message: `features must be from: ${productFeatureKeys.join(', ')}` })
  features?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 60, default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5000)
  offset?: number;
}

class SearchQueryDto {
  @ApiPropertyOptional({ description: 'The shopper’s market (a 2-letter country code), or global: leaves out other countries’ local products (airtime, data, bills, pay-TV, mobile money); products usable anywhere stay.', example: 'NG' })
  @IsOptional()
  @Matches(/^([A-Za-z]{2}|global)$/, { message: 'market must be a 2-letter code or global' })
  market?: string;

  @ApiPropertyOptional({ description: 'A reseller’s hosted store (its subdomain, as in `<subdomain>.bitocard.com`): only the products that reseller listed for their store, in their country. Without it, bitocard.com.', example: 'adadigital' })
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,30}$/, { message: 'store must be a store subdomain' })
  store?: string;

  @ApiProperty({ description: 'What to look for: a brand, a company, a product, a category or a country.', example: 'playstation' })
  @IsString()
  @Length(1, 100)
  q: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @Transform(lower)
  @Matches(/^([a-z]{2}|global)$/, { message: 'country must be a 2-letter code or global' })
  country?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class BrandsQueryDto {
  @ApiPropertyOptional({ description: 'The shopper’s market (a 2-letter country code), or global: leaves out other countries’ local products (airtime, data, bills, pay-TV, mobile money); products usable anywhere stay.', example: 'NG' })
  @IsOptional()
  @Matches(/^([A-Za-z]{2}|global)$/, { message: 'market must be a 2-letter code or global' })
  market?: string;

  @ApiPropertyOptional({ description: 'A reseller’s hosted store (its subdomain, as in `<subdomain>.bitocard.com`): only the products that reseller listed for their store, in their country. Without it, bitocard.com.', example: 'adadigital' })
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,30}$/, { message: 'store must be a store subdomain' })
  store?: string;

  @ApiPropertyOptional({ description: 'Only brands with this tag, for example gaming.' })
  @IsOptional()
  @Transform(lower)
  @IsString()
  @Length(1, 40)
  tag?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** The reseller store named (`store`), or null for bitocard.com. */
const storeOf = (query: { store?: string }) => (query.store && query.store !== 'bitocard' ? query.store : null);

/**
 * BitoCard's own storefront (bitocard.com) and resellers' hosted stores (`store`): the home page, the catalogue,
 * search and product pages. Public and cacheable for a minute. Shows face values; prices are quoted at checkout.
 */
@ApiTags('Storefront')
@Public()
@Controller('store')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @ApiOperation({ summary: 'Get the home page', description: 'The published layout with every section filled in, the menu and the countries on sale. Not found until published.' })
  @Get('home')
  @Header('Cache-Control', 'public, max-age=60')
  home(@Query() query: HomeQueryDto) {
    return this.storefront.inStore(storeOf(query), query.market, () => this.storefront.home(query.preview));
  }

  @ApiOperation({ summary: 'List products', description: 'Filter by category, menu group, country, brand, tag or words; sorted by popularity, name or newest.' })
  @Get('products')
  @Header('Cache-Control', 'public, max-age=60')
  products(@Query() query: StoreProductsQueryDto) {
    return this.storefront.inStore(storeOf(query), query.market, () => this.storefront.products(query));
  }

  @ApiOperation({ summary: 'Get a product', description: 'Its face values, how it is delivered, and related products.' })
  @Get('products/:key')
  @Header('Cache-Control', 'public, max-age=60')
  product(@Param('key') key: string, @Query() query: StoreQueryDto) {
    return this.storefront.inStore(storeOf(query), undefined, () => this.storefront.product(key));
  }

  @ApiOperation({ summary: 'Search everything', description: 'Products, brands and the companies behind them, categories and countries, best matches first.' })
  @Get('search')
  @Header('Cache-Control', 'public, max-age=60')
  search(@Query() query: SearchQueryDto) {
    return this.storefront.inStore(storeOf(query), query.market, () => this.storefront.search(query.q, query));
  }

  @ApiOperation({ summary: 'List categories on sale' })
  @Get('categories')
  @Header('Cache-Control', 'public, max-age=60')
  categories(@Query() query: MarketQueryDto) {
    return this.storefront.inStore(storeOf(query), query.market, () => this.storefront.categories()).then(data => ({ object: 'list' as const, data }));
  }

  @ApiOperation({ summary: 'List brands on sale' })
  @Get('brands')
  @Header('Cache-Control', 'public, max-age=60')
  brands(@Query() query: BrandsQueryDto) {
    return this.storefront.inStore(storeOf(query), query.market, () => this.storefront.brands(query)).then(data => ({ object: 'list' as const, data }));
  }

  @ApiOperation({ summary: 'Get the menu', description: 'Category groups on sale with their top brands, and the countries with products.' })
  @Get('navigation')
  @Header('Cache-Control', 'public, max-age=60')
  async navigation(@Query() query: MarketQueryDto) {
    // The countries are the whole store's, for choosing a market; the menu follows the market chosen.
    const [groups, countries] = await this.storefront.inStore(storeOf(query), query.market, () => Promise.all([this.storefront.navigation(), this.storefront.countries()]));
    return { object: 'store_navigation' as const, groups, countries };
  }
}

class DraftDto {
  @ApiProperty({ description: 'The page sections, in order (see src/storefront/layout.ts).' })
  @IsArray()
  sections: unknown[];
}

class RestoreDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}

class BrandDto {
  @IsString() @Length(1, 80) name: string;
  @IsOptional() @IsString() @MaxLength(120) company?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsString() @Matches(httpsUrl, { message: 'logo_url must be an https:// address' }) @MaxLength(1000) logo_url?: string | null;
  @IsOptional() @IsString() @Matches(httpsUrl, { message: 'image_url must be an https:// address' }) @MaxLength(1000) image_url?: string | null;
  @IsOptional() @IsHexColor() color?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) @Length(1, 40, { each: true }) tags?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) @Length(1, 60, { each: true }) aliases?: string[];
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000) sort_order?: number;
  @IsOptional() @IsBoolean() visible?: boolean;
}

class RegistryAssetsDto {
  @IsOptional() @IsString() @Matches(httpsUrl, { message: 'logo_url must be an https:// address' }) @MaxLength(1000) logo_url?: string | null;
  @IsOptional() @IsString() @Matches(httpsUrl, { message: 'card_url must be an https:// address' }) @MaxLength(1000) card_url?: string | null;
}

class CategoryPresentationDto {
  @IsOptional() @IsString() @Matches(httpsUrl, { message: 'icon_url must be an https:// address' }) @MaxLength(1000) icon_url?: string | null;
  @IsOptional() @IsString() @Matches(httpsUrl, { message: 'image_url must be an https:// address' }) @MaxLength(1000) image_url?: string | null;
}

/** Admins: the Storefront Manager (home page layout, publishing, previews, brands). */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/storefront')
export class AdminStorefrontController {
  constructor(private readonly admin: StorefrontAdminService) {}

  @AdminRoles('operations', 'support')
  @Get('home')
  get() {
    return this.admin.get();
  }

  @AdminRoles('operations')
  @Put('home/draft')
  saveDraft(@CurrentCaller() caller: Caller, @Body() body: DraftDto) {
    return this.admin.saveDraft(adminId(caller), body.sections);
  }

  @AdminRoles('operations')
  @Post('home/publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentCaller() caller: Caller) {
    return this.admin.publish(adminId(caller));
  }

  @AdminRoles('operations')
  @Post('home/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentCaller() caller: Caller) {
    return this.admin.unpublish(adminId(caller));
  }

  @AdminRoles('operations')
  @Post('home/restore')
  @HttpCode(HttpStatus.OK)
  restore(@CurrentCaller() caller: Caller, @Body() body: RestoreDto) {
    return this.admin.restore(adminId(caller), body.version);
  }

  @AdminRoles('operations')
  @Post('home/reset')
  @HttpCode(HttpStatus.OK)
  reset(@CurrentCaller() caller: Caller) {
    return this.admin.reset(adminId(caller));
  }

  @AdminRoles('operations', 'support')
  @Post('home/preview')
  @HttpCode(HttpStatus.OK)
  preview() {
    return this.admin.previewToken();
  }

  @AdminRoles('operations', 'support')
  @Get('brands')
  brands() {
    return this.admin.brands();
  }

  @AdminRoles('operations')
  @Put('brands/:slug')
  saveBrand(@CurrentCaller() caller: Caller, @Param('slug') slug: string, @Body() body: BrandDto) {
    return this.admin.saveBrand(adminId(caller), slug.trim().toLowerCase(), body);
  }

  @AdminRoles('operations', 'support')
  @Get('registry')
  registry() {
    return this.admin.registry();
  }

  @AdminRoles('operations')
  @Put('registry/:slug')
  saveRegistry(@CurrentCaller() caller: Caller, @Param('slug') slug: string, @Body() body: RegistryAssetsDto) {
    return this.admin.saveRegistryAssets(adminId(caller), slug.trim().toLowerCase(), body);
  }

  @AdminRoles('operations', 'support')
  @Get('categories')
  categories() {
    return this.admin.categories();
  }

  @AdminRoles('operations')
  @Put('categories/:category')
  saveCategory(@CurrentCaller() caller: Caller, @Param('category', new ParseCategoryPipe()) category: ProductCategory, @Body() body: CategoryPresentationDto) {
    return this.admin.saveCategory(adminId(caller), category, body);
  }
}
