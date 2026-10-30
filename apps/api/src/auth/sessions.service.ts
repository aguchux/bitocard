import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import type { Realm } from '../generated/prisma/client.js';
import { isAdminRealm } from './caller.js';
import { productOf } from '../products/product.js';

const hour = 60 * 60 * 1000;

/** How long each realm's sessions last. */
export const sessionPolicy: Record<Realm, { lifetimeMs: number }> = {
  reseller: { lifetimeMs: 30 * 24 * hour },
  admin: { lifetimeMs: 12 * hour },
  afrippa_admin: { lifetimeMs: 12 * hour },
};

const touchEveryMs = 5 * 60 * 1000;

/** Server-side sessions: the cookie holds a random token; the database holds only its hash, so sessions can be revoked instantly. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, realm: Realm, req: Request, res: Response) {
    const token = `bcs_${randomToken()}`;
    const { lifetimeMs } = sessionPolicy[realm];
    const cookie = this.cookieName(realm);
    const session = await this.prisma.session.create({
      data: {
        userId,
        realm,
        tokenHash: sha256(token),
        ip: req.ip ?? null,
        userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
        expiresAt: new Date(Date.now() + lifetimeMs),
      },
    });
    // An admin cookie from before it became host-only would be sent alongside the new one: clear it first.
    if (realm === 'admin' && this.config.SESSION_COOKIE_DOMAIN) res.clearCookie(cookie, this.sharedCookieOptions());
    res.cookie(cookie, token, { ...this.cookieOptions(realm), maxAge: lifetimeMs });
    return session;
  }

  /** The active session and user for a token, or null. Refreshes last-seen at most every five minutes. */
  async resolve(token: string, realm: Realm) {
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!session || session.realm !== realm || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (session.user.status !== 'active') return null;
    if (Date.now() - session.lastSeenAt.getTime() > touchEveryMs) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return session;
  }

  revoke(sessionId: string) {
    return this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  revokeAllForUser(userId: string) {
    return this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  clearCookie(realm: Realm, res: Response) {
    if (realm === 'admin' && this.config.SESSION_COOKIE_DOMAIN) res.clearCookie(this.cookieName(realm), this.sharedCookieOptions());
    res.clearCookie(this.cookieName(realm), this.cookieOptions(realm));
  }

  /**
   * Resellers' `bc_session` is shared on SESSION_COOKIE_DOMAIN (the docs read it). Both admin cookies (BitoCard's and
   * Afrippa's) are host-only and SameSite=Strict: they only ever go to the API host that set them, never to resellers'
   * `<store>.bitocard.com` or any other subdomain, and never with a request started from another site.
   */
  /** Each realm has its own cookie, named for the product (`bc_session`, `udz_session`…), so a session of one realm never reaches another's app or routes. */
  cookieName(realm: Realm) {
    return productOf(this.config).cookies[realm];
  }

  private cookieOptions(realm: Realm): CookieOptions {
    return isAdminRealm(realm) ? { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'strict', path: '/' } : this.sharedCookieOptions();
  }

  private sharedCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      ...(this.config.SESSION_COOKIE_DOMAIN ? { domain: this.config.SESSION_COOKIE_DOMAIN } : {}),
    };
  }
}
