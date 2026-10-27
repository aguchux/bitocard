import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, Roles, Scopes, SessionOnly, StepUp } from '../../auth/caller.js';
import { adminId } from '../../countries/countries.controller.js';
import { ApiError } from '../../common/errors/api-error.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../../customers/customer-session.js';
import type { LedgerMode } from '../../generated/prisma/client.js';
import { modeHeader, PageDto } from '../../ledger/wallet.controller.js';
import { Mode } from '../../ledger/mode.js';
import { ExchangeService } from './exchange.service.js';
import type { ExchangeSide } from './pricing.js';
import { maxMarkupBps } from './pricing.js';
import { ResellerDeskService } from './reseller-desk.service.js';
import { type ReserveKind, ReservesService, type ReserveType } from './reserves.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const assetCode = () => Matches(/^[A-Z0-9]{2,10}$/, { message: 'asset must be an asset code such as USDT' });
const decimalAmount = () => Matches(/^\d{1,20}(\.\d{1,18})?$/, { message: 'amount must be a decimal number such as 12.5' });

class OverviewDto {
  @IsOptional() @Transform(upper) @assetCode()
  asset?: string;

  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency?: string;
}

class QuoteDto {
  @Transform(upper) @assetCode()
  asset: string;

  /** buy: the customer buys coins with money; sell: they sell coins for money. Never coin to coin. */
  @IsIn(['buy', 'sell'])
  side: ExchangeSide;

  /** The coin amount, as a decimal string. */
  @IsOptional() @decimalAmount()
  amount?: string;

  /** The money, in minor units of the customer's currency. */
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  fiat?: number;
}

class TradeDto {
  @ApiProperty({ format: 'uuid', description: 'A fresh, unexpired quote from POST /v1/exchange/quotes.' })
  @IsUUID()
  quote_id: string;
}

class ModeDto extends PageDto {
  @IsOptional() @IsIn(['test', 'live'])
  mode?: LedgerMode;
}

class TradesFilterDto extends ModeDto {
  @IsOptional() @Transform(upper) @assetCode()
  asset?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;

  /** `bitocard`, or a reseller's ID for their own desk. */
  @IsOptional() @Matches(/^(bitocard|[0-9a-f-]{36})$/, { message: 'desk must be bitocard or a reseller ID' })
  desk?: string;
}

class ResellerTradesFilterDto extends ModeDto {
  @IsOptional() @Transform(upper) @assetCode()
  asset?: string;

  @IsOptional() @IsUUID()
  reseller_id?: string;
}

class MovementsFilterDto extends ModeDto {
  @IsOptional() @IsIn(['awaiting_code', 'completed', 'cancelled'])
  status?: string;
}

class MarkupDto {
  @IsIn(['test', 'live'])
  mode: LedgerMode;

  @Transform(upper) @assetCode()
  asset: string;

  @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency: string;

  @IsInt() @Min(0) @Max(maxMarkupBps)
  buy_markup_bps: number;

  @IsInt() @Min(0) @Max(maxMarkupBps)
  sell_markup_bps: number;

  /** Minor units. */
  @IsInt() @Min(0) @Max(1_000_000_000_000_00)
  min_fiat: number;

  /** Minor units; null for no maximum. */
  @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  max_fiat: number | null;

  @IsBoolean()
  enabled: boolean;
}

class MovementDto {
  @IsIn(['test', 'live'])
  mode: LedgerMode;

  @IsIn(['fund', 'withdraw'])
  kind: ReserveKind;

  @IsIn(['fiat', 'crypto'])
  reserve: ReserveType;

  /** Money reserves: the market. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter code' })
  country?: string;

  /** Money reserves: the market's local currency (default) or USD. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency?: string;

  /** Coin reserves: the coin. */
  @IsOptional() @Transform(upper) @assetCode()
  asset?: string;

  /** A decimal string: money in its main unit (25000.00), coins in the coin (0.5). */
  @decimalAmount()
  amount: string;

  @IsOptional() @IsString() @Length(1, 120)
  external_reference?: string;

  @IsString() @Length(5, 300)
  reason: string;
}

class ConfirmDto {
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from your authenticator app or the email' })
  code: string;

  /** authenticator (the admin's app, when set up) or email (the code we emailed; the default). */
  @IsOptional() @IsIn(['authenticator', 'email'])
  method?: 'authenticator' | 'email';
}

class ReserveTransferDto {
  @ApiProperty({ example: 'NGN' })
  @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency: string;

  @ApiProperty({ example: 250000, description: 'Fiat minor units.' })
  @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  amount: number;

  @ApiProperty({ enum: ['fund', 'withdraw'] })
  @IsIn(['fund', 'withdraw'])
  direction: 'fund' | 'withdraw';
}

