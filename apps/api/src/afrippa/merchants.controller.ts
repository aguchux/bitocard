import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { type MerchantStatus, merchantStatuses, P2pMerchantsService } from './merchants.service.js';

class MerchantsQueryDto {
  @IsOptional() @IsIn(merchantStatuses) status?: MerchantStatus;
  @IsOptional() @IsIn(['test', 'live']) mode?: LedgerMode;
}

class NoteDto {
  @IsString() @Length(5, 1000) note: string;
}

class ReasonDto {
  @IsString() @Length(5, 1000) reason: string;
}

class RuleDto {
  @IsInt() @Min(0) @Max(100000) min_orders: number;
  /** Basis points: 9800 is 98%. */
  @IsInt() @Min(0) @Max(10000) min_completion_bps: number;
  @IsInt() @Min(1) @Max(365) window_days: number;
  @IsInt() @Min(0) @Max(3650) min_account_days: number;
}

/** A trader's own merchant status: where they stand, and applying (through Afrippa's signed server, past two-step). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('afrippa/p2p/merchant')
export class P2pMerchantController {
  constructor(private readonly merchants: P2pMerchantsService) {}

  @Get()
  mine(@CurrentCustomer() caller: CustomerCaller) {
    return this.merchants.mine(caller.customer);
  }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  apply(@CurrentCustomer() caller: CustomerCaller) {
    return this.merchants.apply(caller.customer);
  }
}

/** Afrippa's admins: merchant applications and merchants (operations decide; approving takes step-up). */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support', 'finance')
@Controller('afrippa/admin/p2p/merchants')
export class AfrippaMerchantsAdminController {
  constructor(private readonly merchants: P2pMerchantsService) {}

  @Get()
  list(@Query() query: MerchantsQueryDto) {
    return this.merchants.adminList(query);
  }

  @AdminRoles('operations')
  @StepUp()
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoteDto) {
    return this.merchants.decide(adminId(caller), id, 'approve', body.note);
  }

  @AdminRoles('operations')
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: NoteDto) {
    return this.merchants.decide(adminId(caller), id, 'reject', body.note);
  }

  /** Protective, so one click: the trader sees the reason. */
  @AdminRoles('operations')
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.merchants.revoke(adminId(caller), id, body.reason);
  }
}

/** Afrippa's admins: who may apply to be a merchant, for all of Afrippa (`WW`) and per market. */
@ApiExcludeController()
@RealmOnly('afrippa_admin')
@AdminRoles('operations', 'support', 'finance')
@Controller('afrippa/admin/p2p/merchant-rules')
export class AfrippaMerchantRulesAdminController {
  constructor(private readonly merchants: P2pMerchantsService) {}

  @Get()
  list() {
    return this.merchants.rules();
  }

  @AdminRoles('operations')
  @StepUp()
  @Put(':market')
  set(@CurrentCaller() caller: Caller, @Param('market') market: string, @Body() body: RuleDto) {
    return this.merchants.setRule(adminId(caller), market, body);
  }

  @AdminRoles('operations')
  @StepUp()
  @Delete(':market')
  remove(@CurrentCaller() caller: Caller, @Param('market') market: string) {
    return this.merchants.removeRule(adminId(caller), market);
  }
}
