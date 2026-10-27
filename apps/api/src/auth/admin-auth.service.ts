import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { type AdminRealm, isAdminRealm, stepUpWindowMs } from './caller.js';
import { PrismaService } from '../database/prisma.service.js';
import { randomToken, sameDigest, sha256 } from '../common/crypto.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { type Platform, Prisma, type User } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../notifications/email.service.js';
import { adminPasswordLinkEmail, type EmailProduct, passwordChangedEmail } from '../notifications/templates.js';
import { recordFailedSignIn } from './auth.service.js';
import { PasswordsService } from './passwords.service.js';
import { SessionsService } from './sessions.service.js';
import { claimTotpStep, newTotpSecret, totpFor, totpStep } from './totp.js';

const challengeLifetimeMs = 5 * 60 * 1000;
const maxChallengeAttempts = 5;
const recoveryCodeCount = 10;
/** How long an emailed set-password link works: a new admin may take a while to open it; a reset should be used soon. */
const passwordLinkHours = { create: 72, reset: 24 } as const;
/** The sign-in page's Resend button counts down the same 60 seconds. */
const passwordLinkGapMs = 60_000;

/** A first name for a new admin from their address (agu.chux@… is "Agu Chux"); they confirm it on the set-password page. */
function nameFromEmail(email: string) {
  const words = email.split('@')[0]!.split(/[._-]+/).filter(Boolean);
  return words.map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ') || 'Admin';
}
export const adminRoles = ['super_admin', 'operations', 'finance', 'support'] as const;

const invalidCredentials = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'invalid_credentials', 'The email or password is incorrect.');
const invalidChallenge = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'challenge_invalid', 'This sign-in has expired. Start again.');
const invalidLink = (product: EmailProduct = 'BitoCard') =>
  new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'link_invalid', `This link has expired or was already used. Ask the ${product} team for a new one.`);
const invalidCode = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mfa_code_invalid', 'That code is not valid. Check your authenticator app.', 'code');