class CoinTransferDto {
  @ApiProperty({ example: 'BTC' })
  @Transform(upper) @assetCode()
  asset: string;

  @ApiProperty({ example: '0.01', description: 'Coin amount as a decimal string.' })
  @decimalAmount()
  amount: string;

  @ApiProperty({ enum: ['fund', 'withdraw'] })
  @IsIn(['fund', 'withdraw'])
  direction: 'fund' | 'withdraw';
}

class DeskSettingsDto {
  @ApiProperty({ description: 'Allow BitoCard to serve pairs your desk does not offer.' })
  @IsBoolean()
  fallback_to_bitocard: boolean;
}

class ResellerOverviewDto {
  @ApiProperty({ example: 'NGN', description: 'Your local or US dollar wallet.' })
  @Transform(upper) @Matches(/^[A-Z]{3}$/)
  currency: string;
}

class ResellerQuoteDto extends ResellerOverviewDto {
  @ApiProperty({ example: 'BTC' })
  @Transform(upper) @assetCode()
  asset: string;

  @ApiProperty({ enum: ['buy', 'sell'] })
  @IsIn(['buy', 'sell'])
  side: ExchangeSide;

  @ApiPropertyOptional({ example: '0.01', description: 'Coin amount. Supply amount or fiat, never both.' })
  @IsOptional() @decimalAmount()
  amount?: string;

  @ApiPropertyOptional({ example: 100000, description: 'Fiat amount in minor units. Supply fiat or amount, never both.' })
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  fiat?: number;
}

/** A reseller's own exchange desk: balances and prices are visible to the reseller, movements use its funded wallet. */
@ApiExcludeController()
@ApiTags('Exchange')
@ApiBearerAuth()
@modeHeader
// SHQ sessions only: an API key must never move reserves, set prices or trade the wallet.
@SessionOnly()
@Controller('exchange')
export class ResellerExchangeController {
  constructor(private readonly exchange: ExchangeService, private readonly desk: ResellerDeskService) {}

  @ApiOperation({ summary: 'See BitoCard exchange prices and available reserves', description: 'Buy or sell a coin against your local or US dollar wallet. BitoCard reserve balances cap each offer.' })
  @Scopes('wallet:read')
  @Get()
  overview(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: ResellerOverviewDto) {
    return this.desk.overview(resellerOf(caller), mode, query.currency);
  }

  @ApiOperation({ summary: 'Quote a reseller trade with BitoCard' })
  @Roles('admin', 'finance')
  @Scopes('wallet:write')
  @Post('quotes')
  quote(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ResellerQuoteDto) {
    return this.desk.quote(resellerOf(caller), mode, body);
  }

  @ApiOperation({ summary: 'Execute a quoted reseller trade with BitoCard', description: 'Atomically moves fiat and coin balances between the reseller and BitoCard. A quote can execute once.' })
  @Roles('admin', 'finance')
  @Scopes('wallet:write')
  @Post('trades')
  trade(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: TradeDto) {
    return this.desk.trade(resellerOf(caller), mode, body.quote_id);
  }

  @ApiOperation({ summary: 'List your trades with BitoCard' })
  @Scopes('wallet:read')
  @Get('trades')
  trades(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: PageDto) {
    return this.desk.trades(resellerOf(caller), mode, query);
  }

  @ApiOperation({ summary: 'Get your exchange reserves', description: 'Your own fiat and coin reserves in this mode. Your customers can trade only up to these balances.' })
  @Scopes('wallet:read')
  @Get('reserves')
  reserves(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.exchange.resellerReserves(resellerOf(caller), mode);
  }

  @ApiOperation({ summary: 'Fund or draw down your fiat exchange reserve', description: 'Moves topped-up money between your wallet and your customer exchange reserve. A draw-down is returned as topped-up funds.' })
  @Roles('admin', 'finance')
  @Scopes('wallet:write')
  @Post('reserves/transfers')
  transfer(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ReserveTransferDto) {
    return this.exchange.transferResellerFiat(resellerOf(caller), mode, body);
  }

  @ApiOperation({ summary: 'Move your coins into or out of your customer exchange reserve' })
  @Roles('admin', 'finance')
  @Scopes('wallet:write')
  @Post('reserves/coins/transfers')
  transferCoins(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: CoinTransferDto) {
    return this.desk.transferCoins(resellerOf(caller), mode, body);
  }

  @ApiOperation({ summary: 'Get your customer exchange desk settings' })
  @Scopes('wallet:read')
  @Get('desk')
  deskSettings(@CurrentCaller() caller: Caller) {
    return this.exchange.resellerDesk(resellerOf(caller));
  }

