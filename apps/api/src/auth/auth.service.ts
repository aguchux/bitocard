import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { EmailService } from '../notifications/email.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { emailAddCodeEmail, emailAddedEmail, emailChangedEmail, passwordChangedEmail, passwordResetEmail, verificationEmail } from '../notifications/templates.js';
import { TeamService } from '../team/team.service.js';
import { CountriesService } from '../countries/countries.service.js';
import { CodesService } from './codes.service.js';
import { PasswordsService } from './passwords.service.js';
import { presentMembership, presentUser } from './presenters.js';
import { SessionsService } from './sessions.service.js';
import { SignupVerificationService } from './signup-verification.service.js';
import type { CreateResellerAccountDto, SignUpDto } from './auth.dto.js';
import { InboxService } from '../notifications/inbox.service.js';

export const lockout = { maxFailures: 5, durationMs: 15 * 60 * 1000 };

/** Addresses besides the primary one a person can keep. */
const maxOtherEmails = 4;
const emailInUse = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_in_use', 'Another account already uses this email.', 'email');
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
    private readonly signupVerification: SignupVerificationService,
    private readonly inbox: InboxService,
  ) {}

  async signUp(input: SignUpDto, req: Request, res: Response) {
    const invitation = input.invitation_token ? await this.team.findValid(input.invitation_token, input.email) : null;
    if (!invitation) await this.countries.assertSignupOpen(input.country ?? '');
    await this.passwords.assertAcceptable(input.password);
    if (await this.emailTaken(input.email)) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_in_use', 'An account already uses this email. Sign in instead.', 'email');
    }
    const passwordHash = await this.passwords.hash(input.password);

    let user: User;
    let openedReseller: { id: string; name: string; country: string | null } | null = null;
    try {
      user = await this.prisma.$transaction(async tx => {
        if (invitation) {
          // Invited staff join the inviting reseller; the emailed link proves the address.
          const created = await tx.user.create({ data: { realm: 'reseller', email: input.email, name: input.name, passwordHash, emailVerifiedAt: new Date() } });
          await tx.resellerMember.create({ data: { resellerId: invitation.resellerId, userId: created.id, role: invitation.role } });
          await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
          return created;
        }
        // A sign-up token proves the email was confirmed with a code before the account existed.
        if (input.signup_token) await this.signupVerification.consume(tx, input.email, input.signup_token);
        const created = await tx.user.create({
          data: { realm: 'reseller', email: input.email, name: input.name, passwordHash, emailVerifiedAt: input.signup_token ? new Date() : null },
        });
        const reseller = await tx.reseller.create({ data: { name: input.business_name ?? input.name, country: input.country } });
        await tx.resellerMember.create({ data: { resellerId: reseller.id, userId: created.id, role: 'owner' } });
        openedReseller = reseller;
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_in_use', 'An account already uses this email. Sign in instead.', 'email');
      }
      throw error;
    }

    if (invitation) {
      await this.inbox.reseller(invitation.resellerId, 'team.member_joined', {
        subject: `${invitation.resellerId}:${user.id}`,
        title: `${user.name} joined your team`,
        body: `${user.name} (${user.email}) accepted your invitation as ${invitation.role}.`,
        link: '/team',
      });
    }
    if (openedReseller) await this.newReseller(openedReseller);
    // A delivery problem must not lose the new account: the person can ask for another code.
    if (!user.emailVerifiedAt) await this.sendVerification(user).catch(error => this.logger.error({ err: error }, 'Could not send the sign-up confirmation code'));
    await this.sessions.create(user.id, 'reseller', req, res);
    return this.describe(user.id);
  }

  /** A signed-in person with a confirmed email opens their own reseller account; one owned account per person. */
  async createResellerAccount(userId: string, input: CreateResellerAccountDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_unverified', 'Confirm your email before opening a reseller account.');
    }
    await this.countries.assertSignupOpen(input.country);
    const opened = await this.prisma.$transaction(async tx => {
      // Locks the person's row, so two requests at once cannot both open an account.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      if (await tx.resellerMember.findFirst({ where: { userId, role: 'owner' } })) {
        throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'already_owner', 'You already own a reseller account.');
      }
      const reseller = await tx.reseller.create({ data: { name: input.business_name, country: input.country } });
      await tx.resellerMember.create({ data: { resellerId: reseller.id, userId, role: 'owner' } });
      return reseller;
    });
    await this.newReseller(opened);
    return this.describe(userId);
  }

  /** Tells operations and support a reseller account was opened. */
  private newReseller(reseller: { id: string; name: string; country: string | null }) {
    return this.inbox.admins('admin.reseller.signed_up', {
      subject: reseller.id,
      title: `New reseller: ${reseller.name}`,
      body: `${reseller.name}${reseller.country ? ` (${reseller.country})` : ''} opened a reseller account. It goes live after the identity check.`,
      link: `/resellers/${reseller.id}`,
    });
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

  async updateProfile(userId: string, name: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { name } });
    return this.describe(userId);
  }

  /**
   * Checks the signed-in person's current password before a sensitive change. Wrong passwords count towards the same
   * lockout as sign-in, so a stolen session cannot guess its way to a new password or email.
   */
  private async confirmPassword(user: User, password: string, param: string) {
    if (!user.passwordHash) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'password_not_set', 'Your account has no password yet. Set one with "Forgot password" first.');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many failed attempts. Try again in 15 minutes.');
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      const failures = user.failedSignIns + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: failures >= lockout.maxFailures ? { failedSignIns: 0, lockedUntil: new Date(Date.now() + lockout.durationMs) } : { failedSignIns: failures },
      });
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'password_incorrect', 'Your current password is not right.', param);
    }
    if (user.failedSignIns) await this.prisma.user.update({ where: { id: user.id }, data: { failedSignIns: 0 } });
  }

  /** Changes the password with the current one, and signs out every other session (this one stays signed in). */
  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.confirmPassword(user, current, 'current_password');
    await this.passwords.assertAcceptable(next);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(next) } });
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: new Date() } });
    await this.email.send(passwordChangedEmail(user.email)).catch((error: unknown) => this.logger.error({ err: error }, 'Could not send the password changed notice'));
    await this.inbox.person(userId, 'security.password_changed', {
      subject: String(Date.now()),
      title: 'Your password was changed',
      body: 'Your other sessions were signed out. If this was not you, reset your password and contact support@bitocard.com.',
      link: '/settings/profile',
    });
  }

  // -- Email addresses --------------------------------------------------------------------------------------------
  // The primary address (`users.email`) signs in and gets notices. Others are added with a code sent to them, and one
  // becomes primary only by swapping with the current primary, so a person always has exactly one and it is never removed.

  /** Whether an address already belongs to someone in the realm, as a primary or another address. */
  async emailTaken(email: string, exceptUserId?: string) {
    const [primary, other] = await Promise.all([
      this.prisma.user.findUnique({ where: { realm_email: { realm: 'reseller', email } }, select: { id: true } }),
      this.prisma.userEmail.findUnique({ where: { realm_email: { realm: 'reseller', email } }, select: { userId: true } }),
    ]);
    return Boolean((primary && primary.id !== exceptUserId) || (other && other.userId !== exceptUserId));
  }

  async listEmails(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { emails: { orderBy: { createdAt: 'asc' } } } });
    return {
      object: 'list' as const,
      data: [
        { object: 'user_email' as const, email: user.email, primary: true, verified: user.emailVerifiedAt !== null, added_at: user.createdAt.toISOString() },
        ...user.emails.map(item => ({ object: 'user_email' as const, email: item.email, primary: false, verified: true, added_at: item.createdAt.toISOString() })),
      ],
    };
  }

  /** Step 1 of adding an address: a code is sent to it. Nothing is saved until the code is confirmed. */
  async addEmail(userId: string, email: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { emails: true } });
    if (email === user.email || user.emails.some(item => item.email === email)) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'email_already_added', 'That address is already on your account.', 'email');
    }
    if (user.emails.length >= maxOtherEmails) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'too_many_emails', `You can have up to ${maxOtherEmails + 1} addresses. Remove one first.`, 'email');
    }
    if (await this.emailTaken(email, userId)) throw emailInUse();
    const code = await this.codes.issue(userId, 'email_change', email);
    try {
      await this.email.send(emailAddCodeEmail(email, code));
    } catch (error) {
      await this.codes.cancel(userId, 'email_change');
      this.logger.error({ err: error }, 'Could not send the email confirmation code');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'email_delivery_failed', 'We could not send the email. Try again shortly.');
    }
  }

  /** Step 2: the code proves control of the address, which is added (not primary). The primary address is told. */
  async confirmEmail(userId: string, code: string) {
    const email = await this.codes.consume(userId, 'email_change', code);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (email !== user.email) {
      if (await this.emailTaken(email, userId)) throw emailInUse();
      try {
        await this.prisma.userEmail.create({ data: { userId, realm: user.realm, email, verifiedAt: new Date() } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        // Added already (a repeated confirmation), or taken by someone else in the meantime.
        const mine = await this.prisma.userEmail.findUnique({ where: { realm_email: { realm: user.realm, email } } });
        if (mine?.userId !== userId) throw emailInUse();
      }
      await this.email.send(emailAddedEmail(user.email, email)).catch((error: unknown) => this.logger.error({ err: error }, 'Could not send the email added notice'));
      await this.inbox.person(userId, 'security.email_added', {
        subject: `${email}:${Date.now()}`,
        title: 'An email address was added',
        body: `${email} was added to your account. If this was not you, remove it and change your password.`,
        link: '/settings/profile',
      });
    }
    return this.listEmails(userId);
  }

  /**
   * Makes a confirmed address the primary (sign-in) one; the old primary stays as another address when it was
   * confirmed. Needs the current password when the account has one. The old primary address is told.
   */
  async makePrimary(userId: string, email: string, password: string | undefined) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (email === user.email) return this.listEmails(userId);
    const other = await this.prisma.userEmail.findFirst({ where: { userId, email } });
    if (!other) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'Add and confirm that address first.', 'email');
    if (user.passwordHash) {
      if (!password) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Enter your current password.', 'password');
      await this.confirmPassword(user, password, 'password');
    }
    await this.prisma.$transaction(async tx => {
      await tx.userEmail.delete({ where: { id: other.id } });
      await tx.user.update({ where: { id: userId }, data: { email, emailVerifiedAt: other.verifiedAt } });
      if (user.emailVerifiedAt) await tx.userEmail.create({ data: { userId, realm: user.realm, email: user.email, verifiedAt: user.emailVerifiedAt } });
    });
    await this.email.send(emailChangedEmail(user.email, email)).catch((error: unknown) => this.logger.error({ err: error }, 'Could not send the email changed notice'));
    await this.inbox.person(userId, 'security.email_changed', {
      subject: String(Date.now()),
      title: 'Your primary email was changed',
      body: `You now sign in with ${email} instead of ${user.email}. If this was not you, contact support@bitocard.com.`,
      link: '/settings/profile',
    });
    return this.listEmails(userId);
  }

  /** Removes another address. The primary one cannot be removed: make another address primary first. */
  async removeEmail(userId: string, email: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (email === user.email) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'primary_email', 'Your primary email cannot be removed. Make another address primary first.', 'email');
    }
    const removed = await this.prisma.userEmail.deleteMany({ where: { userId, email } });
    if (!removed.count) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'That address is not on your account.', 'email');
    return this.listEmails(userId);
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
