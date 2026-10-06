import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { LedgerMode } from '../generated/prisma/client.js';
import { ApiError } from '../common/errors/api-error.js';
import { Mode } from '../ledger/mode.js';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { type Caller, CurrentCaller, resellerOf, Roles, Scopes, SessionOnly } from '../auth/caller.js';
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
      'Dashboard only, and live only: a plan is paid from your live wallet, so the sandbox refuses the change (`live_only`). Upgrading charges the first month straight away, in your currency at the rate shown on the exchange-rates list. Moving to Standard keeps Premium until the end of the paid month.',
  })
  @SessionOnly()
  @Roles('finance')
  @Post()
  @HttpCode(HttpStatus.OK)
  change(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: ChangePlanDto) {
    // Plans are real (paid from the live wallet): never change one from sandbox mode by mistake.
    if (mode === 'test') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'live_only', 'Plans are paid from your live wallet. Switch to live to change your plan.');
    return this.billing.change(resellerOf(caller), body.plan);
  }
}