function recoveryCode() {
  const raw = randomToken(8).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().padEnd(8, '0').slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** What tells the two admin realms apart: who may sign in, who may be set up from the sign-in page, and where links point. */
type RealmSettings = { domains: string[]; setupEmails: string[]; appUrl: string; issuer: string; product: EmailProduct; platform: Platform };

/**
 * Admin sign-in, for both admin realms: BitoCard's (admin.bitocard.com, `admin`) and Afrippa's (admin.afrippa.com,
 * `afrippa_admin`; docs/CRYPTO_SPINOFF_PLAN.md). Email and password (each realm's own domains, never Google), then an
 * authenticator-app code on every sign-in. The first sign-in sets the authenticator up and issues recovery codes. Each
 * step works only in its own realm: a link, challenge or account of one never signs in to the other.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger('AdminAuth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly sessions: SessionsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private settings(realm: AdminRealm): RealmSettings {
    return realm === 'afrippa_admin'
      ? {
          domains: this.config.AFRIPPA_ADMIN_EMAIL_DOMAINS,
          setupEmails: this.config.AFRIPPA_ADMIN_SETUP_EMAILS,
          appUrl: this.config.AFRIPPA_ADMIN_APP_URL,
          issuer: 'Afrippa Admin',
          product: 'Afrippa',
          platform: 'afrippa',
        }
      : { domains: this.config.ADMIN_EMAIL_DOMAINS, setupEmails: this.config.ADMIN_SETUP_EMAILS, appUrl: this.config.ADMIN_APP_URL, issuer: 'BitoCard Admin', product: 'BitoCard', platform: 'bitocard' };
  }

  /** The realm of an admin account (never a reseller's). */
  private realmOf(user: Pick<User, 'realm'>): AdminRealm {
    if (!isAdminRealm(user.realm)) throw new Error('Not an admin account');
    return user.realm;
  }

  /**
   * Creates an admin (tests and `startSignIn`). Without a password the account cannot sign in until its owner sets one
   * with the emailed link.
   */
  async createAdmin(input: { email: string; name: string; password?: string; roles: string[]; realm?: AdminRealm }) {
    const realm = input.realm ?? 'admin';
    const email = input.email.trim().toLowerCase();
    if (!this.allowedDomain(email, realm)) throw new Error(`Admins must use one of: ${this.settings(realm).domains.join(', ')}`);
    const unknown = input.roles.filter(role => !(adminRoles as readonly string[]).includes(role));
    if (unknown.length || input.roles.length === 0) throw new Error(`Roles must be one or more of: ${adminRoles.join(', ')}`);
    if (input.password !== undefined) await this.passwords.assertAcceptable(input.password);
    return this.prisma.user.create({
      data: {
        realm,
        email,
        name: input.name,
        passwordHash: input.password === undefined ? null : await this.passwords.hash(input.password),
        adminRoles: input.roles,
        emailVerifiedAt: new Date(),
      },
    });
  }

  /**
   * Sign-in step 1, the email. An address in the environment's `ADMIN_SETUP_EMAILS` (on an admin domain) whose admin
   * account does not exist yet, or has no password yet, gets its account set up (a super admin) and a link to choose
   * the password: `link_sent`. Every other address goes on to the password (`password`), whether or not it is an
   * admin, so the answer never tells anyone which addresses are admins.
   */
  async startSignIn(emailInput: string, realm: AdminRealm = 'admin') {
    const email = emailInput.trim().toLowerCase();
    if (!this.isSetupEmail(email, realm)) return { object: 'admin_sign_in' as const, next: 'password' as const };
    let user = await this.prisma.user.findUnique({ where: { realm_email: { realm, email } } });
    if (!user) {
      user = await this.createAdmin({ email, name: nameFromEmail(email), roles: ['super_admin'], realm }).catch(async (error: unknown) => {
        // Two first visits at once: the other one created it.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.user.findUniqueOrThrow({ where: { realm_email: { realm, email } } });
        throw error;
      });
      const by = realm === 'afrippa_admin' ? 'AFRIPPA_ADMIN_SETUP_EMAILS' : 'ADMIN_SETUP_EMAILS';
      await this.audit.record({ actorId: null, action: 'admin.created', targetType: 'user', targetId: user.id, after: { email, roles: user.adminRoles, by }, platform: this.settings(realm).platform });
    }
    if (user.passwordHash || user.status !== 'active') return { object: 'admin_sign_in' as const, next: 'password' as const };
    await this.sendPasswordLink(user, 'create');
    return { object: 'admin_sign_in' as const, next: 'link_sent' as const };
  }

  /**
   * "Forgot password": emails a reset link, but only to an address in `ADMIN_SETUP_EMAILS` with an active admin account
   * (one still without a password gets the set-up link again). The answer is the same whatever happened.
   */
  async forgotPassword(emailInput: string, realm: AdminRealm = 'admin') {
    const email = emailInput.trim().toLowerCase();
    if (!this.isSetupEmail(email, realm)) {
      // Never the address itself: only why nothing was sent, so operators can tell a missing setup list entry.
      this.logger.log({ realm, listed: this.settings(realm).setupEmails.length }, 'Admin password reset: address not on the setup list; nothing sent');
    } else {
      const user = await this.prisma.user.findUnique({ where: { realm_email: { realm, email } } });
      if (user?.status === 'active') await this.sendPasswordLink(user, user.passwordHash ? 'reset' : 'create');
      else this.logger.log({ userId: user?.id ?? null }, 'Admin password reset: no active admin account for this address; nothing sent');
    }
    return { object: 'admin_password_reset_requested' as const };
  }

  /**
   * Emails an admin a one-time link to set their password. A new link replaces any earlier one; nothing changes on the
   * account until it is used. At most one a minute per admin (others are silently skipped), and a failed
   * send is logged, never shown, so the answers stay the same.
   */
  private async sendPasswordLink(user: User, kind: 'create' | 'reset') {
    const last = await this.prisma.verificationCode.findFirst({
      where: { userId: user.id, purpose: 'admin_password_link', createdAt: { gt: new Date(Date.now() - passwordLinkGapMs) } },
      select: { id: true },
    });
    if (last) {
      this.logger.log({ userId: user.id }, 'Admin password link skipped: one a minute');
      return;
    }
    const token = `${user.id}.${randomToken()}`;
    const hours = passwordLinkHours[kind];
    const expiresAt = new Date(Date.now() + hours * 3600_000);
    await this.prisma.$transaction([
      this.prisma.verificationCode.updateMany({ where: { userId: user.id, purpose: 'admin_password_link', consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.verificationCode.create({ data: { userId: user.id, purpose: 'admin_password_link', target: user.email, codeHash: sha256(token), expiresAt } }),
    ]);
    // In the fragment, so the token never reaches a server log or a Referer header.
    const realm = this.realmOf(user);
    const { appUrl, product, platform } = this.settings(realm);
    const link = `${new URL('/set-password', appUrl).toString()}#token=${token}`;
    try {
      const sentWith = await this.email.send(adminPasswordLinkEmail(user.email, { name: user.name, kind, link, hours, product }));
      this.logger.log({ userId: user.id, kind, sentWith }, sentWith === 'outbox' ? 'Admin password link NOT sent: no email provider is set up' : 'Admin password link emailed');
    } catch (error) {
      this.logger.error({ err: error, userId: user.id }, 'Could not email an admin password link');
      return;
    }
    await this.audit.record({ actorId: null, action: 'admin.password_link_sent', targetType: 'user', targetId: user.id, after: { email: user.email, kind, expires_at: expiresAt.toISOString() }, platform });
  }

  /** What the set-password page shows before the admin chooses a password. */
  async describePasswordLink(token: string, realm: AdminRealm = 'admin') {
    const { user, record } = await this.passwordLink(token, realm);
    return {
      object: 'admin_password_link' as const,
      email: user.email,
      name: user.name,
      kind: user.passwordHash ? ('reset' as const) : ('create' as const),
      authenticator_set_up: Boolean(user.totp?.confirmedAt),
      expires_at: record.expiresAt.toISOString(),
    };
  }

  /**
   * Uses a set-password link: sets the password, clears any lockout, signs out every admin session the person has and,
   * if they ask, removes their authenticator so they set it up again at their next sign-in. The link works once.
   * Admin accounts only; a reseller account with the same email is untouched.
   */
  async completePasswordLink(token: string, password: string, options: { resetAuthenticator?: boolean; name?: string } = {}, realm: AdminRealm = 'admin') {
    const { user, record } = await this.passwordLink(token, realm);
    const { product, platform } = this.settings(realm);
    await this.passwords.assertAcceptable(password);
    const passwordHash = await this.passwords.hash(password);
    const resetAuthenticator = Boolean(options.resetAuthenticator && user.totp);
    // A new admin confirms their name with their first password.
    const name = !user.passwordHash && options.name?.trim() ? options.name.trim() : undefined;
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.verificationCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (claimed.count === 0) throw invalidLink(product);
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, failedSignIns: 0, lockedUntil: null, ...(name ? { name } : {}) } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (resetAuthenticator) await tx.totpCredential.deleteMany({ where: { userId: user.id } });
    });
    await this.audit.record({ actorId: user.id, action: 'admin.password_set', targetType: 'user', targetId: user.id, after: { email: user.email, authenticator_reset: resetAuthenticator }, platform });
    if (user.passwordHash) await this.email.send(passwordChangedEmail(user.email, product)).catch(() => undefined);
    return { object: 'admin_password_set' as const, email: user.email, authenticator_reset: resetAuthenticator };
  }

  /** On the realm's setup list (environment only, never editable in the app) and on one of its admin domains. */
  private isSetupEmail(email: string, realm: AdminRealm) {
    return this.settings(realm).setupEmails.includes(email) && this.allowedDomain(email, realm);
  }

  /** A set-password link of this realm's admin: another realm's link is as unknown as a made-up one. */
  private async passwordLink(token: string, realm: AdminRealm) {
    const record = await this.prisma.verificationCode.findFirst({
      where: { purpose: 'admin_password_link', codeHash: sha256(token), consumedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { totp: true } } },
    });
    if (!record || record.user.realm !== realm || record.user.status !== 'active' || !token.startsWith(`${record.userId}.`)) throw invalidLink(this.settings(realm).product);
    return { user: record.user, record };
  }

  /** Step 1: password. Returns a short-lived challenge to complete with an authenticator code. */
  async signIn(emailInput: string, password: string, realm: AdminRealm = 'admin') {
    const email = emailInput.trim().toLowerCase();
    const user = this.allowedDomain(email, realm) ? await this.prisma.user.findUnique({ where: { realm_email: { realm, email } }, include: { totp: true } }) : null;
    const valid = await this.passwords.verify(user?.passwordHash ?? null, password);
    if (!user || user.status !== 'active') throw invalidCredentials();
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      if (valid) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many failed attempts. Try again in 15 minutes.');
      throw invalidCredentials();
    }
    if (!valid) {
      await this.recordFailure(user);
      throw invalidCredentials();
    }

    const token = `${user.id}.${randomToken()}`;
    await this.prisma.verificationCode.updateMany({ where: { userId: user.id, purpose: 'admin_mfa_challenge', consumedAt: null }, data: { consumedAt: new Date() } });
    await this.prisma.verificationCode.create({
      data: { userId: user.id, purpose: 'admin_mfa_challenge', target: user.email, codeHash: sha256(token), expiresAt: new Date(Date.now() + challengeLifetimeMs) },
    });
    return { object: 'mfa_challenge' as const, challenge_token: token, mfa_setup_required: !user.totp?.confirmedAt, expires_in: challengeLifetimeMs / 1000 };
  }

  /** First sign-in only: creates the authenticator secret to scan. */
  async setup(token: string, realm: AdminRealm = 'admin') {
    const { user } = await this.challenge(token, realm);
    if (user.totp?.confirmedAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'mfa_already_set_up', 'Your authenticator is already set up.');
    }
    const secret = newTotpSecret();
    await this.prisma.totpCredential.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secretEncrypted: this.encryption().encrypt(secret) },
      update: { secretEncrypted: this.encryption().encrypt(secret), lastUsedStep: null },
    });
    return { object: 'mfa_setup' as const, secret, otpauth_uri: this.totp(user, secret).toString() };
  }

  /** Step 2: authenticator code (or a recovery code). Starts the admin session. */
  async verify(token: string, code: string, req: Request, res: Response, realm: AdminRealm = 'admin') {
    const { user, record } = await this.challenge(token, realm);
    const credential = user.totp;
    if (!credential) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mfa_setup_required', 'Set up your authenticator first.');

    // Claim an attempt on the challenge before checking, in one statement, so parallel guesses never get past its limit.
    const attempt = await this.prisma.verificationCode.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: maxChallengeAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count === 0) throw invalidChallenge();
    const accepted = /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code) ? await this.useRecoveryCode(user.id, credential.recoveryCodeHashes, code) : await this.useTotp(user, credential, code);
    if (!accepted) {
      // Wrong codes also count towards the account's lockout, so signing in again for a fresh challenge cannot be used
      // to keep guessing.
      await this.recordFailure(user);
      throw invalidCode();
    }

    let recoveryCodes: string[] | undefined;
    if (!credential.confirmedAt) {
      recoveryCodes = Array.from({ length: recoveryCodeCount }, recoveryCode);
      await this.prisma.totpCredential.update({ where: { userId: user.id }, data: { confirmedAt: new Date(), recoveryCodeHashes: recoveryCodes.map(sha256) } });
    }
    await this.prisma.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    await this.prisma.user.update({ where: { id: user.id }, data: { failedSignIns: 0, lockedUntil: null, lastSignInAt: new Date() } });
    await this.sessions.create(user.id, realm, req, res);
    return { object: 'admin_session' as const, admin: this.present(user), ...(recoveryCodes ? { recovery_codes: recoveryCodes } : {}) };
  }

  async describe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { object: 'admin_session' as const, admin: this.present(user) };
  }

  /**
   * Step-up check for sensitive changes (for example service credentials): the admin's current authenticator code.
   * Wrong codes count towards the sign-in lockout, so a stolen session cannot guess its way through.
   */
  async confirmCode(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { totp: true } });
    if (!user || !isAdminRealm(user.realm) || !user.totp?.confirmedAt) throw invalidCode();
    if (!(await this.useTotp(user, user.totp, code))) {
      await this.recordFailure(user);
      throw invalidCode();
    }
  }

  /**
   * Opens the session's 5-minute window for sensitive and money actions with the admin's authenticator code (used once;
   * a wrong code counts towards the sign-in lockout). The window is fixed: entering a code again restarts it.
   */
  async stepUp(userId: string, sessionId: string, code: string) {
    await this.confirmCode(userId, code);
    const until = new Date(Date.now() + stepUpWindowMs);
    await this.prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { stepUpUntil: until } });
    await this.audit.record({ actorId: userId, action: 'admin.step_up', targetType: 'session', targetId: sessionId, before: null, after: { until: until.toISOString() } });
    return { object: 'admin_step_up' as const, step_up_until: until.toISOString() };
  }

  private present(user: User) {
    return { object: 'admin' as const, id: user.id, name: user.name, email: user.email, roles: user.adminRoles };
  }

  /** A sign-in challenge of this realm's admin: another realm's is as unknown as a made-up one. */
  private async challenge(token: string, realm: AdminRealm) {
    const userId = token.split('.')[0];
    if (!/^[0-9a-f-]{36}$/.test(userId)) throw invalidChallenge();
    const record = await this.prisma.verificationCode.findFirst({
      where: { userId, purpose: 'admin_mfa_challenge', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.expiresAt <= new Date() || record.attempts >= maxChallengeAttempts || !sameDigest(record.codeHash, sha256(token))) throw invalidChallenge();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { totp: true } });
    if (user.status !== 'active' || user.realm !== realm) throw invalidChallenge();
    // A challenge issued before the account locked stops working with it.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'account_locked', 'Too many failed attempts. Try again in 15 minutes.');
    }
    return { user, record };
  }

  /** Accepts the current code or one either side (clock drift), and never the same time step twice. */
  private async useTotp(user: User, credential: { secretEncrypted: string; lastUsedStep: bigint | null }, code: string) {
    const step = totpStep(this.totp(user, this.encryption().decrypt(credential.secretEncrypted)), code);
    if (step === null || (credential.lastUsedStep !== null && step <= credential.lastUsedStep)) return false;
    return claimTotpStep(this.prisma, user.id, step);
  }

  private async useRecoveryCode(userId: string, hashes: string[], code: string) {
    const hash = sha256(code);
    if (!hashes.includes(hash)) return false;
    try {
      await this.prisma.totpCredential.update({ where: { userId, recoveryCodeHashes: { has: hash } }, data: { recoveryCodeHashes: hashes.filter(h => h !== hash) } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return false;
      throw error;
    }
  }

  private recordFailure(user: User) {
    return recordFailedSignIn(this.prisma, user.id);
  }

  private allowedDomain(email: string, realm: AdminRealm) {
    const domain = email.split('@')[1] ?? '';
    return this.settings(realm).domains.includes(domain);
  }

  /** The authenticator entry, named for the realm ("BitoCard Admin" or "Afrippa Admin") and the admin's address. */
  private totp(user: Pick<User, 'email' | 'realm'>, base32: string) {
    return totpFor(this.settings(this.realmOf(user)).issuer, user.email, base32);
  }

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Admin sign-in is not configured.');
    }
    return new Encryption(this.config.ENCRYPTION_KEY);
  }
}
