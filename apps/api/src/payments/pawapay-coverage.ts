import { Controller, Get, HttpStatus, Injectable } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdminRoles, RealmOnly } from '../auth/caller.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { inSandbox, urlsFor } from '../integrations/endpoints.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { PawapayPaymentsProvider } from './pawapay.provider.js';
import { ProviderError } from './provider-error.js';

/**
 * Where BitoCard's pawaPay account works: every country, currency and mobile money network, whether each takes
 * payments in (deposits: checkout and top-ups) and makes payouts (mobile money top-ups sold to customers), read live
 * from pawaPay with BitoCard's saved token (the sandbox account while its Sandbox switch is on). Each country says
 * whether it is a BitoCard market and whether pawaPay is switched on there, so admins can add the missing markets.
 */
@Injectable()
export class PawapayCoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  async coverage() {
    const settings = this.integrations.config;
    const environment = inSandbox(settings, 'pawapay') ? ('sandbox' as const) : ('live' as const);
    if (!settings.PAWAPAY_API_TOKEN) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'integration_not_configured', 'Save the pawaPay API token in Settings > Integrations first.');
    }
    const provider = new PawapayPaymentsProvider(settings.PAWAPAY_API_TOKEN, urlsFor(settings, environment).PAWAPAY_API_URL);
    let countries;
    try {
      countries = await provider.coverage();
    } catch (error) {
      const reason = error instanceof ProviderError ? error.message : 'pawaPay could not be reached.';
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'provider_unavailable', `pawaPay's configuration could not be read: ${reason}`);
    }
    const [markets, methods] = await Promise.all([
      this.prisma.country.findMany({ select: { code: true, currency: true } }),
      this.prisma.paymentMethod.findMany({ where: { gateway: 'pawapay', enabled: true }, select: { countryCode: true, purpose: true } }),
    ]);
    const market = new Map(markets.map(item => [item.code, item.currency]));
    return {
      object: 'pawapay_coverage' as const,
      environment,
      data: countries.map(country => ({
        object: 'pawapay_country' as const,
        ...country,
        /** The BitoCard market for this country (its currency), or null when it is not a market yet. */
        market: market.has(country.code) ? { currency: market.get(country.code)!, checkout: methods.some(item => item.countryCode === country.code && item.purpose === 'checkout'), wallet_top_up: methods.some(item => item.countryCode === country.code && item.purpose === 'wallet_top_up') } : null,
      })),
    };
  }
}

/** Admin: pawaPay's coverage (Settings > Markets > pawaPay coverage). Reading it changes nothing. */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations', 'finance')
@Controller('admin/pawapay/coverage')
export class AdminPawapayCoverageController {
  constructor(private readonly coverage: PawapayCoverageService) {}

  @Get()
  get() {
    return this.coverage.coverage();
  }
}