  @ApiOperation({ summary: 'Set whether your customers may trade with BitoCard when your desk does not offer a coin' })
  @Roles('admin', 'finance')
  @Scopes('wallet:write')
  @Put('desk')
  setDesk(@CurrentCaller() caller: Caller, @Body() body: DeskSettingsDto) {
    return this.exchange.setResellerDesk(resellerOf(caller), body.fallback_to_bitocard);
  }

  @ApiOperation({ summary: 'List your customers’ trades at your desk', description: 'Newest first, with the customer and the markup you earned on each.' })
  @Scopes('wallet:read')
  @Get('desk/trades')
  deskTrades(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() query: PageDto) {
    return this.exchange.deskTrades(resellerOf(caller), mode, query);
  }

  @ApiOperation({ summary: 'List your customer exchange prices', description: 'Per coin and wallet currency, including whether the offer is enabled.' })
  @Scopes('wallet:read')
  @Get('markups')
  markups(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.exchange.resellerMarkups(resellerOf(caller), mode);
  }

  @ApiOperation({ summary: 'Set a customer exchange price', description: 'Set your buy and sell markup and per-trade limits for a coin in your local or US dollar currency.' })
  @Roles('admin', 'finance')
  @Scopes('wallet:write')
  @Put('markups')
  setMarkup(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: MarkupDto) {
    if (body.mode !== mode) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mode_mismatch', 'Mode must match the BitoCard-Mode header.');
    return this.exchange.setResellerMarkup(resellerOf(caller), caller.kind === 'session' ? caller.userId : null, body);
  }
}

/** Store customers: the instant exchange with BitoCard's reserves (bitocard.com). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/exchange')
export class CustomerExchangeController {
  constructor(private readonly exchange: ExchangeService) {}

  @Get()
  overview(@CurrentCustomer() caller: CustomerCaller, @Query() query: OverviewDto) {
    return this.exchange.overview(caller.customer, query.asset, query.currency);
  }

  @Post('quotes')
  quote(@CurrentCustomer() caller: CustomerCaller, @Body() body: QuoteDto) {
    return this.exchange.quote(caller.customer, body);
  }

  @Post('trades')
  trade(@CurrentCustomer() caller: CustomerCaller, @Body() body: TradeDto) {
    return this.exchange.trade(caller.customer, body.quote_id);
  }

  @Get('trades')
  trades(@CurrentCustomer() caller: CustomerCaller, @Query() query: PageDto) {
    return this.exchange.trades(caller.customer, query);
  }

  @Get('trades/:id')
  getTrade(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.exchange.getTrade(caller.customer, id);
  }
}

/** Admin: BitoCard's exchange reserves (finance moves them with an emailed code), markups and trades. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('finance', 'operations', 'support')
@Controller('admin/exchange')
export class AdminExchangeController {
  constructor(
    private readonly exchange: ExchangeService,
    private readonly reserves: ReservesService,
    private readonly desk: ResellerDeskService,
  ) {}

  @Get('reserves')
  reserveBalances(@Query() query: ModeDto) {
    return this.exchange.reserves(query.mode ?? 'live');
  }

  @Get('reserves/movements')
  movements(@Query() query: MovementsFilterDto) {
    return this.reserves.list(query);
  }

  @AdminRoles('finance')
  @Post('reserves/movements')
  requestMovement(@CurrentCaller() caller: Caller, @Body() body: MovementDto) {
    return this.reserves.request(adminId(caller)!, body);
  }

  @AdminRoles('finance')
  @Post('reserves/movements/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirmMovement(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmDto) {
    return this.reserves.confirm(adminId(caller)!, id, body.code, body.method);
  }

  @AdminRoles('finance')
  @Post('reserves/movements/:id/resend-code')
  @HttpCode(HttpStatus.OK)
  resendMovementCode(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.reserves.resendCode(adminId(caller)!, id);
  }

  @AdminRoles('finance')
  @Post('reserves/movements/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelMovement(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.reserves.cancel(adminId(caller)!, id);
  }

  @Get('markups')
  markups(@Query() query: ModeDto) {
    return this.exchange.markups(query.mode ?? 'live');
  }

  @AdminRoles('operations', 'finance')
  @StepUp()
  @Put('markups')
  setMarkup(@CurrentCaller() caller: Caller, @Body() body: MarkupDto) {
    return this.exchange.setMarkup(adminId(caller), body);
  }

  @Get('trades')
  trades(@Query() query: TradesFilterDto) {
    return this.exchange.adminTrades(query);
  }

  /** Resellers' own trades with BitoCard's desk (they buy and sell coins in SHQ). */
  @Get('reseller-trades')
  resellerTrades(@Query() query: ResellerTradesFilterDto) {
    return this.desk.adminTrades(query);
  }

  /** Every reseller running a desk, its pairs and its reserves. */
  @Get('desks')
  desks(@Query() query: ModeDto) {
    return this.exchange.adminDesks(query.mode ?? 'live');
  }
}
