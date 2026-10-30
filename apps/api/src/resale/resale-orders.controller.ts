import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiExcludeController, ApiExcludeEndpoint, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, resellerOf, Roles, Scopes, storeScopeOf } from '../auth/caller.js';
import { sendPhoto } from '../classifieds/chat-files.js';
import type { MediaUpload } from '../classifieds/media.service.js';
import { type DisputeReason, disputeReasons, SafePayService } from '../classifieds/safe-pay.service.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { maxDocumentBytes } from '../kyc/files.js';
import { maxQuantity, type OrderThread, orderThreads, resaleOrderStatuses, ResaleOrdersService } from './resale-orders.service.js';
import { type StoreReportDecision, storeReportDecisions, type StoreReportReason, storeReportReasons, ResaleStoreReportsService } from './resale-store-reports.service.js';
import { ProductOnly } from '../products/product.js';

class OrdersQueryDto {
  @ApiPropertyOptional({ enum: resaleOrderStatuses, description: 'Only orders in this status.' })
  @IsOptional() @IsIn(resaleOrderStatuses)
  status?: string;

  @ApiPropertyOptional({ description: 'Only this store’s orders.' })
  @IsOptional() @IsUUID()
  store_id?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0, description: 'How many to skip.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  offset?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50, description: 'How many to return.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

class CancelDto {
  @ApiPropertyOptional({ description: 'Why, told to the buyer and the supplier.', maxLength: 300 })
  @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

class ThreadQueryDto {
  @ApiPropertyOptional({ enum: orderThreads, default: 'order', description: '`order` (with the buyer) or `trade` (with the supplier).' })
  @IsOptional() @IsIn(orderThreads)
  thread?: OrderThread;

  @ApiPropertyOptional({ description: 'Only messages after this one (to poll for new ones).' })
  @IsOptional() @IsUUID()
  after?: string;
}

class DisputeNoteDto {
  @ApiProperty({ description: 'What your store told the buyer, or evidence you hold.', maxLength: 2000 })
  @IsString() @Length(1, 2000)
  body: string;
}

class ThreadMessageDto {
  @ApiPropertyOptional({ enum: orderThreads, default: 'order', description: '`order` (the buyer reads it as from your store) or `trade` (the supplier only).' })
  @IsOptional() @IsIn(orderThreads)
  thread?: OrderThread;

  @ApiProperty({ description: 'The message: no links, account or card numbers, or requests to pay outside BitoCard.', maxLength: 2000 })
  @IsString() @Length(1, 2000)
  body: string;
}

/**
 * Orders on your Resale shops (`/v1/resale/orders`): what each customer bought, its figures (your margin, BitoCard’s
 * fee, your earnings once released), the buyer’s details once the supplier accepts, the shipment, and the order’s two
 * threads: the order chat with the buyer (they read every message from your side as your store’s) and the trade thread
 * with the supplier.
 */
@ApiTags('Resale')
@ApiBearerAuth()
@Controller('resale/orders')
@ProductOnly('udozo')
export class ResaleOrdersController {
  constructor(
    private readonly orders: ResaleOrdersService,
    private readonly safePay: SafePayService,
  ) {}

