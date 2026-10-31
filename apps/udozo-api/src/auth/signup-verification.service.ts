import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { numericCode, randomToken, sameDigest, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { EmailService } from '../notifications/email.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { customerSignupCodeEmail, signupCodeEmail } from '../notifications/templates.js';
import type { Prisma } from '../generated/prisma/client.js';
import { maxCodeAttempts, maxCodesPerDay } from './codes.service.js';

const codeLifetimeMs = 30 * 60 * 1000;
const resendAfterMs = 60 * 1000;
/** How long a confirmed email stays usable for finishing sign-up. */
export const signupTokenLifetimeMs = 60 * 60 * 1000;
const keepMs = 24 * 60 * 60 * 1000;

const digest = (email: string, code: string) => sha256(`signup:${email}:${code}`);
const phoneDigest = (signupId: string, phone: string, code: string) => sha256(`signup-phone:${signupId}:${phone}:${code}`);
/** Texts per sign-up: each is paid for, so one confirmed inbox cannot send many. */
const maxPhoneCodesPerSignup = 5;
const tokenInvalid = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'signup_token_invalid', 'Your email confirmation has expired. Confirm your email again.', 'signup_token');

/**
 * Step-by-step sign-up confirms the email before the account exists: a 6-digit code is emailed (hashed, 30 minutes,
 * 5 attempts, one resend a minute) and, once entered, exchanged for a one-hour sign-up token. Sign-up with the token
 * creates the account with its email already confirmed. Then the owner's mobile number can be confirmed the same way,
 * by a texted code (`startPhone`, `verifyPhone`), so the account starts with it as a confirmed sign-in number. Only
 * hashes are stored; rows are removed after a day.
 *
 * Seller HQ's sign-ups have no store (`storeId` null). A store customer's (udozo.com) carries the store whose accounts
 * it opens (`storeId`): its caller checks the email and number are free there, and a token works only for that store.
 */
