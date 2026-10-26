import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { Prisma, type MfaMethod, type TotpCredential, type User } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { twoStepChangedEmail, twoStepCodeEmail } from '../notifications/templates.js';
import { recordFailedSignIn } from './auth.service.js';
import { CodesService } from './codes.service.js';
import { mfaMethods, twoStepAllowed, twoStepPending, twoStepRequired } from './mfa-policy.js';
import { claimTotpStep, newTotpSecret, totpFor, totpStep } from './totp.js';

/** Emailed and texted codes work for 10 minutes, and a method being set up waits as long for its first code. */
const codeLifetimeMs = 10 * 60_000;
const recoveryCodeCount = 10;
const recoveryPattern = /^[a-z0-9]{4}-[a-z0-9]{4}$/;
const issuer = 'BitoCard';

const codeInvalid = () => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mfa_code_invalid', 'That code is not valid. Check it and try again.', 'code');
const locked = () => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many failed attempts. Try again in 15 minutes.');
const notOn = () => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'two_step_off', 'Two-step sign-in is not on for your account.');

function recoveryCode() {
  const raw = randomToken(8).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().padEnd(8, '0').slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** a•••@example.com: enough to recognise the address, not to learn it. */
const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}•••@${domain}`;
};
const maskPhone = (phone: string) => `•••• ${phone.slice(-4)}`;

type Person = User & { totp: TotpCredential | null };

/**
 * Resellers' two-step sign-in in SHQ, chosen per person: an authenticator app, a code emailed to their primary address,
 * or a code texted to their primary confirmed mobile number, each with 10 one-time recovery codes. Required where an
 * admin switches `reseller_two_step` on (global, a market or one reseller); methods are limited by the markets of the
 * person's accounts (`countries.reseller_mfa_methods`). A session stays pending (only this and signing out work, see the
 * guard) until the person finishes the second step on it, or, when it is required, sets a method up.
 */
@Injectable()
export class TwoStepService {
  private readonly logger = new Logger('TwoStep');

  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: CodesService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** What the session endpoints report: whether this session still has to finish signing in. */
  async state(userId: string, sessionId: string | null) {
    const session = sessionId ? await this.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } }) : null;
    const pending = session ? await twoStepPending(this.prisma, session) : null;
    const method = session?.user.mfaMethod ?? (await this.prisma.user.findUnique({ where: { id: userId }, select: { mfaMethod: true } }))?.mfaMethod ?? null;
    return { object: 'two_step_state' as const, pending: Boolean(pending), setup_required: pending?.setup ?? false, method };
  }

  /** The person's two-step settings and what they can choose. */
  async settings(userId: string, sessionId: string) {
    const user = await this.person(userId);
    const [required, allowed, state, smsReady] = await Promise.all([
      twoStepRequired(this.prisma, userId),
      twoStepAllowed(this.prisma, userId),
      this.state(userId, sessionId),
      this.smsReady(user),
    ]);
    return {
      object: 'two_step' as const,
      method: user.mfaMethod,
      enabled_at: user.mfaEnabledAt?.toISOString() ?? null,
      required,
      pending: state.pending,
      setup_required: state.setup_required,
      /** Where the emailed or texted codes go, shown masked. */
      sent_to: user.mfaMethod ? this.target(user, user.mfaMethod).hint : null,
      recovery_codes_left: user.mfaMethod ? user.mfaRecoveryCodeHashes.length : 0,
      methods: mfaMethods.map(method => {
        const reason = !allowed.includes(method) ? ('not_allowed' as const) : method === 'sms' && !user.phoneVerifiedAt ? ('phone_required' as const) : method === 'sms' && !smsReady ? ('sms_unavailable' as const) : null;
        return { method, available: reason === null, reason };
      }),
    };
  }

  /**
   * Starts setting a method up. On a pending session only while the person has no method yet (they must set one up to
   * finish signing in); changing an existing method needs a code from it (`current_code`). An authenticator gets a new
   * secret to scan; email and SMS get a code sent to the primary address or confirmed mobile number.
   */
  async setup(userId: string, sessionId: string, method: MfaMethod, currentCode?: string) {
    const user = await this.person(userId);
    const pending = await this.pending(sessionId);
    if (pending && user.mfaMethod) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'mfa_required', 'Finish signing in with your two-step code first.');
    }
    if (user.mfaMethod) {
      if (!currentCode) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Enter a code from your current two-step method.', 'current_code');
      await this.check(user, currentCode, 'current_code');
    }
    const choice = (await this.settings(userId, sessionId)).methods.find(item => item.method === method);
    if (!choice?.available) {
      const message =
        choice?.reason === 'phone_required'
          ? 'Confirm a mobile number on your profile first, or choose another method.'
          : choice?.reason === 'sms_unavailable'
            ? 'Text messages are not available for your number yet. Choose another method.'
            : 'This method is not available for your account. Choose another one.';
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'two_step_method_unavailable', message, 'method');
    }

    if (method === 'authenticator') {
      const secret = newTotpSecret();
      await this.prisma.user.update({ where: { id: userId }, data: { mfaSetupMethod: method, mfaSetupSecretEncrypted: this.encryption().encrypt(secret), mfaSetupAt: new Date() } });
      return { object: 'two_step_setup' as const, method, secret, otpauth_uri: totpFor(issuer, user.email, secret).toString(), sent_to: null };
    }
    const { to, hint } = this.target(user, method);
    await this.send(user, method, 'mfa_setup', to);
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSetupMethod: method, mfaSetupSecretEncrypted: null, mfaSetupAt: new Date() } });
    return { object: 'two_step_setup' as const, method, secret: null, otpauth_uri: null, sent_to: hint };
  }

  /**
   * Confirms the method being set up with its first code: it becomes the person's method, with new recovery codes
   * (shown once), and this session counts as signed in with it.
   */
  async confirmSetup(userId: string, sessionId: string, code: string) {
    const user = await this.person(userId);
    const method = user.mfaSetupMethod;
    if (!method || !user.mfaSetupAt || Date.now() - user.mfaSetupAt.getTime() > codeLifetimeMs) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'two_step_setup_missing', 'This set-up has expired. Start again.');
    }
    let secret: string | null = null;
    let step: bigint | null = null;
    if (method === 'authenticator') {
      secret = this.encryption().decrypt(user.mfaSetupSecretEncrypted ?? '');
      step = totpStep(totpFor(issuer, user.email, secret), code);
      if (step === null) throw codeInvalid();
    } else {
      const target = await this.codes.consume(userId, 'mfa_setup', code);
      if (target !== this.target(user, method).to) throw codeInvalid();
    }

    const recoveryCodes = Array.from({ length: recoveryCodeCount }, recoveryCode);
    const previous = user.mfaMethod;
    await this.prisma.$transaction(async tx => {
      if (secret !== null) {
        const secretEncrypted = this.encryption().encrypt(secret);
        await tx.totpCredential.upsert({
          where: { userId },
          create: { userId, secretEncrypted, confirmedAt: new Date(), lastUsedStep: step },
          update: { secretEncrypted, confirmedAt: new Date(), lastUsedStep: step, recoveryCodeHashes: [] },
        });
      } else {
        await tx.totpCredential.deleteMany({ where: { userId } });
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaMethod: method,
          mfaEnabledAt: new Date(),
          mfaRecoveryCodeHashes: recoveryCodes.map(sha256),
          mfaSetupMethod: null,
          mfaSetupSecretEncrypted: null,
          mfaSetupAt: null,
          // A code received at the primary address proves it.
          ...(method === 'email' && !user.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
        },
      });
      await tx.session.updateMany({ where: { id: sessionId, userId }, data: { mfaVerifiedAt: new Date() } });
    });
    await this.changed(user, previous ? 'changed' : 'enabled', method, null);
    return { object: 'two_step_enabled' as const, method, recovery_codes: recoveryCodes };
  }

  /**
   * Sends the person's emailed or texted code, to sign in on a pending session or to confirm a change. At most one a
   * minute: asking again sooner answers `sent: false` (the last code still works). Authenticators send nothing.
   */
  async challenge(userId: string) {
    const user = await this.person(userId);
    const method = user.mfaMethod;
    if (!method) throw notOn();
    if (method === 'authenticator') return { object: 'two_step_challenge' as const, method, sent: false, sent_to: null };
    const { to, hint } = this.target(user, method);
    try {
      await this.send(user, method, 'mfa_sign_in', to);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'code_recently_sent') return { object: 'two_step_challenge' as const, method, sent: false, sent_to: hint };
      throw error;
    }
    return { object: 'two_step_challenge' as const, method, sent: true, sent_to: hint };
  }

  /** The second step on a pending session: the method's code or a recovery code. Wrong codes count towards the lockout. */
  async verify(userId: string, sessionId: string, code: string) {
    if (!(await this.pending(sessionId))) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'two_step_not_pending', 'You have already finished signing in.');
    }
    const user = await this.person(userId);
    if (!user.mfaMethod) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'two_step_setup_required', 'Set up two-step sign-in to finish signing in.');
    const used = await this.check(user, code, 'code');
    await this.prisma.session.updateMany({ where: { id: sessionId, userId }, data: { mfaVerifiedAt: new Date() } });
    await this.prisma.user.update({ where: { id: userId }, data: { failedSignIns: 0, lockedUntil: null, lastSignInAt: new Date() } });
    if (used === 'recovery') {
      const left = user.mfaRecoveryCodeHashes.length - 1;
      await this.inbox.person(userId, 'security.two_step_changed', {
        subject: `recovery:${Date.now()}`,
        title: 'A recovery code was used to sign in',
        body: `${left} recovery ${left === 1 ? 'code is' : 'codes are'} left. If this was not you, change your password and contact support@bitocard.com.`,
        link: '/settings/security',
      });
    }
    return { object: 'two_step_verified' as const, method: user.mfaMethod, used };
  }

  /** Turns two-step off with a current code; refused while the person's account requires it. */
  async disable(userId: string, code: string) {
    const user = await this.person(userId);
    if (!user.mfaMethod) throw notOn();
    if (await twoStepRequired(this.prisma, userId)) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'two_step_enforced', 'Your reseller account requires two-step sign-in, so it cannot be turned off. You can change the method instead.');
    }
    await this.check(user, code, 'code');
    await this.clear(userId);
    await this.changed(user, 'disabled', null, null);
    return { object: 'two_step_disabled' as const };
  }

  /** New recovery codes (shown once) with a current code; the old ones stop working. */
  async regenerateRecoveryCodes(userId: string, code: string) {
    const user = await this.person(userId);
    if (!user.mfaMethod) throw notOn();
    await this.check(user, code, 'code');
    const recoveryCodes = Array.from({ length: recoveryCodeCount }, recoveryCode);
    await this.prisma.user.update({ where: { id: userId }, data: { mfaRecoveryCodeHashes: recoveryCodes.map(sha256) } });
    await this.inbox.person(userId, 'security.two_step_changed', {
      subject: `recovery_codes:${Date.now()}`,
      title: 'New recovery codes',
      body: 'Your two-step recovery codes were replaced. The old ones no longer work. If this was not you, change your password.',
      link: '/settings/security',
    });
    return { object: 'two_step_recovery_codes' as const, recovery_codes: recoveryCodes };
  }

  /**
   * Admin: a team member who lost their method. Two-step is turned off for them and every session they have is signed
   * out; where their account requires it, they set it up again at their next sign-in.
   */
  async reset(actorId: string | null, resellerId: string, userId: string, reason: string) {
    const member = await this.prisma.resellerMember.findUnique({ where: { resellerId_userId: { resellerId, userId } }, include: { user: true } });
    if (!member) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'That person is not on this reseller’s team.');
    const before = { method: member.user.mfaMethod, enabled_at: member.user.mfaEnabledAt?.toISOString() ?? null };
    await this.clear(userId);
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ actorId, action: 'reseller.two_step_reset', targetType: 'user', targetId: userId, before, after: { method: null, reseller_id: resellerId, reason } });
    await this.changed(member.user, 'reset', null, reason);
    return { object: 'two_step_reset' as const, user_id: userId };
  }

  private clear(userId: string) {
    return this.prisma.$transaction([
      this.prisma.totpCredential.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaMethod: null, mfaEnabledAt: null, mfaRecoveryCodeHashes: [], mfaSetupMethod: null, mfaSetupSecretEncrypted: null, mfaSetupAt: null },
      }),
    ]);
  }

  /**
   * Checks a code from the person's method, or one of their recovery codes (used up). Wrong codes count towards the
   * sign-in lockout, so a stolen password or session cannot guess its way through.
   */
  private async check(user: Person, code: string, param: string): Promise<'code' | 'recovery'> {
    if (user.lockedUntil && user.lockedUntil > new Date()) throw locked();
    const value = code.trim().toLowerCase();
    let accepted: 'code' | 'recovery' | null = null;
    let refusal: ApiError | null = null;
    if (recoveryPattern.test(value)) {
      if (await this.useRecoveryCode(user, value)) accepted = 'recovery';
    } else if (user.mfaMethod === 'authenticator') {
      const credential = user.totp;
      const step = credential?.confirmedAt ? totpStep(totpFor(issuer, user.email, this.encryption().decrypt(credential.secretEncrypted)), value) : null;
      if (step !== null && (credential!.lastUsedStep === null || step > credential!.lastUsedStep) && (await claimTotpStep(this.prisma, user.id, step))) accepted = 'code';
    } else if (user.mfaMethod) {
      try {
        const target = await this.codes.consume(user.id, 'mfa_sign_in', value);
        if (target === this.target(user, user.mfaMethod).to) accepted = 'code';
      } catch (error) {
        // Expired or used up: say so; a plain wrong code reads like any other.
        if (error instanceof ApiError && error.code !== 'code_invalid') refusal = error;
        else if (!(error instanceof ApiError)) throw error;
      }
    }
    if (accepted) return accepted;
    await recordFailedSignIn(this.prisma, user.id);
    if (refusal) throw refusal;
    throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mfa_code_invalid', 'That code is not valid. Check it and try again.', param);
  }

  private async useRecoveryCode(user: Person, code: string) {
    const hash = sha256(code);
    if (!user.mfaRecoveryCodeHashes.includes(hash)) return false;
    try {
      // Conditional on the code still being there, so two requests cannot both use it.
      await this.prisma.user.update({ where: { id: user.id, mfaRecoveryCodeHashes: { has: hash } }, data: { mfaRecoveryCodeHashes: user.mfaRecoveryCodeHashes.filter(item => item !== hash) } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return false;
      throw error;
    }
  }

  /** Where a method's codes go: the primary email, or the primary confirmed mobile number. */
  private target(user: User, method: MfaMethod) {
    if (method === 'email') return { to: user.email, hint: maskEmail(user.email) };
    if (method === 'sms' && user.phone && user.phoneVerifiedAt) return { to: user.phone, hint: maskPhone(user.phone) };
    return { to: '', hint: null };
  }

  private async send(user: User, method: MfaMethod, purpose: 'mfa_setup' | 'mfa_sign_in', to: string) {
    if (!to) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'two_step_method_unavailable', 'Confirm a mobile number on your profile first, or choose another method.', 'method');
    const code = await this.codes.issue(user.id, purpose, to, codeLifetimeMs);
    try {
      if (method === 'email') await this.email.send(twoStepCodeEmail(to, code, purpose === 'mfa_setup' ? 'setup' : 'sign_in'));
      else await this.sms.sendForCountry(parsePhoneNumberFromString(to)?.country ?? null, { to, text: `Your BitoCard sign-in code is ${code}. It expires in 10 minutes. Never share it.` });
    } catch (error) {
      await this.codes.cancel(user.id, purpose);
      if (error instanceof ApiError) throw error;
      this.logger.error({ err: error, method }, 'Could not send a two-step code');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', method === 'email' ? 'email_delivery_failed' : 'sms_delivery_failed', 'We could not send the code. Try again shortly.');
    }
  }

  /** Text messages need an SMS provider in the market of the person's number. */
  private async smsReady(user: User) {
    if (!user.phone || !user.phoneVerifiedAt) return false;
    const country = parsePhoneNumberFromString(user.phone)?.country;
    if (!country) return false;
    return Boolean((await this.prisma.country.findUnique({ where: { code: country }, select: { smsProvider: true } }))?.smsProvider);
  }

  private async pending(sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    return session ? twoStepPending(this.prisma, session) : null;
  }

  private person(userId: string): Promise<Person> {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { totp: true } });
  }

  /** The person is emailed and told in SHQ whenever their two-step sign-in changes. */
  private async changed(user: User, change: 'enabled' | 'changed' | 'disabled' | 'reset', method: MfaMethod | null, reason: string | null) {
    const label = method === 'authenticator' ? 'authenticator app' : method === 'email' ? 'emailed codes' : method === 'sms' ? 'text messages' : null;
    await this.email.send(twoStepChangedEmail(user.email, change, label)).catch((error: unknown) => this.logger.error({ err: error }, 'Could not send the two-step notice'));
    const titles = { enabled: 'Two-step sign-in is on', changed: 'Two-step sign-in method changed', disabled: 'Two-step sign-in turned off', reset: 'Two-step sign-in reset by BitoCard' } as const;
    await this.inbox.person(user.id, 'security.two_step_changed', {
      subject: `${change}:${Date.now()}`,
      title: titles[change],
      body:
        change === 'reset'
          ? `BitoCard support reset it${reason ? ` (${reason})` : ''}. Set it up again at your next sign-in if your account requires it.`
          : change === 'disabled'
            ? 'You will no longer be asked for a code when you sign in. If this was not you, change your password.'
            : `You will be asked for a code from your ${label} when you sign in.`,
      link: '/settings/security',
    });
    if (change !== 'reset') {
      await this.audit.record({ actorId: user.id, action: `user.two_step_${change}`, targetType: 'user', targetId: user.id, before: { method: user.mfaMethod }, after: { method } });
    }
  }

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Two-step sign-in is not available yet.');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }
}

