import { Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';

/**
 * BitoCard has no reseller plans (22 November 2026): every reseller may use every feature and integration, within each
 * market's switches. What is left are the ceilings admins set for everyone (Settings > Integrations > Reseller limits
 * and usage), a reseller's own store ceiling (their page), and a few fixed ones against abuse.
 */
export const domainsPerStore = 5;
export const webhookEndpointsPerStore = 16;

/** The refusal for adding one more past a ceiling (409, or 400 where the route always answered so). */
export function limitReached(message: string, options: { code?: string; param?: string; invalid?: boolean } = {}) {
  return new ApiError(
    options.invalid ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT,
    options.invalid ? 'invalid_request_error' : 'conflict_error',
    options.code ?? 'limit_reached',
    message,
    options.param,
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

@Injectable()
export class ResellerLimitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** How many stores a reseller may run: their own ceiling, else everyone's (one by default). BitoCard's own accounts: no limit. */
  async storesAllowed(resellerId: string) {
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { house: true, maxStores: true } });
    if (reseller.house) return null;
    return reseller.maxStores ?? this.integrations.config.MAX_STORES_PER_RESELLER;
  }

  /** Refuses another store once the reseller runs as many as they may. */
  async requireStoreRoom(resellerId: string, used: number) {
    const allowed = await this.storesAllowed(resellerId);
    if (allowed !== null && used >= allowed) {
      throw limitReached(`Your account can run ${plural(allowed, 'store', 'stores')}. Ask BitoCard support if you need more.`, { code: 'store_limit_reached', param: 'name' });
    }
  }

  /** Free bot replies a month per store on BitoCard's AI (house stores: no limit). */
  aiReplies(house: boolean) {
    return house ? null : this.integrations.config.AI_MONTHLY_REPLIES;
  }
}

@Global()
@Module({ providers: [ResellerLimitsService], exports: [ResellerLimitsService] })
export class ResellerLimitsModule {}
