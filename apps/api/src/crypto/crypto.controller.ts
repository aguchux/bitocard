import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { Request } from 'express';
import { ApiExcludeController, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { chains } from './chains/client.js';
import { CryptoDepositsService } from './chains/deposits.service.js';
import { CryptoWalletsService, presentAsset } from './crypto-wallets.service.js';
import { type AdSide, P2pService } from './p2p.service.js';
import { CryptoMarketLimitsService } from './market-limits.service.js';
import { CryptoReconciliationService } from './custody/reconciliation.service.js';
import { CryptoWithdrawalsService } from './withdrawals.service.js';
import { CustomerPayoutsService } from '../payouts/customer-payouts.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const assetCode = () => Matches(/^[A-Z0-9]{2,10}$/, { message: 'asset must be an asset code such as USDT' });
/** A crypto amount as a decimal string ("12.5"). */
export const cryptoAmount = () => Matches(/^\d{1,20}(\.\d{1,8})?$/, { message: 'amount must be a decimal number such as 12.5' });

class AssetQueryDto {
  @IsOptional() @Transform(upper) @assetCode()
  asset?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsUUID()
  starting_after?: string;
}

class TestDepositDto {
  @Transform(upper) @assetCode()
  asset: string;

  @cryptoAmount()
  amount: string;
}

class DeclarationDto {
  @IsString() @Length(1, 20)
  version: string;
}

class NicknameDto {
  @Matches(/^[A-Za-z0-9_]{3,20}$/, { message: 'nickname must be 3 to 20 letters, numbers or underscores' })
  nickname: string;
}

class MarketQueryDto {
  /** The market: a country code, or WW for the global market. Default: the customer's own country. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'market must be a country code such as NG, or WW' })
  market?: string;

  @Transform(upper) @assetCode()
  asset: string;

  /** What you want to do: buy (from sell ads) or sell (to buy ads). */
  @IsIn(['buy', 'sell'])
  side: AdSide;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional() @IsString() @MaxLength(80)
  q?: string;

  /** Only ads taking this amount (fiat minor units). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  fiat?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

/** A public market's book: the same filters as the signed-in market, without `market` (it is in the address). */
class PublicMarketQueryDto {
  @Transform(upper) @assetCode()
  asset: string;

  @IsIn(['buy', 'sell'])
  side: AdSide;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional() @IsString() @MaxLength(20)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  fiat?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class CreateAdDto {
  /** The market: a country code, or WW for the global market. Default: the customer's own country. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'market must be a country code such as NG, or WW' })
  market?: string;

  @IsIn(['buy', 'sell'])
  side: AdSide;

  @Transform(upper) @assetCode()
  asset: string;

  /** The customer's local currency, or US dollars. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency?: string;

  /** Fiat minor units per whole unit of the asset (NGN 1,650.00 per USDT is 165000). */
  @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  price: number;

  @cryptoAmount()
  amount: string;

  @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  min_fiat: number;

  @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  max_fiat: number;

  @IsOptional() @IsString() @MaxLength(500)
  terms?: string;

  /** Escrow ads (Afrippa): one to five of your saved payment methods, in the ad's currency. */
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  payment_method_ids?: string[];

  /** Escrow ads (Afrippa): minutes a buyer has to pay once an order opens: 15, 30 or 60 (default 15). */
  @IsOptional() @IsInt() @IsIn([15, 30, 60])
  payment_window?: number;
}

class UpdateAdDto {
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  price?: number;

  @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  min_fiat?: number;

  @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  max_fiat?: number;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(500)
  terms?: string | null;

  @IsOptional() @IsIn(['active', 'paused'])
  status?: 'active' | 'paused';

  /** Escrow ads (Afrippa): one to five of your saved payment methods, in the ad's currency. */
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true })
  payment_method_ids?: string[];

  /** Escrow ads (Afrippa): minutes a buyer has to pay once an order opens: 15, 30 or 60 (default 15). */
  @IsOptional() @IsInt() @IsIn([15, 30, 60])
  payment_window?: number;
}

class MyAdsQueryDto {
  @IsOptional() @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

export class DepositNetworksDto {
  @ApiProperty({ description: 'Coin code.', example: 'USDT' })
  @Transform(upper) @assetCode()
  asset: string;
}

export class DepositAddressDto extends DepositNetworksDto {
  @ApiProperty({ description: 'The network to deposit on, from the deposit networks.', example: 'ETHEREUM', enum: [...chains] })
  @Transform(upper) @IsIn([...chains])
  chain: string;
}

/** A store customer's crypto wallets: balances, deposit addresses and deposits (sandbox stores can add test crypto). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/crypto')
export class CustomerCryptoController {
  constructor(
    private readonly wallets: CryptoWalletsService,
    private readonly deposits: CryptoDepositsService,
  ) {}

  /** The crypto declaration (not a citizen or resident of the US or UK) for the current version, and whether it was made. */
  @Get('declaration')
  declaration(@CurrentCustomer() caller: CustomerCaller) {
    return this.wallets.declaration(caller.customer);
  }

  /** Makes the declaration for the version shown (needed to trade). */
  @Post('declaration')
  @HttpCode(HttpStatus.OK)
  declare(@CurrentCustomer() caller: CustomerCaller, @Body() body: DeclarationDto) {
    return this.wallets.declare(caller.customer, body.version);
  }

  /** The networks an asset can be deposited on now. */
  @Get('deposit-networks')
  depositNetworks(@CurrentCustomer() caller: CustomerCaller, @Query() query: DepositNetworksDto) {
    return this.deposits.depositNetworks(caller.customer, query.asset);
  }

  /** The customer's own deposit address for an asset on a chain (made once; showing it watches it for a week). */
  @Post('deposit-addresses')
  @HttpCode(HttpStatus.OK)
  depositAddress(@CurrentCustomer() caller: CustomerCaller, @Body() body: DepositAddressDto) {
    return this.deposits.depositAddress(caller.customer, body);
  }

  @Get('deposits')
  depositList(@CurrentCustomer() caller: CustomerCaller) {
    return this.deposits.customerDeposits(caller.customer);
  }

  @Get()
  overview(@CurrentCustomer() caller: CustomerCaller) {
    return this.wallets.overview(caller.customer);
  }

  @Get('transactions')
  transactions(@CurrentCustomer() caller: CustomerCaller, @Query() query: AssetQueryDto) {
    return this.wallets.transactions(caller.customer, query);
  }

  /** Sandbox stores only. */
  @Post('test-deposits')
  testDeposit(@CurrentCustomer() caller: CustomerCaller, @Body() body: TestDepositDto) {
    return this.wallets.testDeposit(caller.customer, body);
  }
}

export class WithdrawalAddressDto {
  @ApiProperty({ description: 'The network the address is on (`withdrawal_chains`).', example: 'ETHEREUM', enum: [...chains] })
  @Transform(upper) @IsIn([...chains])
  chain: string;

  @ApiProperty({ description: 'The address, checked with the network’s checksum.', example: '0x52908400098527886E0F7030069857D2E4169EE7' })
  @IsString() @Length(20, 100)
  address: string;

  @ApiProperty({ description: 'Your name for it.', example: 'Treasury' })
  @IsString() @Length(1, 40)
  label: string;
}

export class WithdrawalDto {
  @ApiProperty({ description: 'Coin code.', example: 'USDT' })
  @Transform(upper) @assetCode()
  asset: string;

  @ApiProperty({ description: 'The network to send on.', example: 'ETHEREUM', enum: [...chains] })
  @Transform(upper) @IsIn([...chains])
  chain: string;

  @ApiProperty({ description: 'A saved withdrawal address on that network, usable 24 hours after it was added.', format: 'uuid' })
  @IsUUID()
  address_id: string;

  @ApiProperty({ description: 'What arrives, as a decimal string; the network fee is taken on top.', example: '20' })
  @cryptoAmount()
  amount: string;

  /** Only show what it would send and cost. */
  @ApiPropertyOptional({ description: 'Only show what it would send and cost; nothing moves.' })
  @IsOptional() @IsBoolean()
  preview?: boolean;
}

export class CodeDto {
  @ApiProperty({ description: 'The 6-digit code emailed to the person who asked.', example: '482137' })
  @Matches(/^\d{6}$/, { message: 'code must be the 6 digits we emailed you' })
  code: string;
}

/** A store customer's on-chain withdrawals: saved addresses (usable after 24 hours), withdrawals confirmed by an emailed code. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/crypto')
export class CustomerWithdrawalsController {
  constructor(private readonly withdrawals: CryptoWithdrawalsService) {}

  @Get('withdrawal-networks')
  networks(@CurrentCustomer() caller: CustomerCaller, @Query() query: DepositNetworksDto) {
    return this.withdrawals.networks(caller.customer, query.asset);
  }

  @Get('withdrawal-addresses')
  addresses(@CurrentCustomer() caller: CustomerCaller) {
    return this.withdrawals.addresses(caller.customer);
  }

  @Post('withdrawal-addresses')
  addAddress(@CurrentCustomer() caller: CustomerCaller, @Body() body: WithdrawalAddressDto) {
    return this.withdrawals.addAddress(caller.customer, body);
  }

  @Delete('withdrawal-addresses/:id')
  removeAddress(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.removeAddress(caller.customer, id);
  }

  @Get('withdrawals')
  withdrawalList(@CurrentCustomer() caller: CustomerCaller) {
    return this.withdrawals.list(caller.customer);
  }

  @Get('withdrawals/:id')
  withdrawal(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.get(caller.customer, id);
  }

  /** Previews, or asks for a withdrawal (then confirmed with the emailed code). */
  @Post('withdrawals')
  withdraw(@CurrentCustomer() caller: CustomerCaller, @Body() body: WithdrawalDto) {
    return this.withdrawals.create(caller.customer, body);
  }

  @Post('withdrawals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CodeDto) {
    return this.withdrawals.confirm(caller.customer, id, body.code);
  }

  @Post('withdrawals/:id/resend-code')
  @HttpCode(HttpStatus.OK)
  resend(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.resendCode(caller.customer, id);
  }

  @Post('withdrawals/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.cancel(caller.customer, id);
  }
}

