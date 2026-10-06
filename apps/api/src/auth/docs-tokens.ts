import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiKeyMode, ResellerRole } from '../generated/prisma/client.js';
import { apiKeyScopes } from '../api-keys/api-keys.service.js';

/**
 * "Try it" tokens for the API documentation (docs.bitocard.com). A signed-in reseller exchanges their dashboard session
 * for one: short-lived, for one reseller account and one mode, and tied to that session, so signing out (or losing
 * the membership) ends it. Stateless: signed with ENCRYPTION_KEY, never stored; the docs keep it in memory only.
 * To the API it is an API key: key rules, scopes and plan restrictions apply, and dashboard-only routes refuse it.
 */
export const docsTokenLifetimeMs = 15 * 60 * 1000;
export const docsTokenPattern = /^bc_docs_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;

/** Roles that may make changes through the docs, the same as those who may create API keys; others get read-only. */
export const docsWriteRoles: ResellerRole[] = ['owner', 'admin', 'developer'];

export type DocsTokenClaims = {
  /** The dashboard session that issued it. */
  sid: string;
  rid: string;
  mode: ApiKeyMode;
  /** Read-only: only the `:read` scopes. */
  ro: boolean;
  /** Expiry, milliseconds since 1970. */
  exp: number;
};

const sign = (key: string, body: string) => createHmac('sha256', key).update(`bitocard-docs-token:${body}`).digest('base64url');

export function issueDocsToken(key: string, claims: DocsTokenClaims) {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `bc_docs_${body}.${sign(key, body)}`;
}

/** The claims of a genuine, unexpired token; null for anything else. */
export function readDocsToken(key: string, token: string, now = Date.now()): DocsTokenClaims | null {
  const match = docsTokenPattern.exec(token);
  if (!match) return null;
  const [, body, signature] = match;
  const expected = sign(key, body);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<DocsTokenClaims>;
    const valid =
      typeof claims.sid === 'string' &&
      typeof claims.rid === 'string' &&
      (claims.mode === 'test' || claims.mode === 'live') &&
      typeof claims.ro === 'boolean' &&
      typeof claims.exp === 'number' &&
      claims.exp > now;
    return valid ? (claims as DocsTokenClaims) : null;
  } catch {
    return null;
  }
}

/** Every scope, or only the reading ones. */
export const docsTokenScopes = (readOnly: boolean) => (readOnly ? apiKeyScopes.filter(scope => scope.endsWith(':read')) : [...apiKeyScopes]);
