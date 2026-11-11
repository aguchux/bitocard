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
import { PosCollectionsService } from './collections.service.js';
import { PosCustomersService } from './customers.service.js';
import { maxSaleLines, maxSalePayments, recordedPaymentMethods, stockAdjustments, tillPaymentMethods } from './sale-rules.js';
import { PosSalesService } from './sales.service.js';
import { PosWalletService, walletTokenPattern } from './wallet.service.js';
import { posPlanCodes } from './plans.js';
import { PosService } from './pos.service.js';
import { PosStaffService } from './staff.service.js';
import { posShopKindCodes, presentShopKind } from './shop-kinds.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

export class ShopDto {
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

export class TillDto {
  @IsOptional() @IsString() @MaxLength(60)
  name?: string;

  @IsOptional() @IsIn([58, 80])
  printer_width?: 58 | 80;

  @IsOptional() @IsBoolean()
  auto_print?: boolean;
}

export class CatalogueDto {
  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @IsUUID()
  category?: string;

  @IsOptional() @IsString() @MaxLength(60)
  barcode?: string;

  @IsOptional() @IsIn(['all', 'sellable', 'low_stock', 'out_of_stock', 'blocked'])
  show?: 'all' | 'sellable' | 'low_stock' | 'out_of_stock' | 'blocked';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
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
  /** `credit` is pay later: the sale's customer owes the shop that part. */
  @IsIn(tillPaymentMethods)
  method: (typeof tillPaymentMethods)[number];

  @IsInt() @Min(1)
  amount: number;

  /** Cash handed over (its part and the change). */
  @IsOptional() @IsInt() @Min(1)
  tendered?: number | null;

  /** A transfer's or card slip's reference. */
  @IsOptional() @IsString() @MaxLength(80)
  reference?: string | null;
}

export class SaleDto {
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

  /** The shop's customer the sale is made to (needed to sell on credit). */
  @IsOptional() @IsUUID()
  customer_id?: string | null;
}

export class CustomerDto {
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  /** A mobile number of the shop's country, with or without its dialling code. */
  @IsOptional() @IsString() @MaxLength(30)
  phone?: string | null;

  @IsOptional() @IsString() @MaxLength(254)
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  address?: string | null;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string | null;

