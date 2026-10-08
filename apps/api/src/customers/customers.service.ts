import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PasswordsService } from '../auth/passwords.service.js';
import { numericCode, randomToken, sameDigest, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Customer, type CustomerCodePurpose, Prisma, type Store } from '../generated/prisma/client.js';
import { EmailService } from '../notifications/email.service.js';
import { customerCodeEmail } from '../notifications/templates.js';

const minute = 60 * 1000;
/** Customers stay signed in for 30 days on the store's own cookie. */
export const customerSessionMs = 30 * 24 * 60 * minute;
const touchEveryMs = 5 * minute;
const codeLifetimeMs = 30 * minute;
const resendAfterMs = minute;
const maxCodeAttempts = 5;
const maxFailedSignIns = 5;
const lockMs = 15 * minute;

/** The header a store's server sends the customer's session token in. */
export const customerSessionHeader = 'bitocard-customer-session';

export type CustomerWithStore = Customer & { store: Store };

export function presentCustomer(customer: Customer) {
  return {
    object: 'customer' as const,
    id: customer.id,
    email: customer.email,
    name: customer.name,
    email_verified: customer.emailVerifiedAt !== null,
    created_at: customer.createdAt.toISOString(),
  };
}

const digest = (customerId: string, purpose: CustomerCodePurpose, code: string) => sha256(`customer:${purpose}:${customerId}:${code}`);
const signInFailed = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'invalid_credentials', 'The email or password is wrong.');
const codeInvalid = () => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');

/**
 * Storefront customers: accounts at one store only, owned by the store's reseller (BitoCard's own for bitocard.com).
 * Email and password, with the email confirmed by a 6-digit code before checkout. The store's server holds the session
 * token in its own cookie and sends it to the API in a header; only a hash of it is stored. Codes are emailed under
 * the store's name, single use, 30 minutes, 5 attempts, one resend a minute. Five wrong passwords lock the account for
 * 15 minutes.
 */
@Injectable()
export class CustomersService {
  private readonly logger = new Logger('Customers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly email: EmailService,
  ) {}

