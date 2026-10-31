import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import type { LedgerMode } from '../generated/prisma/client.js';
import { ApiError } from '../common/errors/api-error.js';
import { Mode } from '../ledger/mode.js';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, personOf, RealmOnly, resellerOf, Roles, Scopes, SessionOnly, StepUp } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { StoreSubscriptionsService } from './store-subscriptions.service.js';
import { BillingService } from './billing.service.js';

class ChangePlanDto {
  @ApiProperty({ description: 'Plan code from the plan list.', example: 'premium' })
  @IsString() @Length(1, 40)
  plan: string;
}

@ApiTags('Plans')
@ApiBearerAuth()
@Controller('subscription')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @ApiOperation({ summary: 'Get your plan', description: 'The current plan, when it renews, and whether it ends at the end of the paid month.' })
  @Scopes('wallet:read')
  @Get()
  get(@CurrentCaller() caller: Caller) {
    return this.billing.subscription(resellerOf(caller));
  }

  @ApiOperation({
    summary: 'Change your plan',
    description:
      'Dashboard only, and live only: a plan is paid from your live wallet, so the sandbox refuses the change (`live_only`). Upgrading charges the first month straight away, in your currency at the rate shown on the exchange-rates list. Moving to Startup keeps Premium until the end of the paid month.',
  })
  @SessionOnly()
  @Roles('finance')
  @Post()
  @HttpCode(HttpStatus.OK)
  change(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ChangePlanDto) {
    // Plans are real (paid from the live wallet): never change one from sandbox mode by mistake.
    if (mode === 'test') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'live_only', 'Plans are paid from your live wallet. Switch to live to change your plan.');
    return this.billing.change(resellerOf(caller), body.plan, personOf(caller));
  }
}

const liveOnly = (mode: LedgerMode) => {
  // Plans are real (paid from the live wallet): never change one from sandbox mode by mistake.
  if (mode === 'test') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'live_only', 'Plans are paid from your live wallet. Switch to live to change a plan.');
};

@ApiTags('Plans')
@ApiBearerAuth()
@Controller()
export class StoreSubscriptionsController {
  constructor(private readonly subscriptions: StoreSubscriptionsService) {}

  @ApiOperation({ summary: 'List your stores’ plans', description: 'Each store’s plan and billing, and the account’s plan (the highest among your stores, which account-wide features follow).' })
  @Scopes('wallet:read')
  @Get('subscriptions')
  list(@CurrentCaller() caller: Caller) {
    return this.subscriptions.list(resellerOf(caller));
  }

  @ApiOperation({ summary: 'Get a store’s plan', description: 'The store’s plan with its price in your currency, when it renews, and any cancellation or downgrade waiting for the end of the month.' })
  @Scopes('wallet:read')
  @Get('stores/:store/subscription')
  get(@CurrentCaller() caller: Caller, @Param('store', ParseUUIDPipe) store: string) {
    return this.subscriptions.view(resellerOf(caller), store);
  }

  @ApiOperation({
    summary: 'Change a store’s plan',
    description:
      'Dashboard only, live only (`live_only` in the sandbox). Each store pays for its own plan from your live wallet, in your currency. Moving up charges now, less credit for the unused part of this month’s plan, and starts a new month; moving down to a cheaper paid plan, or to Startup, waits for the end of the paid month. Choosing the current plan takes back a waiting change.',
  })
  @SessionOnly()
  @Roles('finance')
  @Post('stores/:store/subscription')
  @HttpCode(HttpStatus.OK)
  change(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('store', ParseUUIDPipe) store: string, @Body() body: ChangePlanDto) {
    liveOnly(mode);
    return this.subscriptions.change(resellerOf(caller), store, body.plan, personOf(caller));
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/stores')
export class AdminStoreSubscriptionsController {
  constructor(private readonly subscriptions: StoreSubscriptionsService) {}

  /** Puts a store on a plan without billing it (or back on Startup). Audited. */
  @AdminRoles('operations')
  @StepUp()
  @Put(':id/subscription')
  assign(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChangePlanDto) {
    return this.subscriptions.assign(adminId(caller), id, body.plan);
  }
}