@Injectable()
export class SignupVerificationService {
  private readonly logger = new Logger('SignupVerification');

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
  ) {}

  /** Emails the code. `customer`: a store customer's sign-up (its caller has checked the email is free at the store). */
  async start(email: string, customer?: { storeId: string; storeName: string }) {
    const storeId = customer?.storeId ?? null;
    if (!customer) {
      // Taken as someone's primary address or as one of their other addresses.
      const [primary, other] = await Promise.all([
        this.prisma.user.findUnique({ where: { realm_email: { realm: 'reseller', email } } }),
        this.prisma.userEmail.findUnique({ where: { realm_email: { realm: 'reseller', email } } }),
      ]);
      if (primary || other) {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_in_use', 'An account already uses this email. Sign in instead.', 'email');
      }
    }
    await this.prisma.signupVerification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - keepMs) } } });
    const latest = await this.prisma.signupVerification.findFirst({ where: { email, storeId, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    // A daily cap per address (rows are kept a day), so nobody can flood someone's inbox from many machines.
    if ((await this.prisma.signupVerification.count({ where: { email } })) >= maxCodesPerDay) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_daily_limit', 'Too many codes were sent to this address today. Try again tomorrow.');
    }
    const code = numericCode();
    const [, created] = await this.prisma.$transaction([
      this.prisma.signupVerification.updateMany({ where: { email, storeId, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.signupVerification.create({ data: { email, storeId, codeHash: digest(email, code), expiresAt: new Date(Date.now() + codeLifetimeMs) } }),
    ]);
    try {
      await this.email.send(customer ? customerSignupCodeEmail(email, code, customer.storeName) : signupCodeEmail(email, code));
    } catch (error) {
      // Lets the person ask again at once.
      await this.prisma.signupVerification.update({ where: { id: created.id }, data: { consumedAt: new Date() } });
      this.logger.error({ err: error }, 'Could not send the sign-up code');
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'email_unavailable', 'We could not send the code. Try again in a moment.');
    }
  }

  /** Checks the code and returns the sign-up token (shown once). */
  async verify(email: string, code: string, storeId: string | null = null) {
    const record = await this.prisma.signupVerification.findFirst({ where: { email, storeId, consumedAt: null, verifiedAt: null }, orderBy: { createdAt: 'desc' } });
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

  /**
   * Inside the sign-up transaction: uses up the token, which must belong to this email. With `phone`, says whether that
   * number was confirmed with a texted code during this sign-up (the confirmation is used up with it).
   */
  async consume(tx: Prisma.TransactionClient, email: string, token: string, phone: string | null = null, storeId: string | null = null) {
    const record = await tx.signupVerification.findUnique({ where: { tokenHash: sha256(token) } });
    const used = await tx.signupVerification.updateMany({
      where: { tokenHash: sha256(token), email, storeId, verifiedAt: { not: null }, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (used.count === 0 || !record) throw tokenInvalid();
    if (!phone) return { phoneConfirmed: false };
    const confirmed = await tx.signupPhoneVerification.updateMany({
      where: { signupVerificationId: record.id, phone, verifiedAt: { not: null }, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return { phoneConfirmed: confirmed.count > 0 };
  }

  /** The confirmed email's sign-up, still open (its token unused and unexpired). */
  private async openSignup(email: string, token: string, storeId: string | null) {
    const record = await this.prisma.signupVerification.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.email !== email || record.storeId !== storeId || !record.verifiedAt || record.consumedAt || record.expiresAt <= new Date()) throw tokenInvalid();
    return record;
  }

  /**
   * Texts a 6-digit code to the owner's mobile number (E.164, already checked against the business country) through the
   * country's SMS provider. Only after the email is confirmed, so texts cannot be sent without a real inbox: one a
   * minute, five per sign-up and `maxCodesPerDay` a day per number. Hashed, 30 minutes, 5 attempts.
   */
  async startPhone(email: string, token: string, country: string, phone: string, storeId: string | null = null) {
    const signup = await this.openSignup(email, token, storeId);
    const latest = await this.prisma.signupPhoneVerification.findFirst({ where: { signupVerificationId: signup.id, consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (latest && Date.now() - latest.createdAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    const dayAgo = new Date(Date.now() - keepMs);
    const [forSignup, forPhone] = await Promise.all([
      this.prisma.signupPhoneVerification.count({ where: { signupVerificationId: signup.id } }),
      this.prisma.signupPhoneVerification.count({ where: { phone, createdAt: { gt: dayAgo } } }),
    ]);
    if (forSignup >= maxPhoneCodesPerSignup || forPhone >= maxCodesPerDay) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_daily_limit', 'Too many codes were sent to this number today. Try again tomorrow.', 'phone');
    }
    const code = numericCode();
    const [, created] = await this.prisma.$transaction([
      this.prisma.signupPhoneVerification.updateMany({ where: { signupVerificationId: signup.id, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.signupPhoneVerification.create({
        data: { signupVerificationId: signup.id, phone, codeHash: phoneDigest(signup.id, phone, code), expiresAt: new Date(Date.now() + codeLifetimeMs) },
      }),
    ]);
    try {
      await this.sms.sendForCountry(country, { to: phone, text: `Your BitoCard code is ${code}. It expires in 30 minutes. Never share it.` });
    } catch (error) {
      // Lets the person ask again at once (or carry on without it where the country has no SMS provider).
      await this.prisma.signupPhoneVerification.update({ where: { id: created.id }, data: { consumedAt: new Date() } });
      if (error instanceof ApiError) throw error;
      this.logger.error({ err: error }, 'Could not text the sign-up code');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'sms_delivery_failed', 'We could not send the text message. Check the number and try again.', 'phone');
    }
  }

  /** Checks the texted code: the number is then confirmed for this sign-up, and signs in once the account is made. */
  async verifyPhone(email: string, token: string, code: string, storeId: string | null = null) {
    const signup = await this.openSignup(email, token, storeId);
    const record = await this.prisma.signupPhoneVerification.findFirst({ where: { signupVerificationId: signup.id, consumedAt: null, verifiedAt: null }, orderBy: { createdAt: 'desc' } });
    const invalid = new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');
    if (!record) throw invalid;
    if (record.expiresAt <= new Date()) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_expired', 'That code has expired. Ask for a new one.', 'code');
    }
    // Claim an attempt before comparing, in one statement, so parallel guesses can never get past the limit.
    const attempt = await this.prisma.signupPhoneVerification.updateMany({
      where: { id: record.id, consumedAt: null, verifiedAt: null, attempts: { lt: maxCodeAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count === 0) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
    }
    if (!sameDigest(record.codeHash, phoneDigest(signup.id, record.phone, code))) throw invalid;
    const verifiedAt = new Date();
    const claimed = await this.prisma.signupPhoneVerification.updateMany({ where: { id: record.id, verifiedAt: null, consumedAt: null }, data: { verifiedAt } });
    if (claimed.count === 0) throw invalid;
    return { object: 'signup_phone_verification' as const, phone: record.phone, verified_at: verifiedAt.toISOString() };
  }
}
