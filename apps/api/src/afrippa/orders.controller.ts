import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Equals, IsBase64, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { cryptoAmount } from '../crypto/crypto.controller.js';
import { maxFeeBps, P2pFeesService } from '../crypto/p2p-fees.service.js';
import { P2pStandingService } from '../crypto/p2p-standing.service.js';
import { P2pTrustService, type ReportReason, reportReasons } from '../crypto/p2p-trust.service.js';
import { P2pWordsService } from '../crypto/p2p-words.service.js';
import { CryptoWalletsService } from '../crypto/crypto-wallets.service.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode, P2pOrderStatus } from '../generated/prisma/client.js';
import { sendFile } from '../support/chats.controller.js';
import { maxMessageLength, OrderRoomService } from './order-room.service.js';
import { P2pOrdersService } from './orders.service.js';

class OpenOrderDto {
  @IsUUID() ad_id: string;
  /** The ad's price as you saw it: a changed price is refused. */
  @IsInt() @Min(1) price: number;
  @IsOptional() @cryptoAmount() amount?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000_000_00) fiat?: number;
  /** Where the buyer pays: one of a sell ad's payment methods, or (taking a buy ad) one of your own the ad accepts. */
  @IsUUID() payment_method_id: string;
  @IsOptional() @IsBoolean() preview?: boolean;
}

class MessageDto {
  @IsString() @Length(1, maxMessageLength) body: string;
}

class AttachmentDto {
  @IsString() @Length(1, 200) file_name: string;
  @IsIn(['image/jpeg', 'image/png', 'application/pdf']) content_type: string;
  /** The file, base64 (4 MB at most once decoded). */
  @IsBase64() @MaxLength(5_600_000) data: string;
  @IsOptional() @IsString() @MaxLength(maxMessageLength) body?: string;
}

class AfterDto {
  @IsOptional() @IsUUID() after?: string;
}

class PaidDto {
  /** The account you paid from: one of your own saved payment methods. */
  @IsUUID() payment_method_id: string;
}

class ReleaseDto {
  /** You checked the money arrived in your account from the buyer's own name. */
  @Equals(true, { message: 'Confirm the money arrived from the buyer before releasing.' }) payer_checked: boolean;
}

class AppealDto {
  @IsString() @Length(10, 1000) reason: string;
}

