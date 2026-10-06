import { applyDecorators, createParamDecorator, type ExecutionContext, HttpStatus, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { Request } from 'express';
import type { ApiKeyMode, Realm, ResellerRole } from '../generated/prisma/client.js';
import { ApiError } from '../common/errors/api-error.js';

/** Who is making a request: a signed-in person (session) or a reseller system (API key). */
export type Caller =
  | {
      kind: 'session';
      id: string;
      realm: Realm;
      userId: string;
      sessionId: string;
      /** The reseller the person is acting for, and their role in it (reseller realm only). */
      resellerId: string | null;
      role: ResellerRole | null;
      adminRoles: string[];
    }
  | {
      kind: 'api_key';
      id: string;
      realm: 'reseller';
      /** Null for a docs "Try it" token, which acts like a key but is not one (see auth/docs-tokens.ts). */
      apiKeyId: string | null;
      /** Set for a docs "Try it" token: when it expires. */
      docsTokenExpiresAt?: Date;
      resellerId: string;
      mode: ApiKeyMode;
      scopes: string[];
      /** API features the reseller's plan switches off. */
      planRestrictions: string[];
    };

export type CallerRequest = Request & { caller?: Caller };

export const PUBLIC_ROUTE = 'auth:public';
export const ROUTE_REALM = 'auth:realm';
export const ROUTE_ROLES = 'auth:roles';
export const ROUTE_SCOPES = 'auth:scopes';
export const ROUTE_SESSION_ONLY = 'auth:session-only';
export const ROUTE_ADMIN_ROLES = 'auth:admin-roles';
export const ROUTE_CRON = 'auth:cron';

/**
 * The same rules, written into the OpenAPI document for the docs: `x-bitocard-auth` (`public`, `session` or, by default,
 * `api_key` for routes that also accept keys), `x-bitocard-scopes` and `x-bitocard-roles`. A route's own value wins over its
 * controller's, as in the guard.
 */
export const authExtension = 'x-bitocard-auth';

/** No sign-in needed (a caller is still identified if credentials are sent). */
export const Public = () => applyDecorators(SetMetadata(PUBLIC_ROUTE, true), ApiExtension(authExtension, 'public'));

/**
 * Scheduled jobs: no user or API key; the handler checks the cron secret itself (Vercel Cron sends it as a Bearer token,
 * which the guard would otherwise read as an API key).
 */
export const CronOnly = () => SetMetadata(ROUTE_CRON, true);

/** Which realm may call the route. Defaults to `reseller`; admin routes must say `admin`. */
export const RealmOnly = (realm: Realm) => SetMetadata(ROUTE_REALM, realm);

/** Reseller staff roles allowed to call the route (sessions). Owners are always allowed. */
export const Roles = (...roles: ResellerRole[]) => applyDecorators(SetMetadata(ROUTE_ROLES, roles), ApiExtension('x-bitocard-roles', roles));

/** Admin roles allowed to call an admin route. super_admin is always allowed. */
export const AdminRoles = (...roles: string[]) => SetMetadata(ROUTE_ADMIN_ROLES, roles);

/** API key scopes required to call the route (API keys). */
export const Scopes = (...scopes: string[]) => applyDecorators(SetMetadata(ROUTE_SCOPES, scopes), ApiExtension('x-bitocard-scopes', scopes));

/** Only a signed-in person may call the route, never an API key (for example, managing API keys). */
export const SessionOnly = () => applyDecorators(SetMetadata(ROUTE_SESSION_ONLY, true), ApiExtension(authExtension, 'session'));

/** The reseller a caller acts for; people who belong to several resellers choose one with the BitoCard-Reseller header. */
export function resellerOf(caller: Caller) {
  if (!caller.resellerId) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'not_permitted', 'Choose a reseller account first.');
  return caller.resellerId;
}

/** The signed-in person (never an API key) making the request. */
export function personOf(caller: Caller) {
  if (caller.kind !== 'session') throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'session_required', 'Sign in to do this; API keys cannot.');
  return caller.userId;
}

export const CurrentCaller = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<CallerRequest>().caller ?? null;
});