class CustomerBankAccountDto {
  @IsString() @Length(1, 20)
  bank_code: string;

  @Matches(/^\d{6,20}$/, { message: 'account_number must be the account number, digits only' })
  account_number: string;
}

class CustomerPayoutDto {
  /** Minor units of the customer's currency. */
  @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  amount: number;

  @IsUUID()
  bank_account_id: string;
}

class SimulatePayoutDto {
  @IsIn(['paid', 'failed'])
  outcome: 'paid' | 'failed';
}

/**
 * A store customer's withdrawable money (BitoCard Shop's Safe pay sales) paid out to their
 * own bank account, at `/v1/store/cash`. BitoCard's, not Afrippa's: Afrippa never pays out fiat.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/cash')
export class CustomerCashController {
  constructor(
    private readonly wallets: CryptoWalletsService,
    private readonly payouts: CustomerPayoutsService,
  ) {}

  @Get()
  async balance(@CurrentCustomer() caller: CustomerCaller) {
    return this.payouts.balance(await this.wallets.requireCashOut(caller.customer));
  }

  @Get('banks')
  async banks(@CurrentCustomer() caller: CustomerCaller) {
    return this.payouts.banks(await this.wallets.requireCashOut(caller.customer));
  }

  @Get('bank-accounts')
  async accounts(@CurrentCustomer() caller: CustomerCaller) {
    const { mode } = await this.wallets.context(caller.customer);
    return this.payouts.accounts(caller.customer.id, mode);
  }

  @Post('bank-accounts')
  async addAccount(@CurrentCustomer() caller: CustomerCaller, @Body() body: CustomerBankAccountDto) {
    return this.payouts.addAccount(await this.wallets.requireCashOut(caller.customer), body);
  }

  @Delete('bank-accounts/:id')
  async removeAccount(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    const { mode } = await this.wallets.context(caller.customer);
    return this.payouts.removeAccount(caller.customer.id, mode, id);
  }

  @Get('payouts')
  async list(@CurrentCustomer() caller: CustomerCaller) {
    const { mode } = await this.wallets.context(caller.customer);
    return this.payouts.list(caller.customer.id, mode);
  }

  @Post('payouts')
  async create(@CurrentCustomer() caller: CustomerCaller, @Body() body: CustomerPayoutDto) {
    return this.payouts.create(await this.wallets.requireCashOut(caller.customer), body);
  }

  /** Sandbox stores only. */
  @Post('payouts/:id/simulate')
  @HttpCode(HttpStatus.OK)
  async simulate(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulatePayoutDto) {
    const { mode } = await this.wallets.context(caller.customer);
    return this.payouts.simulate(caller.customer.id, mode, id, body.outcome);
  }
}

