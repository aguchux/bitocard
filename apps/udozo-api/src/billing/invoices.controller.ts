import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, personOf, RealmOnly, resellerOf, Roles, Scopes, SessionOnly, StepUp, storeScopeOf } from '../auth/caller.js';
import { adminId } from '../countries/countries.controller.js';
import { PageDto } from '../ledger/wallet.controller.js';
import { InvoicesService, maxCreditCents } from './invoices.service.js';

class InvoiceFilterDto extends PageDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only this store’s invoices (an API key sees its store’s and the account’s own).' })
  @IsOptional() @IsUUID()
  store_id?: string;

  @ApiPropertyOptional({ enum: ['open', 'closed', 'paid'], description: '`open`: the month is running; `closed`: something is owed; `paid`: closed with nothing owed.' })
  @IsOptional() @IsIn(['open', 'closed', 'paid'])
  status?: string;
}

class SetCreditLimitDto {
  @ApiProperty({ description: `The credit limit in US cents, 0 to ${maxCreditCents}.` })
  @IsInt() @Min(0) @Max(maxCreditCents)
  cents: number;

  @ApiProperty()
  @IsString() @Length(3, 500)
  reason: string;
}

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @ApiOperation({
    summary: 'List invoices',
    description:
      'Monthly invoices per store, and one for your account’s own usage, in live mode, newest first. Every line was taken from your wallet when it happened; what your wallet could not cover is owed, and your next top-ups pay it, oldest first.',
  })
  @Scopes('wallet:read')
  @Get('invoices')
  list(@CurrentCaller() caller: Caller, @Query() filter: InvoiceFilterDto) {
    return this.invoices.list(resellerOf(caller), filter, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Get an invoice', description: 'The invoice with every line: what each was, what it cost, what was paid and what is still owed.' })
  @Scopes('wallet:read')
  @Get('invoices/:id')
  get(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(resellerOf(caller), id, storeScopeOf(caller));
  }

  @ApiOperation({ summary: 'Pay an invoice', description: 'Dashboard only. Pays what the invoice still owes from your live wallet now: topped-up funds first, then earnings.' })
  @SessionOnly()
  @Roles('finance')
  @Post('invoices/:id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.pay(resellerOf(caller), id);
  }

  @ApiOperation({
    summary: 'Get your credit limit',
    description:
      'What your account may owe BitoCard (US$10 at first, then 25, 50 and 100), what you owe in each currency, and whether you can raise the limit: after a full month’s invoice is paid in full, with nothing owed. At the limit, billable usage stops until what is owed is paid.',
  })
  @Scopes('wallet:read')
  @Get('billing/credit')
  credit(@CurrentCaller() caller: Caller) {
    return this.invoices.credit(resellerOf(caller));
  }

  @ApiOperation({ summary: 'Raise your credit limit', description: 'Dashboard only. One step up (10, 25, 50, 100 US dollars), after a full month’s invoice is paid in full with nothing owed (`credit_raise_unavailable` otherwise).' })
  @SessionOnly()
  @Roles('finance')
  @Post('billing/credit/raise')
  @HttpCode(HttpStatus.OK)
  raise(@CurrentCaller() caller: Caller) {
    return this.invoices.raise(resellerOf(caller), personOf(caller));
  }
}

@ApiExcludeController()
@RealmOnly('admin')
@Controller('admin/resellers')
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @AdminRoles('finance', 'operations', 'support')
  @Get(':id/invoices')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() filter: InvoiceFilterDto) {
    return this.invoices.list(id, filter);
  }

  @AdminRoles('finance', 'operations', 'support')
  @Get(':id/invoices/:invoice')
  get(@Param('id', ParseUUIDPipe) id: string, @Param('invoice', ParseUUIDPipe) invoice: string) {
    return this.invoices.get(id, invoice);
  }

  @AdminRoles('finance', 'operations', 'support')
  @Get(':id/credit')
  credit(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.credit(id);
  }

  /** Sets the reseller's credit limit (up to US$100), or lowers it. Audited. */
  @AdminRoles('finance')
  @StepUp()
  @Put(':id/credit-limit')
  setLimit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SetCreditLimitDto) {
    return this.invoices.setLimit(adminId(caller), id, body.cents, body.reason);
  }
}
