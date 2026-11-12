import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { randomToken, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { googleAuthorizationUrl, googleClaims, GoogleSignInError, verifyGoogleIdToken, type GoogleClaims } from '../auth/google.service.js';
import { googleNames } from '../auth/names.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Store } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { SignupJourneysService } from '../signups/journeys.service.js';
import { CustomersService } from './customers.service.js';

const stateLifetimeMs = 10 * 60 * 1000;
/** What a customer's round trip is kept under (`oauth_states.return_to`): never a Seller HQ address, so neither finishes the other. */
export const customerGoogleState = (storeId: string) => `customer:${storeId}`;

/** What each failure answers: the site shows the customer why. */
const failures: Record<string, [HttpStatus, string, string]> = {
  google_state_invalid: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'This Google sign-in has expired. Start again.'],
  google_failed: [HttpStatus.BAD_GATEWAY, 'api_error', 'Google sign-in did not work. Try again.'],
  google_token_invalid: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'Google could not confirm this sign-in. Try again.'],
  google_email_unverified: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'Google has not confirmed this email address.'],
  google_account_not_found: [HttpStatus.NOT_FOUND, 'not_found_error', 'No account uses this Google account yet. Sign up with Google first.'],
  account_exists_sign_in_with_password: [HttpStatus.CONFLICT, 'conflict_error', 'An account already uses this email. Sign in with your email and password.'],
  account_disabled: [HttpStatus.FORBIDDEN, 'permission_error', 'This account is suspended.'],
};
const refused = (code: string) => {
  const [status, type, message] = failures[code] ?? failures.google_failed!;
  return new ApiError(status, type as 'api_error', failures[code] ? code : 'google_failed', message);
};

/**
 * "Continue with Google" for Udozo's customers (udozo.com's accounts, shared by every store), with Udozo's own Google
 * client (Settings > Integrations > Google). udozo.com's server drives the round trip: it asks for Google's address and a
 * one-time state (kept in its own cookie), Google returns the browser to `<STOREFRONT_URL>/auth/google/callback` (add it
 * to the Google client's redirect addresses beside Seller HQ's), and its server sends the code here.
 *
 * A Google account no account uses yet signs up, whether the customer chose sign-in or sign-up (4 November 2026, the
 * owner's request): the account is made with its email confirmed by Google, its first and last name Google's,
 * unconfirmed, and no password until Forgot password sets one. A Google account never links itself to an account with
 * the same email (that one signs in with its password). A new account then onboards on udozo.com in one step (its name,
 * its country, fixed, and its mobile, kept to confirm later): until then it reaches only its own account routes
 * (`phonePendingFor`).
 */
@Injectable()
export class CustomerGoogleService {
  private readonly logger = new Logger('CustomerGoogle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly integrations: IntegrationsService,
    @Optional() private readonly journeys?: SignupJourneysService,
  ) {}

  /** A refusal once Google has named the email: kept as a step of the person's sign-up journey (the route cannot see the email). */
  private async refuseFor(email: string, code: string) {
    await this.journeys?.record({ surface: 'udozo', step: 'google', email, error: code });
    return refused(code);
  }

