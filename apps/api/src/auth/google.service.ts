import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { originAllowed } from './auth.guard.js';
import { SessionsService } from './sessions.service.js';

export const oauthCookie = 'bc_oauth_state';
const stateLifetimeMs = 10 * 60 * 1000;
const googleIssuers = ['https://accounts.google.com', 'accounts.google.com'];

/** A failure during the Google round trip. The browser is sent back to the app with `?auth_error=<code>`. */
class GoogleSignInError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type GoogleClaims = JWTPayload & { email?: string; email_verified?: boolean; name?: string; nonce?: string };

/** Why the Google round trip was started. */
export type GoogleIntent = 'signin' | 'signup' | 'link';

/**
 * "Sign in with Google" for resellers (never admins): authorization code flow with PKCE, a one-time state,
 * and an ID token verified against Google's published keys.
 *
 * Sign-up is deliberate: only a round trip started with `intent=signup` creates an account, and it creates only the
 * person (Google has confirmed the email); they then open their reseller account in SHQ's onboarding (business name
 * and country). Signing in with a Google account that has no BitoCard account fails with `google_account_not_found`.
 * A Google-only person has no password until they set one with "Forgot password"; then both ways work.
 *
 * Linking rules: a Google account already linked signs in. A signed-in person can link Google to their account.
 * If an email/password account already uses the Google email, Google is not linked automatically: the person
 * must sign in with their password first and link from there, which stops takeover through a matching email.
 */
@Injectable()
export class GoogleService {
  private readonly logger = new Logger('GoogleSignIn');
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  /** Admin integration settings over the environment, read fresh on every use. */
  private get config() {
    return this.integrations.config;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Starts the flow and returns the Google URL to redirect to. */
  async start(req: Request, res: Response, returnTo: string | undefined, intent: GoogleIntent, linkUserId: string | null) {
    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_REDIRECT_URI: redirectUri } = this.config;
    if (!clientId || !this.config.GOOGLE_CLIENT_SECRET) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'google_not_configured', 'Google sign-in is not available yet.');
    }
    const state = randomToken();
    const nonce = randomToken(16);
    const codeVerifier = randomToken(48);
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.oAuthState.create({
      data: {
        id: sha256(state),
        codeVerifier,
        nonce,
        returnTo: this.safeReturnTo(returnTo),
        linkUserId,
        intent: linkUserId ? 'link' : intent === 'signup' ? 'signup' : 'signin',
        expiresAt: new Date(Date.now() + stateLifetimeMs),
      },
    });
    res.cookie(oauthCookie, state, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/v1/auth/google',
      maxAge: stateLifetimeMs,
    });

    const url = new URL(this.config.GOOGLE_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /** Finishes the flow and returns where to send the browser (the app, with `auth_error` on failure). */
  async callback(req: Request, res: Response): Promise<string> {
    const query = req.query as Record<string, string | undefined>;
    const cookieState = (req.cookies as Record<string, string> | undefined)?.[oauthCookie];
    res.clearCookie(oauthCookie, { path: '/v1/auth/google' });

    const pending = query.state && cookieState === query.state ? await this.takeState(query.state) : null;
    const returnTo = pending?.returnTo ?? this.config.DASHBOARD_URL;
    try {
      if (!pending) throw new GoogleSignInError('google_state_invalid');
      if (query.error) throw new GoogleSignInError('google_cancelled');
      if (!query.code) throw new GoogleSignInError('google_failed');

      const claims = await this.exchange(query.code, pending.codeVerifier, pending.nonce);
      const userId = await this.resolveUser(claims, pending.intent, pending.linkUserId);
      await this.prisma.user.update({ where: { id: userId }, data: { lastSignInAt: new Date() } });
      await this.sessions.create(userId, 'reseller', req, res);
      return returnTo;
    } catch (error) {
      const code = error instanceof GoogleSignInError ? error.code : 'google_failed';
      if (!(error instanceof GoogleSignInError)) this.logger.error({ err: error }, 'Google sign-in failed');
      const url = new URL(returnTo);
      url.searchParams.set('auth_error', code);
      return url.toString();
    }
  }

  private async takeState(state: string) {
    const record = await this.prisma.oAuthState.findUnique({ where: { id: sha256(state) } });
    if (!record) return null;
    await this.prisma.oAuthState.delete({ where: { id: record.id } }).catch(() => undefined);
    return record.expiresAt > new Date() ? record : null;
  }

  private async exchange(code: string, codeVerifier: string, nonce: string): Promise<GoogleClaims> {
    const res = await fetch(this.config.GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: this.config.GOOGLE_CLIENT_ID ?? '',
        client_secret: this.config.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: this.config.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new GoogleSignInError('google_failed');
    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    if (!idToken) throw new GoogleSignInError('google_failed');

    this.jwks ??= createRemoteJWKSet(new URL(this.config.GOOGLE_JWKS_URL));
    let claims: GoogleClaims;
    try {
      ({ payload: claims } = await jwtVerify<GoogleClaims>(idToken, this.jwks, { issuer: googleIssuers, audience: this.config.GOOGLE_CLIENT_ID }));
    } catch {
      throw new GoogleSignInError('google_token_invalid');
    }
    if (claims.nonce !== nonce) throw new GoogleSignInError('google_token_invalid');
    if (!claims.sub || !claims.email || claims.email_verified !== true) throw new GoogleSignInError('google_email_unverified');
    return claims;
  }

  private async resolveUser(claims: GoogleClaims, intent: GoogleIntent, linkUserId: string | null): Promise<string> {
    const sub = claims.sub as string;
    const email = (claims.email as string).toLowerCase();
    const linked = await this.prisma.oAuthAccount.findUnique({ where: { provider_providerUserId: { provider: 'google', providerUserId: sub } }, include: { user: true } });

    if (intent === 'link' && linkUserId) {
      if (linked && linked.userId !== linkUserId) throw new GoogleSignInError('google_account_in_use');
      if (!linked) await this.prisma.oAuthAccount.create({ data: { userId: linkUserId, provider: 'google', providerUserId: sub, email } });
      return linkUserId;
    }

    if (linked) {
      if (linked.user.status !== 'active') throw new GoogleSignInError('account_disabled');
      return linked.userId;
    }

    const existing = await this.prisma.user.findUnique({ where: { realm_email: { realm: 'reseller', email } } });
    if (existing) throw new GoogleSignInError('account_exists_sign_in_to_link');
    // Someone's other address: never a new account, and never linked to them automatically.
    if (await this.prisma.userEmail.findUnique({ where: { realm_email: { realm: 'reseller', email } } })) throw new GoogleSignInError('account_exists_sign_in_to_link');

    // Signing in never creates an account: the person signs up first, on purpose.
    if (intent !== 'signup') throw new GoogleSignInError('google_account_not_found');

    // A new person: Google has confirmed the email. Their reseller account is opened during onboarding.
    return this.prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: { realm: 'reseller', email, emailVerifiedAt: new Date(), name: claims.name?.trim() || email.split('@')[0] },
      });
      await tx.oAuthAccount.create({ data: { userId: user.id, provider: 'google', providerUserId: sub, email } });
      return user.id;
    });
  }

  /** Only BitoCard apps may receive the browser afterwards; anything else falls back to the dashboard. */
  private safeReturnTo(returnTo: string | undefined) {
    if (!returnTo) return this.config.DASHBOARD_URL;
    try {
      const url = new URL(returnTo);
      return originAllowed(url.origin, this.config.ALLOWED_ORIGINS) ? url.toString() : this.config.DASHBOARD_URL;
    } catch {
      return this.config.DASHBOARD_URL;
    }
  }
}
