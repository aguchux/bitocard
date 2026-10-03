import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import type { Realm } from '../generated/prisma/client.js';

const hour = 60 * 60 * 1000;

/** Each realm has its own cookie, so a reseller session can never reach the admin app and vice versa. */
export const sessionPolicy: Record<Realm, { cookie: string; lifetimeMs: number }> = {
  reseller: { cookie: 'bc_session', lifetimeMs: 30 * 24 * hour },
  admin: { cookie: 'bc_admin_session', lifetimeMs: 12 * hour },
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
    const { lifetimeMs, cookie } = sessionPolicy[realm];
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
    res.cookie(cookie, token, { ...this.cookieOptions(), maxAge: lifetimeMs });
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
    res.clearCookie(sessionPolicy[realm].cookie, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      ...(this.config.SESSION_COOKIE_DOMAIN ? { domain: this.config.SESSION_COOKIE_DOMAIN } : {}),
    };
  }
}
