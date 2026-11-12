import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { randomToken, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { facebookAuthorizationUrl, facebookProfile, facebookProfileFromIdToken, facebookProfileFromToken, FacebookSignInError, type FacebookProfile } from '../auth/facebook.js';
import { googleNames } from '../auth/names.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Store } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { SignupJourneysService } from '../signups/journeys.service.js';
import { CustomersService } from './customers.service.js';
import { customerGoogleState } from './customer-google.service.js';

const stateLifetimeMs = 10 * 60 * 1000;

/** What each failure answers: udozo.com shows the customer why. */
const failures: Record<string, [HttpStatus, string, string]> = {
  facebook_state_invalid: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'This Facebook sign-in has expired. Start again.'],
  facebook_failed: [HttpStatus.BAD_GATEWAY, 'api_error', 'Facebook sign-in did not work. Try again.'],
  facebook_token_invalid: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'Facebook could not confirm this sign-in. Try again.'],
  facebook_email_missing: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'Facebook did not share an email address. Allow Udozo to see your email, or use your email instead.'],
  account_exists_sign_in_with_password: [HttpStatus.CONFLICT, 'conflict_error', 'An account already uses this email. Sign in with your password or Google.'],
  account_disabled: [HttpStatus.FORBIDDEN, 'permission_error', 'This account is suspended.'],
};
const refused = (code: string) => {
  const [status, type, message] = failures[code] ?? failures.facebook_failed!;
  return new ApiError(status, type as 'api_error', failures[code] ? code : 'facebook_failed', message);
};

/**
 * "Continue with Facebook" for Udozo's customers (udozo.com's accounts, shared by every store), with Udozo's own Meta
 * app (Settings > Integrations > Facebook sign-in), built as Google's is (`CustomerGoogleService`): udozo.com's server
 * asks for Facebook's address and a one-time state (kept in its own cookie), Facebook returns the browser to
 * `<STOREFRONT_URL>/auth/facebook/callback` (one of the app's valid OAuth redirect addresses), and its server sends the
 * code here. The round trip is the customers' own (`return_to` `customer:<store>`) and Facebook's (`provider`), so it
 * never finishes at Seller HQ's callback or as a Google one.
 *
 * A Facebook account no account uses yet signs up, whether the customer chose sign-in or sign-up: the account is made
 * with Facebook's first and last name, unconfirmed, and no password. Facebook does not say an email is confirmed, so
 * unlike Google's the account's email waits for Udozo's emailed code (sent at once; udozo.com's `/verify` takes it),
 * then the usual onboarding (name, country, mobile). A Facebook account never links itself to an account with the same
 * email (that one signs in its own way). Facebook's token is used once and never kept.
 */
@Injectable()
export class CustomerFacebookService {
  private readonly logger = new Logger('CustomerFacebook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly integrations: IntegrationsService,
    @Optional() private readonly journeys?: SignupJourneysService,
  ) {}

