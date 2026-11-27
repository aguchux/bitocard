import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PasswordsService } from '../auth/passwords.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Customer } from '../generated/prisma/client.js';
import type { CustomerCaller } from './customer-session.js';

export const transactionPinHeader = 'bitocard-transaction-pin';
const pinPattern = /^\d{6}$/;
const maxFailures = 5;
const lockMs = 15 * 60_000;

const missing = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'transaction_pin_required', 'Enter your transaction PIN to continue.', 'transaction_pin');
const notSet = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'transaction_pin_setup_required', 'Set a transaction PIN in Security before making a transaction.');
const wrong = () => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'transaction_pin_incorrect', 'That transaction PIN is incorrect.', 'transaction_pin');
const locked = () => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'transaction_pin_locked', 'Too many incorrect PIN attempts. Try again in 15 minutes.');

@Injectable()
export class TransactionPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
  ) {}

  status(customer: Pick<Customer, 'transactionPinHash' | 'transactionPinLockedUntil' | 'transactionPinUpdatedAt'>) {
    return {
      object: 'transaction_pin' as const,
      set: Boolean(customer.transactionPinHash),
      locked_until: customer.transactionPinLockedUntil?.toISOString() ?? null,
      updated_at: customer.transactionPinUpdatedAt?.toISOString() ?? null,
    };
  }

  /** Set or replace the PIN only after proving the account password; other signed-in devices are revoked. */
  async set(customer: Customer, sessionId: string, currentPassword: string, pin: string) {
    if (!pinPattern.test(pin)) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'transaction_pin_invalid', 'Choose a six-digit transaction PIN.', 'pin');
    if (/^(\d)\1{5}$/.test(pin) || ['012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321'].includes(pin)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'transaction_pin_weak', 'Choose a PIN that is not repeated or consecutive.', 'pin');
    }
    if (!customer.passwordHash || !(await this.passwords.verify(customer.passwordHash, currentPassword))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'password_incorrect', 'Your current password is wrong.', 'current_password');
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async tx => {
      const row = await tx.customer.update({
        where: { id: customer.id },
        data: { transactionPinHash: await this.passwords.hash(pin), transactionPinFailures: 0, transactionPinLockedUntil: null, transactionPinUpdatedAt: now },
      });
      await tx.customerSession.updateMany({ where: { customerId: customer.id, id: { not: sessionId }, revokedAt: null }, data: { revokedAt: now } });
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