  /** The most they may owe, in minor units; null for no limit. */
  @IsOptional() @IsInt() @Min(0)
  credit_limit?: number | null;
}

export class CustomersDto {
  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  @IsOptional() @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  owing?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class RepaymentDto {
  @IsInt() @Min(1)
  amount: number;

  @IsIn(recordedPaymentMethods)
  method: (typeof recordedPaymentMethods)[number];

  @IsOptional() @IsString() @MaxLength(80)
  reference?: string | null;

  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

export class WalletRequestDto extends SaleDto {
  /** The part paid from the buyer's Udozo wallet, in minor units; the rest is in `payments`. */
  @IsInt() @Min(1)
  wallet_amount: number;

  /** The buyer's Udozo mobile number (E.164): asked of them on udozo.com. Without it, a QR code anyone signed in may pay. */
  @IsOptional() @IsString() @MaxLength(20)
  phone?: string | null;
}

export class TransferRequestDto extends SaleDto {
  /** The part paid by transfer into the till's Udozo collection account, in minor units; the rest is in `payments`. */
  @IsInt() @Min(1)
  transfer_amount: number;
}

class OpenCollectionAccountDto {
  /** Nigeria, live: the owner's BVN, which the banks need to open the account (passed on, never kept). */
  @IsOptional() @Matches(/^\d{11}$/, { message: 'bvn must be 11 digits' })
  bvn?: string | null;
}

class SettlementAccountDto {
  /** One of the owner's payout bank accounts on udozo.com; null: none (collections stay in their Udozo payouts). */
  @IsOptional() @IsUUID()
  bank_account_id: string | null;
}

class SimulateTransferDto {
  @IsInt() @Min(1) @Max(1_000_000_000_00)
  amount: number;

  @IsOptional() @IsString() @MaxLength(120)
  payer_name?: string | null;
}

export class CollectionsDto {
  @IsOptional() @IsIn(['matched', 'unmatched', 'kept'])
  status?: 'matched' | 'unmatched' | 'kept';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class AttachDto {
  @IsUUID()
  transfer_request_id: string;
}

export class KeepDto {
  @IsOptional() @IsString() @MaxLength(300)
  note?: string | null;
}

class AdminCollectionsDto extends CollectionsDto {
  @IsOptional() @IsUUID()
  account?: string;
}

class HoldDto {
  @IsString() @MaxLength(300)
  reason: string;
}

class MarketSettingsDto {
  /** Udozo's margin on each transfer, on top of the gateway's fee: basis points (100 is 1%), at most 10%. */
  @IsInt() @Min(0) @Max(1000)
  collection_fee_bps: number;

  @IsInt() @Min(0)
  collection_fee_min: number;

  @IsOptional() @IsInt() @Min(0)
  collection_fee_cap: number | null;
}

class PayDto {
  /** The amount the buyer saw, in minor units. */
  @IsInt() @Min(1)
  expected_amount: number;
}

export class SalesDto {
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

export class RefundDto {
  @IsString() @MaxLength(300)
  reason: string;

  /** Put the units back on the shelf (the default). */
  @IsOptional() @IsBoolean()
  restock?: boolean;
}

export class StockDto {
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
    private readonly wallet: PosWalletService,
    private readonly customers: PosCustomersService,
    private readonly collections: PosCollectionsService,
  ) {}

  /** The owner's Udozo collection accounts: whether they may open one, where collections are paid, each till's account. */
  @Get('collections')
  collectionsOverview(@CurrentCustomer() caller: CustomerCaller) {
    return this.collections.overview(caller.customer);
  }

  @Put('collections/settlement-account')
  settlementAccount(@CurrentCustomer() caller: CustomerCaller, @Body() body: SettlementAccountDto) {
    return this.collections.setSettlementAccount(caller.customer, body.bank_account_id ?? null);
  }

  @Post('tills/:id/collection-account')
  @HttpCode(HttpStatus.OK)
  openCollectionAccount(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: OpenCollectionAccountDto) {
    return this.collections.openAccount(caller.customer, id, body);
  }

  @Post('collection-accounts/:id/close')
  @HttpCode(HttpStatus.OK)
  closeCollectionAccount(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.closeAccount(caller.customer, id);
  }

  /** The sandbox only: a made-up transfer into a collection account. */
  @Post('collection-accounts/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulateTransfer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateTransferDto) {
    return this.collections.simulate(caller.customer, id, body);
  }

  /** Transfers into the owner's collection accounts, newest first. */
  @Get('collections/transfers')
  collectionTransfers(@CurrentCustomer() caller: CustomerCaller, @Query() query: CollectionsDto) {
    return this.collections.collections(caller.customer, query);
  }

  @Post('collections/transfers/:id/attach')
  @HttpCode(HttpStatus.OK)
  attachTransfer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AttachDto) {
    return this.collections.attach(caller.customer, id, body.transfer_request_id);
  }

  @Post('collections/transfers/:id/keep')
  @HttpCode(HttpStatus.OK)
  keepTransfer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: KeepDto) {
    return this.collections.keep(caller.customer, id, body.note);
  }

  @Get('collections/settlements')
  settlements(@CurrentCustomer() caller: CustomerCaller, @Query() query: CollectionsDto) {
    return this.collections.settlementList(caller.customer, query);
  }

  @Get('collections/settlements/:id')
  settlement(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.settlement(caller.customer, id);
  }

  /** The till asks for the rest of a basket by transfer into its collection account; the transfer makes the sale. */
  @Post('transfer-requests')
  transferRequest(@CurrentCustomer() caller: CustomerCaller, @Body() body: TransferRequestDto) {
    return this.collections.ask(caller.customer, body);
  }

  @Get('transfer-requests/:id')
  transferStatus(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.request(caller.customer, id);
  }

  @Post('transfer-requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  transferCancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.collections.cancel(caller.customer, id);
  }

  /** The shop's customers: its own records, no Udozo account needed. */
  @Get('customers')
  customerList(@CurrentCustomer() caller: CustomerCaller, @Query() query: CustomersDto) {
    return this.customers.list(caller.customer, query);
  }

  @Post('customers')
  addCustomer(@CurrentCustomer() caller: CustomerCaller, @Body() body: CustomerDto) {
    return this.customers.create(caller.customer, body);
  }

  @Get('customers/:id')
  customer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(caller.customer, id);
  }

  @Patch('customers/:id')
  updateCustomer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CustomerDto) {
    return this.customers.update(caller.customer, id, body);
  }

  @Delete('customers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCustomer(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    await this.customers.remove(caller.customer, id);
  }

  /** A repayment of what a customer owes for goods sold on credit. */
  @Post('customers/:id/repayments')
  @HttpCode(HttpStatus.OK)
  repay(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RepaymentDto) {
    return this.customers.repay(caller.customer, id, body);
  }

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