class OrdersQueryDto {
  @IsOptional() @IsIn(['open', 'closed']) status?: 'open' | 'closed';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class AdminOrdersQueryDto {
  @IsOptional() @IsIn(['test', 'live']) mode?: LedgerMode;
  @IsOptional() @IsIn(['pending_payment', 'paid', 'appealed', 'released', 'cancelled', 'returned']) status?: P2pOrderStatus;
  @IsOptional() @IsUUID() customer_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

class FeeRateDto {
  @IsString() @Matches(/^[A-Za-z0-9]{2,10}$/) asset: string;
  /** A country, WW for the global market, or null for every market (a market's own rate wins). */
  @ValidateIf((_, value) => value !== null) @IsString() @Matches(/^[A-Za-z]{2}$/) market: string | null;
  @IsInt() @Min(0) @Max(maxFeeBps) buyer_bps: number;
  @IsInt() @Min(0) @Max(maxFeeBps) seller_bps: number;
}

class FeedbackDto {
  @IsIn(['positive', 'negative']) rating: 'positive' | 'negative';
  @IsOptional() @IsString() @MaxLength(300) comment?: string;
}

class NicknameDto {
  @IsString() @Length(3, 30) nickname: string;
}

class ReportDto {
  @IsString() @Length(3, 30) nickname: string;
  @IsIn([...reportReasons]) reason: ReportReason;
  @IsString() @Length(10, 2000) details: string;
  @IsOptional() @IsUUID() order_id?: string;
}

class ReportsQueryDto {
  @IsOptional() @IsIn(['open', 'upheld', 'dismissed']) status?: 'open' | 'upheld' | 'dismissed';
  @IsOptional() @IsIn(['test', 'live']) mode?: LedgerMode;
}

class DecideReportDto {
  @IsIn(['upheld', 'dismissed']) decision: 'upheld' | 'dismissed';
  @IsString() @Length(5, 1000) note: string;
}

class RefusedWordDto {
  @IsString() @Length(2, 60) phrase: string;
  /** A market, or null for every market. */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @Matches(/^[A-Za-z]{2}$/) market?: string | null;
}

class ClearStandingDto {
  @IsIn(['test', 'live']) mode: LedgerMode;
  @IsString() @Length(5, 500) reason: string;
}

class StandingQueryDto {
  @IsOptional() @IsIn(['test', 'live']) mode?: LedgerMode;
}

class DecideDto {
  @IsIn(['release', 'return']) outcome: 'release' | 'return';
  @IsIn(['buyer', 'seller', 'none']) fault: 'buyer' | 'seller' | 'none';
  @IsString() @Length(5, 1000) note: string;
}

/** A trader's P2P orders (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 3), through Afrippa's signed server, past two-step. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/p2p/orders')
export class P2pOrdersController {
  constructor(
    private readonly orders: P2pOrdersService,
    private readonly room: OrderRoomService,
    private readonly trust: P2pTrustService,
  ) {}

  /** Rates the other party once the order is released (once, within 30 days). */
  @Post(':id/feedback')
  feedback(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: FeedbackDto) {
    return this.trust.giveFeedback(caller.customer, id, body);
  }

  /** The order's room, oldest first; with `after`, only what came since (polled while it is open). */
  @Get(':id/messages')
  messages(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.room.list(caller.customer, id, query.after);
  }

  @Post(':id/messages')
  send(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageDto) {
    return this.room.send(caller.customer, id, body.body);
  }

  @Post(':id/attachments')
  attach(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AttachmentDto) {
    return this.room.attach(caller.customer, id, body);
  }

  @Get(':id/files/:message')
  async file(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('message', ParseUUIDPipe) message: string, @Res() res: Response) {
    sendFile(res, await this.room.file(caller.customer, id, message));
  }

  @Post()
  open(@CurrentCustomer() caller: CustomerCaller, @Body() body: OpenOrderDto) {
    return this.orders.open(caller.customer, body);
  }

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Query() query: OrdersQueryDto) {
    return this.orders.list(caller.customer, query);
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(caller.customer, id);
  }

  @Post(':id/paid')
  @HttpCode(HttpStatus.OK)
  paid(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: PaidDto) {
    return this.orders.markPaid(caller.customer, id, body.payment_method_id);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  release(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReleaseDto) {
    return this.orders.release(caller.customer, id, body.payer_checked);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.cancel(caller.customer, id);
  }

  @Post(':id/appeal')
  @HttpCode(HttpStatus.OK)
  appeal(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AppealDto) {
    return this.orders.appeal(caller.customer, id, body.reason);
  }
}

/** Afrippa's admins: every order, and deciding appeals (operations, with step-up). */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support', 'finance')
@Controller('afrippa/admin/p2p/orders')
export class AfrippaOrdersAdminController {
  constructor(
    private readonly orders: P2pOrdersService,
    private readonly room: OrderRoomService,
  ) {}

  @Get(':id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() query: AfterDto) {
    return this.room.adminList(id, query.after);
  }

  /** Writes in an open order's room as "Afrippa" (operations and support). */
  @AdminRoles('operations', 'support')
  @Post(':id/messages')
  send(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: MessageDto) {
    return this.room.adminSend(adminId(caller), id, body.body);
  }

  @Get(':id/files/:message')
  async file(@Param('id', ParseUUIDPipe) id: string, @Param('message', ParseUUIDPipe) message: string, @Res() res: Response) {
    sendFile(res, await this.room.adminFile(id, message));
  }

