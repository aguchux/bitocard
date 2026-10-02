import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { type Caller, CurrentCaller, resellerOf, Roles, Scopes, SessionOnly } from '../auth/caller';
import { BillingService } from './billing.service';

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
      'Dashboard only. Upgrading charges the first month from your live wallet straight away, in your currency at the rate shown on the exchange-rates list. Moving to Standard keeps Premium until the end of the paid month.',
  })
  @SessionOnly()
  @Roles('finance')
  @Post()
  @HttpCode(HttpStatus.OK)
  change(@CurrentCaller() caller: Caller, @Body() body: ChangePlanDto) {
    return this.billing.change(resellerOf(caller), body.plan);
  }
}