  @ApiOperation({ summary: 'Get an order’s dispute', description: 'The buyer’s dispute on one of your resale orders: its reason, state and BitoCard’s decision, and every message from the buyer, the supplier, you and BitoCard, oldest first. BitoCard decides it; add your side while it is open.' })
  @Scopes('resale:read')
  @Get(':id/dispute')
  dispute(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.resellerDisputeThread(resellerOf(caller), id, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Add to an order’s dispute', description: 'Your side while the dispute is open: what your store told the buyer, or evidence you hold. The buyer reads it as from your store; the supplier and BitoCard see it too.' })
  @Roles('admin', 'support')
  @Scopes('resale:write')
  @Post(':id/dispute/messages')
  disputeNote(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DisputeNoteDto) {
    return this.safePay.resellerDisputeMessage(resellerOf(caller), caller.kind === 'session' ? caller.userId : null, id, body.body, storeScopeOf(caller));
  }

  /** A photo on an order's dispute, the image itself. */
  @ApiExcludeEndpoint()
  @Scopes('resale:read')
  @Get(':id/dispute/photos/:message')
  async disputePhoto(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('message', ParseUUIDPipe) message: string, @Res() res: Response) {
    sendPhoto(res, await this.safePay.resellerDisputePhoto(resellerOf(caller), id, message, storeScopeOf(caller)));
  }

  @ApiOperation({ summary: 'List resale orders', description: 'Orders on your Resale shops, newest first, without the buyer’s details.' })
  @Scopes('resale:read')
  @Get()
  list(@CurrentCaller() caller: Caller, @Query() query: OrdersQueryDto) {
    return this.orders.list(resellerOf(caller), query, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Get a resale order', description: 'One order with the buyer’s name, phone, email and delivery address once the supplier accepts it (until 30 days after it ends; every view is logged), the supplier, the note the buyer saw and the shipment. Use the buyer’s details only for this order.' })
  @Scopes('resale:read')
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(resellerOf(caller), id, caller.kind === 'session' ? caller.userId : null, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Cancel a resale order', description: 'Before it is shipped or handed over: the buyer’s money is unlocked, or refunded in full once accepted. Each cancellation counts towards your strikes; too many pause your Resale shops’ checkout.' })
  @Roles('admin')
  @Scopes('resale:write')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CancelDto) {
    return this.orders.cancel(resellerOf(caller), id, body.reason, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'List an order’s messages', description: 'The order chat (`thread=order`) or the trade thread with the supplier (`thread=trade`), oldest first, each with who wrote it.' })
  @Scopes('resale:read')
  @Get(':id/messages')
  messages(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Query() query: ThreadQueryDto) {
    return this.orders.resellerMessages(resellerOf(caller), id, query.thread ?? 'order', query.after, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Write on an order', description: 'In the order chat the buyer reads it as from your store, and the supplier sees it too; the trade thread is between you and the supplier.' })
  @Roles('admin', 'support')
  @Scopes('resale:write')
  @Post(':id/messages')
  write(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ThreadMessageDto) {
    return this.orders.resellerWrites(resellerOf(caller), caller.kind === 'session' ? caller.userId : null, id, body.thread ?? 'order', body.body, storeScopeOf(caller));
  }

  /** One of the supplier’s dispatch photos, the image itself (described on the order’s `shipment.dispatch_photos`). */
  @ApiExcludeEndpoint()
  @Scopes('resale:read')
  @Get(':id/dispatch-photos/:photo')
  async photo(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Param('photo', ParseUUIDPipe) photo: string, @Res() res: Response) {
    sendPhoto(res, await this.orders.resellerDispatchPhoto(resellerOf(caller), id, photo, storeScopeOf(caller)));
  }
}

class SupplierThreadQueryDto {
  @IsOptional() @IsIn(orderThreads)
  thread?: OrderThread;

  @IsOptional() @IsUUID()
  after?: string;
}

class SupplierThreadMessageDto {
  @IsOptional() @IsIn(orderThreads)
  thread?: OrderThread;

  @IsString() @Length(1, 2000)
  body: string;
}

class AutoAcceptDto {
  @IsBoolean()
  enabled: boolean;
}

class SupplierReportDto {
  @IsUUID()
  store_id: string;

  @IsIn(storeReportReasons)
  reason: StoreReportReason;

  @IsString() @Length(10, 2000)
  details: string;
}

/** The supplier's side of resale orders in the Shop tab: the order's threads and auto-accept (Safe pay's own routes do the rest). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('classifieds')
@ProductOnly('udozo')
export class SupplierResaleOrdersController {
  constructor(
    private readonly orders: ResaleOrdersService,
    private readonly reports: ResaleStoreReportsService,
  ) {}

  /** The supplier reports one of a reseller's stores (claims, misleading words, payment outside BitoCard). */
  @Post('me/resellers/:id/report')
  report(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierReportDto) {
    return this.reports.reportBySupplier(caller.customer, id, body);
  }

  @Get('me/resale/reports')
  myReports(@CurrentCustomer() caller: CustomerCaller) {
    return this.reports.mine(caller.customer);
  }

  @Get('orders/:id/messages')
  messages(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: SupplierThreadQueryDto) {
    return this.orders.supplierMessages(caller.customer, id, query.thread ?? 'order', query.after);
  }

  @Post('orders/:id/messages')
  @SkipIdempotency()
  write(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SupplierThreadMessageDto) {
    return this.orders.supplierWrites(caller.customer, id, body.thread ?? 'order', body.body);
  }

  @Get('me/resale/auto-accept')
  autoAccept(@CurrentCustomer() caller: CustomerCaller) {
    return this.orders.autoAccept(caller.customer);
  }

  @Put('me/resale/auto-accept')
  setAutoAccept(@CurrentCustomer() caller: CustomerCaller, @Body() body: AutoAcceptDto) {
    return this.orders.setAutoAccept(caller.customer, body.enabled);
  }
}

class BuyDto {
  /** The listing's number on the store (`/l/<ref>-<slug>`). */
  @Type(() => Number) @IsInt() @Min(1)
  ref: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(maxQuantity)
  quantity?: number;

  @IsIn(['meet_up', 'delivery'])
  fulfilment: 'meet_up' | 'delivery';

  @IsOptional() @IsString() @MaxLength(500)
  delivery_address?: string;

  @IsOptional() @IsUUID()
  delivery_state_id?: string;
}

class BuyOrderDto extends BuyDto {
  /** The total the buyer was shown, in minor units: a different total now is `price_changed`. */
  @Type(() => Number) @IsInt() @Min(1)
  expected_total: number;
}

class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class BuyerAfterDto {
  @IsOptional() @IsUUID()
  after?: string;
}

class BuyerMessageDto {
  @IsString() @Length(1, 2000)
  body: string;
}

class BuyerCancelDto {
  @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

class BuyerDisputeDto {
  @IsIn(disputeReasons)
  reason: DisputeReason;

  @IsString() @MaxLength(2000)
  details: string;
}

class BuyerDisputeMessageDto {
  @IsOptional() @IsString() @MaxLength(2000)
  body?: string;
}

/**
 * Buying on a Resale shop, for the store's customers (through the store's server, `BitoCard-Store` naming it): the
 * quote, buying from the store wallet, their orders, the order chat with the store, and Safe pay's buyer steps.
 */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/resale/orders')
@ProductOnly('udozo')
export class StoreResaleOrdersController {
  constructor(
    private readonly orders: ResaleOrdersService,
    private readonly safePay: SafePayService,
  ) {}

  /** What buying would cost (the price, any delivery charge, the fee, the total) and the wallet's balance. */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @SkipIdempotency()
  quote(@CurrentCustomer() caller: CustomerCaller, @Body() body: BuyDto) {
    return this.orders.quote(caller.customer, body);
  }

  @Post()
  buy(@CurrentCustomer() caller: CustomerCaller, @Body() body: BuyOrderDto) {
    return this.orders.buy(caller.customer, body);
  }

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Query() query: PageDto) {
    return this.orders.purchases(caller.customer, query);
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.purchase(caller.customer, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: BuyerCancelDto) {
    return this.safePay.cancel(caller.customer, id, body.reason);
  }

  @Post(':id/received')
  @HttpCode(HttpStatus.OK)
  received(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.received(caller.customer, id);
  }

  @Get(':id/release-code')
  @Header('Cache-Control', 'no-store')
  releaseCode(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.releaseCode(caller.customer, id);
  }

  @Post(':id/dispute')
  dispute(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: BuyerDisputeDto) {
    return this.safePay.dispute(caller.customer, id, body);
  }

  @Get(':id/dispute')
  disputeThread(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.safePay.disputeThread(caller.customer, id);
  }

  @Post(':id/dispute/messages')
  @SkipIdempotency()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxDocumentBytes + 1, files: 1, fields: 2 } }))
  disputeMessage(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: BuyerDisputeMessageDto, @UploadedFile() file?: MediaUpload) {
    return this.safePay.disputeMessage(caller.customer, id, body.body ?? '', file);
  }

  @Get(':id/dispute/photos/:message')
  async disputePhoto(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('message', ParseUUIDPipe) message: string, @Res() res: Response) {
    sendPhoto(res, await this.safePay.disputePhoto(caller.customer, id, message));
  }

  @Get(':id/dispatch-photos/:photo')
  async dispatchPhoto(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Param('photo', ParseUUIDPipe) photo: string, @Res() res: Response) {
    sendPhoto(res, await this.safePay.partyDispatchPhoto(caller.customer, id, photo));
  }

  @Get(':id/messages')
  messages(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Query() query: BuyerAfterDto) {
    return this.orders.buyerMessages(caller.customer, id, query.after);
  }

  @Post(':id/messages')
  @SkipIdempotency()
  write(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: BuyerMessageDto) {
    return this.orders.buyerWrites(caller.customer, id, body.body);
  }
}

class BuyerReportDto {
  @IsIn(storeReportReasons)
  reason: StoreReportReason;

  @IsString() @Length(10, 2000)
  details: string;

  @IsOptional() @IsUUID()
  order_id?: string;
}

/** A Resale shop's customer reports the store to BitoCard. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/resale/reports')
@ProductOnly('udozo')
export class StoreResaleReportsController {
  constructor(private readonly reports: ResaleStoreReportsService) {}

  @Post()
  report(@CurrentCustomer() caller: CustomerCaller, @Body() body: BuyerReportDto) {
    return this.reports.reportByBuyer(caller.customer, body);
  }

  @Get()
  mine(@CurrentCustomer() caller: CustomerCaller) {
    return this.reports.mine(caller.customer);
  }
}

class ReportsQueryDto {
  @IsOptional() @IsIn(['open', ...storeReportDecisions])
  status?: string;

  @IsOptional() @IsUUID()
  reseller_id?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

class DecideReportDto {
  @IsIn(storeReportDecisions)
  decision: StoreReportDecision;

  @IsString() @Length(3, 500)
  note: string;
}

/** Reports of Resale shops: support reads them, operations uphold (a strike for the reseller) or dismiss them. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds/resale-reports')
@ProductOnly('udozo')
export class AdminResaleReportsController {
  constructor(private readonly reports: ResaleStoreReportsService) {}

  @Get()
  list(@Query() query: ReportsQueryDto) {
    return this.reports.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(id);
  }

  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  decide(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: DecideReportDto) {
    return this.reports.decide(adminId(caller), id, body);
  }
}

class ClearStrikesDto {
  @IsString() @Length(3, 300)
  reason: string;
}

/** A reseller's resale strikes (orders their stores cancelled) and lifting them. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('support', 'operations')
@Controller('admin/classifieds/resellers/:id/resale-standing')
@ProductOnly('udozo')
export class AdminResaleOrdersController {
  constructor(private readonly orders: ResaleOrdersService) {}

  @Get()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.adminStanding(id);
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('operations')
  clear(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ClearStrikesDto) {
    return this.orders.clearStrikes(adminId(caller), id, body.reason);
  }
}
