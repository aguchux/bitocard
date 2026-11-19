import { Body, Controller, Get, HttpCode, HttpStatus, Injectable, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Equals, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service.js';
import { Public } from '../auth/caller.js';
import { PasswordsService } from '../auth/passwords.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { SkipIdempotency } from '../common/idempotency/idempotency.interceptor.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Customer } from '../generated/prisma/client.js';
import { ProductOnly } from '../products/product.js';
import { CurrentCustomer, type CustomerCaller, CustomerGuard } from './customer-session.js';
import { CustomersService } from './customers.service.js';

const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/**
 * A BitoCard customer deleting their own account, from the app (the App Store and Google Play require it in the app) or
 * a store's account pages. Refused while money is theirs or under way: a balance in any of their live wallets, an order
 * paid but not delivered or refunded, a gift card sale being checked, an airtime trade or bank deposit still open, or a
 * payout on its way, so nothing owed is lost.
 *
 * Then, at once and for good: their personal details are removed from the account (name, email, mobile numbers,
 * password, Google sign-in, two-step secrets), every session is signed out and every device forgotten. What the law
 * asks BitoCard to keep (orders, payments, the ledger) stays, tied to an account with no details. The email can sign up
 * again as a new account.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  /** What stands in the way of deleting, for the app to say before asking (`blockers` empty: it can be deleted). */
  async check(customer: Customer) {
    const customerId = customer.id;
    const [money, orders, cardSales, airtime, deposits, payouts] = await Promise.all([
      this.prisma.ledgerAccount.count({ where: { customerId, mode: 'live', balanceMinor: { not: 0n } } }),
      this.prisma.checkout.count({ where: { customerId, status: { in: ['paid', 'refund_pending'] } } }),
      this.prisma.giftCardSale.count({ where: { customerId, status: { in: ['submitting', 'pending'] } } }),
      Promise.all([
        this.prisma.airtimeSale.count({ where: { customerId, status: { in: ['awaiting_transfer', 'sent', 'received'] } } }),
        this.prisma.airtimePurchase.count({ where: { customerId, status: { in: ['paid', 'delivering'] } } }),
      ]).then(([sales, purchases]) => sales + purchases),
      this.prisma.bankDeposit.count({ where: { customerId, status: { in: ['awaiting_payment', 'sent'] } } }),
      this.prisma.customerPayout.count({ where: { customerId, status: { in: ['pending', 'processing'] } } }),
    ]);
    const blockers: { code: string; message: string }[] = [];
    if (money) blockers.push({ code: 'account_has_money', message: 'Your wallets still hold money. Spend it first, or ask us to help.' });
    if (orders) blockers.push({ code: 'account_has_open_orders', message: 'You have orders still on their way or being refunded. Wait until they end.' });
    if (cardSales) blockers.push({ code: 'account_has_gift_card_sales', message: 'A gift card you sold is still being checked. Wait until it is decided.' });
    if (airtime) blockers.push({ code: 'account_has_airtime_trades', message: 'You have airtime trades still open. Finish or cancel them first.' });
    if (deposits) blockers.push({ code: 'account_has_bank_deposits', message: 'You have a bank deposit still open. Cancel it, or wait until it is credited.' });
    if (payouts) blockers.push({ code: 'account_has_payouts', message: 'A payout to your bank is still on its way. Wait until it arrives.' });
    return { object: 'account_deletion_check' as const, can_delete: blockers.length === 0, password_required: Boolean(customer.passwordHash), blockers };
  }

  async delete(customer: Customer, input: { confirm: string; password?: string }) {
    if (input.confirm !== 'DELETE') throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'confirmation_required', 'Type DELETE to confirm.', 'confirm');
    if (customer.passwordHash) {
      if (customer.lockedUntil && customer.lockedUntil > new Date()) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many wrong attempts. Try again in 15 minutes, or reset your password.');
      }
      if (!input.password || !(await this.passwords.verify(customer.passwordHash, input.password))) {
        await this.customers.recordFailedSignIn(customer.id);
        throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'password_incorrect', 'Your password is wrong.', 'password');
      }
    }
    const { blockers } = await this.check(customer);
    if (blockers.length) throw conflict(blockers[0]!.code, blockers[0]!.message);

    const now = new Date();
    const deleted = await this.prisma.$transaction(async tx => {
      // Claimed once: a second request finds it gone.
      const claimed = await tx.customer.updateMany({
        where: { id: customer.id, deletedAt: null },
        data: {
          email: `deleted.${customer.id}@deleted.bitocard.invalid`,
          name: 'Deleted account',
          passwordHash: null,
          googleSubject: null,
          phone: null,
          phoneVerifiedAt: null,
          totpSecretEncrypted: null,
          mfaSetupSecretEncrypted: null,
          mfaRecoveryCodeHashes: [],
          status: 'disabled',
          deletedAt: now,
        },
      });
      if (claimed.count === 0) return false;
      await tx.customerPhone.deleteMany({ where: { customerId: customer.id } });
      await tx.customerCode.deleteMany({ where: { customerId: customer.id } });
      await tx.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.device.deleteMany({ where: { customerId: customer.id } });
      await tx.notificationPreference.deleteMany({ where: { customerId: customer.id } });
      return true;
    });
    if (!deleted) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This account was already deleted.');
    // Only that it happened: never the details that were removed.
    await this.audit.record({ actorId: null, action: 'customer.account_deleted', targetType: 'customer', targetId: customer.id });
    return { object: 'account_deletion' as const, deleted: true, deleted_at: now.toISOString() };
  }
}

class DeleteAccountDto {
  @Equals('DELETE', { message: 'Type DELETE to confirm.' })
  confirm: string;

  @IsOptional() @IsString() @MaxLength(128)
  password?: string;
}

/** Deleting the signed-in customer's own account (left out of the public OpenAPI document). */
@ApiExcludeController()
@Public()
@UseGuards(CustomerGuard)
@ProductOnly('bitocard')
@Controller('store/account')
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  /** What stands in the way of deleting the account (money, open orders and trades), shown before asking. */
  @Get('delete')
  check(@CurrentCustomer() caller: CustomerCaller) {
    return this.deletion.check(caller.customer);
  }

  /** Deletes the account for good: `confirm: "DELETE"`, and the password when the account has one. */
  @Post('delete')
  @SkipIdempotency()
  @HttpCode(HttpStatus.OK)
  remove(@CurrentCustomer() caller: CustomerCaller, @Body() body: DeleteAccountDto) {
    return this.deletion.delete(caller.customer, body);
  }
}
