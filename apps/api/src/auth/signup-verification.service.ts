import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { numericCode, randomToken, sameDigest, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { EmailService } from '../notifications/email.service.js';
import { signupCodeEmail } from '../notifications/templates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { maxCodeAttempts, maxCodesPerDay } from './codes.service.js';

const codeLifetimeMs = 30 * 60 * 1000;
const resendAfterMs = 60 * 1000;
/** How long a confirmed email stays usable for finishing sign-up. */
export const signupTokenLifetimeMs = 60 * 60 * 1000;
const keepMs = 24 * 60 * 60 * 1000;

const digest = (email: string, code: string) => sha256(`signup:${email}:${code}`);
const tokenInvalid = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'signup_token_invalid', 'Your email confirmation has expired. Confirm your email again.', 'signup_token');

/**
 * Step-by-step sign-up confirms the email before the account exists: a 6-digit code is emailed (hashed, 30 minutes,
 * 5 attempts, one resend a minute) and, once entered, exchanged for a one-hour sign-up token. Sign-up with the token
 * creates the account with its email already confirmed. Only hashes are stored; rows are removed after a day.
 */
@Injectable()
export class SignupVerificationService {
  private readonly logger = new Logger('SignupVerification');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async start(email: string) {
    // Taken as someone's primary address or as one of their other addresses.
    const [primary, other] = await Promise.all([
      this.prisma.user.findUnique({ where: { realm_email: { realm: 'reseller', email } } }),
      this.prisma.userEmail.findUnique({ where: { realm_email: { realm: 'reseller', email } } }),
    ]);
    if (primary || other) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_in_use', 'An account already uses this email. Sign in instead.', 'email');
    }
    await this.prisma.signupVerification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - keepMs) } } });
    const latest = await this.prisma.signupVerification.findFirst({ where: { email, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    // A daily cap per address (rows are kept a day), so nobody can flood someone's inbox from many machines.
    if ((await this.prisma.signupVerification.count({ where: { email } })) >= maxCodesPerDay) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_daily_limit', 'Too many codes were sent to this address today. Try again tomorrow.');
    }
    const code = numericCode();
    const [, created] = await this.prisma.$transaction([
      this.prisma.signupVerification.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.signupVerification.create({ data: { email, codeHash: digest(email, code), expiresAt: new Date(Date.now() + codeLifetimeMs) } }),
    ]);
    try {
      await this.email.send(signupCodeEmail(email, code));
    } catch (error) {
      // Lets the person ask again at once.
      await this.prisma.signupVerification.update({ where: { id: created.id }, data: { consumedAt: new Date() } });
      this.logger.error({ err: error }, 'Could not send the sign-up code');
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'email_unavailable', 'We could not send the code. Try again in a moment.');
    }
  }

  /** Checks the code and returns the sign-up token (shown once). */
  async verify(email: string, code: string) {
    const record = await this.prisma.signupVerification.findFirst({ where: { email, consumedAt: null, verifiedAt: null }, orderBy: { createdAt: 'desc' } });
    const invalid = new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');
    if (!record) throw invalid;
    if (record.expiresAt <= new Date()) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_expired', 'That code has expired. Ask for a new one.', 'code');
    }
    // Claim an attempt before comparing, in one statement, so parallel guesses can never get past the limit.
    const attempt = await this.prisma.signupVerification.updateMany({
      where: { id: record.id, consumedAt: null, verifiedAt: null, attempts: { lt: maxCodeAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count === 0) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
    }
    if (!sameDigest(record.codeHash, digest(email, code))) throw invalid;
    const token = randomToken();
    const expiresAt = new Date(Date.now() + signupTokenLifetimeMs);
    const claimed = await this.prisma.signupVerification.updateMany({
      where: { id: record.id, verifiedAt: null, consumedAt: null },
      data: { verifiedAt: new Date(), tokenHash: sha256(token), expiresAt },
    });
    if (claimed.count === 0) throw invalid;
    return { object: 'signup_verification' as const, email, signup_token: token, expires_at: expiresAt.toISOString() };
  }

  /** Inside the sign-up transaction: uses up the token, which must belong to this email. */
  async consume(tx: Prisma.TransactionClient, email: string, token: string) {
    const used = await tx.signupVerification.updateMany({
      where: { tokenHash: sha256(token), email, verifiedAt: { not: null }, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (used.count === 0) throw tokenInvalid();
  }
}
