import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { type Caller, CurrentCaller, personOf, resellerOf, Roles, Scopes, SessionOnly } from '../auth/caller.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { Mode } from '../ledger/mode.js';
import { modeHeader, PageDto } from '../ledger/wallet.controller.js';
import { PayoutsService } from './payouts.service.js';

class AddBankAccountDto {
  @ApiProperty({ description: 'Bank code from the bank list.' })
  @IsString() @Length(1, 20)
  bank_code: string;

  @ApiProperty({ example: '0123456789' })
  @Matches(/^\d{6,20}$/, { message: 'account_number must be 6 to 20 digits' })
  account_number: string;
}

class CreatePayoutDto {
  @ApiProperty({ description: 'Minor units; at least the country minimum withdrawal.' })
  @IsInt() @Min(1) @Max(100_000_000_00)
  amount: number;

  @ApiProperty()
  @IsUUID()
  bank_account_id: string;
}

class SimulatePayoutDto {
  @ApiProperty({ enum: ['paid', 'failed'] })
  @IsIn(['paid', 'failed'])
  outcome: 'paid' | 'failed';
}

/**
 * Withdrawals of earnings. Anyone with wallet access can read them; adding bank accounts and withdrawing need a
 * signed-in owner or finance member, never an API key.
 */
@ApiTags('Payouts')
@ApiBearerAuth()
@modeHeader
@Roles('finance')
@Scopes('wallet:read')
@Controller()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @ApiOperation({ summary: 'List banks for payouts', description: 'Banks (and mobile money services) in your country, with the codes bank accounts use.' })
  @Get('banks')
  banks(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.payouts.banks(resellerOf(caller), mode);
  }

  @ApiOperation({ summary: 'List payout bank accounts' })
  @Get('bank-accounts')
  listBankAccounts(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode) {
    return this.payouts.listBankAccounts(resellerOf(caller), mode);
  }

  @ApiOperation({
    summary: 'Add a payout bank account',
    description: 'Dashboard only, and only the account owner. The bank confirms the account and supplies its name. Live payouts to a new account start 24 hours after it is added.',
  })
  @SessionOnly()
  // Owners only (no staff role passes): where withdrawals go is the owner's decision, so a finance member's session cannot redirect them.
  @Roles()
  @Post('bank-accounts')
  addBankAccount(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: AddBankAccountDto) {
    return this.payouts.addBankAccount(resellerOf(caller), mode, personOf(caller), body);
  }

  @ApiOperation({ summary: 'Remove a payout bank account', description: 'Dashboard only.' })
  @SessionOnly()
  @Delete('bank-accounts/:id')
  removeBankAccount(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.removeBankAccount(resellerOf(caller), mode, id);
  }

  @ApiOperation({ summary: 'List payouts' })
  @Get('payouts')
  list(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Query() page: PageDto) {
    return this.payouts.listPayouts(resellerOf(caller), mode, page);
  }

  @ApiOperation({ summary: 'Get a payout' })
  @Get('payouts/:id')
  get(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.getPayout(resellerOf(caller), mode, id);
  }

  @ApiOperation({
    summary: 'Withdraw earnings',
    description: 'Dashboard only. Only withdrawable earnings (past the payout hold) can be withdrawn, at least the country minimum. Live payouts need a verified business.',
  })
  @SessionOnly()
  @Post('payouts')
  create(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Body() body: CreatePayoutDto) {
    return this.payouts.createPayout(resellerOf(caller), mode, personOf(caller), body);
  }

  @ApiOperation({ summary: 'Simulate a payout result (test mode)' })
  @SessionOnly()
  @Post('payouts/:id/simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@CurrentCaller() caller: Caller, @Mode() mode: LedgerMode, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulatePayoutDto) {
    return this.payouts.simulatePayout(resellerOf(caller), mode, id, body.outcome);
  }
}
