import { createHash } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { AppConfig } from '../config/config.js';

/** A failure while signing in with Apple: the app shows the person why by its code. */
export class AppleSignInError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type AppleClaims = JWTPayload & { email?: string; email_verified?: boolean | string; is_private_email?: boolean | string; nonce?: string };

type Config = Pick<AppConfig, 'APPLE_AUTH_URL' | 'APPLE_BUNDLE_IDS' | 'APPLE_TEAM_ID' | 'APPLE_KEY_ID' | 'APPLE_PRIVATE_KEY'>;

const appleIssuer = 'https://appleid.apple.com';
const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** The bundle IDs Apple's tokens may be for (`APPLE_BUNDLE_IDS`, separated by commas). */
export const appleAudiences = (config: Pick<AppConfig, 'APPLE_BUNDLE_IDS'>) =>
  (config.APPLE_BUNDLE_IDS ?? '').split(',').map(item => item.trim()).filter(Boolean);

/**
 * A PEM private key as pasted into a one-line field: the line breaks may be gone, so the key's base64 is taken from
 * between the markers and wrapped again.
 */
export function pemKey(pasted: string) {
  const body = pasted.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Checks the identity token Apple gave the app: Apple's published keys, Apple as issuer, one of the app's bundle IDs as
 * audience, and the nonce the app made (Apple keeps either the nonce or its SHA-256, as the app passed it). Apple always
 * puts a confirmed email in it, sometimes a private relay address, which works like any other.
 */
export async function verifyAppleIdentityToken(config: Config, token: string, nonce: string): Promise<AppleClaims & { sub: string; email: string }> {
  const audiences = appleAudiences(config);
  if (!audiences.length) throw new AppleSignInError('apple_not_configured');
  const url = `${config.APPLE_AUTH_URL.replace(/\/+$/, '')}/auth/keys`;
  let jwks = jwksByUrl.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    jwksByUrl.set(url, jwks);
  }
  let claims: AppleClaims;
  try {
    ({ payload: claims } = await jwtVerify<AppleClaims>(token, jwks, { issuer: appleIssuer, audience: audiences }));
  } catch {
    throw new AppleSignInError('apple_token_invalid');
  }
  const hashed = createHash('sha256').update(nonce).digest('hex');
  if (!nonce || (claims.nonce !== nonce && claims.nonce !== hashed)) throw new AppleSignInError('apple_token_invalid');
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!claims.sub || !email || !verified || email.length > 254) throw new AppleSignInError('apple_email_missing');
  return { ...claims, sub: claims.sub, email };
}

/** Whether the API can talk to Apple about an account (exchange a code, revoke access): the team, key and private key. */
export const appleKeysSet = (config: Config) => Boolean(config.APPLE_TEAM_ID && config.APPLE_KEY_ID && config.APPLE_PRIVATE_KEY);

/** The client secret Apple asks for: a short-lived ES256 token signed with the team's Sign in with Apple key. */
export async function appleClientSecret(config: Config, clientId: string) {
  const key = await importPKCS8(pemKey(config.APPLE_PRIVATE_KEY ?? ''), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.APPLE_KEY_ID })
    .setIssuer(config.APPLE_TEAM_ID!)
    .setIssuedAt()
    .setExpirationTime('5m')
    .setAudience(appleIssuer)
    .setSubject(clientId)
    .sign(key);
}

async function appleForm(config: Config, path: string, form: Record<string, string>) {
  const res = await fetch(`${config.APPLE_AUTH_URL.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, body };
}

/**
 * Exchanges the one-time authorization code the app got with the token for a refresh token, kept only so access can be
 * revoked when the account is deleted. Null when it cannot be had: signing in never depends on it.
 */
export async function appleRefreshToken(config: Config, input: { code: string; clientId: string }) {
  if (!appleKeysSet(config)) return null;
  const { ok, body } = await appleForm(config, '/auth/token', {
    client_id: input.clientId,
    client_secret: await appleClientSecret(config, input.clientId),
    code: input.code,
    grant_type: 'authorization_code',
  });
  return ok && typeof body?.refresh_token === 'string' ? body.refresh_token : null;
}

/** Revokes the app's access to the person's Apple account (account deletion). True when Apple accepted it. */
export async function revokeApple(config: Config, input: { token: string; clientId: string }) {
  if (!appleKeysSet(config)) return false;
  const { ok } = await appleForm(config, '/auth/revoke', {
    client_id: input.clientId,
    client_secret: await appleClientSecret(config, input.clientId),
    token: input.token,
    token_type_hint: 'refresh_token',
  });
  return ok;
}