  /** Asks for the Udozo wallet part of a basket: a QR code, or a request to one buyer by their mobile number. */
  @Post('wallet-requests')
  walletRequest(@CurrentCustomer() caller: CustomerCaller, @Body() body: WalletRequestDto) {
    return this.wallet.request(caller.customer, body);
  }

  @Get('wallet-requests/:id')
  walletStatus(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.status(caller.customer, id);
  }

  @Post('wallet-requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  walletCancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.cancel(caller.customer, id);
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

/** A buyer on udozo.com paying a shop's till from their Udozo wallet (the link the till's QR code or request opens). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/account/pos-payments')
@ProductOnly('udozo')
export class PosPaymentsController {
  constructor(private readonly wallet: PosWalletService) {}

  private static token(token: string) {
    if (!walletTokenPattern.test(token)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This payment request is not here any more. Ask the shop for a new one.');
    return token;
  }

  @Get(':token')
  view(@CurrentCustomer() caller: CustomerCaller, @Param('token') token: string) {
    return this.wallet.view(caller.customer, PosPaymentsController.token(token));
  }

  @Post(':token/pay')
  @HttpCode(HttpStatus.OK)
  pay(@CurrentCustomer() caller: CustomerCaller, @Param('token') token: string, @Body() body: PayDto) {
    return this.wallet.pay(caller.customer, PosPaymentsController.token(token), body.expected_amount);
  }

  @Post(':token/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentCustomer() caller: CustomerCaller, @Param('token') token: string) {
    return this.wallet.decline(caller.customer, PosPaymentsController.token(token));
  }
}

/** Udozo's team: owners' accounts, the plans (finance) and the app links (operations). */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations', 'finance')
@Controller('admin/pos')
@ProductOnly('udozo')
export class AdminPosController {
  constructor(
    private readonly admin: PosAdminService,
    private readonly customers: PosCustomersService,
    private readonly collections: PosCollectionsService,
    private readonly staff: PosStaffService,
  ) {}

  /**
   * An account's staff (role, tills, status, last active; never PINs), its own roles, its tills' linked devices and
   * the latest managers' approvals, read only.
   */
  @Get('accounts/:id/staff')
  async accountStaff(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.account(id);
    const [staff, roles, devices, approvals] = await Promise.all([this.staff.list(id), this.staff.roles(id), this.staff.devices(id), this.staff.approvals(id, 20)]);
    return { object: 'pos_account_staff' as const, staff, roles, devices: devices.data, approvals: approvals.data };
  }

  /** Transfers into every owner's collection accounts (or one account's), newest first. */
  @Get('collections')
  allCollections(@Query() query: AdminCollectionsDto) {
    return this.collections.adminCollections(query);
  }

  @Get('accounts/:id/collections')
  accountCollections(@Param('id', ParseUUIDPipe) id: string) {
    return this.collections.adminAccount(id);
  }

  /** Holds an owner's settlements (fraud, a dispute): collections keep coming in, nothing is paid out. */
  @Post('accounts/:id/settlements/hold')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('finance', 'operations')
  holdSettlements(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: HoldDto) {
    return this.collections.hold(adminId(caller), id, { held: true, reason: body.reason });
  }

  @Post('accounts/:id/settlements/release')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('finance')
  @StepUp()
  releaseSettlements(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: HoldDto) {
    return this.collections.hold(adminId(caller), id, { held: false, reason: body.reason });
  }

  /** Udozo's collection fee per market. */
  @Get('market-settings')
  marketSettings() {
    return this.collections.marketSettings();
  }

  @Put('market-settings/:country')
  @AdminRoles('finance')
  @StepUp()
  setMarketSettings(@CurrentCaller() caller: Caller, @Param('country') country: string, @Body() body: MarketSettingsDto) {
    return this.collections.setMarketSettings(adminId(caller), country.toUpperCase(), { collection_fee_bps: body.collection_fee_bps, collection_fee_min: body.collection_fee_min, collection_fee_cap: body.collection_fee_cap ?? null });
  }

  /** A shop's customers, read under its POS account. */
  @Get('accounts/:id/customers')
  accountCustomers(@Param('id', ParseUUIDPipe) id: string, @Query() query: CustomersDto) {
    return this.customers.adminList(id, query);
  }

  @Get('accounts/:id/customers/:customer')
  accountCustomer(@Param('id', ParseUUIDPipe) id: string, @Param('customer', ParseUUIDPipe) customer: string) {
    return this.customers.adminGet(id, customer);
  }

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
