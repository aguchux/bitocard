import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUrl, Matches, Max, Min } from 'class-validator';
import { type Caller, CurrentCaller, resellerOf, Roles, Scopes } from '../auth/caller';
import type { LedgerMode } from '../generated/prisma/client';
import { Mode } from '../ledger/mode';
import { modeHeader, PageDto } from '../ledger/wallet.controller';
import { PaymentsService } from './payments.service';

/** Largest single top-up or deposit simulation, in minor units. */
const maxAmount = 100_000_000_00;

class CreateTopUpDto {
  @ApiProperty({ description: 'Minor units of the wallet currency (for example 500000 = NGN 5,000.00).', minimum: 100, example: 500000 })
  @IsInt() @Min(100) @Max(maxAmount)
  amount: number;

  @ApiPropertyOptional({ description: 'HTTPS page the payer returns to after paying.' })
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  return_url?: string;
}

class SimulateTopUpDto {
  @ApiProperty({ enum: ['succeeded', 'failed'] })
  @IsIn(['succeeded', 'failed'])
  outcome: 'succeeded' | 'failed';
}

class CreateReservedAccountDto {
  @ApiPropertyOptional({ description: 'Nigeria: the BVN the bank needs to open the account. Passed to the bank, never stored by BitoCard.' })
  @IsOptional() @Matches(/^\d{11}$/, { message: 'bvn must be 11 digits' })
  bvn?: string;
}

class SimulateDepositDto {
  @ApiProperty({ description: 'Minor units.', minimum: 100 })
  @IsInt() @Min(100) @Max(maxAmount)
  amount: number;
}

@ApiTags('Wallet')
@ApiBearerAuth()
@modeHeader
@Roles('admin', 'finance')
@Controller('wallet')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiOperation({
    summary: 'Top up the wallet',
    description:
      'Returns a `checkout_url` for the payer to pay by card, bank or mobile money. The wallet is credited once the payment provider confirms it. Live top-ups need a verified business; in test mode, finish it with the simulate endpoint.',
  })
  @Scopes('wallet:write')
  @Post('top-ups')
  async createTopUp(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: CreateTopUpDto) {
    const resellerId = resellerOf(caller);
    const payer = await this.payments.contactFor(resellerId, caller.kind === 'session' ? caller.userId : null);
    return this.payments.createTopUp(resellerId, mode, payer, body);
  }

  @ApiOperation({ summary: 'List top-ups' })
  @Scopes('wallet:read')
  @Get('top-ups')
  listTopUps(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() page: PageDto) {
    return this.payments.listTopUps(resellerOf(caller), mode, page);
  }

  @ApiOperation({ summary: 'Get a top-up', description: 'A pending top-up is checked with the payment provider first.' })
  @Scopes('wallet:read')
  @Get('top-ups/:id')
  getTopUp(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.getTopUp(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'Simulate a top-up result (test mode)', description: 'Completes a sandbox top-up as paid or failed.' })
  @Scopes('wallet:write')
  @Post('top-ups/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulateTopUp(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateTopUpDto) {
    return this.payments.simulateTopUp(resellerOf(caller), mode, id, body.outcome);
  }

  @ApiOperation({ summary: 'List reserved bank accounts', description: 'Bank transfers into these accounts top up the wallet.' })
  @Scopes('wallet:read')
  @Get('reserved-accounts')
  listReservedAccounts(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.payments.listReservedAccounts(resellerOf(caller), mode);
  }

  @ApiOperation({
    summary: 'Create reserved bank accounts',
    description: 'Where your country offers them. Asking again returns the existing accounts. Live accounts need a verified business.',
  })
  @Scopes('wallet:write')
  @Post('reserved-accounts')
  async createReservedAccounts(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: CreateReservedAccountDto) {
    const resellerId = resellerOf(caller);
    const owner = await this.payments.contactFor(resellerId, caller.kind === 'session' ? caller.userId : null);
    return this.payments.createReservedAccounts(resellerId, mode, owner, body);
  }

  @ApiOperation({ summary: 'Simulate a bank transfer into a reserved account (test mode)' })
  @Scopes('wallet:write')
  @Post('reserved-accounts/:id/simulate-deposit')
  @HttpCode(HttpStatus.OK)
  simulateDeposit(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateDepositDto) {
    return this.payments.simulateDeposit(resellerOf(caller), mode, id, body.amount);
  }
}
