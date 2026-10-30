import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, personOf, RealmOnly, resellerOf, Roles, SessionOnly, StepUp } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { adminId } from '../countries/countries.controller.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { ProductOnly } from '../products/product.js';
import { SetupFeesService } from './setup-fees.service.js';

class SetupFeeDto {
  @IsBoolean() enabled: boolean;
  /** In the market's currency, minor units. */
  @IsInt() @Min(0) @Max(1_000_000_000_000) amount: number;
}

/** A Udozo seller's one-time Seller HQ setup fee (docs/UDOZO_SPINOFF_PLAN.md, step 3). */
@ApiExcludeController()
@SessionOnly()
@Controller('billing/setup-fee')
@ProductOnly('udozo')
export class SetupFeeController {
  constructor(private readonly fees: SetupFeesService) {}

  @Get()
  status(@CurrentCaller() caller: Caller) {
    return this.fees.status(resellerOf(caller));
  }

  /** Pays it from the live wallet (with a store's first Premium month it is paid there instead). */
  @Roles('finance')
  @Post()
  @HttpCode(HttpStatus.OK)
  pay(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    if (mode === 'test') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'live_only', 'The setup fee is paid from your live wallet. Switch to live to pay it.');
    return this.fees.pay(resellerOf(caller), personOf(caller));
  }
}

/** Udozo's admins: each market's setup fee. */
@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/setup-fees')
@ProductOnly('udozo')
export class AdminSetupFeesController {
  constructor(private readonly fees: SetupFeesService) {}

  @AdminRoles('finance', 'operations', 'support')
  @Get()
  list() {
    return this.fees.list();
  }

  @AdminRoles('finance')
  @StepUp()
  @Put(':country')
  set(@CurrentCaller() caller: Caller, @Param('country') country: string, @Body() body: SetupFeeDto) {
    return this.fees.set(adminId(caller), country, body);
  }
}
