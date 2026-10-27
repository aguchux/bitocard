import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomToken, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import { googleAuthorizationUrl, googleClaims, GoogleSignInError } from '../auth/google.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { afrippaStoreId } from './ids.js';

const stateLifetimeMs = 10 * 60 * 1000;

/** What each failure answers: Afrippa's server shows the trader why. */
const failures: Record<string, [HttpStatus, string, string]> = {
  google_state_invalid: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'This Google sign-in has expired. Start again.'],
  google_failed: [HttpStatus.BAD_GATEWAY, 'api_error', 'Google sign-in did not work. Try again.'],
  google_token_invalid: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'Google could not confirm this sign-in. Try again.'],
  google_email_unverified: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'Google has not confirmed this email address.'],
  google_account_not_found: [HttpStatus.NOT_FOUND, 'not_found_error', 'No Afrippa account uses this Google account. Sign up first.'],
  account_exists_sign_in_with_password: [HttpStatus.CONFLICT, 'conflict_error', 'An Afrippa account already uses this email. Sign in with your password.'],
  account_disabled: [HttpStatus.FORBIDDEN, 'permission_error', 'This account is suspended.'],
};
const refused = (code: string) => {
  const [status, type, message] = failures[code] ?? failures.google_failed!;
  return new ApiError(status, type as 'api_error', failures[code] ? code : 'google_failed', message);
};

/**
 * "Sign in with Google" for Afrippa's traders (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 5b), with Afrippa's own Google
 * client (set in Afrippa's admin) and consent screen. Afrippa's server drives the round trip: it asks for Google's
 * address and a one-time state (kept in its own cookie), Google returns the browser to afrippa.com, and its server sends
 * the code here. As for resellers: signing up with Google is deliberate (`intent=signup` creates the account, its email
 * confirmed by Google, with no password until Forgot password sets one); signing in with a Google account that never
 * signed up creates nothing; and a Google account never links itself to a password account with the same email. The new
 * session still needs the two-step code like any other.
 */
@Injectable()
export class TraderGoogleService {
  private readonly logger = new Logger('TraderGoogle');

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Afrippa's Google client, and where Google returns the browser: Afrippa's own address (its admin's, else afrippa.com's). */
  private client() {
    const config = this.integrations.configFor('afrippa');
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'google_not_configured', 'Google sign-in is not available yet.');
    }
    const redirectUri = this.integrations.storedFor('afrippa').get('GOOGLE_REDIRECT_URI')?.value ?? new URL('/auth/google/callback', this.integrations.config.AFRIPPA_URL).toString();
    return { config, clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET, redirectUri };
  }

  /** Starts a round trip: Google's consent address, and the state Afrippa's server keeps until Google returns. */
  async start(intent: 'signin' | 'signup') {
    const { config, clientId, redirectUri } = this.client();
    const state = randomToken();
    const nonce = randomToken(16);
    const codeVerifier = randomToken(48);
    const expiresAt = new Date(Date.now() + stateLifetimeMs);
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.oAuthState.create({ data: { id: sha256(state), codeVerifier, nonce, returnTo: redirectUri, intent, platform: 'afrippa', expiresAt } });
    return { object: 'google_sign_in' as const, url: googleAuthorizationUrl(config, { clientId, redirectUri, state, nonce, codeVerifier }), state, expires_at: expiresAt.toISOString() };
  }

  /** Finishes it: the trader signed in (signing up first with `intent=signup`, their country fixed), two-step pending. */
  async finish(input: { state: string; code: string; country?: string }) {
    const record = await this.prisma.oAuthState.findUnique({ where: { id: sha256(input.state) } });
    // Only Afrippa's own round trips, unexpired.
    if (!record || record.platform !== 'afrippa' || record.expiresAt <= new Date()) throw refused('google_state_invalid');
    const { config, clientId, clientSecret, redirectUri } = this.client();
    // The country is checked first, so a sign-up sent without one can be sent again with it.
    const country = record.intent === 'signup' ? await this.signupCountry(input.country) : null;
    // Used once: whoever deletes it goes on.
    if ((await this.prisma.oAuthState.deleteMany({ where: { id: record.id } })).count === 0) throw refused('google_state_invalid');
    let claims;
    try {
      claims = await googleClaims(config, { code: input.code, codeVerifier: record.codeVerifier, nonce: record.nonce, clientId, clientSecret, redirectUri });
    } catch (error) {
      if (!(error instanceof GoogleSignInError)) this.logger.error({ err: error }, 'Google sign-in failed');
      throw refused(error instanceof GoogleSignInError ? error.code : 'google_failed');
    }
    const sub = claims.sub!;
    const email = claims.email!.toLowerCase();

    let created = false;
    let customer = await this.prisma.customer.findUnique({ where: { storeId_googleSubject: { storeId: afrippaStoreId, googleSubject: sub } } });
    if (customer && customer.status !== 'active') throw refused('account_disabled');
    if (!customer) {
      // Never linked through a matching email: the trader signs in with their password.
      if (await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: afrippaStoreId, email } } })) throw refused('account_exists_sign_in_with_password');
      if (record.intent !== 'signup') throw refused('google_account_not_found');
      try {
        customer = await this.prisma.customer.create({
          data: { storeId: afrippaStoreId, email, name: claims.name?.trim() || email.split('@')[0]!, country, emailVerifiedAt: new Date(), googleSubject: sub, passwordHash: null },
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

  private async signupCountry(asked: string | undefined) {
    if (!asked) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Choose your country.', 'country');
    const market = await this.prisma.country.findUnique({ where: { code: asked.toUpperCase() } });
    if (!market) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'market_unavailable', 'Afrippa is not open in this country yet.', 'country');
    return market.code;
  }
}
