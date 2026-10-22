import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { StoreHostsService } from '../stores/store-hosts.service.js';
import { houseRootId, houseStoreId } from './house-ids.js';

export { houseRootId, houseStoreId };

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
    private readonly hosts: StoreHostsService,
  ) {}

  store() {
    return this.prisma.store.findUniqueOrThrow({ where: { id: houseStoreId }, include: { reseller: true } });
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
      return await this.prisma.reseller.create({ data: { name: 'BitoCard', country: code, status: 'active', planCode: 'enterprise', house: true, verifiedAt: new Date() } });
    } catch (error) {
      // Another request created it at the same moment.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.reseller.findFirstOrThrow({ where: { house: true, country: code } });
      throw error;
    }
  }

  /**
   * The market's own store, `<country>.bitocard.com` (country-localised stores, `docs/BITOCARD_COUNTRY_STORES_PLAN.md`),
   * created the first time it is needed, owned by that market's house account. Unlike a reseller's stores, this skips
   * every plan-limit and verification check: house accounts always pass. Its address (Cloudflare and Vercel) is set up
   * at once; a failure there is left for the `domains` job, exactly as a reseller's own store.
   */
  async storeFor(countryCode: string) {
    const code = countryCode.toUpperCase();
    const subdomain = code.toLowerCase();
    const existing = await this.prisma.store.findUnique({ where: { subdomain } });
    if (existing) return existing;
    const reseller = await this.resellerFor(code);
    try {
      const store = await this.prisma.store.create({
        data: { resellerId: reseller.id, name: `BitoCard ${code}`, subdomain, status: 'published', publishedAt: new Date(), template: 'all_in_one', variant: 'classic', theme: 'navy_pink' },
      });
      await this.hosts.sync(store.id);
      return store;
    } catch (error) {
      // Another request created it at the same moment.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.prisma.store.findUniqueOrThrow({ where: { subdomain } });
      throw error;
    }
  }
}