  /** The customer signed in with this token, or null (ended, expired or suspended). */
  async resolve(token: string): Promise<{ customer: CustomerWithStore; sessionId: string } | null> {
    const session = await this.prisma.customerSession.findUnique({ where: { tokenHash: sha256(token) }, include: { customer: { include: { store: true } } } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.customer.status !== 'active') return null;
    if (Date.now() - session.lastSeenAt.getTime() > touchEveryMs) await this.prisma.customerSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return { customer: session.customer, sessionId: session.id };
  }

  private async startSession(customerId: string) {
    const token = `bcc_${randomToken()}`;
    const expiresAt = new Date(Date.now() + customerSessionMs);
    await this.prisma.customerSession.create({ data: { customerId, tokenHash: sha256(token), expiresAt } });
    return { token, expires_at: expiresAt.toISOString() };
  }

  async signup(store: Store, input: { email: string; name: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    await this.passwords.assertAcceptable(input.password);
    let customer: Customer;
    try {
      customer = await this.prisma.customer.create({ data: { storeId: store.id, email, name: input.name.trim(), passwordHash: await this.passwords.hash(input.password) } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_taken', 'An account with this email already exists. Sign in instead.', 'email');
      }
      throw error;
    }
    await this.sendCode(customer, store, 'email_verification').catch(error => this.logger.warn({ err: error, customerId: customer.id }, 'Could not send the confirmation code'));
    return { customer: presentCustomer(customer), session: await this.startSession(customer.id) };
  }

  async signin(store: Store, input: { email: string; password: string }) {
    const customer = await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email: input.email.trim().toLowerCase() } } });
    const ok = await this.passwords.verify(customer?.passwordHash ?? null, input.password);
    if (customer?.lockedUntil && customer.lockedUntil > new Date()) {
      // Only someone who knows the password learns the account is locked (as for resellers), so a lock never reveals
      // that an account exists.
      if (ok) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many wrong attempts. Try again in 15 minutes, or reset your password.');
      throw signInFailed();
    }
    if (!customer || !ok || customer.status !== 'active') {
      if (customer) await this.recordFailedSignIn(customer.id);
      throw signInFailed();
    }
    await this.prisma.customer.update({ where: { id: customer.id }, data: { failedSignIns: 0, lockedUntil: null, lastSignInAt: new Date() } });
    return { customer: presentCustomer(customer), session: await this.startSession(customer.id) };
  }

  /** Counts a wrong password atomically (parallel guesses each count) and locks the account at the limit. */
  private async recordFailedSignIn(customerId: string) {
    const { failedSignIns } = await this.prisma.customer.update({ where: { id: customerId }, data: { failedSignIns: { increment: 1 } }, select: { failedSignIns: true } });
    if (failedSignIns < maxFailedSignIns) return;
    await this.prisma.customer.updateMany({
      where: { id: customerId, failedSignIns: { gte: maxFailedSignIns } },
      data: { failedSignIns: 0, lockedUntil: new Date(Date.now() + lockMs) },
    });
  }

  async signout(sessionId: string) {
    await this.prisma.customerSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { object: 'signed_out' as const };
  }

  async updateProfile(customer: Customer, input: { name: string }) {
    return presentCustomer(await this.prisma.customer.update({ where: { id: customer.id }, data: { name: input.name.trim() } }));
  }

  /** Needs the current password (wrong ones count towards the sign-in lockout); signs out the customer's other sessions. */
  async changePassword(customer: Customer, sessionId: string, input: { current_password: string; password: string }) {
    if (customer.lockedUntil && customer.lockedUntil > new Date()) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many wrong attempts. Try again in 15 minutes, or reset your password.');
    }
    if (!(await this.passwords.verify(customer.passwordHash, input.current_password))) {
      await this.recordFailedSignIn(customer.id);
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'password_incorrect', 'Your current password is wrong.', 'current_password');
    }
    await this.passwords.assertAcceptable(input.password);
    await this.prisma.$transaction([
      this.prisma.customer.update({ where: { id: customer.id }, data: { passwordHash: await this.passwords.hash(input.password) } }),
      this.prisma.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: new Date() } }),
    ]);
    return presentCustomer(customer);
  }

  // -- Codes -----------------------------------------------------------------------------------------------------

  private async sendCode(customer: Customer, store: Store, purpose: CustomerCodePurpose) {
    const latest = await this.prisma.customerCode.findFirst({ where: { customerId: customer.id, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    const code = numericCode();
    await this.prisma.$transaction([
      this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.customerCode.create({ data: { customerId: customer.id, purpose, codeHash: digest(customer.id, purpose, code), expiresAt: new Date(Date.now() + codeLifetimeMs) } }),
    ]);
    try {
      await this.email.send(customerCodeEmail(customer.email, { store: store.name, code, purpose }));
    } catch (error) {
      // Not sent: cancel it so another can be asked for at once.
      await this.prisma.customerCode.updateMany({ where: { customerId: customer.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
      throw error;
    }
  }

  private async consumeCode(customer: Customer, purpose: CustomerCodePurpose, code: string) {
    const record = await this.prisma.customerCode.findFirst({ where: { customerId: customer.id, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!record) throw codeInvalid();
    if (record.expiresAt <= new Date()) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_expired', 'That code has expired. Ask for a new one.', 'code');
    // Claim an attempt before comparing, in one statement, so parallel guesses can never get past the limit.
    const attempt = await this.prisma.customerCode.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: maxCodeAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count === 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
    if (!sameDigest(record.codeHash, digest(customer.id, purpose, code))) throw codeInvalid();
    const consumed = await this.prisma.customerCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count === 0) throw codeInvalid();
  }

  async resendVerification(customer: CustomerWithStore) {
    if (customer.emailVerifiedAt) return presentCustomer(customer);
    await this.sendCode(customer, customer.store, 'email_verification');
    return presentCustomer(customer);
  }

  async verifyEmail(customer: Customer, code: string) {
    if (customer.emailVerifiedAt) return presentCustomer(customer);
    await this.consumeCode(customer, 'email_verification', code);
    return presentCustomer(await this.prisma.customer.update({ where: { id: customer.id }, data: { emailVerifiedAt: new Date() } }));
  }

  /** Always answers the same, so it never reveals whether an account exists. */
  async forgotPassword(store: Store, emailAddress: string) {
    const customer = await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email: emailAddress.trim().toLowerCase() } } });
    if (customer?.status === 'active') {
      await this.sendCode(customer, store, 'password_reset').catch(error => {
        if (!(error instanceof ApiError)) this.logger.warn({ err: error, customerId: customer.id }, 'Could not send the reset code');
      });
    }
    return { object: 'password_reset' as const, sent: true };
  }

  /** Sets a new password with the emailed code, confirms the email (the code proved it), and signs out everywhere else. */
  async resetPassword(store: Store, input: { email: string; code: string; password: string }) {
    const customer = await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email: input.email.trim().toLowerCase() } } });
    if (!customer || customer.status !== 'active') throw codeInvalid();
    // Check the new password first, so a refused one does not use up the emailed code.
    await this.passwords.assertAcceptable(input.password);
    await this.consumeCode(customer, 'password_reset', input.code);
    const updated = await this.prisma.$transaction(async tx => {
      await tx.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.customer.update({
        where: { id: customer.id },
        data: { passwordHash: await this.passwords.hash(input.password), failedSignIns: 0, lockedUntil: null, emailVerifiedAt: customer.emailVerifiedAt ?? new Date() },
      });
    });
    return { customer: presentCustomer(updated), session: await this.startSession(customer.id) };
  }
}
