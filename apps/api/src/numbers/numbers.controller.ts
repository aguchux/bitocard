import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { type Caller, CurrentCaller, Public, resellerOf, Roles, Scopes } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { OrderAccessService } from '../orders/order-access.service.js';
import { NumbersService } from './numbers.service.js';

class NumberFilterDto extends PageDto {
  @ApiPropertyOptional({ enum: ['active', 'expired', 'deleted'] })
  @IsOptional() @IsIn(['active', 'expired', 'deleted'])
  status?: 'active' | 'expired' | 'deleted';
}

class UpdateNumberDto {
  @ApiPropertyOptional({ description: 'Renew from your wallet 3 days before `expires_at`. Your customer can also switch this on the order’s page.' })
  @IsOptional() @IsBoolean()
  auto_renew?: boolean;

  @ApiPropertyOptional({ description: 'Let your customer send SMS from the order’s page (charged to your wallet).' })
  @IsOptional() @IsBoolean()
  customer_sending?: boolean;
}

class SendMessageDto {
  @ApiProperty({ description: 'Who to send to, in international format, for example `+447700900123`.', example: '+447700900123' })
  @IsString() @Matches(/^\+?[\d\s()-]{8,20}$/, { message: 'to must be a phone number in international format' })
  to: string;

  @ApiProperty({ description: 'The message: up to 160 characters (70 if it needs characters outside the GSM alphabet, such as emoji).' })
  @IsString() @Length(1, 160)
  text: string;
}

@ApiTags('Numbers')
@ApiBearerAuth()
@modeHeader
@Controller('numbers')
export class NumbersController {
  constructor(private readonly numbers: NumbersService) {}

  @ApiOperation({ summary: 'List virtual numbers', description: 'The numbers your orders bought, newest first, with when each is paid up to.' })
  @Scopes('orders:read')
  @Get()
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() filter: NumberFilterDto) {
    return this.numbers.list(resellerOf(caller), mode, filter);
  }

  @ApiOperation({ summary: 'Get a virtual number' })
  @Scopes('orders:read')
  @Get(':id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.numbers.get(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'Change a number’s settings', description: 'Auto-renew, and whether your customer may send SMS from the order’s page.' })
  @Roles('admin', 'developer')
  @Scopes('orders:write')
  @Patch(':id')
  update(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateNumberDto) {
    return this.numbers.update(resellerOf(caller), mode, id, body);
  }

  @ApiOperation({ summary: 'Get a number’s renewal price', description: 'What renewing for a month would take from your wallet now (at today’s exchange rate).' })
  @Scopes('orders:read')
  @Get(':id/renewal-price')
  renewalPrice(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.numbers.renewalPrice(resellerOf(caller), mode, id);
  }

  @ApiOperation({
    summary: 'Renew a number for a month',
    description: 'Takes a month from your wallet and adds it: to the end of the paid month, or from now for an expired (paused) number, which is active again. Deleted numbers cannot be renewed.',
  })
  @Roles('admin', 'developer', 'finance')
  @Scopes('orders:write')
  @Post(':id/renew')
  @HttpCode(HttpStatus.OK)
  renew(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.numbers.renewByReseller(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'List a number’s messages', description: 'SMS received and sent, newest first, with their text. Messages are kept 90 days.' })
  @Scopes('orders:read')
  @Get(':id/messages')
  messages(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Query() page: PageDto) {
    return this.numbers.resellerMessages(resellerOf(caller), mode, id, page);
  }

  @ApiOperation({
    summary: 'Send an SMS',
    description:
      'From a number that sends SMS (`sends_sms`). The most it can cost is held from your wallet; the real price is taken once the network reports it (`charged`), and the rest returned. In the sandbox nothing is sent.',
  })
  @Roles('admin', 'developer', 'support')
  @Scopes('orders:write')
  @Post(':id/messages')
  send(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: SendMessageDto) {
    return this.numbers.resellerSend(resellerOf(caller), mode, id, body);
  }
}

const untrusted = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'unauthenticated', 'Not a trusted notification.');

/**
 * DIDWW's SMS trunks: incoming SMS (HTTP IN trunk) and the outcome of sent ones (HTTP OUT trunk callback). They sign
 * nothing, so each carries the token set on the trunk (`?token=`, compared in constant time).
 */
@ApiExcludeController()
@Public()
@SkipIdempotency()
@Controller('webhooks')
export class NumberWebhooksController {
  constructor(private readonly numbers: NumbersService) {}

  @Post('didww-sms')
  @HttpCode(HttpStatus.OK)
  received(@Req() req: Request, @Query('token') token?: string) {
    if (!this.numbers.tokenValid(token)) throw untrusted();
    return this.numbers.receive('didww', (req.body ?? {}) as Record<string, string>);
  }

  @Post('didww-sms-status')
  @HttpCode(HttpStatus.OK)
  status(@Req() req: Request, @Query('token') token?: string) {
    if (!this.numbers.tokenValid(token)) throw untrusted();
    return this.numbers.smsStatus((req.body ?? {}) as Parameters<NumbersService['smsStatus']>[0]);
  }
}

class PageSendDto {
  @IsString() @Matches(/^\+?[\d\s()-]{8,20}$/, { message: 'Enter the number in international format, for example +447700900123.' })
  to: string;

  @IsString() @Length(1, 160)
  text: string;
}

class AutoRenewDto {
  @IsBoolean()
  enabled: boolean;
}

const proofOf = (req: Request) => ({ customerSession: req.get('bitocard-customer-session') ?? undefined, pass: req.get('bitocard-access-pass') ?? undefined });

/** A number on its order's page (`/a/<token>`), for the customer who proved the order is theirs. */
@ApiExcludeController()
@Public()
@Controller('store/access')
export class NumberAccessController {
  constructor(
    private readonly access: OrderAccessService,
    private readonly numbers: NumbersService,
  ) {}

  @Get(':token/number')
  @Header('Cache-Control', 'no-store')
  async number(@Param('token') token: string, @Req() req: Request) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return { object: 'order_number' as const, number: await this.numbers.forOrder(order.id) };
  }

  @Post(':token/number/renew')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async renew(@Param('token') token: string, @Req() req: Request) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return { object: 'order_number' as const, number: await this.numbers.renewForOrder(order.id) };
  }

  @Post(':token/number/auto-renew')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async autoRenew(@Param('token') token: string, @Req() req: Request, @Body() body: AutoRenewDto) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return { object: 'order_number' as const, number: await this.numbers.setAutoRenewForOrder(order.id, body.enabled) };
  }

  @Post(':token/messages')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async send(@Param('token') token: string, @Req() req: Request, @Body() body: PageSendDto) {
    const order = await this.access.provenOrder(token, proofOf(req));
    return { object: 'order_number_message' as const, message: await this.numbers.sendForOrder(order.id, body) };
  }
}
