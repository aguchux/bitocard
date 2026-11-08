import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomToken, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { deviceOf, SignupJourneysService } from '../signups/journeys.service.js';
import { AuthService } from './auth.service.js';
import { originAllowed } from './auth.guard.js';
import { facebookAuthorizationUrl, facebookProfile, type FacebookProfile, FacebookSignInError } from './facebook.js';
import { googleNames } from './names.js';
import { SessionsService } from './sessions.service.js';

export const facebookCookie = 'bc_fb_state';
const stateLifetimeMs = 10 * 60 * 1000;

/**
 * "Continue with Facebook" for Seller HQ's people (never admins), built as Google's is (`GoogleService`): the API's
 * `/v1/auth/facebook/start` sends the browser to Facebook with a one-time state (kept here and in a host-only cookie on
 * that path), Facebook returns it to `FACEBOOK_REDIRECT_URI` (`/v1/auth/facebook/callback`), and the person is signed in
 * and sent back to Seller HQ (with `?auth_error=<code>` when it failed).
 *
 * A Facebook account no account uses yet signs up, whether the person chose sign-in or sign-up: only the person is
 * made, with Facebook's names unconfirmed and no password. Facebook does not say an email is confirmed, so the account's
 * email waits for Seller HQ's emailed code (sent at once), then onboarding opens the reseller account. A Facebook
 * account never links itself to an account with the same email (`account_exists_sign_in_to_link`): that person signs
 * in their own way. Facebook's token is used once and never kept.
 */
@Injectable()
export class FacebookService {
  private readonly logger = new Logger('FacebookSignIn');

  private get config() {
    return this.integrations.config;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly integrations: IntegrationsService,
    private readonly auth: AuthService,
    @Optional() private readonly journeys?: SignupJourneysService,
  ) {}

  /** Starts the flow and returns Facebook's address to send the browser to. */
  async start(res: Response, returnTo: string | undefined, intent: 'signin' | 'signup') {
    const { FACEBOOK_APP_ID: appId, FACEBOOK_REDIRECT_URI: redirectUri } = this.config;
    if (!appId || !this.config.FACEBOOK_APP_SECRET) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'facebook_not_configured', 'Facebook sign-in is not available yet.');
    }
    const state = randomToken();
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.oAuthState.create({
      data: { id: sha256(state), codeVerifier: '', nonce: '', returnTo: this.safeReturnTo(returnTo), intent, provider: 'facebook', expiresAt: new Date(Date.now() + stateLifetimeMs) },
    });
    res.cookie(facebookCookie, state, { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'lax', path: '/v1/auth/facebook', maxAge: stateLifetimeMs });
    return facebookAuthorizationUrl(this.config, { appId, redirectUri, state });
  }

  /** Finishes the flow and returns where to send the browser (Seller HQ, with `auth_error` on failure). */
  async callback(req: Request, res: Response): Promise<string> {
    const query = req.query as Record<string, string | undefined>;
    const cookieState = (req.cookies as Record<string, string> | undefined)?.[facebookCookie];
    res.clearCookie(facebookCookie, { path: '/v1/auth/facebook' });
    const pending = query.state && cookieState === query.state ? await this.takeState(query.state) : null;
    const returnTo = pending?.returnTo ?? this.config.DASHBOARD_URL;
    let email: string | null = null;
    const device = deviceOf(req.headers);
    try {
      if (!pending) throw new FacebookSignInError('facebook_state_invalid');
      if (query.error) throw new FacebookSignInError('facebook_cancelled');
      if (!query.code) throw new FacebookSignInError('facebook_failed');
      const profile = await facebookProfile(this.config, { code: query.code, appId: this.config.FACEBOOK_APP_ID ?? '', appSecret: this.config.FACEBOOK_APP_SECRET ?? '', redirectUri: this.config.FACEBOOK_REDIRECT_URI });
      email = profile.email;
      const { userId, created } = await this.resolveUser(profile);
      await this.prisma.user.update({ where: { id: userId }, data: { lastSignInAt: new Date() } });
      await this.sessions.create(userId, 'reseller', req, res);
      await this.journeys?.record({ surface: 'shq', step: created ? 'facebook' : 'signin', email, device });
      return returnTo;
    } catch (error) {
      const code = error instanceof FacebookSignInError ? error.code : 'facebook_failed';
      if (!(error instanceof FacebookSignInError)) this.logger.error({ err: error }, 'Facebook sign-in failed');
      if (email) await this.journeys?.record({ surface: 'shq', step: 'facebook', email, device, error: code });
      const url = new URL(returnTo);
      url.searchParams.set('auth_error', code);
      return url.toString();
    }
  }

  /** One of Seller HQ's own Facebook round trips (never a customer's, Google's or Afrippa's), used once. */
  private async takeState(state: string) {
    const record = await this.prisma.oAuthState.findUnique({ where: { id: sha256(state) } });
    if (!record || record.provider !== 'facebook' || record.platform !== 'bitocard' || record.returnTo.startsWith('customer:')) return null;
    await this.prisma.oAuthState.delete({ where: { id: record.id } }).catch(() => undefined);
    return record.expiresAt > new Date() ? record : null;
  }

  private async resolveUser(profile: FacebookProfile): Promise<{ userId: string; created: boolean }> {
    const email = profile.email!;
    const linked = await this.prisma.oAuthAccount.findUnique({ where: { provider_providerUserId: { provider: 'facebook', providerUserId: profile.id } }, include: { user: true } });
    if (linked) {
      if (linked.user.status !== 'active') throw new FacebookSignInError('account_disabled');
      return { userId: linked.userId, created: false };
    }
    // Never linked through a matching email (anyone's primary or other address).
    if (await this.prisma.user.findUnique({ where: { realm_email: { realm: 'reseller', email } } })) throw new FacebookSignInError('account_exists_sign_in_to_link');
    if (await this.prisma.userEmail.findUnique({ where: { realm_email: { realm: 'reseller', email } } })) throw new FacebookSignInError('account_exists_sign_in_to_link');
    const names = googleNames({ given_name: profile.firstName ?? undefined, family_name: profile.lastName ?? undefined, name: profile.name ?? undefined }, email);
    const userId = await this.prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { realm: 'reseller', email, emailVerifiedAt: null, ...names } });
      await tx.oAuthAccount.create({ data: { userId: user.id, provider: 'facebook', providerUserId: profile.id, email } });
      return user.id;
    });
    // Its email is confirmed with Seller HQ's own code: never failing the sign-in (Seller HQ can send another).
    await this.auth.resendVerification(userId).catch(error => this.logger.warn({ err: error }, 'Could not send the email confirmation code'));
    return { userId, created: true };
  }

  /** Only Udozo's apps may receive the browser afterwards; anything else falls back to Seller HQ. */
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
