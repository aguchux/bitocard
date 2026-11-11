import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { type PlanChange, PosAdminService, posAppPlatforms, type PosAppPlatform } from './pos-admin.service.js';
import { PosCatalogueService } from './catalogue.service.js';
import { maxSaleLines, maxSalePayments, posPaymentMethods, stockAdjustments } from './sale-rules.js';
import { PosSalesService } from './sales.service.js';
import { posPlanCodes } from './plans.js';
import { PosService } from './pos.service.js';
import { posShopKindCodes, presentShopKind } from './shop-kinds.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class ShopDto {
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @IsString() @MaxLength(30)
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(40)
  tin?: string | null;

  /** VAT added to sales, in basis points (750 is 7.5%). */
  @IsOptional() @IsInt() @Min(0) @Max(5000)
  vat_bps?: number;

  @IsOptional() @IsString() @MaxLength(300)
  receipt_footer?: string | null;

  /** What kind of shop it is (`GET /v1/pos/shop-kinds`): the till leads with its categories. */
  @IsOptional() @IsIn(posShopKindCodes)
  kind?: string;
}

class SignupDto {
  @IsIn(posPlanCodes)
  plan: string;

  @IsObject() @ValidateNested() @Type(() => ShopDto)
  shop: ShopDto;

  /** What the owner saw due today, in minor units: a different amount is refused (`price_changed`). */
  @IsOptional() @IsInt() @Min(0)
  expected_amount?: number;
}

class PlanDto {
  @IsIn(posPlanCodes)
  plan: string;

  @IsOptional() @IsInt() @Min(0)
  expected_amount?: number;
}

class TillDto {
  @IsOptional() @IsString() @MaxLength(60)
  name?: string;

  @IsOptional() @IsIn([58, 80])
  printer_width?: 58 | 80;

  @IsOptional() @IsBoolean()
  auto_print?: boolean;
}

class CatalogueDto {
  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @IsUUID()
  category?: string;

  @IsOptional() @IsString() @MaxLength(60)
  barcode?: string;

  @IsOptional() @IsIn(['all', 'sellable', 'low_stock', 'out_of_stock', 'blocked'])
  show?: 'all' | 'sellable' | 'low_stock' | 'out_of_stock' | 'blocked';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class SaleLineDto {
  @IsUUID()
  listing_id: string;

  @IsInt() @Min(1) @Max(10000)
  quantity: number;

  /** Off this line, in minor units. */
  @IsOptional() @IsInt() @Min(0)
  discount?: number;
}

class SalePaymentDto {
  @IsIn(posPaymentMethods)
  method: (typeof posPaymentMethods)[number];

  @IsInt() @Min(1)
  amount: number;

  /** Cash handed over (its part and the change). */
  @IsOptional() @IsInt() @Min(1)
  tendered?: number | null;

  /** A transfer's or card slip's reference. */
  @IsOptional() @IsString() @MaxLength(80)
  reference?: string | null;
}

class SaleDto {
  @IsUUID()
  till_id: string;

  /** Made by the till for this sale, so sending it twice is one sale. */
  @IsUUID()
  client_sale_id: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(maxSaleLines) @ValidateNested({ each: true }) @Type(() => SaleLineDto)
  lines: SaleLineDto[];

  /** Off the whole sale, in minor units. */
  @IsOptional() @IsInt() @Min(0)
  discount?: number;

  @IsArray() @ArrayMaxSize(maxSalePayments) @ValidateNested({ each: true }) @Type(() => SalePaymentDto)
  payments: SalePaymentDto[];

  @IsInt() @Min(0)
  expected_total: number;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;

  @IsOptional() @IsDateString()
  client_created_at?: string;
}

class SalesDto {
  @IsOptional() @IsUUID()
  shop?: string;

  @IsOptional() @IsUUID()
  till?: string;

  @IsOptional() @IsIn(['completed', 'refunded'])
  status?: 'completed' | 'refunded';

  @IsOptional() @IsString() @MaxLength(20)
  q?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class RefundDto {
  @IsString() @MaxLength(300)
  reason: string;

  /** Put the units back on the shelf (the default). */
  @IsOptional() @IsBoolean()
  restock?: boolean;
}

class StockDto {
  @IsIn(stockAdjustments)
  kind: (typeof stockAdjustments)[number];

  /** Added (restock), taken off (damage), or what is on the shelf (count). */
  @IsInt() @Min(0)
  quantity: number;

  @IsOptional() @IsString() @MaxLength(200)
  note?: string | null;

  @IsOptional() @IsUUID()
  shop_id?: string | null;
}

class CountryDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/)
  country?: string;
}

class AccountsDto extends CountryDto {
  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @IsIn(posPlanCodes)
  plan?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000)
  offset?: number;
}

class PlanChangeDto {
  @IsOptional() @IsString() @MaxLength(40)
  name?: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  /** { "NGN": 1500000 } in minor units; null removes a currency's price. */
  @IsOptional() @IsObject()
  prices?: Record<string, number | null>;

  /** { "tills": 3 }; null is unlimited. */
  @IsOptional() @IsObject()
  limits?: Record<string, number | null>;

  @IsOptional() @IsInt() @Min(0) @Max(90)
  trial_days?: number;

  @IsOptional() @IsBoolean()
  shown?: boolean;
}