/**
 * Afrippa's public pages: the markets, each market's ads and traders' cards (`/v1/afrippa/markets`,
 * `/v1/afrippa/traders`), with no sign-in and cached for a minute. Nicknames only, never customers.
 */
@ApiExcludeController()
@Public()
@Controller('afrippa')
export class PublicCryptoController {
  constructor(private readonly p2p: P2pService) {}

  @Get('markets')
  @Header('Cache-Control', 'public, max-age=60')
  markets() {
    return this.p2p.publicMarkets();
  }

  @Get('markets/:market/ads')
  @Header('Cache-Control', 'public, max-age=60')
  ads(@Param('market') market: string, @Query() query: PublicMarketQueryDto) {
    if (!/^[A-Za-z]{2}$/.test(market)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'market_unavailable', 'This market is not open.', 'market');
    return this.p2p.publicAds(market, query);
  }

  @Get('traders/:nickname')
  @Header('Cache-Control', 'public, max-age=60')
  trader(@Param('nickname') nickname: string) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(nickname)) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such trader.');
    return this.p2p.publicTrader(nickname);
  }
}

/** The P2P market for store customers: ads, quotes and instant trades paid from BitoCard wallets. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/p2p')
export class CustomerP2pController {
  constructor(private readonly p2p: P2pService) {}

  @Get('profile')
  profile(@CurrentCustomer() caller: CustomerCaller) {
    return this.p2p.profile(caller.customer);
  }

  @Put('profile')
  setNickname(@CurrentCustomer() caller: CustomerCaller, @Body() body: NicknameDto) {
    return this.p2p.setNickname(caller.customer, body.nickname);
  }

  /** The markets the customer may trade in now: their own, the global market, and countries taking cross-border trades. */
  @Get('markets')
  markets(@CurrentCustomer() caller: CustomerCaller) {
    return this.p2p.markets(caller.customer);
  }

  @Get('market')
  market(@CurrentCustomer() caller: CustomerCaller, @Query() query: MarketQueryDto) {
    return this.p2p.market(caller.customer, query);
  }

  @Get('ads')
  myAds(@CurrentCustomer() caller: CustomerCaller, @Query() query: MyAdsQueryDto) {
    return this.p2p.myAds(caller.customer, query);
  }

  @Post('ads')
  createAd(@CurrentCustomer() caller: CustomerCaller, @Body() body: CreateAdDto) {
    return this.p2p.createAd(caller.customer, body);
  }

  @Patch('ads/:id')
  updateAd(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAdDto) {
    return this.p2p.updateAd(caller.customer, id, body);
  }

  @Post('ads/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelAd(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.p2p.cancelAd(caller.customer, id);
  }
}

class AssetDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1000)
  p2p_fee_bps?: number;

  /** The most one customer can withdraw on chain in 24 hours. */
  @IsOptional() @cryptoAmount()
  withdrawal_daily_limit?: string;

  /** Withdrawals from this amount wait for an admin's approval ("0": none do). */
  @IsOptional() @cryptoAmount()
  withdrawal_review_from?: string;
}

class CustomerSearchDto {
  @IsOptional() @IsString() @MaxLength(200)
  q?: string;
}

class ReasonDto {
  @IsString() @Length(3, 500)
  reason: string;
}

class CreditDto extends ReasonDto {
  @Transform(upper) @assetCode()
  asset: string;

  @cryptoAmount()
  amount: string;
}

class FreezeDto extends CreditDto {
  @IsIn(['live', 'test'])
  mode: LedgerMode;
}

class AccountFreezeDto extends ReasonDto {
  @IsBoolean()
  frozen: boolean;
}

class ResolveDto {
  @IsString() @Length(3, 500)
  note: string;
}

class MarketLimitsQueryDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;
}

/** A P2P market's limits, in the currency's minor units; null (or left out) is no limit. */
class MarketLimitDto {
  @IsIn(['live', 'test'])
  mode: LedgerMode;

  /** A country code, or WW for the global market. */
  @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'market must be a country code such as NG, or WW' })
  market: string;

  @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency: string;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  per_trade?: number | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  per_day?: number | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  cross_border_per_trade?: number | null;

  /** Afrippa: tighter limits for new traders (fewer than five completed orders), per order and per 24 hours. */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  new_trader_per_trade?: number | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  new_trader_per_day?: number | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  cross_border_per_day?: number | null;
}

class AdminListDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;

  @IsOptional() @IsIn(['active', 'paused', 'completed', 'cancelled'])
  status?: string;

  @IsOptional() @Transform(upper) @assetCode()
  asset?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;
}

/** Admin: crypto assets, customers' crypto wallets and freezes. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('afrippa/admin/crypto')
export class AdminCryptoController {
  constructor(
    private readonly wallets: CryptoWalletsService,
    private readonly limits: CryptoMarketLimitsService,
  ) {}

  /** Every P2P market's limits (per trade, per 24 hours, across borders) and its cross-border payout hold. */
  @Get('market-limits')
  marketLimits(@Query() query: MarketLimitsQueryDto) {
    return this.limits.list(query.mode);
  }

  /** Sets a market's limits: live trading in a market needs them. Finance or operations, after step-up; audited. */
  @AdminRoles('operations', 'finance')
  @StepUp()
  @Put('market-limits')
  setMarketLimits(@CurrentCaller() caller: Caller, @Body() body: MarketLimitDto) {
    return this.limits.set(adminId(caller), body);
  }

  @Get('assets')
  async assets() {
    return { object: 'list' as const, data: (await this.wallets.assets(true)).map(presentAsset) };
  }

  @AdminRoles('operations')
  @StepUp()
  @Patch('assets/:code')
  setAsset(@CurrentCaller() caller: Caller, @Param('code') code: string, @Body() body: AssetDto) {
    return this.wallets.setAsset(adminId(caller), code, body);
  }

  @Get('customers')
  search(@Query() query: CustomerSearchDto) {
    return this.wallets.search(query.q);
  }

  @Get('customers/:id')
  customer(@Param('id', ParseUUIDPipe) id: string) {
    return this.wallets.adminCustomer(id);
  }

  /** Test mode only: test crypto for trying the market. */
  @AdminRoles('operations')
  @Post('customers/:id/test-credits')
  credit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreditDto) {
    return this.wallets.adminCredit(adminId(caller), id, body);
  }

  @AdminRoles('operations')
  @Post('customers/:id/freezes')
  freeze(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: FreezeDto) {
    return this.wallets.freeze(adminId(caller), id, body);
  }

  @AdminRoles('operations')
  @Put('customers/:id/account-freeze')
  accountFreeze(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AccountFreezeDto) {
    return this.wallets.setAccountFrozen(adminId(caller), id, body);
  }

  @AdminRoles('operations')
  @StepUp()
  @Post('freezes/:id/release')
  @HttpCode(HttpStatus.OK)
  release(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.wallets.resolveFreeze(adminId(caller), id, 'released', body.note);
  }

  /** Finance only: frozen crypto taken to BitoCard (court orders, proven fraud). */
  @AdminRoles('finance')
  @StepUp()
  @Post('freezes/:id/seize')
  @HttpCode(HttpStatus.OK)
  seize(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.wallets.resolveFreeze(adminId(caller), id, 'seized', body.note);
  }
}

/** Admin: the P2P market's ads and trades. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('afrippa/admin/p2p')
export class AdminP2pController {
  constructor(private readonly p2p: P2pService) {}

  @Get('ads')
  ads(@Query() query: AdminListDto) {
    return this.p2p.adminAds(query);
  }

  @AdminRoles('operations')
  @Post('ads/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.p2p.adminCancelAd(adminId(caller), id, body.reason);
  }
}

class RoutesDto {
  /** Provider IDs in the order to ask them; any left out keep their place after these. */
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true })
  order: string[];

  @IsArray() @ArrayMaxSize(30) @IsString({ each: true })
  disabled: string[];
}

class NetworkDto {
  @IsOptional() @IsBoolean()
  deposits_enabled?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(1000)
  confirmations?: number;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @Length(20, 100)
  contract?: string | null;

  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @Length(20, 100)
  test_contract?: string | null;

  @IsOptional() @cryptoAmount()
  double_check_from?: string;

  @IsOptional() @IsBoolean()
  withdrawals_enabled?: boolean;

