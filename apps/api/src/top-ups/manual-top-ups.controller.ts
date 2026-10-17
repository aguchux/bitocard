import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { ManualTopUpsService, maxTopUpMinor, type TopUpSource, topUpSources } from './manual-top-ups.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

class TopUpDto {
  @IsOptional() @IsIn(['test', 'live'])
  mode?: LedgerMode;

  /** The wallet: the country's currency (default) or `USD`. */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code' })
  currency?: string;

  /** Minor units of the wallet's currency. */
  @IsInt() @Min(1) @Max(maxTopUpMinor)
  amount: number;

  @IsIn(topUpSources)
  source: TopUpSource;

  /** The bank transfer or payment reference (required for money received). */
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

class FilterDto extends PageDto {
  @IsOptional() @IsUUID()
  reseller_id?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;

  @IsOptional() @IsIn(['awaiting_code', 'completed', 'cancelled'])
  status?: string;
}

/**
 * Admin: manual top-ups of reseller and customer wallets (finance). Asking emails a code to the asking admin; the
 * wallet is credited only when they confirm with it. Every step is audited.
 */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('finance')
@Controller('admin')
export class AdminManualTopUpsController {
  constructor(private readonly topUps: ManualTopUpsService) {}

  @AdminRoles('finance', 'operations', 'support')
  @Get('top-ups')
  list(@Query() query: FilterDto) {
    return this.topUps.list(query);
  }

  @AdminRoles('finance', 'operations', 'support')
  @Get('top-ups/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.topUps.get(id);
  }

  @Post('resellers/:id/top-ups')
  forReseller(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: TopUpDto) {
    return this.topUps.requestForReseller(adminId(caller)!, id, body);
  }

  @Post('customers/:id/top-ups')
  forCustomer(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: TopUpDto) {
    return this.topUps.requestForCustomer(adminId(caller)!, id, body);
  }

  @Post('top-ups/:id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmDto) {
    return this.topUps.confirm(adminId(caller)!, id, body.code, body.method);
  }

  @Post('top-ups/:id/resend-code')
  @HttpCode(HttpStatus.OK)
  resend(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.topUps.resendCode(adminId(caller)!, id);
  }

  @Post('top-ups/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.topUps.cancel(adminId(caller)!, id);
  }
}