class AppLinkDto {
  /** The app's address in its store; null puts the button back to Coming soon. */
  @IsOptional() @IsString() @MaxLength(300)
  url: string | null;
}

/** pos.udozo.com's public pages: the plans (priced in a market's currency) and where the app buttons go. */
@ApiExcludeController()
@Public()
@Controller('pos')
@ProductOnly('udozo')
export class PublicPosController {
  constructor(
    private readonly pos: PosService,
    private readonly admin: PosAdminService,
  ) {}

  @Get('plans')
  plans(@Query() query: CountryDto) {
    return this.pos.publicPlans(query.country);
  }

  @Get('apps')
  apps() {
    return this.admin.appLinks();
  }

  /** The kinds of shop the till can be tailored to. */
  @Get('shop-kinds')
  shopKinds() {
    return { object: 'list' as const, data: posShopKindCodes.map(presentShopKind) };
  }
}

/** A shop owner's Udozo POS account, for udozo.com customers; pos.udozo.com calls these from its server. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('pos/owner')
@ProductOnly('udozo')
export class PosOwnerController {
  constructor(
    private readonly pos: PosService,
    private readonly catalogue: PosCatalogueService,
    private readonly sales: PosSalesService,
  ) {}

  @Get()
  me(@CurrentCustomer() caller: CustomerCaller) {
    return this.pos.me(caller.customer);
  }

  @Post('signup')
  signup(@CurrentCustomer() caller: CustomerCaller, @Body() body: SignupDto) {
    return this.pos.signup(caller.customer, body);
  }

  @Post('plan')
  @HttpCode(HttpStatus.OK)
  plan(@CurrentCustomer() caller: CustomerCaller, @Body() body: PlanDto) {
    return this.pos.changePlan(caller.customer, body.plan, body.expected_amount);
  }

  /** The listings ticked Sell at POS, read live, with the stock free to sell and why one cannot be sold. */
  @Get('catalogue')
  products(@CurrentCustomer() caller: CustomerCaller, @Query() query: CatalogueDto) {
    return this.catalogue.catalogue(caller.customer, query);
  }

  /** Rings up a sale at one of the owner's tills: the units come off the listings' stock, the payment is recorded. */
  @Post('sales')
  sell(@CurrentCustomer() caller: CustomerCaller, @Body() body: SaleDto) {
    return this.sales.sell(caller.customer, body);
  }

  @Get('sales')
  salesList(@CurrentCustomer() caller: CustomerCaller, @Query() query: SalesDto) {
    return this.sales.list(caller.customer, query);
  }

  @Get('sales/:id')
  sale(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(caller.customer, id);
  }

  @Post('sales/:id/refund')
  @HttpCode(HttpStatus.OK)
  refund(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RefundDto) {
    return this.sales.refund(caller.customer, id, body);
  }

  /** Restock, count or write off a product's units. */
  @Post('stock/:listing')
  @HttpCode(HttpStatus.OK)
  adjustStock(@CurrentCustomer() caller: CustomerCaller, @Param('listing', ParseUUIDPipe) listing: string, @Body() body: StockDto) {
    return this.sales.adjustStock(caller.customer, listing, body);
  }

  @Get('stock/:listing/movements')
  movements(@CurrentCustomer() caller: CustomerCaller, @Param('listing', ParseUUIDPipe) listing: string) {
    return this.sales.movements(caller.customer, listing);
  }

  @Get('charges')
  charges(@CurrentCustomer() caller: CustomerCaller) {
    return this.pos.charges(caller.customer);
  }

  @Post('shops')
  addShop(@CurrentCustomer() caller: CustomerCaller, @Body() body: ShopDto) {
    return this.pos.addShop(caller.customer, body);
  }

  @Patch('shops/:id')
  updateShop(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ShopDto) {
    return this.pos.updateShop(caller.customer, id, body);
  }

  @Post('shops/:id/tills')
  addTill(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: TillDto) {
    return this.pos.addTill(caller.customer, id, body);
  }

  @Patch('tills/:id')
  updateTill(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: TillDto) {
    return this.pos.updateTill(caller.customer, id, body);
  }

  @Delete('tills/:id')
  removeTill(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.pos.removeTill(caller.customer, id);
  }
}

/** Udozo's team: owners' accounts, the plans (finance) and the app links (operations). */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/pos')
@ProductOnly('udozo')
export class AdminPosController {
  constructor(private readonly admin: PosAdminService) {}

  @Get('accounts')
  accounts(@Query() query: AccountsDto) {
    return this.admin.accounts(query);
  }

  @Get('accounts/:id')
  account(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.account(id);
  }

  @Get('plans')
  plans() {
    return this.admin.plans();
  }

  @Patch('plans/:code')
  @AdminRoles('finance')
  @StepUp()
  updatePlan(@CurrentCaller() caller: Caller, @Param('code') code: string, @Body() body: PlanChangeDto) {
    return this.admin.updatePlan(adminId(caller), code, body as PlanChange);
  }

  @Get('apps')
  apps() {
    return this.admin.appLinks();
  }

  @Put('apps/:platform')
  @AdminRoles('operations')
  setApp(@CurrentCaller() caller: Caller, @Param('platform') platform: string, @Body() body: AppLinkDto) {
    if (!(posAppPlatforms as readonly string[]).includes(platform)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'Choose android, ios or windows.');
    return this.admin.setAppLink(adminId(caller), platform as PosAppPlatform, body.url ?? null);
  }
}