  /** BitoCard's network fee per withdrawal, on top of the amount sent. */
  @IsOptional() @cryptoAmount()
  withdrawal_fee?: string;

  @IsOptional() @cryptoAmount()
  min_withdrawal?: string;
}

class DepositListDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;

  @IsOptional() @IsIn(['pending', 'credited', 'ignored', 'failed'])
  status?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;
}

/** Admin: chains (providers in order, their health, networks) and deposits. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('afrippa/admin/crypto')
export class AdminChainsController {
  constructor(private readonly deposits: CryptoDepositsService) {}

  @Get('chains')
  chains() {
    return this.deposits.adminChains();
  }

  @AdminRoles('operations')
  @StepUp()
  @Put('chains/:chain/routes')
  routes(@CurrentCaller() caller: Caller, @Param('chain') chain: string, @Body() body: RoutesDto) {
    return this.deposits.setRoutes(adminId(caller), chain, body);
  }

  @AdminRoles('operations')
  @Post('chains/check')
  @HttpCode(HttpStatus.OK)
  check() {
    return this.deposits.checkAll();
  }

  @AdminRoles('operations')
  @StepUp()
  @Patch('networks/:id')
  network(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: NetworkDto) {
    return this.deposits.setNetwork(adminId(caller), id, body);
  }

  @Get('deposits')
  depositList(@Query() query: DepositListDto) {
    return this.deposits.adminDeposits(query);
  }

  /** Checks a deposit on chain again now; a failed one (the chain had stopped showing it) goes back to pending. */
  @AdminRoles('operations')
  @Post('deposits/:id/recheck')
  @HttpCode(HttpStatus.OK)
  recheckDeposit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.deposits.recheck(adminId(caller), id);
  }
}

class WithdrawalListDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;

  @IsOptional() @IsIn(['awaiting_code', 'review', 'queued', 'submitting', 'broadcast', 'completed', 'failed', 'rejected', 'cancelled'])
  status?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;
}

/** Admin: on-chain withdrawals (approve or reject those waiting for review, recheck stuck ones). */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('afrippa/admin/crypto/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: CryptoWithdrawalsService) {}

  @Get()
  list(@Query() query: WithdrawalListDto) {
    return this.withdrawals.adminList(query);
  }

  /** Finance only: crypto leaves BitoCard. */
  @AdminRoles('finance')
  @StepUp()
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.withdrawals.approve(adminId(caller), id, body.note);
  }

  @AdminRoles('operations', 'finance')
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.withdrawals.reject(adminId(caller), id, body.note);
  }

  @AdminRoles('operations', 'finance')
  @Post(':id/recheck')
  @HttpCode(HttpStatus.OK)
  recheck(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.recheck(adminId(caller), id);
  }
}

class ModeDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;
}

/** Admin: the daily custody check (crypto_custody against the signer's wallets), and running it now. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'finance')
@Controller('afrippa/admin/crypto/reconciliations')
export class AdminReconciliationsController {
  constructor(private readonly reconciliation: CryptoReconciliationService) {}

  @Get()
  latest(@Query() query: ModeDto) {
    return this.reconciliation.latest(query.mode ?? 'live');
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  run(@CurrentCaller() caller: Caller, @Body() body: ModeDto) {
    return this.reconciliation.runNow(adminId(caller), body.mode ?? 'live');
  }
}

class CustomerPayoutListDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;

  @IsOptional() @IsIn(['pending', 'processing', 'paid', 'failed'])
  status?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;
}

/** Admin: customers' payouts of their withdrawable money to their banks. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/crypto/payouts')
export class AdminCustomerPayoutsController {
  constructor(private readonly payouts: CustomerPayoutsService) {}

  @Get()
  list(@Query() query: CustomerPayoutListDto) {
    return this.payouts.adminList(query);
  }
}

/** Blockchain providers' notifications (signature checked per provider; only the transactions named are used). */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('afrippa/webhooks/chain')
export class ChainWebhooksController {
  constructor(private readonly deposits: CryptoDepositsService) {}

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  receive(@Req() req: Request & { rawBody?: Buffer }, @Param('provider') provider: string, @Query('chain') chain?: string) {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value]));
    return this.deposits.notice(provider, chain, { headers, body: req.rawBody, url: new URL(req.originalUrl, 'https://api.bitocard.com') });
  }
}