  @Get()
  list(@Query() query: AdminOrdersQueryDto) {
    return this.orders.adminList(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminGet(id);
  }

  @AdminRoles('operations')
  @StepUp()
  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  decide(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideDto) {
    return this.orders.decide(adminId(caller), id, body);
  }
}

/** Afrippa's P2P fee rates, per coin and market (step 3 item 4): finance sets them, with step-up; audited. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support', 'finance')
@Controller('afrippa/admin/p2p/fee-rates')
export class AfrippaFeeRatesAdminController {
  constructor(private readonly fees: P2pFeesService) {}

  @Get()
  list() {
    return this.fees.list();
  }

  @AdminRoles('finance')
  @StepUp()
  @Put()
  set(@CurrentCaller() caller: Caller, @Body() body: FeeRateDto) {
    return this.fees.set(adminId(caller), body);
  }

  /** `market` is a country, WW, or `all` for the every-market rate. */
  @AdminRoles('finance')
  @StepUp()
  @Delete(':asset/:market')
  remove(@CurrentCaller() caller: Caller, @Param('asset') asset: string, @Param('market') market: string) {
    return this.fees.remove(adminId(caller), asset, market);
  }
}

/** A trader's own standing (strikes, cancellations, what stops them now), through Afrippa's signed server. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/p2p/standing')
export class P2pStandingController {
  constructor(
    private readonly standing: P2pStandingService,
    private readonly wallets: CryptoWalletsService,
  ) {}

  @Get()
  async get(@CurrentCustomer() caller: CustomerCaller) {
    const context = await this.wallets.context(caller.customer);
    return this.standing.standing(caller.customer.id, context.mode);
  }
}

/** Afrippa's admins: a trader's standing, and clearing their strikes (operations, step-up, audited). */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support', 'finance')
@Controller('afrippa/admin/traders')
export class AfrippaStandingAdminController {
  constructor(private readonly standing: P2pStandingService) {}

  @Get(':id/standing')
  get(@Param('id', ParseUUIDPipe) id: string, @Query() query: StandingQueryDto) {
    return this.standing.standing(id, query.mode ?? 'live');
  }

  @AdminRoles('operations')
  @StepUp()
  @Post(':id/standing/clear')
  @HttpCode(HttpStatus.OK)
  clear(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ClearStandingDto) {
    return this.standing.clear(adminId(caller), id, body.mode, body.reason);
  }
}

/** Traders' cards, blocks and reports (step 3 item 6), through Afrippa's signed server. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/p2p')
export class P2pTrustController {
  constructor(
    private readonly trust: P2pTrustService,
    private readonly wallets: CryptoWalletsService,
  ) {}

  @Get('traders/:nickname')
  async trader(@CurrentCustomer() caller: CustomerCaller, @Param('nickname') nickname: string) {
    return this.trust.card(nickname, (await this.wallets.context(caller.customer)).mode);
  }

  @Get('blocks')
  blocks(@CurrentCustomer() caller: CustomerCaller) {
    return this.trust.blocks(caller.customer);
  }

  @Post('blocks')
  block(@CurrentCustomer() caller: CustomerCaller, @Body() body: NicknameDto) {
    return this.trust.block(caller.customer, body.nickname);
  }

  @Delete('blocks/:nickname')
  unblock(@CurrentCustomer() caller: CustomerCaller, @Param('nickname') nickname: string) {
    return this.trust.unblock(caller.customer, nickname);
  }

  @Get('reports')
  reports(@CurrentCustomer() caller: CustomerCaller) {
    return this.trust.myReports(caller.customer);
  }

  @Post('reports')
  async report(@CurrentCustomer() caller: CustomerCaller, @Body() body: ReportDto) {
    return this.trust.report(caller.customer, (await this.wallets.context(caller.customer)).mode, body);
  }
}

/** Afrippa's admins: traders' reports, oldest first; operations uphold (a strike) or dismiss them, audited. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support')
@Controller('afrippa/admin/p2p/reports')
export class AfrippaReportsAdminController {
  constructor(private readonly trust: P2pTrustService) {}

  @Get()
  list(@Query() query: ReportsQueryDto) {
    return this.trust.adminReports(query);
  }

  @AdminRoles('operations')
  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  decide(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideReportDto) {
    return this.trust.decide(adminId(caller), id, body);
  }
}

/** Afrippa's refused words (ad terms, nicknames, feedback): operations keep the list, audited; support reads it. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support')
@Controller('afrippa/admin/p2p/refused-words')
export class AfrippaRefusedWordsAdminController {
  constructor(private readonly words: P2pWordsService) {}

  @Get()
  list() {
    return this.words.list();
  }

  @AdminRoles('operations')
  @Post()
  add(@CurrentCaller() caller: Caller, @Body() body: RefusedWordDto) {
    return this.words.add(adminId(caller), body);
  }

  @AdminRoles('operations')
  @Delete(':id')
  remove(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.words.remove(adminId(caller), id);
  }
}
