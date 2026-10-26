import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * The BitoCard Shop terms' version: their date on the legals site (`/documents/shop-terms`). Bump it when the terms change
 * in a way people must accept again; everyone is then asked once more before they next post or use Safe pay.
 */
export const shopTermsVersion = '2026-10-26';
/** Their path on the legals site (apps use `appUrl("legals", path)`). */
export const shopTermsPath = '/documents/shop-terms';

/** Each customer's acceptance of the BitoCard Shop terms, once per version, before they post a listing or use Safe pay. */
@Injectable()
export class ShopTermsService {
  constructor(private readonly prisma: PrismaService) {}

  async status(customerId: string) {
    const [current, latest] = await Promise.all([
      this.prisma.classifiedTermsAcceptance.findUnique({ where: { customerId_version: { customerId, version: shopTermsVersion } } }),
      this.prisma.classifiedTermsAcceptance.findFirst({ where: { customerId }, orderBy: { acceptedAt: 'desc' } }),
    ]);
    return {
      object: 'classified_terms' as const,
      version: shopTermsVersion,
      path: shopTermsPath,
      accepted: Boolean(current),
      accepted_at: current?.acceptedAt.toISOString() ?? null,
      // An earlier version accepted: the apps say the terms have changed.
      previous_version: !current && latest ? latest.version : null,
    };
  }

  /** Records the acceptance of the version the customer was shown; accepting again changes nothing. */
  async accept(customerId: string, version: string) {
    if (version !== shopTermsVersion) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'terms_changed', 'The BitoCard Shop terms have changed. Read the new version, then accept it.', 'version');
    await this.prisma.classifiedTermsAcceptance.createMany({ data: [{ customerId, version }], skipDuplicates: true });
    return this.status(customerId);
  }

  async accepted(customerId: string) {
    return Boolean(await this.prisma.classifiedTermsAcceptance.findUnique({ where: { customerId_version: { customerId, version: shopTermsVersion } }, select: { version: true } }));
  }

  /** Posting a listing and Safe pay need the current terms accepted. */
  async require(customerId: string) {
    if (await this.accepted(customerId)) return;
    throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'terms_not_accepted', 'Accept the BitoCard Shop terms to post listings and use Safe pay.', 'terms');
  }
}
