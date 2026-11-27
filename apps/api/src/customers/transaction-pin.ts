import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PasswordsService } from '../auth/passwords.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Customer } from '../generated/prisma/client.js';
import { EmailService } from '../notifications/email.service.js';
import { transactionPinCodeEmail } from '../notifications/templates.js';
import type { CustomerCaller } from './customer-session.js';
import { CustomersService, type CustomerWithStore } from './customers.service.js';

export const transactionPinHeader = 'bitocard-transaction-pin';
const pinPattern = /^\d{6}$/;
const maxFailures = 5;
const lockMs = 15 * 60_000;
const codeVerificationMs = 10 * 60_000;

const missing = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'transaction_pin_required', 'Enter your transaction PIN to continue.', 'transaction_pin');
const notSet = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'transaction_pin_setup_required', 'Set a transaction PIN in Security before making a transaction.');
const wrong = () => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'transaction_pin_incorrect', 'That transaction PIN is incorrect.', 'transaction_pin');
const locked = () => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'transaction_pin_locked', 'Too many incorrect PIN attempts. Try again in 15 minutes.');
const codeRequired = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'transaction_pin_code_required', 'Verify the email code before choosing your new PIN.', 'code');

@Injectable()
export class TransactionPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly customers: CustomersService,
    private readonly email: EmailService,
  ) {}

  status(customer: Pick<Customer, 'transactionPinHash' | 'transactionPinLockedUntil' | 'transactionPinUpdatedAt'>) {
    return {
      object: 'transaction_pin' as const,
      set: Boolean(customer.transactionPinHash),
      locked_until: customer.transactionPinLockedUntil?.toISOString() ?? null,
      updated_at: customer.transactionPinUpdatedAt?.toISOString() ?? null,
    };
  }

  /** Emails a single-use code before the customer creates or changes their PIN. */
  async sendCode(customer: CustomerWithStore, sessionId: string) {
    await this.prisma.customerSession.updateMany({
      where: { id: sessionId, customerId: customer.id, revokedAt: null },
      data: { transactionPinVerifiedAt: null },
    });
    const code = await this.customers.issueCode(customer, 'transaction_pin', customer.email);
    try {
      await this.email.send(transactionPinCodeEmail(customer.email, { store: customer.store.name, code, changing: Boolean(customer.transactionPinHash) }), {
        resellerId: customer.store.resellerId,
        name: customer.store.name,
      });
    } catch (error) {
      await this.customers.cancelCode(customer.id, 'transaction_pin');
      throw error;
    }
    const [name, domain] = customer.email.split('@');
    return { object: 'transaction_pin_code' as const, sent: true, sent_to: `${name.slice(0, 1)}•••@${domain}` };
  }

  /** Consume the emailed OTP and briefly authorize the PIN step on this signed-in session. */
  async verifyCode(customer: Customer, sessionId: string, code: string) {
    await this.customers.consumeCode(customer, 'transaction_pin', code);
    const verifiedAt = new Date();
    const updated = await this.prisma.customerSession.updateMany({
      where: { id: sessionId, customerId: customer.id, revokedAt: null },
      data: { transactionPinVerifiedAt: verifiedAt },
    });
    if (!updated.count) throw codeRequired();
    return {
      object: 'transaction_pin_code_verified' as const,
      verified: true,
      expires_at: new Date(verifiedAt.getTime() + codeVerificationMs).toISOString(),
    };
  }

  /** Set or replace the PIN after the wizard OTP step. `code` remains accepted for older mobile clients. */
  async set(customer: Customer, sessionId: string, code: string | undefined, pin: string) {
    if (!pinPattern.test(pin)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'transaction_pin_invalid', 'Choose a six-digit transaction PIN.', 'pin');
    if (/^(\d)\1{5}$/.test(pin) || ['012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321'].includes(pin)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'transaction_pin_weak', 'Choose a PIN that is not repeated or consecutive.', 'pin');
    }
    if (code !== undefined) {
      if (!/^\d{6}$/.test(code)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'Enter the six-digit code sent to your email.', 'code');
      await this.customers.consumeCode(customer, 'transaction_pin', code);
    } else {
      const consumed = await this.prisma.customerSession.updateMany({
        where: {
          id: sessionId,
          customerId: customer.id,
          revokedAt: null,
          transactionPinVerifiedAt: { gte: new Date(Date.now() - codeVerificationMs) },
        },
        data: { transactionPinVerifiedAt: null },
      });
      if (!consumed.count) throw codeRequired();
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async tx => {
      const row = await tx.customer.update({
        where: { id: customer.id },
        data: { transactionPinHash: await this.passwords.hash(pin), transactionPinFailures: 0, transactionPinLockedUntil: null, transactionPinUpdatedAt: now },
      });
      await tx.customerSession.updateMany({ where: { customerId: customer.id, id: { not: sessionId }, revokedAt: null }, data: { revokedAt: now } });
      await tx.customerSession.updateMany({ where: { id: sessionId, customerId: customer.id }, data: { transactionPinVerifiedAt: null } });
      return row;
    });
    return this.status(updated);
  }

  async verify(customerId: string, pin?: string) {
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (!customer.transactionPinHash) throw notSet();
    if (customer.transactionPinLockedUntil && customer.transactionPinLockedUntil > new Date()) throw locked();
    if (!pin) throw missing();
    if (!pinPattern.test(pin) || !(await this.passwords.verify(customer.transactionPinHash, pin))) {
      const updated = await this.prisma.customer.update({ where: { id: customerId }, data: { transactionPinFailures: { increment: 1 } }, select: { transactionPinFailures: true } });
      if (updated.transactionPinFailures >= maxFailures) {
        await this.prisma.customer.update({ where: { id: customerId }, data: { transactionPinFailures: 0, transactionPinLockedUntil: new Date(Date.now() + lockMs) } });
        throw locked();
      }
      throw wrong();
    }
    if (customer.transactionPinFailures || customer.transactionPinLockedUntil) {
      await this.prisma.customer.update({ where: { id: customerId }, data: { transactionPinFailures: 0, transactionPinLockedUntil: null } });
    }
  }
}

/** Financial mutations only. A preview never moves money and does not consume a PIN attempt. */
@Injectable()
export class TransactionPinGuard implements CanActivate {
  constructor(private readonly pins: TransactionPinService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { customer?: CustomerCaller }>();
    if ((request.body as { preview?: unknown } | undefined)?.preview === true) return true;
    if (!request.customer) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'unauthenticated', 'Sign in to continue.');
    await this.pins.verify(request.customer.customer.id, request.get(transactionPinHeader));
    return true;
  }
}
