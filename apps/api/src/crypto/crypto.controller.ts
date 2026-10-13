import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { CryptoDepositsService } from './chains/deposits.service.js';
import { CryptoWalletsService, presentAsset } from './crypto-wallets.service.js';
import { type AdSide, P2pService } from './p2p.service.js';
import { CryptoWithdrawalsService } from './withdrawals.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const assetCode = () => Matches(/^[A-Z0-9]{2,10}$/, { message: 'asset must be an asset code such as USDT' });
/** A crypto amount as a decimal string ("12.5"). */
const cryptoAmount = () => Matches(/^\d{1,20}(\.\d{1,8})?$/, { message: 'amount must be a decimal number such as 12.5' });

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

class NicknameDto {
  @Matches(/^[A-Za-z0-9_]{3,20}$/, { message: 'nickname must be 3 to 20 letters, numbers or underscores' })
  nickname: string;
}

class MarketQueryDto {
  @Transform(upper) @assetCode()
  asset: string;

  /** What you want to do: buy (from sell ads) or sell (to buy ads). */
  @IsIn(['buy', 'sell'])
  side: AdSide;

  /** Only ads taking this amount (fiat minor units). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  fiat?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class QuoteQueryDto {
  @Transform(upper) @assetCode()
  asset: string;

  @IsIn(['buy', 'sell'])
  side: AdSide;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  fiat?: number;

  @IsOptional() @cryptoAmount()
  amount?: string;
}

class CreateAdDto {
  @IsIn(['buy', 'sell'])
  side: AdSide;

  @Transform(upper) @assetCode()
  asset: string;

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
}

class MyAdsQueryDto {
  @IsOptional() @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

class TradeDto {
  @IsUUID()
  ad_id: string;

  /** The ad's price as you saw it: a changed price is refused, never charged. */
  @IsInt() @Min(1)
  price: number;

  /** BitoCard's fee as you saw it (basis points): a changed fee is refused, like a changed price. */
  @IsOptional() @IsInt() @Min(0) @Max(1000)
  fee_bps?: number;

  /** How much crypto, or (instead) how much fiat to spend or receive, in minor units. */
  @IsOptional() @cryptoAmount()
  amount?: string;

  @IsOptional() @IsInt() @Min(1)
  fiat?: number;

  /** Only show the trade it would make. */
  @IsOptional() @IsBoolean()
  preview?: boolean;
}

class DepositNetworksDto {
  @Transform(upper) @assetCode()
  asset: string;
}

class DepositAddressDto extends DepositNetworksDto {
  @Transform(upper) @IsIn(['ETHEREUM', 'BSC', 'TRON', 'BITCOIN', 'SOLANA'])
  chain: string;
}

/** A store customer's crypto wallets: balances, deposit addresses and deposits (sandbox stores can add test crypto). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/crypto')
export class CustomerCryptoController {
  constructor(
    private readonly wallets: CryptoWalletsService,
    private readonly deposits: CryptoDepositsService,
  ) {}

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

class WithdrawalAddressDto {
  @Transform(upper) @IsIn(['ETHEREUM', 'BSC', 'TRON', 'BITCOIN', 'SOLANA'])
  chain: string;

  @IsString() @Length(20, 100)
  address: string;

  @IsString() @Length(1, 40)
  label: string;
}

class WithdrawalDto {
  @Transform(upper) @assetCode()
  asset: string;

  @Transform(upper) @IsIn(['ETHEREUM', 'BSC', 'TRON', 'BITCOIN', 'SOLANA'])
  chain: string;

  @IsUUID()
  address_id: string;

  @cryptoAmount()
  amount: string;

  /** Only show what it would send and cost. */
  @IsOptional() @IsBoolean()
  preview?: boolean;
}

class CodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be the 6 digits we emailed you' })
  code: string;
}

/** A store customer's on-chain withdrawals: saved addresses (usable after 24 hours), withdrawals confirmed by an emailed code. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/crypto')
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

/** The P2P market for store customers: ads, quotes and instant trades paid from BitoCard wallets. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/p2p')
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

  @Get('market')
  market(@CurrentCustomer() caller: CustomerCaller, @Query() query: MarketQueryDto) {
    return this.p2p.market(caller.customer, query);
  }

  @Get('quote')
  quote(@CurrentCustomer() caller: CustomerCaller, @Query() query: QuoteQueryDto) {
    return this.p2p.quote(caller.customer, query);
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

  @Post('trades')
  trade(@CurrentCustomer() caller: CustomerCaller, @Body() body: TradeDto) {
    return this.p2p.trade(caller.customer, body);
  }

  @Get('trades')
  trades(@CurrentCustomer() caller: CustomerCaller, @Query() query: AssetQueryDto) {
    return this.p2p.trades(caller.customer, query);
  }

  @Get('trades/:id')
  getTrade(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.p2p.getTrade(caller.customer, id);
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
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/crypto')
export class AdminCryptoController {
  constructor(private readonly wallets: CryptoWalletsService) {}

  @Get('assets')
  async assets() {
    return { object: 'list' as const, data: (await this.wallets.assets(true)).map(presentAsset) };
  }

  @AdminRoles('operations')
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
  @Post('freezes/:id/release')
  @HttpCode(HttpStatus.OK)
  release(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.wallets.resolveFreeze(adminId(caller), id, 'released', body.note);
  }

  /** Finance only: frozen crypto taken to BitoCard (court orders, proven fraud). */
  @AdminRoles('finance')
  @Post('freezes/:id/seize')
  @HttpCode(HttpStatus.OK)
  seize(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.wallets.resolveFreeze(adminId(caller), id, 'seized', body.note);
  }
}

/** Admin: the P2P market's ads and trades. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/p2p')
export class AdminP2pController {
  constructor(private readonly p2p: P2pService) {}

  @Get('ads')
  ads(@Query() query: AdminListDto) {
    return this.p2p.adminAds(query);
  }

  @Get('trades')
  trades(@Query() query: AdminListDto) {
    return this.p2p.adminTrades(query);
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
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/crypto')
export class AdminChainsController {
  constructor(private readonly deposits: CryptoDepositsService) {}

  @Get('chains')
  chains() {
    return this.deposits.adminChains();
  }

  @AdminRoles('operations')
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
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/crypto/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: CryptoWithdrawalsService) {}

  @Get()
  list(@Query() query: WithdrawalListDto) {
    return this.withdrawals.adminList(query);
  }

  /** Finance only: crypto leaves BitoCard. */
  @AdminRoles('finance')
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

/** Blockchain providers' notifications (signature checked per provider; only the transactions named are used). */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('webhooks/chain')
export class ChainWebhooksController {
  constructor(private readonly deposits: CryptoDepositsService) {}

  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  receive(@Req() req: Request & { rawBody?: Buffer }, @Param('provider') provider: string, @Query('chain') chain?: string) {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value]));
    return this.deposits.notice(provider, chain, { headers, body: req.rawBody, url: new URL(req.originalUrl, 'https://api.bitocard.com') });
  }
}