  private client() {
    const config = this.integrations.config;
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'google_not_configured', 'Google sign-in is not available yet. Use your email instead.');
    }
    const redirectUri = new URL('/auth/google/callback', String(config.STOREFRONT_URL ?? 'https://udozo.com')).toString();
    return { config, clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET, redirectUri };
  }

  /** Starts a round trip: Google's consent address, and the state the site keeps until Google returns. */
  async start(store: Store, intent: 'signin' | 'signup') {
    const { config, clientId, redirectUri } = this.client();
    const state = randomToken();
    const nonce = randomToken(16);
    const codeVerifier = randomToken(48);
    const expiresAt = new Date(Date.now() + stateLifetimeMs);
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.oAuthState.create({ data: { id: sha256(state), codeVerifier, nonce, returnTo: customerGoogleState(store.id), intent, platform: 'bitocard', expiresAt } });
    return { object: 'google_sign_in' as const, url: googleAuthorizationUrl(config, { clientId, redirectUri, state, nonce, codeVerifier }), state, expires_at: expiresAt.toISOString() };
  }

  /** Finishes it: the customer signed in (signed up first when no account uses this Google account), with `signed_up` when the account is new. */
  async finish(store: Store, input: { state: string; code: string; ref?: string }) {
    const record = await this.prisma.oAuthState.findUnique({ where: { id: sha256(input.state) } });
    // Only this store's accounts' own round trips, unexpired.
    if (!record || record.provider !== 'google' || record.platform !== 'bitocard' || record.returnTo !== customerGoogleState(store.id) || record.expiresAt <= new Date()) throw refused('google_state_invalid');
    const { config, clientId, clientSecret, redirectUri } = this.client();
    // Used once: whoever deletes it goes on.
    if ((await this.prisma.oAuthState.deleteMany({ where: { id: record.id } })).count === 0) throw refused('google_state_invalid');
    let claims;
    try {
      claims = await googleClaims(config, { code: input.code, codeVerifier: record.codeVerifier, nonce: record.nonce, clientId, clientSecret, redirectUri });
    } catch (error) {
      if (!(error instanceof GoogleSignInError)) this.logger.error({ err: error }, 'Google sign-in failed');
      throw refused(error instanceof GoogleSignInError ? error.code : 'google_failed');
    }
    return this.signIn(store, claims, input.ref);
  }

  /**
   * Udozo's app: Google's SDK gives the app an ID token for the nonce the app made, sent here as it is. It must name one
   * of Udozo's client IDs (the app's own, or the web one the app asks for as its server client).
   */
  async native(store: Store, input: { idToken: string; nonce: string; ref?: string }) {
    const config = this.integrations.config;
    const audiences = [config.GOOGLE_CLIENT_ID ?? '', ...(config.GOOGLE_APP_CLIENT_IDS ?? '').split(',').map(item => item.trim())].filter(Boolean);
    if (!audiences.length) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'google_not_configured', 'Google sign-in is not available yet. Use your email instead.');
    let claims: GoogleClaims;
    try {
      claims = await verifyGoogleIdToken(config, input.idToken, { audiences, nonce: input.nonce });
    } catch (error) {
      if (!(error instanceof GoogleSignInError)) this.logger.error({ err: error }, 'Google sign-in failed');
      throw refused(error instanceof GoogleSignInError ? error.code : 'google_failed');
    }
    return this.signIn(store, claims, input.ref);
  }

  /** The account a checked Google identity signs in to, made first when none uses it (shared by the web and the app). */
  private async signIn(store: Store, claims: GoogleClaims, ref?: string) {
    const sub = claims.sub!;
    const email = claims.email!.toLowerCase();

    let created = false;
    let customer = await this.prisma.customer.findUnique({ where: { storeId_googleSubject: { storeId: store.id, googleSubject: sub } } });
    if (customer && customer.status !== 'active') throw refused('account_disabled');
    if (!customer) {
      // Never linked through a matching email: they sign in with their password.
      if (await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email } } })) throw await this.refuseFor(email, 'account_exists_sign_in_with_password');
      // Signing in with a Google account no account uses yet signs up: onboarding follows.
      try {
        customer = await this.prisma.customer.create({
          data: { storeId: store.id, email, ...googleNames(claims, email), emailVerifiedAt: new Date(), googleSubject: sub, passwordHash: null, signupRef: ref ?? null },
        });
        created = true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw refused('account_exists_sign_in_with_password');
        throw error;
      }
    }
    await this.prisma.customer.update({ where: { id: customer.id }, data: { lastSignInAt: new Date() } });
    return { customer: await this.customers.present(customer), session: await this.customers.startSession(customer.id), signed_up: created };
  }
}
