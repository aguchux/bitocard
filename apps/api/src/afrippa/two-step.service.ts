import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AuditService } from '../audit/audit.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { type CustomerWithStore, CustomersService } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Customer, type MfaMethod, Prisma } from '../generated/prisma/client.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SmsService } from '../notifications/sms.service.js';
import { traderTwoStepChangedEmail, traderTwoStepCodeEmail } from '../notifications/templates.js';
import { mfaMethods } from '../auth/mfa-policy.js';
import { newTotpSecret, totpFor, totpStep } from '../auth/totp.js';
import { afrippaStoreId } from './ids.js';

/** Emailed and texted codes work for 10 minutes, and a method being set up waits as long for its first code. */
const codeLifetimeMs = 10 * 60_000;
const recoveryCodeCount = 10;
const recoveryPattern = /^[a-z0-9]{4}-[a-z0-9]{4}$/;
const issuer = 'Afrippa';
/** The policy row for all of Afrippa; a market's own row wins over it. */
export const everywhere = 'WW';
/** After operations reset a trader's two-step sign-in, withdrawals wait this long. */
export const resetHoldMs = 24 * 60 * 60_000;

const codeInvalid = (param = 'code') => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mfa_code_invalid', 'That code is not valid. Check it and try again.', param);
const locked = () => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many failed attempts. Try again in 15 minutes.');
const labels: Record<MfaMethod, string> = { authenticator: 'authenticator app', email: 'emailed codes', sms: 'text messages' };

