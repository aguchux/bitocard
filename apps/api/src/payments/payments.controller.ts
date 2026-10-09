import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUrl, Max, Min } from 'class-validator';
import { paymentGateways } from './payment-providers.js';
import { type Caller, CurrentCaller, resellerOf, Roles, Scopes } from '../auth/caller.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { ChargebacksService } from './chargebacks.service.js';
import { PaymentsService } from './payments.service.js';

/** Largest single top-up or deposit simulation, in minor units. */
const maxAmount = 100_000_000_00;

class CreateTopUpDto {
  @ApiProperty({ description: 'Minor units of the wallet currency (for example 500000 = NGN 5,000.00).', minimum: 100, example: 500000 })
  @IsInt() @Min(100) @Max(maxAmount)
  amount: number;

  @ApiPropertyOptional({ description: 'How to pay: one of the methods `GET /v1/wallet/payment-methods` lists (default: the first). Test mode always uses the sandbox payment page.', enum: Object.keys(paymentGateways) })
  @IsOptional() @IsIn(Object.keys(paymentGateways))
  method?: string;

  @ApiPropertyOptional({ description: 'HTTPS page the payer returns to after paying.' })
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  return_url?: string;
}

class SimulateTopUpDto {
  @ApiProperty({ enum: ['succeeded', 'failed'] })
  @IsIn(['succeeded', 'failed'])
  outcome: 'succeeded' | 'failed';
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
  constructor(
    private readonly payments: PaymentsService,
    private readonly chargebacks: ChargebacksService,
  ) {}

  @ApiOperation({
    summary: 'List chargebacks',
    description:
      'Card payments into your wallet or your store that the cardholder disputed (chargebacks), newest first. While one is `open` its amount is held from your wallet (`held`; what the wallet could not cover is `shortfall`) and withdrawals wait (`payouts_on_hold`). Won: the hold comes back. Lost: it is returned to the cardholder. With chargeback protection (`protected`, the Premium plan) nothing is held and BitoCard bears a loss.',
  })
  @Scopes('wallet:read')
  @Get('chargebacks')
  listChargebacks(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() page: PageDto) {
    return this.chargebacks.forReseller(resellerOf(caller), mode, page);
  }

  @ApiOperation({
    summary: 'List top-up payment methods',
    description: 'The ways to top up in your country, best first: card, bank or mobile money, as BitoCard offers them in your market. Empty when none is available yet (reserved bank accounts may still be).',
  })
  @Scopes('wallet:read')
  @Get('payment-methods')
  topUpMethods(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.payments.topUpMethods(resellerOf(caller), mode);
  }

  @ApiOperation({
    summary: 'Top up the wallet',
    description:
      'Returns a `checkout_url` for the payer to pay with the chosen `method` (card, bank or mobile money; see `GET /v1/wallet/payment-methods`). The wallet is credited once the payment provider confirms it. Live top-ups need a verified business; in test mode, finish it with the simulate endpoint.',
  })
  @Scopes('wallet:write')
  @Post('top-ups')
  async createTopUp(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: CreateTopUpDto) {
    const resellerId = resellerOf(caller);
    const payer = await this.payments.contactFor(resellerId, caller.kind === 'session' ? caller.userId : null);
    return this.payments.createTopUp(resellerId, mode, payer, body);
  }

  @ApiOperation({ summary: 'List top-ups', description: 'Checkout payments and bank transfers into your reserved accounts, newest first; `source` is `checkout` or `bank_transfer`.' })
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
    description:
      'Where your country offers them. Asking again returns the existing accounts. Live accounts need a verified business and BitoCard to switch them on for you; in Nigeria the owner must pass the BVN check first (`POST /v1/account/bvn`), whose BVN the bank uses.',
  })
  @Scopes('wallet:write')
  @Post('reserved-accounts')
  async createReservedAccounts(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    const resellerId = resellerOf(caller);
    const owner = await this.payments.contactFor(resellerId, caller.kind === 'session' ? caller.userId : null);
    return this.payments.createReservedAccounts(resellerId, mode, owner);
  }

  @ApiOperation({ summary: 'Simulate a bank transfer into a reserved account (test mode)' })
  @Scopes('wallet:write')
  @Post('reserved-accounts/:id/simulate-deposit')
  @HttpCode(HttpStatus.OK)
  simulateDeposit(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulateDepositDto) {
    return this.payments.simulateDeposit(resellerOf(caller), mode, id, body.amount);
  }
}
