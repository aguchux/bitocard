import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';

/** BitoCard's own store, bitocard.com (seeded by migration): its customers belong to it. */
export const houseStoreId = '00000000-0000-4000-8000-0000000000b2';
/** The house account with no country, which owns the store. */
export const houseRootId = '00000000-0000-4000-8000-0000000000b1';

/**
 * BitoCard selling to retail customers on bitocard.com, through the same quotes, orders and ledger as any reseller.
 * Each market has its own house account (created with that market's first checkout), so customers pay in their
 * market's currency and BitoCard's retail margin is the account's earnings. House accounts are active, on Premium (they
 * sell across borders), never shown as resellers and never charged plans.
 */
@Injectable()
export class HouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  store() {
    return this.prisma.store.findUniqueOrThrow({ where: { id: houseStoreId } });
  }

  /** bitocard.com's checkout is live unless an admin switched it to the sandbox (Settings > Integrations > Customer checkout). */
  mode() {
    return this.integrations.config.CHECKOUT_SANDBOX ? ('test' as const) : ('live' as const);
  }

  /** The house account selling in a market, created the first time it is needed. */
  async resellerFor(countryCode: string) {
    const code = countryCode.toUpperCase();
    const country = await this.prisma.country.findUnique({ where: { code } });
    if (!country) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'market_unavailable', 'BitoCard does not sell in this country yet.', 'country');
    const existing = await this.prisma.reseller.findFirst({ where: { house: true, country: code } });
    if (existing) return existing;
    try {
      return await this.prisma.reseller.create({ data: { name: 'BitoCard', country: code, status: 'active', planCode: 'premium', house: true, verifiedAt: new Date() } });
    } catch (error) {
      // Another request created it at the same moment.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.reseller.findFirstOrThrow({ where: { house: true, country: code } });
      throw error;
    }
  }
}
