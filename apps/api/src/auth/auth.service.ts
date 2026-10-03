import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { EmailService } from '../notifications/email.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { passwordResetEmail, verificationEmail } from '../notifications/templates.js';
import { TeamService } from '../team/team.service.js';
import { CountriesService } from '../countries/countries.service.js';
import { CodesService } from './codes.service.js';
import { PasswordsService } from './passwords.service.js';
import { presentMembership, presentUser } from './presenters.js';
import { SessionsService } from './sessions.service.js';
import type { SignUpDto } from './auth.dto.js';

export const lockout = { maxFailures: 5, durationMs: 15 * 60 * 1000 };

const phoneInUse = () =>
  new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'phone_in_use', 'Another account already uses this mobile number.', 'phone');

/**
 * E.164 form of a mobile number. Local formats (0803...) are read using the reseller's country.
 * Fixed lines are refused because they cannot receive the sign-in codes.
 */
export function normalisePhone(raw: string, defaultCountry: string | null) {
  const parsed = parsePhoneNumberFromString(raw, (defaultCountry ?? undefined) as CountryCode | undefined);
  const type = parsed?.getType();
  if (!parsed?.isValid() || (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE')) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'phone_invalid', 'Enter a valid mobile number, for example +2348012345678.', 'phone');
  }
  return parsed.number;
}

const invalidCredentials = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'invalid_credentials', 'The email, phone number or password is incorrect.');

/** Reseller sign-up, sign-in, email verification and password reset. */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly sessions: SessionsService,
    private readonly codes: CodesService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly team: TeamService,
    private readonly countries: CountriesService,
  ) {}

  async signUp(input: SignUpDto, req: Request, res: Response) {
    const invitation = input.invitation_token ? await this.team.findValid(input.invitation_token, input.email) : null;
    if (!invitation) await this.countries.assertSignupOpen(input.country ?? '');
    await this.passwords.assertAcceptable(input.password);
    const passwordHash = await this.passwords.hash(input.password);

    let user: User;
    try {
      user = await this.prisma.$transaction(async tx => {
        if (invitation) {
          // Invited staff join the inviting reseller; the emailed link proves the address.
          const created = await tx.user.create({ data: { realm: 'reseller', email: input.email, name: input.name, passwordHash, emailVerifiedAt: new Date() } });
          await tx.resellerMember.create({ data: { resellerId: invitation.resellerId, userId: created.id, role: invitation.role } });
          await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
          return created;
        }
        const created = await tx.user.create({ data: { realm: 'reseller', email: input.email, name: input.name, passwordHash } });
        const reseller = await tx.reseller.create({ data: { name: input.business_name ?? input.name, country: input.country } });
        await tx.resellerMember.create({ data: { resellerId: reseller.id, userId: created.id, role: 'owner' } });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_in_use', 'An account already uses this email. Sign in instead.', 'email');
      }
      throw error;
    }

    // A delivery problem must not lose the new account: the person can ask for another code.
    if (!user.emailVerifiedAt) await this.sendVerification(user).catch(error => this.logger.error({ err: error }, 'Could not send the sign-up confirmation code'));
    await this.sessions.create(user.id, 'reseller', req, res);
    return this.describe(user.id);
  }

  async signIn(identifier: string, password: string, req: Request, res: Response) {
    const phone = identifier.startsWith('+') ? (parsePhoneNumberFromString(identifier)?.number ?? identifier) : null;
    const user = await this.prisma.user.findFirst({
      where: phone ? { realm: 'reseller', phone, phoneVerifiedAt: { not: null } } : { realm: 'reseller', email: identifier },
    });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, password);
    if (!user || user.status !== 'active') throw invalidCredentials();

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      // Only someone who knows the password learns the account is locked.
      if (valid) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many failed attempts. Try again in 15 minutes.');
      }
      throw invalidCredentials();
    }
    if (!valid) {
      const failures = user.failedSignIns + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: failures >= lockout.maxFailures ? { failedSignIns: 0, lockedUntil: new Date(Date.now() + lockout.durationMs) } : { failedSignIns: failures },
      });
      throw invalidCredentials();
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { failedSignIns: 0, lockedUntil: null, lastSignInAt: new Date() } });
    await this.sessions.create(user.id, 'reseller', req, res);
    return this.describe(user.id);
  }

  async describe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { reseller: true }, orderBy: { createdAt: 'asc' } } },
    });
    return { object: 'session' as const, user: presentUser(user), memberships: user.memberships.map(presentMembership) };
  }

  async resellerCountry(resellerId: string) {
    return (await this.prisma.reseller.findUnique({ where: { id: resellerId } }))?.country ?? null;
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_already_verified', 'Your email is already confirmed.');
    }
    await this.sendVerification(user);
  }

  async verifyEmail(userId: string, code: string) {
    const target = await this.codes.consume(userId, 'email_verification', code);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (target !== user.email) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
    return this.describe(userId);
  }

  /** Always succeeds from the caller's point of view, so it cannot be used to discover accounts. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { realm_email: { realm: 'reseller', email } } });
    if (!user || user.status !== 'active') return;
    try {
      const code = await this.codes.issue(user.id, 'password_reset', user.email);
      await this.email.send(passwordResetEmail(user.email, code));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'code_recently_sent') return;
      this.logger.error({ err: error }, 'Could not send password reset email');
    }
  }

  /** Sets a new password, clears any lock and signs out every existing session. */
  async resetPassword(email: string, code: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { realm_email: { realm: 'reseller', email } } });
    if (!user || user.status !== 'active') {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');
    }
    await this.codes.consume(user.id, 'password_reset', code);
    await this.passwords.assertAcceptable(password);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(password),
        failedSignIns: 0,
        lockedUntil: null,
        // Receiving the code proves control of the email address.
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    await this.sessions.revokeAllForUser(user.id);
  }

  /** Sends a code to a mobile number; it becomes the account's sign-in number once confirmed. */
  async addPhone(userId: string, raw: string, resellerCountry: string | null) {
    const phone = normalisePhone(raw, resellerCountry);
    const taken = await this.prisma.user.findFirst({ where: { realm: 'reseller', phone, phoneVerifiedAt: { not: null }, id: { not: userId } } });
    if (taken) throw phoneInUse();
    const code = await this.codes.issue(userId, 'phone_verification', phone);
    try {
      await this.sms.send({ to: phone, text: `Your BitoCard code is ${code}. It expires in 30 minutes. Never share it.` });
    } catch (error) {
      await this.codes.cancel(userId, 'phone_verification');
      this.logger.error({ err: error }, 'Could not send the phone confirmation code');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'sms_delivery_failed', 'We could not send the text message. Check the number and try again.');
    }
    return { object: 'notice' as const, message: `A code is on its way to ${phone}.`, phone };
  }

  async verifyPhone(userId: string, code: string) {
    const phone = await this.codes.consume(userId, 'phone_verification', code);
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw phoneInUse();
      throw error;
    }
    return this.describe(userId);
  }

  private async sendVerification(user: User) {
    const code = await this.codes.issue(user.id, 'email_verification', user.email);
    try {
      await this.email.send(verificationEmail(user.email, code));
    } catch (error) {
      await this.codes.cancel(user.id, 'email_verification');
      this.logger.error({ err: error }, 'Could not send the email confirmation code');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'email_delivery_failed', 'We could not send the email. Try again shortly.');
    }
  }
}
