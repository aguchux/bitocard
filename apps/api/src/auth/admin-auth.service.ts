import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Secret, TOTP } from 'otpauth';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { randomToken, sameDigest, sha256 } from '../common/crypto.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../notifications/email.service.js';
import { adminPasswordLinkEmail, passwordChangedEmail } from '../notifications/templates.js';
import { lockout } from './auth.service.js';
import { PasswordsService } from './passwords.service.js';
import { SessionsService } from './sessions.service.js';

const challengeLifetimeMs = 5 * 60 * 1000;
const maxChallengeAttempts = 5;
const recoveryCodeCount = 10;
/** How long an emailed set-password link works: a new admin may take a while to open it; a reset should be used soon. */
const passwordLinkHours = { create: 72, reset: 24 } as const;
export const adminRoles = ['super_admin', 'operations', 'finance', 'support'] as const;

const invalidCredentials = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'invalid_credentials', 'The email or password is incorrect.');
const invalidChallenge = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'challenge_invalid', 'This sign-in has expired. Start again.');
const invalidLink = () =>
  new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'link_invalid', 'This link has expired or was already used. Ask the BitoCard team for a new one.');
const invalidCode = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mfa_code_invalid', 'That code is not valid. Check your authenticator app.', 'code');

function recoveryCode() {
  const raw = randomToken(8).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().padEnd(8, '0').slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * Admin sign-in for admin.bitocard.com: email and password (company domains only, never Google), then an
 * authenticator-app code on every sign-in. The first sign-in sets the authenticator up and issues recovery codes.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly sessions: SessionsService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates an admin. Without a password (the `admin:create` script, through `inviteAdmin`) the account cannot sign in
   * until its owner sets one with the emailed link.
   */
  async createAdmin(input: { email: string; name: string; password?: string; roles: string[] }) {
    const email = input.email.trim().toLowerCase();
    if (!this.allowedDomain(email)) throw new Error(`Admins must use one of: ${this.config.ADMIN_EMAIL_DOMAINS.join(', ')}`);
    const unknown = input.roles.filter(role => !(adminRoles as readonly string[]).includes(role));
    if (unknown.length || input.roles.length === 0) throw new Error(`Roles must be one or more of: ${adminRoles.join(', ')}`);
    if (input.password !== undefined) await this.passwords.assertAcceptable(input.password);
    return this.prisma.user.create({
      data: {
        realm: 'admin',
        email,
        name: input.name,
        passwordHash: input.password === undefined ? null : await this.passwords.hash(input.password),
        adminRoles: input.roles,
        emailVerifiedAt: new Date(),
      },
    });
  }

  /** The `admin:create` script: creates the admin (no password) and emails them the link to set one. */
  async inviteAdmin(input: { email: string; name: string; roles: string[] }) {
    this.assertSetupEmail(input.email);
    await this.createAdmin(input);
    return this.sendPasswordLink(input.email, 'create');
  }

  /**
   * Emails an admin a one-time link to set their password (the `admin:create` and `admin:reset-password` scripts;
   * admins have no self-service reset). Only to addresses in the environment's `ADMIN_SETUP_EMAILS`, so whoever runs
   * a script can never send a link anywhere else. A new link replaces any earlier one. Nothing changes on the account
   * until the link is used.
   */
  async sendPasswordLink(emailInput: string, kind: 'create' | 'reset') {
    const email = this.assertSetupEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { realm_email: { realm: 'admin', email } } });
    if (!user) throw new Error(`No admin account for ${email}.`);
    const token = `${user.id}.${randomToken()}`;
    const hours = passwordLinkHours[kind];
    const expiresAt = new Date(Date.now() + hours * 3600_000);
    await this.prisma.$transaction([
      this.prisma.verificationCode.updateMany({ where: { userId: user.id, purpose: 'admin_password_link', consumedAt: null }, data: { consumedAt: new Date() } }),
      this.prisma.verificationCode.create({ data: { userId: user.id, purpose: 'admin_password_link', target: email, codeHash: sha256(token), expiresAt } }),
    ]);
    // In the fragment, so the token never reaches a server log or a Referer header.
    const link = `${new URL('/set-password', this.config.ADMIN_APP_URL).toString()}#token=${token}`;
    const sentWith = await this.email.send(adminPasswordLinkEmail(email, { name: user.name, kind, link, hours }));
    await this.audit.record({
      actorId: null,
      action: 'admin.password_link_sent',
      targetType: 'user',
      targetId: user.id,
      after: { email, kind, expires_at: expiresAt.toISOString(), by: `admin:${kind === 'create' ? 'create' : 'reset-password'} script` },
    });
    return { admin: user, sentWith, expiresAt };
  }

  /** What the set-password page shows before the admin chooses a password. */
  async describePasswordLink(token: string) {
    const { user, record } = await this.passwordLink(token);
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
  async completePasswordLink(token: string, password: string, options: { resetAuthenticator?: boolean } = {}) {
    const { user, record } = await this.passwordLink(token);
    await this.passwords.assertAcceptable(password);
    const passwordHash = await this.passwords.hash(password);
    const resetAuthenticator = Boolean(options.resetAuthenticator && user.totp);
    await this.prisma.$transaction(async tx => {
      const claimed = await tx.verificationCode.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (claimed.count === 0) throw invalidLink();
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, failedSignIns: 0, lockedUntil: null } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (resetAuthenticator) await tx.totpCredential.deleteMany({ where: { userId: user.id } });
    });
    await this.audit.record({ actorId: user.id, action: 'admin.password_set', targetType: 'user', targetId: user.id, after: { email: user.email, authenticator_reset: resetAuthenticator } });
    if (user.passwordHash) await this.email.send(passwordChangedEmail(user.email)).catch(() => undefined);
    return { object: 'admin_password_set' as const, email: user.email, authenticator_reset: resetAuthenticator };
  }

  private assertSetupEmail(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    if (!this.config.ADMIN_SETUP_EMAILS.includes(email)) {
      throw new Error(`${email} is not in ADMIN_SETUP_EMAILS. Only the addresses listed there (in the environment) can be sent a set-password link.`);
    }
    return email;
  }

  private async passwordLink(token: string) {
    const record = await this.prisma.verificationCode.findFirst({
      where: { purpose: 'admin_password_link', codeHash: sha256(token), consumedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { include: { totp: true } } },
    });
    if (!record || record.user.realm !== 'admin' || record.user.status !== 'active' || !token.startsWith(`${record.userId}.`)) throw invalidLink();
    return { user: record.user, record };
  }

  /** Step 1: password. Returns a short-lived challenge to complete with an authenticator code. */
  async signIn(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const user = this.allowedDomain(email) ? await this.prisma.user.findUnique({ where: { realm_email: { realm: 'admin', email } }, include: { totp: true } }) : null;
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
  async setup(token: string) {
    const { user } = await this.challenge(token);
    if (user.totp?.confirmedAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'mfa_already_set_up', 'Your authenticator is already set up.');
    }
    const secret = new Secret({ size: 20 });
    await this.prisma.totpCredential.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secretEncrypted: this.encryption().encrypt(secret.base32) },
      update: { secretEncrypted: this.encryption().encrypt(secret.base32), lastUsedStep: null },
    });
    return { object: 'mfa_setup' as const, secret: secret.base32, otpauth_uri: this.totp(user.email, secret.base32).toString() };
  }

  /** Step 2: authenticator code (or a recovery code). Starts the admin session. */
  async verify(token: string, code: string, req: Request, res: Response) {
    const { user, record } = await this.challenge(token);
    const credential = user.totp;
    if (!credential) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mfa_setup_required', 'Set up your authenticator first.');

    const accepted = /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code) ? await this.useRecoveryCode(user.id, credential.recoveryCodeHashes, code) : await this.useTotp(user, credential, code);
    if (!accepted) {
      await this.prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw invalidCode();
    }

    let recoveryCodes: string[] | undefined;
    if (!credential.confirmedAt) {
      recoveryCodes = Array.from({ length: recoveryCodeCount }, recoveryCode);
      await this.prisma.totpCredential.update({ where: { userId: user.id }, data: { confirmedAt: new Date(), recoveryCodeHashes: recoveryCodes.map(sha256) } });
    }
    await this.prisma.verificationCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    await this.prisma.user.update({ where: { id: user.id }, data: { failedSignIns: 0, lockedUntil: null, lastSignInAt: new Date() } });
    await this.sessions.create(user.id, 'admin', req, res);
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
    if (!user || user.realm !== 'admin' || !user.totp?.confirmedAt) throw invalidCode();
    if (!(await this.useTotp(user, user.totp, code))) {
      await this.recordFailure(user);
      throw invalidCode();
    }
  }

  private present(user: User) {
    return { object: 'admin' as const, id: user.id, name: user.name, email: user.email, roles: user.adminRoles };
  }

  private async challenge(token: string) {
    const userId = token.split('.')[0];
    if (!/^[0-9a-f-]{36}$/.test(userId)) throw invalidChallenge();
    const record = await this.prisma.verificationCode.findFirst({
      where: { userId, purpose: 'admin_mfa_challenge', consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.expiresAt <= new Date() || record.attempts >= maxChallengeAttempts || !sameDigest(record.codeHash, sha256(token))) throw invalidChallenge();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { totp: true } });
    if (user.status !== 'active') throw invalidChallenge();
    return { user, record };
  }

  /** Accepts the current code or one either side (clock drift), and never the same time step twice. */
  private async useTotp(user: User, credential: { secretEncrypted: string; lastUsedStep: bigint | null }, code: string) {
    if (!/^\d{6}$/.test(code)) return false;
    const delta = this.totp(user.email, this.encryption().decrypt(credential.secretEncrypted)).validate({ token: code, window: 1 });
    if (delta === null) return false;
    const step = BigInt(Math.floor(Date.now() / 30_000) + delta);
    if (credential.lastUsedStep !== null && step <= credential.lastUsedStep) return false;
    // Conditional update, so two simultaneous requests cannot both use the same code.
    const updated = await this.prisma.totpCredential.updateMany({
      where: { userId: user.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
      data: { lastUsedStep: step },
    });
    return updated.count === 1;
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

  private async recordFailure(user: User) {
    const failures = user.failedSignIns + 1;
    await this.prisma.user.update({
      where: { id: user.id },
      data: failures >= lockout.maxFailures ? { failedSignIns: 0, lockedUntil: new Date(Date.now() + lockout.durationMs) } : { failedSignIns: failures },
    });
  }

  private allowedDomain(email: string) {
    const domain = email.split('@')[1] ?? '';
    return this.config.ADMIN_EMAIL_DOMAINS.includes(domain);
  }

  private totp(label: string, base32: string) {
    return new TOTP({ issuer: 'BitoCard Admin', label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(base32) });
  }

  private encryption() {
    if (!this.config.ENCRYPTION_KEY) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Admin sign-in is not configured.');
    }
    return new Encryption(this.config.ENCRYPTION_KEY);
  }
}