function recoveryCode() {
  const raw = randomToken(8).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().padEnd(8, '0').slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}•••@${domain}`;
};
const maskPhone = (phone: string) => `•••• ${phone.slice(-4)}`;

/** A trader's session as the two-step steps see it. */
export type TraderSession = { customer: CustomerWithStore; sessionId: string; mfaVerifiedAt: Date | null; mfaReconfirmedAt: Date | null };

/**
 * Afrippa's traders' two-step sign-in (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 5), required from day one: a new
 * account sets a method up before it can do anything else, and every sign-in asks for the code (the session stays
 * pending until then; `CustomerGuard`). The trader chooses among the methods Afrippa's operations allow, for all of
 * Afrippa (`WW`) or their market: an authenticator app, a code emailed to their address, or one texted to their confirmed
 * mobile number (through Afrippa's own SMS account), each with 10 one-time recovery codes. A method no longer allowed
 * is confirmed once more at the next sign-in, then replaced. Wrong codes count towards the sign-in lockout. Never turned
 * off; operations reset a trader who lost every method (signing them out, withdrawals held 24 hours).
 */
@Injectable()
export class TraderTwoStepService {
  private readonly logger = new Logger('TraderTwoStep');

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The methods a trader may use: their market's own list, else all of Afrippa's, else every method. */
  async allowed(country: string | null): Promise<MfaMethod[]> {
    const rows = await this.prisma.afrippaTwoStepPolicy.findMany({ where: { market: { in: [everywhere, ...(country ? [country] : [])] } } });
    const row = rows.find(item => item.market === country) ?? rows.find(item => item.market === everywhere);
    return row ? mfaMethods.filter(method => row.methods.includes(method)) : [...mfaMethods];
  }

  /**
   * What a session still has to do: nothing once the second step is done on it; otherwise set a method up (none yet,
   * or one no longer allowed and just proved) or enter the code. `method_not_allowed` says the current one must go.
   */
  async state(session: TraderSession) {
    const customer = session.customer;
    const allowed = await this.allowed(customer.country);
    const notAllowed = Boolean(customer.mfaMethod && !allowed.includes(customer.mfaMethod));
    const pending = !session.mfaVerifiedAt;
    const setupRequired = pending && (!customer.mfaMethod || (notAllowed && Boolean(session.mfaReconfirmedAt)));
    return {
      object: 'two_step_state' as const,
      pending,
      setup_required: setupRequired,
      method: customer.mfaMethod,
      method_not_allowed: notAllowed,
    };
  }

  /** The trader's two-step settings and what they can choose. */
  async settings(session: TraderSession) {
    const customer = session.customer;
    const [allowed, state, smsReady] = await Promise.all([this.allowed(customer.country), this.state(session), this.smsReady(customer)]);
    return {
      object: 'two_step' as const,
      method: customer.mfaMethod,
      enabled_at: customer.mfaEnabledAt?.toISOString() ?? null,
      required: true,
      pending: state.pending,
      setup_required: state.setup_required,
      method_not_allowed: state.method_not_allowed,
      sent_to: customer.mfaMethod ? this.target(customer, customer.mfaMethod).hint : null,
      recovery_codes_left: customer.mfaMethod ? customer.mfaRecoveryCodeHashes.length : 0,
      methods: mfaMethods.map(method => {
        const reason = !allowed.includes(method) ? ('not_allowed' as const) : method === 'sms' && !customer.phoneVerifiedAt ? ('phone_required' as const) : method === 'sms' && !smsReady ? ('sms_unavailable' as const) : null;
        return { method, available: reason === null, reason };
      }),
    };
  }

  /**
   * Starts setting a method up. On a pending session only to finish signing in: with no method yet, or after proving a
   * method that is no longer allowed. Otherwise changing the method needs a code from the current one.
   */
  async setup(session: TraderSession, method: MfaMethod, currentCode?: string) {
    const customer = session.customer;
    const state = await this.state(session);
    if (state.pending && !state.setup_required) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'mfa_required', 'Finish signing in with your two-step code first.');
    if (!state.pending && customer.mfaMethod) {
      if (!currentCode) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Enter a code from your current two-step method.', 'current_code');
      await this.check(customer, currentCode, 'current_code');
    }
    const choice = (await this.settings(session)).methods.find(item => item.method === method);
    if (!choice?.available) {
      const message =
        choice?.reason === 'phone_required'
          ? 'Confirm your mobile number first, or choose another method.'
          : choice?.reason === 'sms_unavailable'
            ? 'Text messages are not available for your number yet. Choose another method.'
            : 'This method is not available for your account. Choose another one.';
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'two_step_method_unavailable', message, 'method');
    }
    if (method === 'authenticator') {
      const secret = newTotpSecret();
      await this.prisma.customer.update({ where: { id: customer.id }, data: { mfaSetupMethod: method, mfaSetupSecretEncrypted: this.encryption().encrypt(secret), mfaSetupAt: new Date() } });
      return { object: 'two_step_setup' as const, method, secret, otpauth_uri: totpFor(issuer, customer.email, secret).toString(), sent_to: null };
    }
    const { to, hint } = this.target(customer, method);
    await this.send(customer, method, 'mfa_setup', to);
    await this.prisma.customer.update({ where: { id: customer.id }, data: { mfaSetupMethod: method, mfaSetupSecretEncrypted: null, mfaSetupAt: new Date() } });
    return { object: 'two_step_setup' as const, method, secret: null, otpauth_uri: null, sent_to: hint };
  }

  /** Confirms the method being set up with its first code: it becomes the trader's, with new recovery codes (shown once). */
  async confirmSetup(session: TraderSession, code: string) {
    const customer = session.customer;
    const method = customer.mfaSetupMethod;
    if (!method || !customer.mfaSetupAt || Date.now() - customer.mfaSetupAt.getTime() > codeLifetimeMs) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'two_step_setup_missing', 'This set-up has expired. Start again.');
    }
    let secret: string | null = null;
    let step: bigint | null = null;
    if (method === 'authenticator') {
      secret = this.encryption().decrypt(customer.mfaSetupSecretEncrypted ?? '');
      step = totpStep(totpFor(issuer, customer.email, secret), code.trim());
      if (step === null) throw codeInvalid();
    } else {
      const target = await this.customers.consumeCode(customer, 'mfa_setup', code.trim()).catch(error => {
        throw error instanceof ApiError && error.code === 'code_invalid' ? codeInvalid() : error;
      });
      if (target !== this.target(customer, method).to) throw codeInvalid();
    }
    const recoveryCodes = Array.from({ length: recoveryCodeCount }, recoveryCode);
    const previous = customer.mfaMethod;
    await this.prisma.$transaction(async tx => {
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          mfaMethod: method,
          mfaEnabledAt: new Date(),
          mfaRecoveryCodeHashes: recoveryCodes.map(sha256),
          mfaSetupMethod: null,
          mfaSetupSecretEncrypted: null,
          mfaSetupAt: null,
          totpSecretEncrypted: secret === null ? null : this.encryption().encrypt(secret),
          totpLastStep: step,
          // A code received at the address proves it.
          ...(method === 'email' && !customer.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
        },
      });
      await tx.customerSession.updateMany({ where: { id: session.sessionId, customerId: customer.id }, data: { mfaVerifiedAt: new Date(), mfaReconfirmedAt: null } });
    });
    await this.changed(customer, previous ? 'changed' : 'enabled', method);
    return { object: 'two_step_enabled' as const, method, recovery_codes: recoveryCodes };
  }

  /** Sends the emailed or texted code to sign in (or to confirm a change): one a minute, `sent: false` sooner. */
  async challenge(session: TraderSession) {
    const customer = session.customer;
    const method = customer.mfaMethod;
    if (!method) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'two_step_setup_required', 'Set up two-step sign-in first.');
    if (method === 'authenticator') return { object: 'two_step_challenge' as const, method, sent: false, sent_to: null };
    const { to, hint } = this.target(customer, method);
    try {
      await this.send(customer, method, 'mfa_sign_in', to);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'code_recently_sent') return { object: 'two_step_challenge' as const, method, sent: false, sent_to: hint };
      throw error;
    }
    return { object: 'two_step_challenge' as const, method, sent: true, sent_to: hint };
  }

  /**
   * The second step on a pending session: the method's code or a recovery code. A method no longer allowed is proved
   * once more, then the trader sets another up on this session before it is signed in (`setup_required`).
   */
  async verify(session: TraderSession, code: string) {
    if (session.mfaVerifiedAt) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'two_step_not_pending', 'You have already finished signing in.');
    const customer = session.customer;
    if (!customer.mfaMethod) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'two_step_setup_required', 'Set up two-step sign-in to finish signing in.');
    const used = await this.check(customer, code, 'code');
    const allowed = (await this.allowed(customer.country)).includes(customer.mfaMethod);
    await this.prisma.customerSession.updateMany({ where: { id: session.sessionId, customerId: customer.id }, data: allowed ? { mfaVerifiedAt: new Date() } : { mfaReconfirmedAt: new Date() } });
    await this.prisma.customer.update({ where: { id: customer.id }, data: { failedSignIns: 0, lockedUntil: null, lastSignInAt: new Date() } });
    if (used === 'recovery') {
      const left = customer.mfaRecoveryCodeHashes.length - 1;
      await this.notice(customer, 'recovery', 'A recovery code was used to sign in', `${left} recovery ${left === 1 ? 'code is' : 'codes are'} left. If this was not you, change your password.`);
    }
    return { object: 'two_step_verified' as const, method: customer.mfaMethod, used, signed_in: allowed, setup_required: !allowed };
  }

  /** New recovery codes (shown once) with a current code; the old ones stop working. */
  async regenerateRecoveryCodes(session: TraderSession, code: string) {
    const customer = session.customer;
    if (!customer.mfaMethod) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'two_step_setup_required', 'Set up two-step sign-in first.');
    await this.check(customer, code, 'code');
    const recoveryCodes = Array.from({ length: recoveryCodeCount }, recoveryCode);
    await this.prisma.customer.update({ where: { id: customer.id }, data: { mfaRecoveryCodeHashes: recoveryCodes.map(sha256) } });
    await this.notice(customer, 'recovery_codes', 'New recovery codes', 'Your two-step recovery codes were replaced. The old ones no longer work. If this was not you, change your password.');
    return { object: 'two_step_recovery_codes' as const, recovery_codes: recoveryCodes };
  }

  /**
   * Afrippa's operations: a trader who lost every method, after they proved who they are. Two-step is cleared (they set
   * it up again at their next sign-in), every session is signed out, and withdrawals wait 24 hours. Audited.
   */
  async reset(actorId: string | null, customerId: string, reason: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, storeId: afrippaStoreId } });
    if (!customer) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such trader.');
    const heldUntil = new Date(Date.now() + resetHoldMs);
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id: customer.id },
        data: { mfaMethod: null, mfaEnabledAt: null, mfaRecoveryCodeHashes: [], mfaSetupMethod: null, mfaSetupSecretEncrypted: null, mfaSetupAt: null, totpSecretEncrypted: null, totpLastStep: null, withdrawalsHeldUntil: heldUntil },
      }),
      this.prisma.customerSession.updateMany({ where: { customerId: customer.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({ actorId, action: 'trader.two_step_reset', targetType: 'customer', targetId: customer.id, before: { method: customer.mfaMethod }, after: { method: null, withdrawals_held_until: heldUntil.toISOString(), reason }, platform: 'afrippa' });
    await this.changed(customer, 'reset', null);
    return { object: 'two_step_reset' as const, customer_id: customer.id, withdrawals_held_until: heldUntil.toISOString() };
  }

  /** A code from the trader's method, or a recovery code (used up). Wrong ones count towards the sign-in lockout. */
  private async check(customer: Customer, code: string, param: string): Promise<'code' | 'recovery'> {
    if (customer.lockedUntil && customer.lockedUntil > new Date()) throw locked();
    const value = code.trim().toLowerCase();
    let accepted: 'code' | 'recovery' | null = null;
    let refusal: ApiError | null = null;
    if (recoveryPattern.test(value)) {
      if (await this.useRecoveryCode(customer, value)) accepted = 'recovery';
    } else if (customer.mfaMethod === 'authenticator') {
      const step = customer.totpSecretEncrypted ? totpStep(totpFor(issuer, customer.email, this.encryption().decrypt(customer.totpSecretEncrypted)), value) : null;
      if (step !== null && (await this.claimStep(customer.id, step))) accepted = 'code';
    } else if (customer.mfaMethod) {
      try {
        const target = await this.customers.consumeCode(customer, 'mfa_sign_in', value);
        if (target === this.target(customer, customer.mfaMethod).to) accepted = 'code';
      } catch (error) {
        if (error instanceof ApiError && error.code !== 'code_invalid') refusal = error;
        else if (!(error instanceof ApiError)) throw error;
      }
    }
    if (accepted) return accepted;
    await this.customers.recordFailedSignIn(customer.id);
    if (refusal) throw refusal;
    throw codeInvalid(param);
  }

  /** Each authenticator time step is used once, even by parallel requests. */
  private async claimStep(customerId: string, step: bigint) {
    const claimed = await this.prisma.customer.updateMany({ where: { id: customerId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return claimed.count === 1;
  }

  private async useRecoveryCode(customer: Customer, code: string) {
    const hash = sha256(code);
    if (!customer.mfaRecoveryCodeHashes.includes(hash)) return false;
    try {
      await this.prisma.customer.update({ where: { id: customer.id, mfaRecoveryCodeHashes: { has: hash } }, data: { mfaRecoveryCodeHashes: customer.mfaRecoveryCodeHashes.filter(item => item !== hash) } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return false;
      throw error;
    }
  }

  /** Where a method's codes go: the trader's address, or their confirmed mobile number. */
  private target(customer: Customer, method: MfaMethod) {
    if (method === 'email') return { to: customer.email, hint: maskEmail(customer.email) };
    if (method === 'sms' && customer.phone && customer.phoneVerifiedAt) return { to: customer.phone, hint: maskPhone(customer.phone) };
    return { to: '', hint: null };
  }

  /** Emailed and texted codes go through Afrippa's own email and SMS accounts. */
  private async send(customer: Customer, method: MfaMethod, purpose: 'mfa_setup' | 'mfa_sign_in', to: string) {
    if (!to) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'two_step_method_unavailable', 'Confirm your mobile number first, or choose another method.', 'method');
    const code = await this.customers.issueCode(customer, purpose, to, codeLifetimeMs);
    try {
      if (method === 'email') await this.email.sendFor('afrippa', traderTwoStepCodeEmail(to, code, purpose === 'mfa_setup' ? 'setup' : 'sign_in'));
      else await this.sms.sendForCountry(parsePhoneNumberFromString(to)?.country ?? null, { to, text: `Your Afrippa sign-in code is ${code}. It expires in 10 minutes. Never share it.` }, 'afrippa');
    } catch (error) {
      await this.customers.cancelCode(customer.id, purpose);
      if (error instanceof ApiError) throw error;
      this.logger.error({ err: error, method }, 'Could not send a two-step code');
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', method === 'email' ? 'email_delivery_failed' : 'sms_delivery_failed', 'We could not send the code. Try again shortly.');
    }
  }

  /** Text messages need an SMS provider in the market of the trader's number. */
  private async smsReady(customer: Customer) {
    if (!customer.phone || !customer.phoneVerifiedAt) return false;
    const country = parsePhoneNumberFromString(customer.phone)?.country;
    if (!country) return false;
    return Boolean((await this.prisma.country.findUnique({ where: { code: country }, select: { smsProvider: true } }))?.smsProvider);
  }

  /** Every change emails the trader, leaves an inbox notice and is audited in Afrippa's trail. */
  private async changed(customer: Customer, change: 'enabled' | 'changed' | 'reset', method: MfaMethod | null) {
    const label = method ? labels[method] : null;
    await this.email.sendFor('afrippa', traderTwoStepChangedEmail(customer.email, change, label)).catch((error: unknown) => this.logger.error({ err: error }, 'Could not send the two-step notice'));
    const titles = { enabled: 'Two-step sign-in is set up', changed: 'Two-step sign-in method changed', reset: 'Two-step sign-in reset by Afrippa' } as const;
    await this.notice(
      customer,
      change,
      titles[change],
      change === 'reset' ? 'Afrippa reset it and signed you out everywhere. Set it up again at your next sign-in. Withdrawals wait 24 hours.' : `You will be asked for a code from your ${label} when you sign in.`,
    );
    if (change !== 'reset') {
      await this.audit.record({ actorId: null, action: `trader.two_step_${change}`, targetType: 'customer', targetId: customer.id, before: { method: customer.mfaMethod }, after: { method }, platform: 'afrippa' });
    }
  }

  private notice(customer: Customer, subject: string, title: string, body: string) {
    return this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, 'customer.security.two_step_changed', { subject: `${subject}:${Date.now()}`, title, body, link: '/security' });
  }

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Two-step sign-in is not available yet.');
    return new Encryption(this.config.ENCRYPTION_KEY);
  }
}
