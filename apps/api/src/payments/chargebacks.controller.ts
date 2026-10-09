import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { chargebackOutcomes, ChargebacksService, type ChargebackOutcome } from './chargebacks.service.js';

class RecordChargebackDto {
  @IsUUID()
  payment_id: string;

  /** The chargeback's ID in the gateway's dashboard, so it is recorded once. */
  @IsString() @Length(1, 200)
  provider_dispute_id: string;

  /** In minor units; defaults to the whole payment. */
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  amount?: number;

  @IsString() @Length(3, 500)
  reason: string;
}

class ResolveChargebackDto {
  @IsIn(chargebackOutcomes)
  outcome: ChargebackOutcome;

  @IsString() @Length(3, 500)
  reason: string;
}

class ReasonDto {
  @IsString() @Length(3, 500)
  reason: string;
}

class ChargebackFilterDto {
  @IsOptional() @IsIn(['open', 'won', 'lost'])
  status?: string;

  @IsOptional() @IsUUID()
  reseller_id?: string;
}

/**
 * Admin (finance): card payment chargebacks. Stripe's arrive by webhook; other gateways' are recorded here from their
 * dashboards and decided here. Every change is audited.
 */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('finance')
@Controller('admin/chargebacks')
export class AdminChargebacksController {
  constructor(private readonly chargebacks: ChargebacksService) {}

  @Get()
  list(@Query() filter: ChargebackFilterDto) {
    return this.chargebacks.list(filter);
  }

  @Post()
  record(@CurrentCaller() caller: Caller, @Body() body: RecordChargebackDto) {
    return this.chargebacks.record(adminId(caller), body);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveChargebackDto) {
    return this.chargebacks.resolve(id, body.outcome, adminId(caller), body.reason);
  }

  @Post(':id/clear')
  @HttpCode(HttpStatus.OK)
  clear(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.chargebacks.clear(adminId(caller), id, body.reason);
  }
}
