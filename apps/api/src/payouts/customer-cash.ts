import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AdminRoles, Public, RealmOnly } from '../auth/caller.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { ApiError } from '../common/errors/api-error.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from '../customers/customer-session.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IdentityService } from '../identity/identity.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProductOnly } from '../products/product.js';
import { CustomerPayoutsService } from './customer-payouts.service.js';
import { PayoutsModule } from './payouts.module.js';

/**
 * Who may pay out their withdrawable money (Safe pay sales, and a resale supplier's share) and in what: the store's
 * seller and mode, the market's currency, and, live, the name their identity check verified, which the bank account
 * must carry. An email confirmed and, live, the identity check; never whether the store is open now, so closing a
 * store never traps money (docs/UDOZO_SPINOFF_PLAN.md, step 3: moved out of the crypto code it began in).
 */
@Injectable()
export class CustomerCashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoreSellers,
    private readonly identity: IdentityService,
  ) {}

  /** The customer's mode, seller and market, without the checks (lists and removing an account). */
  async context(customer: CustomerWithStore) {
    const seller = this.stores.isHouse(customer.store)
      ? await this.stores.sellerFor(customer)
      : await this.prisma.reseller.findUniqueOrThrow({ where: { id: customer.store.resellerId } });
    if (!seller.country) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'store_unavailable', 'This store is not open.');
    const market = await this.prisma.country.findUniqueOrThrow({ where: { code: seller.country }, select: { code: true, currency: true } });
    return { mode: this.stores.mode(customer.store), seller, country: market.code, currency: market.currency };
  }

  /** The checks before paying money out, and what the payout needs. */
  async requireCashOut(customer: CustomerWithStore) {
    if (!customer.emailVerifiedAt) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    const context = await this.context(customer);
    if (context.mode === 'live' && !(await this.identity.isCustomerVerified(context.seller.id, context.mode, customer.id))) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'customer_verification_required', 'Verify your identity before paying money out.');
    }
    const verifiedName = context.mode === 'live' ? await this.identity.customerVerifiedName(context.seller.id, context.mode, customer.id) : null;
    return { customer, mode: context.mode, sellerId: context.seller.id, country: context.country, currency: context.currency, verifiedName };
  }
}

class CustomerBankAccountDto {
  @IsString() @Length(1, 20)
  bank_code: string;

  @Matches(/^\d{6,20}$/, { message: 'account_number must be the account number, digits only' })
  account_number: string;
}

class CustomerPayoutDto {
  /** Minor units of the customer's currency. */
  @IsInt() @Min(1) @Max(1_000_000_000_000_00)
  amount: number;

  @IsUUID()
  bank_account_id: string;
}

class SimulatePayoutDto {
  @IsIn(['paid', 'failed'])
  outcome: 'paid' | 'failed';
}

class CustomerPayoutListDto {
  @IsOptional() @IsIn(['live', 'test'])
  mode?: LedgerMode;

  @IsOptional() @IsIn(['pending', 'processing', 'paid', 'failed'])
  status?: string;

  @IsOptional() @IsUUID()
  customer_id?: string;
}

/** A customer's withdrawable money paid out to their own bank account, at `/v1/store/cash`. */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@Controller('store/cash')
@ProductOnly('udozo')
export class CustomerCashController {
  constructor(
    private readonly cash: CustomerCashService,
    private readonly payouts: CustomerPayoutsService,
  ) {}

  @Get()
  async balance(@CurrentCustomer() caller: CustomerCaller) {
    return this.payouts.balance(await this.cash.requireCashOut(caller.customer));
  }

  @Get('banks')
  async banks(@CurrentCustomer() caller: CustomerCaller) {
    return this.payouts.banks(await this.cash.requireCashOut(caller.customer));
  }

  @Get('bank-accounts')
  async accounts(@CurrentCustomer() caller: CustomerCaller) {
    const { mode } = await this.cash.context(caller.customer);
    return this.payouts.accounts(caller.customer.id, mode);
  }

  @Post('bank-accounts')
  async addAccount(@CurrentCustomer() caller: CustomerCaller, @Body() body: CustomerBankAccountDto) {
    return this.payouts.addAccount(await this.cash.requireCashOut(caller.customer), body);
  }

  @Delete('bank-accounts/:id')
  async removeAccount(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string) {
    const { mode } = await this.cash.context(caller.customer);
    return this.payouts.removeAccount(caller.customer.id, mode, id);
  }

  @Get('payouts')
  async list(@CurrentCustomer() caller: CustomerCaller) {
    const { mode } = await this.cash.context(caller.customer);
    return this.payouts.list(caller.customer.id, mode);
  }

  @Post('payouts')
  async create(@CurrentCustomer() caller: CustomerCaller, @Body() body: CustomerPayoutDto) {
    return this.payouts.create(await this.cash.requireCashOut(caller.customer), body);
  }

  /** Sandbox stores only. */
  @Post('payouts/:id/simulate')
  @HttpCode(HttpStatus.OK)
  async simulate(@CurrentCustomer() caller: CustomerCaller, @Param('id', ParseUUIDPipe) id: string, @Body() body: SimulatePayoutDto) {
    const { mode } = await this.cash.context(caller.customer);
    return this.payouts.simulate(caller.customer.id, mode, id, body.outcome);
  }
}

/** Admins: customers' payouts of their withdrawable money to their banks. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'finance', 'support')
@Controller('admin/customer-payouts')
@ProductOnly('udozo')
export class AdminCustomerPayoutsController {
  constructor(private readonly payouts: CustomerPayoutsService) {}

  @Get()
  list(@Query() query: CustomerPayoutListDto) {
    return this.payouts.adminList(query);
  }
}

@Module({
  imports: [CheckoutModule, IdentityModule, PayoutsModule],
  controllers: [CustomerCashController, AdminCustomerPayoutsController],
  providers: [CustomerCashService],
})
export class CustomerCashModule {}
