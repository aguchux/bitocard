import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { appleAudiences, appleRefreshToken, AppleSignInError, revokeApple, verifyAppleIdentityToken } from '../auth/apple.js';
import { googleNames } from '../auth/names.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Customer, type Store } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { SignupJourneysService } from '../signups/journeys.service.js';
import { CustomersService } from './customers.service.js';

const failures: Record<string, [HttpStatus, string, string]> = {
  apple_not_configured: [HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'Sign in with Apple is not available yet. Use your email instead.'],
  apple_failed: [HttpStatus.BAD_GATEWAY, 'api_error', 'Sign in with Apple did not work. Try again.'],
  apple_token_invalid: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'Apple could not confirm this sign-in. Try again.'],
  apple_email_missing: [HttpStatus.BAD_REQUEST, 'invalid_request_error', 'Apple did not share an email address. Try again, or use your email instead.'],
  account_exists_sign_in_with_password: [HttpStatus.CONFLICT, 'conflict_error', 'An account already uses this email. Sign in with your email and password, Google or Facebook.'],
  account_disabled: [HttpStatus.FORBIDDEN, 'permission_error', 'This account is suspended.'],
};
const refused = (code: string) => {
  const [status, type, message] = failures[code] ?? failures.apple_failed!;
  return new ApiError(status, type as 'api_error', failures[code] ? code : 'apple_failed', message);
};

/**
 * Sign in with Apple, in Udozo's iPhone app (App Store guideline 4.8 asks for it beside Google and Facebook). The app
 * gets an identity token from Apple for a nonce it made and sends it here with the one-time authorization code and,
 * the first time only, the name the person gave Apple.
 *
 * The rules are Google's: an Apple account no account uses yet signs up (its email confirmed by Apple, a private relay
 * address included, its name unconfirmed, no password), and never links itself to an account with the same email. The
 * code is exchanged for a refresh token, kept encrypted only to revoke the app's access when the account is deleted, as
 * Apple requires; signing in never waits on that exchange working.
 */
@Injectable()
export class CustomerAppleService {
  private readonly logger = new Logger('CustomerApple');

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly integrations: IntegrationsService,
    @Optional() private readonly journeys?: SignupJourneysService,
  ) {}

  private encryption() {
    const key = this.integrations.env.ENCRYPTION_KEY;
    return key ? new Encryption(key) : null;
  }

  async native(store: Store, input: { identityToken: string; nonce: string; authorizationCode?: string; firstName?: string; lastName?: string; ref?: string }) {
    const config = this.integrations.config;
    let claims;
    try {
      claims = await verifyAppleIdentityToken(config, input.identityToken, input.nonce);
    } catch (error) {
      if (!(error instanceof AppleSignInError)) this.logger.error({ err: error }, 'Sign in with Apple failed');
      throw refused(error instanceof AppleSignInError ? error.code : 'apple_failed');
    }
    const { sub, email } = claims;
    const clientId = typeof claims.aud === 'string' ? claims.aud : (appleAudiences(config)[0] ?? '');

    let created = false;
    let customer: Customer | null = await this.prisma.customer.findUnique({ where: { storeId_appleSubject: { storeId: store.id, appleSubject: sub } } });
    if (customer && customer.status !== 'active') throw refused('account_disabled');
    if (!customer) {
      if (await this.prisma.customer.findUnique({ where: { storeId_email: { storeId: store.id, email } } })) {
        await this.journeys?.record({ surface: 'app', step: 'apple', email, error: 'account_exists_sign_in_with_password' });
        throw refused('account_exists_sign_in_with_password');
      }
      try {
        customer = await this.prisma.customer.create({
          data: {
            storeId: store.id,
            email,
            ...googleNames({ given_name: input.firstName, family_name: input.lastName }, email),
            emailVerifiedAt: new Date(),
            appleSubject: sub,
            passwordHash: null,
            signupRef: input.ref ?? null,
          },
        });
        created = true;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw refused('account_exists_sign_in_with_password');
        throw error;
      }
    }
    // The refresh token, for revoking access on deletion: best effort, never failing the sign-in.
    if (input.authorizationCode && clientId) {
      const token = await appleRefreshToken(config, { code: input.authorizationCode, clientId }).catch(error => {
        this.logger.warn({ err: error }, 'Could not exchange Apple’s authorization code');
        return null;
      });
      const encryption = this.encryption();
      if (token && encryption) await this.prisma.customer.update({ where: { id: customer.id }, data: { appleRefreshTokenEncrypted: encryption.encrypt(token) } });
    }
    await this.prisma.customer.update({ where: { id: customer.id }, data: { lastSignInAt: new Date() } });
    return { customer: await this.customers.present(customer), session: await this.customers.startSession(customer.id), signed_up: created };
  }

  /** On deleting an account: revokes the app's access to the person's Apple account. True when Apple accepted it, or nothing was kept. */
  async revoke(customer: Pick<Customer, 'appleRefreshTokenEncrypted'>) {
    const encryption = this.encryption();
    if (!customer.appleRefreshTokenEncrypted || !encryption) return true;
    const clientId = appleAudiences(this.integrations.config)[0];
    if (!clientId) return false;
    try {
      return await revokeApple(this.integrations.config, { token: encryption.decrypt(customer.appleRefreshTokenEncrypted), clientId });
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not revoke Sign in with Apple');
      return false;
    }
  }
}
