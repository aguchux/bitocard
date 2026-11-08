import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { parseSignedRequest } from './facebook.js';

/** A confirmation code Meta shows the person: 12 letters and digits, easy to read out. */
const confirmationCode = () => randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').toUpperCase();

/**
 * Meta's two Facebook Login callbacks. Both name the person only by the app-scoped id Facebook gave Udozo, in a
 * `signed_request` signed with the app secret, and both remove what Udozo keeps from Facebook: that id on udozo.com's
 * customers (`customers.facebook_subject`) and Seller HQ's people (`oauth_accounts` provider `facebook`). The account
 * itself is the person's own Udozo account and stays: they sign in with their email (Forgot password sets a password
 * for one made with Facebook), or close it with Udozo. Udozo asks Facebook for nothing else and keeps no token.
 */
@Injectable()
export class FacebookDataService {
  private readonly logger = new Logger('FacebookData');

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  private signedBy(signed: unknown) {
    const secret = this.integrations.config.FACEBOOK_APP_SECRET as string | undefined;
    const request = secret ? parseSignedRequest(signed, secret) : null;
    if (!request) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'signature_invalid', 'The signed request is missing or wrong.');
    return request;
  }

  /** Removes the Facebook account's id wherever Udozo keeps it, in one transaction. */
  private async unlink(userId: string) {
    const [customers, people] = await this.prisma.$transaction([
      this.prisma.customer.updateMany({ where: { facebookSubject: userId }, data: { facebookSubject: null } }),
      this.prisma.oAuthAccount.deleteMany({ where: { provider: 'facebook', providerUserId: userId } }),
    ]);
    return { customers: customers.count, people: people.count };
  }

  /** The person removed Udozo from their Facebook account: Facebook no longer signs them in here. */
  async deauthorize(signed: unknown) {
    const removed = await this.unlink(this.signedBy(signed).userId);
    this.logger.log(`Facebook deauthorized: ${removed.customers} customer(s), ${removed.people} person(s) unlinked`);
    return { received: true };
  }

  /** The person asked Facebook for their data to be deleted: done at once, with a code and a page to check it. */
  async deletion(signed: unknown) {
    const removed = await this.unlink(this.signedBy(signed).userId);
    const record = await this.prisma.facebookDataDeletion.create({ data: { confirmationCode: confirmationCode(), ...removed, completedAt: new Date() } });
    const base = String(this.integrations.config.STOREFRONT_URL ?? 'https://udozo.com');
    const url = new URL('/legal/facebook-deletion', base);
    url.searchParams.set('code', record.confirmationCode);
    return { url: url.toString(), confirmation_code: record.confirmationCode };
  }

  /** Where a deletion request stands, by its confirmation code (nothing about whose it was). */
  async status(code: string) {
    const record = /^[A-Z0-9x]{6,32}$/i.test(code) ? await this.prisma.facebookDataDeletion.findUnique({ where: { confirmationCode: code.toUpperCase() } }) : null;
    if (!record) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No deletion request has that confirmation code.');
    return {
      object: 'facebook_data_deletion',
      confirmation_code: record.confirmationCode,
      status: record.completedAt ? 'completed' : 'pending',
      requested_at: record.requestedAt.toISOString(),
      completed_at: record.completedAt?.toISOString() ?? null,
    };
  }
}
