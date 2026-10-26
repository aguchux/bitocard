import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import type { Realm, ResellerRole } from '../generated/prisma/client.js';
import { type Caller, type CallerRequest, PUBLIC_ROUTE, ROUTE_ADMIN_ROLES, ROUTE_CRON, ROUTE_REALM, ROUTE_ROLES, ROUTE_SCOPES, ROUTE_SESSION_ONLY, ROUTE_STEP_UP, ROUTE_TWO_STEP_PENDING, requireStepUp } from './caller.js';
import { twoStepPending } from './mfa-policy.js';
import { freePlanCode } from '../plans/features.js';
import { docsTokenPattern, docsTokenScopes, docsWriteRoles, readDocsToken } from './docs-tokens.js';
import { reservedSubdomains } from '../stores/reserved.js';
import { SessionsService, sessionPolicy } from './sessions.service.js';

const apiKeyPattern = /^bc_(test|live)_[A-Za-z0-9_-]{20,}$/;
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const touchEveryMs = 5 * 60 * 1000;

const unauthenticated = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'not_authenticated', 'Sign in, or send a valid API key as a Bearer token.');
const forbidden = (message: string) => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', message);

/**
 * Origin matching. A leading `*.` wildcard matches only BitoCard's own subdomains (the reserved names no store can take,
 * such as `shq`, `admin` and `docs`), one level deep: never a reseller's hosted store (`<store>.bitocard.com`), whose
 * pages a reseller controls, so a script on one can never act as a signed-in reseller or admin.
 */
export function originAllowed(origin: string, allowed: string[]) {
  return allowed.some(pattern => {
    if (!pattern.includes('*')) return origin === pattern;
    const [scheme, host] = pattern.split('://');
    const suffix = host.replace(/^\*\./, '.');
    if (!origin.startsWith(`${scheme}://`)) return false;
    const originHost = origin.slice(scheme.length + 3);
    if (!originHost.endsWith(suffix)) return false;
    const label = originHost.slice(0, -suffix.length);
    return reservedSubdomains.has(label);
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
    if (meta<boolean>(ROUTE_CRON)) return true;

    req.caller = (await this.identify(req, realm)) ?? undefined;
    const caller = req.caller;

    if (caller?.kind === 'session' && !safeMethods.has(req.method)) {
      const origin = req.get('origin');
      if (!origin || !originAllowed(origin, this.config.ALLOWED_ORIGINS)) {
        throw forbidden('This request must come from a BitoCard app.');
      }
    }

    // Signed in with a password (or Google) but not yet with the second step: only finishing it is allowed. Public routes
    // treat the session as signed out.
    if (caller?.kind === 'session' && caller.twoStepPending && !meta<boolean>(ROUTE_TWO_STEP_PENDING)) {
      if (isPublic) {
        req.caller = undefined;
        return true;
      }
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'mfa_required', 'Finish signing in with your two-step code.');
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
    if (realm === 'admin' && meta<boolean>(ROUTE_STEP_UP)) requireStepUp(caller);

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
      if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthenticated();
      if (docsTokenPattern.test(token)) return this.identifyDocsToken(token);
      if (!apiKeyPattern.test(token)) throw unauthenticated();
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
      stepUpUntil: realm === 'admin' ? session.stepUpUntil : null,
      twoStepPending: realm === 'reseller' && Boolean(await twoStepPending(this.prisma, session)),
    };
  }

  /**
   * A docs "Try it" token: genuine and unexpired, its dashboard session still open, the person still a member of the
   * reseller (write access only while their role allows it), and the reseller not suspended (live: active).
   */
  private async identifyDocsToken(token: string): Promise<Caller> {
    const key = this.config.ENCRYPTION_KEY;
    const claims = key ? readDocsToken(key, token) : null;
    if (!claims) throw unauthenticated();
    const session = await this.prisma.session.findUnique({ where: { id: claims.sid }, include: { user: true } });
    if (!session || session.realm !== 'reseller' || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'active') throw unauthenticated();
    // Its session must have finished two-step sign-in (once it is on, or required, for the person).
    if (await twoStepPending(this.prisma, session)) throw unauthenticated();
    const member = await this.prisma.resellerMember.findFirst({ where: { userId: session.userId, resellerId: claims.rid }, include: { reseller: { include: { plan: true } } } });
    if (!member || member.reseller.status === 'suspended' || (claims.mode === 'live' && member.reseller.status !== 'active')) throw unauthenticated();
    const readOnly = claims.ro || !docsWriteRoles.includes(member.role);
    // A docs token acts for one store: the one it was asked for, else the oldest published (else oldest) store.
    const stores = await this.prisma.store.findMany({ where: { resellerId: claims.rid }, orderBy: { createdAt: 'asc' }, include: { subscription: { include: { plan: true } } } });
    const store = (claims.st ? stores.find(item => item.id === claims.st) : undefined) ?? stores.find(item => item.status === 'published') ?? stores[0];
    return {
      kind: 'api_key',
      id: `docs:${claims.sid}:${claims.mode}`,
      realm: 'reseller',
      apiKeyId: null,
      docsTokenExpiresAt: new Date(claims.exp),
      resellerId: claims.rid,
      storeId: store?.id ?? null,
      mode: claims.mode,
      scopes: docsTokenScopes(readOnly),
      planRestrictions: store?.subscription?.plan.apiRestrictions ?? (store ? await this.startupRestrictions() : member.reseller.plan.apiRestrictions),
    };
  }

  /** The free plan's API restrictions: what a store without a plan of its own has. */
  private async startupRestrictions() {
    return (await this.prisma.plan.findUnique({ where: { code: freePlanCode } }))?.apiRestrictions ?? [];
  }

  private async identifyApiKey(token: string): Promise<Caller> {
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(token) }, include: { reseller: true, store: { include: { subscription: { include: { plan: true } } } } } });
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
      storeId: key.storeId,
      mode: key.mode,
      scopes: key.scopes,
      // A key is limited by its store's plan (Startup when the store has none).
      planRestrictions: key.store.subscription?.plan.apiRestrictions ?? (await this.startupRestrictions()),
    };
  }
}
