import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { AdminRoles, type Caller, CurrentCaller, personOf, Public, RealmOnly, StepUp } from '../auth/caller.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import { ProductOnly } from '../products/product.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BankDepositsService, maxDepositMinor, minDepositMinor } from './bank-deposits.service.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);
const currencyRule = { message: 'currency must be a 3-letter code' };

class OptionsQueryDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, currencyRule) currency?: string;
}

const shows = ['open', 'done', 'awaiting_payment', 'sent', 'credited', 'rejected', 'cancelled', 'expired'] as const;

class MyListDto {
  @IsOptional() @IsIn(shows) show?: (typeof shows)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() starting_after?: string;
}

class CreateDto {
  /** Which wallet (the customer's country's currency by default). */
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, currencyRule) currency?: string;
  /** Minor units of the wallet's currency. */
  @Type(() => Number) @IsInt() @Min(minDepositMinor) @Max(maxDepositMinor) amount: number;
  /** One of the accounts offered (the first by default). */
  @IsOptional() @IsUUID() account_id?: string;
}

class SentDto {
  @IsIn(['cash', 'transfer']) method: 'cash' | 'transfer';
  /** The name on the deposit slip or the account the transfer came from. */
  @IsString() @Length(2, 120) sender_name: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class AccountDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/, currencyRule) currency?: string;
  @IsOptional() @IsString() @Length(2, 80) bank_name?: string;
  @IsOptional() @IsString() @Length(2, 120) account_name?: string;
  @IsOptional() @IsString() @Length(4, 40) account_number?: string;
  @IsOptional() @IsString() @MaxLength(300) details?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) position?: number;
}

class NewAccountDto extends AccountDto {
  @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter country code' }) country: string;
  @IsString() @Length(2, 80) declare bank_name: string;
  @IsString() @Length(2, 120) declare account_name: string;
  @IsString() @Length(4, 40) declare account_number: string;
}

class AccountsQueryDto {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter country code' }) country?: string;
}

class ListDto {
  @IsOptional() @IsIn(['awaiting_payment', 'sent', 'credited', 'rejected', 'cancelled', 'expired']) status?: string;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter country code' }) country?: string;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class CreditDto {
  /** What arrived, in minor units (what the customer asked to add by default). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(maxDepositMinor) amount?: number;
  /** The bank's reference for the money that arrived. */
  @IsOptional() @IsString() @MaxLength(120) external_reference?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class RejectDto {
  @IsString() @Length(5, 300) reason: string;
}

const adminOf = (caller: Caller) => personOf(caller)!;

/** A store customer's bank deposits (topping their wallet up by paying into Golojan's bank account). */
@ApiExcludeController()
@ProductOnly('bitocard')
@Public()
@UseGuards(CustomerGuard)
@Controller('store/wallet/bank-deposits')
export class CustomerBankDepositsController {
  constructor(private readonly deposits: BankDepositsService) {}

  @Get('options')
  options(@CurrentCustomer() caller: CustomerCaller, @Query() query: OptionsQueryDto) {
    return this.deposits.options(caller.customer, query.currency);
  }

  @Get()
  list(@CurrentCustomer() caller: CustomerCaller, @Query() query: MyListDto) {
    return this.deposits.list(caller.customer, query);
  }

  @Post()
  create(@CurrentCustomer() caller: CustomerCaller, @Body() body: CreateDto) {
    return this.deposits.create(caller.customer, body);
  }

  @Get(':id')
  get(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.deposits.get(caller.customer, id);
  }

  @Post(':id/sent')
  @HttpCode(HttpStatus.OK)
  sent(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SentDto) {
    return this.deposits.markSent(caller.customer, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    return this.deposits.cancel(caller.customer, id);
  }
}

/** Admin: Golojan's receiving accounts per market, and customers' bank deposits to check and credit. */
@ApiExcludeController()
@ProductOnly('bitocard')
@RealmOnly('admin')
@Controller('admin')
export class AdminBankDepositsController {
  constructor(private readonly deposits: BankDepositsService) {}

  @AdminRoles('finance', 'operations', 'support')
  @Get('bank-deposit-accounts')
  accounts(@Query() query: AccountsQueryDto) {
    return this.deposits.accounts(query.country);
  }

  // Where customers send money: a change here redirects real payments, so finance only, after step-up.
  @AdminRoles('finance')
  @StepUp()
  @Post('bank-deposit-accounts')
  createAccount(@CurrentCaller() caller: Caller, @Body() body: NewAccountDto) {
    return this.deposits.createAccount(adminOf(caller), body);
  }

  @AdminRoles('finance')
  @StepUp()
  @Patch('bank-deposit-accounts/:id')
  updateAccount(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: AccountDto) {
    return this.deposits.updateAccount(adminOf(caller), id, body);
  }

  @AdminRoles('finance')
  @StepUp()
  @Delete('bank-deposit-accounts/:id')
  deleteAccount(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string) {
    return this.deposits.deleteAccount(adminOf(caller), id);
  }

  @AdminRoles('finance', 'operations', 'support')
  @Get('bank-deposits')
  list(@Query() query: ListDto) {
    return this.deposits.adminList(query);
  }

  @AdminRoles('finance', 'operations', 'support')
  @Get('bank-deposits/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.deposits.adminGet(id);
  }

  @AdminRoles('finance')
  @StepUp()
  @Post('bank-deposits/:id/credit')
  @HttpCode(HttpStatus.OK)
  credit(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreditDto) {
    return this.deposits.credit(adminOf(caller), id, body);
  }

  @AdminRoles('finance', 'operations')
  @Post('bank-deposits/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentCaller() caller: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() body: RejectDto) {
    return this.deposits.reject(adminOf(caller), id, body.reason);
  }
}

@Module({
  imports: [CheckoutModule, SettingsModule],
  controllers: [CustomerBankDepositsController, AdminBankDepositsController],
  providers: [BankDepositsService],
  exports: [BankDepositsService],
})
export class BankDepositsModule {}
