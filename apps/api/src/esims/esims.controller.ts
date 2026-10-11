import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { type Caller, CurrentCaller, Public, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { OrderAccessService } from '../orders/order-access.service.js';
import { EsimsService } from './esims.service.js';

class EsimFilterDto extends PageDto {
  @ApiPropertyOptional({ description: 'Only the eSIMs this order delivered.' })
  @IsOptional() @IsUUID()
  order_id?: string;
}

class TopUpDto {
  @ApiProperty({ description: 'One of the options `GET /v1/esims/{id}/top-up-options` lists.', example: 'opt_4f1c2b9a0d7e6c5b3a21' })
  @IsString() @Length(4, 64)
  option_id: string;
}

class CustomerTopUpDto extends TopUpDto {
  /** The customer's wallet that pays: their country's currency (default) or `USD`. */
  @IsOptional() @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Matches(/^[A-Z]{3}$/)
  wallet_currency?: string;
}

@ApiTags('eSIMs')
@ApiBearerAuth()
@modeHeader
@Controller('esims')
export class EsimsController {
  constructor(private readonly esims: EsimsService) {}

  @ApiOperation({ summary: 'List eSIMs', description: 'The eSIMs your orders delivered, newest first, with their status, data use and expiry. Activation codes are only on `GET /v1/orders/{id}`.' })
  @Scopes('orders:read')
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: EsimFilterDto) {
    return this.esims.list(resellerOf(caller), mode, filter);
  }

  @ApiOperation({ summary: 'Get an eSIM', description: 'Its status, data use and expiry, read again from the supplier when older than ten minutes (suppliers update data use every few hours).' })
  @Scopes('orders:read')
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.esims.get(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'List top-up options', description: 'The top-ups this eSIM can take now, with what each costs you (BitoCard’s price, from your wallet). Empty when it takes none, or once it has expired.' })
  @Scopes('orders:read')
  @Get(':id/top-up-options')
  options(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.esims.resellerOptions(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'List top-ups', description: 'Top-ups added to this eSIM (by you or your customer), newest first.' })
  @Scopes('orders:read')
  @Get(':id/top-ups')
  topUps(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.esims.resellerTopUps(resellerOf(caller), mode, id);
  }

  @ApiOperation({
    summary: 'Top up an eSIM',
    description:
      'Adds data (or, for a day pass, days) to an eSIM. The price is held from your wallet and taken once the supplier confirms (`completed`); refused, it is returned (`failed`). `pending` means the supplier has not answered clearly yet: it is asked again and you get `esim.updated` once it is added.',
  })
  @Roles('admin', 'support', 'finance')
  @Scopes('orders:write')
  @Post(':id/top-ups')
  topUp(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: TopUpDto) {
    return this.esims.resellerTopUp(resellerOf(caller), mode, id, body);
  }

  @ApiOperation({
    summary: 'Cancel an eSIM for a refund',
    description:
      'Cancels every eSIM of this eSIM’s order, as long as none was ever installed, and refunds the order (to your wallet, or to your store’s customer). An installed eSIM cannot be cancelled (`esim_in_use`).',
  })
  @Roles('admin', 'support')
  @Scopes('orders:write')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.esims.resellerCancel(resellerOf(caller), mode, id);
  }
}

const proofOf = (req: Request) => ({ customerSession: req.get('bitocard-customer-session') ?? undefined, pass: req.get('bitocard-access-pass') ?? undefined });

/** eSIMs on their order's page (`/a/<token>`), for the customer who proved the order is theirs. */
@ApiExcludeController()
@Public()
@Controller('store/access')
export class EsimAccessController {
  constructor(
    private readonly access: OrderAccessService,
    private readonly esims: EsimsService,
  ) {}

  @Get(':token/esims')
  @Header('Cache-Control', 'no-store')
  async list(@Param('token') token: string, @Req() req: Request) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return { object: 'list' as const, data: await this.esims.forOrder(order.id) };
  }

  @Get(':token/esims/:id/top-up-options')
  @Header('Cache-Control', 'no-store')
  async options(@Param('token') token: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return this.esims.customerOptions(order, id);
  }

  @Post(':token/esims/:id/top-ups')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async topUp(@Param('token') token: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Body() body: CustomerTopUpDto) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return this.esims.customerTopUp(order, id, body);
  }

  @Post(':token/esims/:id/cancel')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async cancel(@Param('token') token: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return this.esims.customerCancel(order, id);
  }
}
