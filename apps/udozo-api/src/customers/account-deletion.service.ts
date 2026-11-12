import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PasswordsService } from '../auth/passwords.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Customer } from '../generated/prisma/client.js';
import { CustomerAppleService } from './customer-apple.service.js';
import { CustomersService } from './customers.service.js';

/** UdozoPay orders still under way: the money in them belongs to someone until they end. */
const openOrderStatuses = ['requested', 'awaiting_payment', 'locked', 'paid', 'sent', 'at_centre', 'disputed'];
/** Buy orders not yet ended. */
const openBuyOrderStatuses = ['requested', 'countered', 'accepted'];
/** Listings taken down with the account; sold ones stay, as their buyers' records. */
const takenDown = ['draft', 'pending_review', 'active', 'expired', 'rejected'];

const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/**
 * A Udozo customer deleting their own account, from the app (the App Store and Google Play require it in the app) or
 * udozo.com. Refused while money is theirs or under way (a balance in any of their live wallets, open UdozoPay orders,
 * open buy orders, a paid Udozo POS plan), so nothing owed is lost.
 *
 * Then, at once and for good: their personal details are removed from the account (name, email, mobile, photos,
 * username, where they live, sign-in links to Google, Facebook and Apple), its listings are taken down, every session is
 * signed out and every device forgotten, and Sign in with Apple's access is revoked. What the law asks Udozo to keep
 * (orders, payments, the ledger) stays, tied to an account with no details. The email can sign up again as a new account.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly customers: CustomersService,
    private readonly apple: CustomerAppleService,
    private readonly audit: AuditService,
  ) {}

  /** What stands in the way of deleting, for the app to say before asking (`blockers` empty: it can be deleted). */
  async check(customer: Customer) {
    const [money, orders, buyOrders, pos] = await Promise.all([
      this.prisma.ledgerAccount.count({ where: { customerId: customer.id, mode: 'live', balanceMinor: { not: 0n } } }),
      this.prisma.classifiedOrder.count({ where: { OR: [{ buyerId: customer.id }, { sellerId: customer.id }], status: { in: openOrderStatuses } } }),
      this.prisma.classifiedBuyOrder.count({ where: { OR: [{ buyerId: customer.id }, { sellerId: customer.id }], status: { in: openBuyOrderStatuses } } }),
      this.prisma.posAccount.findUnique({ where: { customerId: customer.id }, select: { planCode: true } }),
    ]);
    const blockers: { code: string; message: string }[] = [];
    if (money) blockers.push({ code: 'account_has_money', message: 'Your wallet or payouts still hold money. Spend it or pay it out to your bank first.' });
    if (orders) blockers.push({ code: 'account_has_open_orders', message: 'You have UdozoPay orders still under way. Finish or cancel them first.' });
    if (buyOrders) blockers.push({ code: 'account_has_open_buy_orders', message: 'You have buy orders still open. Cancel them, or wait until they end.' });
    if (pos && pos.planCode !== 'free') blockers.push({ code: 'pos_plan_active', message: 'Your Udozo POS account is on a paid plan. Move it to Free first.' });
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
    const apple = { appleRefreshTokenEncrypted: customer.appleRefreshTokenEncrypted };
    const deleted = await this.prisma.$transaction(async tx => {
      // Claimed once: a second request finds it gone.
      const claimed = await tx.customer.updateMany({
        where: { id: customer.id, deletedAt: null },
        data: {
          email: `deleted.${customer.id}@deleted.udozo.invalid`,
          name: 'Deleted account',
          firstName: null,
          lastName: null,
          nameConfirmedAt: null,
          passwordHash: null,
          googleSubject: null,
          facebookSubject: null,
          appleSubject: null,
          appleRefreshTokenEncrypted: null,
          phone: null,
          phoneVerifiedAt: null,
          phoneDeferredAt: null,
          areaId: null,
          birthDate: null,
          sex: null,
          avatarUrl: null,
          bannerUrl: null,
          username: null,
          usernameSetAt: null,
          signupRef: null,
          acquisitionChannel: null,
          acquisitionSource: null,
          acquisitionMedium: null,
          acquisitionCampaign: null,
          acquisitionLanding: null,
          totpSecretEncrypted: null,
          mfaSetupSecretEncrypted: null,
          personalisationOffAt: now,
          status: 'disabled',
          deletedAt: now,
        },
      });
      if (claimed.count === 0) return false;
      await tx.classifiedListing.updateMany({ where: { customerId: customer.id, status: { in: takenDown } }, data: { status: 'deleted' } });
      await tx.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.device.deleteMany({ where: { customerId: customer.id } });
      await tx.notificationPreference.deleteMany({ where: { customerId: customer.id } });
      await tx.customerPresence.deleteMany({ where: { customerId: customer.id } });
      await tx.whatsappContact.deleteMany({ where: { customerId: customer.id } });
      return true;
    });
    if (!deleted) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'This account was already deleted.');
    const revoked = await this.apple.revoke(apple);
    if (!revoked) this.logger.warn({ customerId: customer.id }, 'Sign in with Apple was not revoked for a deleted account');
    // Only that it happened: never the details that were removed.
    await this.audit.record({ actorId: null, action: 'customer.account_deleted', targetType: 'customer', targetId: customer.id, after: { apple_revoked: apple.appleRefreshTokenEncrypted ? revoked : null } });
    return { object: 'account_deletion' as const, deleted: true, deleted_at: now.toISOString() };
  }
}
