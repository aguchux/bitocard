import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { sha256 } from '../common/crypto';
import { ApiError } from '../common/errors/api-error';
import type { Realm, ResellerRole } from '../generated/prisma/client';
import {
  type Caller,
  type CallerRequest,
  PUBLIC_ROUTE,
  ROUTE_ADMIN_ROLES,
  ROUTE_REALM,
  ROUTE_ROLES,
  ROUTE_SCOPES,
  ROUTE_SESSION_ONLY,
} from './caller';
import { SessionsService, sessionPolicy } from './sessions.service';

const apiKeyPattern = /^bc_(test|live)_[A-Za-z0-9_-]{20,}$/;
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const touchEveryMs = 5 * 60 * 1000;

const unauthenticated = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'not_authenticated', 'Sign in, or send a valid API key as a Bearer token.');
const forbidden = (message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', message);

/** Origin matching, with a leading `*.` wildcard for subdomains. */
export function originAllowed(origin: string, allowed: string[]) {
  return allowed.some(pattern => {
    if (!pattern.includes('*')) return origin === pattern;
    const [scheme, host] = pattern.split('://');
    const suffix = host.replace(/^\*\./, '.');
    return origin.startsWith(`${scheme}://`) && origin.slice(scheme.length + 3).endsWith(suffix);
  });
}

/**
 * Identifies the caller on every request (API key in the Authorization header, or the realm's session cookie),
 * then enforces the route's rules: sign-in required unless @Public, realm, staff roles and API key scopes.
 * Cookie-authenticated changes must come from an allowed Origin, which blocks cross-site request forgery.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<CallerRequest>();
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T | undefined>(key, [context.getHandler(), context.getClass()]);
    const realm: Realm = meta<Realm>(ROUTE_REALM) ?? 'reseller';
    const isPublic = meta<boolean>(PUBLIC_ROUTE) ?? false;

    req.caller = (await this.identify(req, realm)) ?? undefined;
    const caller = req.caller;

    if (caller?.kind === 'session' && !safeMethods.has(req.method)) {
      const origin = req.get('origin');
      if (!origin || !originAllowed(origin, this.config.ALLOWED_ORIGINS)) {
        throw forbidden('This request must come from a BitoCard app.');
      }
    }

    if (isPublic) return true;
    if (!caller) throw unauthenticated();
    if (caller.realm !== realm) throw forbidden('This account cannot use this endpoint.');

    if (caller.kind === 'api_key') {
      if (meta<boolean>(ROUTE_SESSION_ONLY)) throw forbidden('API keys cannot use this endpoint; sign in instead.');
      const scopes = meta<string[]>(ROUTE_SCOPES) ?? [];
      const missing = scopes.filter(scope => !caller.scopes.includes(scope));
      if (missing.length) throw forbidden(`This API key is missing the scope ${missing.join(', ')}.`);
      const restricted = scopes.filter(scope => caller.planRestrictions.includes(scope));
      if (restricted.length) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'plan_restricted', `Your plan does not include ${restricted.join(', ')}.`);
      }
      return true;
    }

    const adminRoles = meta<string[]>(ROUTE_ADMIN_ROLES);
    if (realm === 'admin' && adminRoles && !caller.adminRoles.includes('super_admin') && !adminRoles.some(role => caller.adminRoles.includes(role))) {
      throw forbidden('Your admin role does not allow this.');
    }

    const roles = meta<ResellerRole[]>(ROUTE_ROLES);
    if (realm === 'reseller' && roles) {
      if (!caller.role) throw forbidden('Choose a reseller account first.');
      if (caller.role !== 'owner' && !roles.includes(caller.role)) throw forbidden('Your role does not allow this.');
    }
    return true;
  }

  private async identify(req: CallerRequest, realm: Realm): Promise<Caller | null> {
    const authorization = req.get('authorization');
    if (authorization) {
      const [scheme, token] = authorization.split(' ');
      if (scheme?.toLowerCase() !== 'bearer' || !token || !apiKeyPattern.test(token)) throw unauthenticated();
      return this.identifyApiKey(token);
    }

    const token = (req.cookies as Record<string, string> | undefined)?.[sessionPolicy[realm].cookie];
    if (!token) return null;
    const session = await this.sessions.resolve(token, realm);
    if (!session) return null;

    let resellerId: string | null = null;
    let role: ResellerRole | null = null;
    if (realm === 'reseller') {
      const requested = req.get('bitocard-reseller');
      const memberships = await this.prisma.resellerMember.findMany({ where: { userId: session.userId } });
      const membership = requested ? memberships.find(m => m.resellerId === requested) : memberships.length === 1 ? memberships[0] : undefined;
      if (requested && !membership) throw forbidden('You are not a member of that reseller account.');
      resellerId = membership?.resellerId ?? null;
      role = membership?.role ?? null;
    }

    return {
      kind: 'session',
      id: `user:${session.userId}`,
      realm,
      userId: session.userId,
      sessionId: session.id,
      resellerId,
      role,
      adminRoles: session.user.adminRoles,
    };
  }

  private async identifyApiKey(token: string): Promise<Caller> {
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(token) }, include: { reseller: { include: { plan: true } } } });
    const now = new Date();
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= now) || key.reseller.status === 'suspended') throw unauthenticated();
    if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > touchEveryMs) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });
    }
    return {
      kind: 'api_key',
      id: `key:${key.id}`,
      realm: 'reseller',
      apiKeyId: key.id,
      resellerId: key.resellerId,
      mode: key.mode,
      scopes: key.scopes,
      planRestrictions: key.reseller.plan.apiRestrictions,
    };
  }
}
