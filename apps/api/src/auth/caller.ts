import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiKeyMode, Realm, ResellerRole } from '../generated/prisma/client';

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
      apiKeyId: string;
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

/** No sign-in needed (a caller is still identified if credentials are sent). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Which realm may call the route. Defaults to `reseller`; admin routes must say `admin`. */
export const RealmOnly = (realm: Realm) => SetMetadata(ROUTE_REALM, realm);

/** Reseller staff roles allowed to call the route (sessions). Owners are always allowed. */
export const Roles = (...roles: ResellerRole[]) => SetMetadata(ROUTE_ROLES, roles);

/** Admin roles allowed to call an admin route. super_admin is always allowed. */
export const AdminRoles = (...roles: string[]) => SetMetadata(ROUTE_ADMIN_ROLES, roles);

/** API key scopes required to call the route (API keys). */
export const Scopes = (...scopes: string[]) => SetMetadata(ROUTE_SCOPES, scopes);

/** Only a signed-in person may call the route, never an API key (for example, managing API keys). */
export const SessionOnly = () => SetMetadata(ROUTE_SESSION_ONLY, true);

export const CurrentCaller = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<CallerRequest>().caller ?? null;
});