  private client() {
    const config = this.integrations.config;
    if (!config.FACEBOOK_APP_ID || !config.FACEBOOK_APP_SECRET) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'facebook_not_configured', 'Facebook sign-in is not available yet. Use your email instead.');
    }
    const redirectUri = new URL('/auth/facebook/callback', String(config.STOREFRONT_URL ?? 'https://udozo.com')).toString();
    return { config, appId: config.FACEBOOK_APP_ID, appSecret: config.FACEBOOK_APP_SECRET, redirectUri };
  }

  /** Starts a round trip: Facebook's consent address, and the state the site keeps until Facebook returns. */
  async start(store: Store, intent: 'signin' | 'signup') {
    const { config, appId, redirectUri } = this.client();
    const state = randomToken();
    const expiresAt = new Date(Date.now() + stateLifetimeMs);
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    // Facebook's manual flow has no PKCE or nonce: the state, kept in the browser and here, and this server's secret do that work.
    await this.prisma.oAuthState.create({ data: { id: sha256(state), codeVerifier: '', nonce: '', returnTo: customerGoogleState(store.id), intent, platform: 'bitocard', provider: 'facebook', expiresAt } });
    return { object: 'facebook_sign_in' as const, url: facebookAuthorizationUrl(config, { appId, redirectUri, state }), state, expires_at: expiresAt.toISOString() };
  }

  /** Finishes it: the customer signed in (signed up first when no account uses this Facebook account), with `signed_up` when the account is new. */
  async finish(store: Store, input: { state: string; code: string; ref?: string }) {
    const record = await this.prisma.oAuthState.findUnique({ where: { id: sha256(input.state) } });
    if (!record || record.provider !== 'facebook' || record.platform !== 'bitocard' || record.returnTo !== customerGoogleState(store.id) || record.expiresAt <= new Date()) throw refused('facebook_state_invalid');
    const { config, appId, appSecret, redirectUri } = this.client();
    // Used once: whoever deletes it goes on.
    if ((await this.prisma.oAuthState.deleteMany({ where: { id: record.id } })).count === 0) throw refused('facebook_state_invalid');
    let profile;
    try {
      profile = await facebookProfile(config, { code: input.code, appId, appSecret, redirectUri });
    } catch (error) {
      if (!(error instanceof FacebookSignInError)) this.logger.error({ err: error }, 'Facebook sign-in failed');
      throw refused(error instanceof FacebookSignInError ? error.code : 'facebook_failed');
    }
    return this.signIn(store, profile, input.ref);
  }

  /**
   * Udozo's app: Facebook's SDK gives the app an access token (checked to be this app's), or on iPhones that decline
   * tracking a Limited Login token for the app's nonce. Either way the same account rules follow.
   */
  async native(store: Store, input: { accessToken?: string; idToken?: string; nonce?: string; ref?: string }) {
    const { config, appId, appSecret } = this.client();
    let profile: FacebookProfile;
    try {
      profile = input.accessToken
        ? await facebookProfileFromToken(config, { token: input.accessToken, appId, appSecret })
        : await facebookProfileFromIdToken(config, { token: input.idToken ?? '', nonce: input.nonce ?? '', appId });
    } catch (error) {
      if (!(error instanceof FacebookSignInError)) this.logger.error({ err: error }, 'Facebook sign-in failed');
      throw refused(error instanceof FacebookSignInError ? error.code : 'facebook_failed');
    }
    return this.signIn(store, profile, input.ref);
  }

  /** The account a checked Facebook identity signs in to, made first when none uses it (shared by the web and the app). */
  private async signIn(store: Store, profile: FacebookProfile, ref?: string) {
    const email = profile.email!;

    let created = false;
    let customer = await this.prisma.customer.findUnique({ where: { storeId_facebookSubject: { storeId: store.id, facebookSubject: profile.id } } });
    if (customer && customer.status !== 'active') throw refused('account_disabled');
    if (!customer) {
      // Never linked through a matching email: that account signs in its own way.
      if (await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email } } })) {
        await this.journeys?.record({ surface: 'udozo', step: 'facebook', email, error: 'account_exists_sign_in_with_password' });
        throw refused('account_exists_sign_in_with_password');
      }
      try {
        customer = await this.prisma.customer.create({
          data: {
            storeId: store.id,
            email,
            ...googleNames({ given_name: profile.firstName ?? undefined, family_name: profile.lastName ?? undefined, name: profile.name ?? undefined }, email),
            emailVerifiedAt: null,
            facebookSubject: profile.id,
            passwordHash: null,
            signupRef: ref ?? null,
          },
        });
        created = true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw refused('account_exists_sign_in_with_password');
        throw error;
      }
      // Its email is confirmed with Udozo's own code: never failing the sign-in (udozo.com's /verify can send another).
      const withStore = await this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, include: { store: { include: { reseller: { select: { house: true } } } } } });
      await this.customers.resendVerification(withStore).catch(error => this.logger.warn({ err: error }, 'Could not send the email confirmation code'));
    }
    await this.prisma.customer.update({ where: { id: customer.id }, data: { lastSignInAt: new Date() } });
    return { customer: await this.customers.present(customer), session: await this.customers.startSession(customer.id), signed_up: created };
  }
}
