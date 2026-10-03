import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { FlutterwaveProvider } from './flutterwave.provider.js';
import { MonnifyProvider } from './monnify.provider.js';
import type { CheckoutProvider, ReservedAccountProvider, TransferProvider } from './providers.js';
import { SandboxProvider } from './sandbox.provider.js';

export const providerUnavailable = (what: string) =>
  new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'provider_unavailable', `${what} is not available in your country yet.`);

/**
 * The configured payment providers, chosen by mode, country and currency. Test mode always uses the sandbox;
 * live mode uses only providers with keys configured, in order of preference.
 */
@Injectable()
export class PaymentProviders {
  private readonly clients: () => { sandbox: SandboxProvider; flutterwave: FlutterwaveProvider | null; monnify: MonnifyProvider | null };

  constructor(integrations: IntegrationsService) {
    this.clients = integrations.derive(config => ({
      sandbox: new SandboxProvider(config.DASHBOARD_URL),
      flutterwave: config.FLUTTERWAVE_SECRET_KEY ? new FlutterwaveProvider(config.FLUTTERWAVE_SECRET_KEY, config.FLUTTERWAVE_API_URL, config.FLUTTERWAVE_WEBHOOK_HASH) : null,
      monnify:
        config.MONNIFY_API_KEY && config.MONNIFY_SECRET_KEY && config.MONNIFY_CONTRACT_CODE
          ? new MonnifyProvider(config.MONNIFY_API_KEY, config.MONNIFY_SECRET_KEY, config.MONNIFY_CONTRACT_CODE, config.MONNIFY_API_URL)
          : null,
    }));
  }

  get sandbox() {
    return this.clients().sandbox;
  }

  /** Null until its secret key is set (admin Settings > Integrations, or the environment). */
  get flutterwave() {
    return this.clients().flutterwave;
  }

  get monnify() {
    return this.clients().monnify;
  }

  checkout(mode: LedgerMode, country: string): CheckoutProvider {
    if (mode === 'test') return this.sandbox;
    const provider = [this.flutterwave].find(p => p?.supportsCheckout(country));
    if (!provider) throw providerUnavailable('Card and bank top-ups');
    return provider;
  }

  /** In failover order: Flutterwave first, then Monnify (Nigeria). */
  reservedAccounts(mode: LedgerMode, country: string, currency: string): ReservedAccountProvider[] {
    if (mode === 'test') return [this.sandbox];
    const providers = [this.flutterwave, this.monnify].filter((p): p is FlutterwaveProvider | MonnifyProvider => p !== null && p.supportsReservedAccounts(country, currency));
    if (providers.length === 0) throw providerUnavailable('Reserved bank accounts');
    return providers;
  }

  transfers(mode: LedgerMode, country: string): TransferProvider {
    if (mode === 'test') return this.sandbox;
    if (!this.flutterwave?.supportsTransfers(country)) throw providerUnavailable('Bank payouts');
    return this.flutterwave;
  }

  /** The transfer provider that handled an existing payout. */
  transfersByName(name: string): TransferProvider | null {
    if (name === 'sandbox') return this.sandbox;
    if (name === 'flutterwave') return this.flutterwave;
    return null;
  }
}
