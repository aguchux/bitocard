import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { inSandbox, urlsFor } from '../integrations/endpoints.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import type { LedgerMode } from '../generated/prisma/client.js';
import { FlutterwaveProvider } from './flutterwave.provider.js';
import { MonnifyProvider } from './monnify.provider.js';
import { PawapayPaymentsProvider } from './pawapay.provider.js';
import type { CheckoutProvider, ReservedAccountProvider, TransferProvider } from './providers.js';
import { SandboxProvider } from './sandbox.provider.js';
import { StripeProvider } from './stripe.provider.js';

/** The payment gateways an admin can offer per market, for wallet top-ups and customer checkout, as payers see them. */
export const paymentGateways = {
  stripe: { name: 'Stripe', label: 'Card', description: 'Visa, Mastercard, American Express and other cards' },
  flutterwave: { name: 'Flutterwave', label: 'Card, bank or mobile money', description: 'Cards, bank transfer, USSD and mobile money where available' },
  monnify: { name: 'Monnify', label: 'Bank transfer or card', description: 'Nigerian bank transfer, USSD or card' },
  pawapay: { name: 'pawaPay', label: 'Mobile money', description: 'Approve the payment on your phone with your mobile money provider' },
} as const;
export type PaymentGateway = keyof typeof paymentGateways;
export const isPaymentGateway = (value: string): value is PaymentGateway => Object.hasOwn(paymentGateways, value);

export const providerUnavailable = (what: string) =>
  new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'provider_unavailable', `${what} is not available in your country yet.`);

/**
 * The configured payment providers, chosen by mode, country and currency. Test mode always uses the sandbox;
 * live mode uses only providers with keys configured, in order of preference.
 */
@Injectable()
export class PaymentProviders {
  private readonly clients: () => {
    sandbox: SandboxProvider;
    flutterwave: FlutterwaveProvider | null;
    monnify: MonnifyProvider | null;
    stripe: StripeProvider | null;
    pawapay: PawapayPaymentsProvider | null;
  };

  constructor(private readonly integrations: IntegrationsService) {
    // A gateway switched to its sandbox (Settings > Integrations) is never used for live money: its credentials are
    // only tested from the integration, so sandbox payments can never credit a wallet.
    this.clients = integrations.derive(settings => {
      const config = urlsFor(settings, 'live');
      return {
        sandbox: new SandboxProvider(config.DASHBOARD_URL),
        flutterwave:
          config.FLUTTERWAVE_SECRET_KEY && !inSandbox(settings, 'flutterwave') ? new FlutterwaveProvider(config.FLUTTERWAVE_SECRET_KEY, config.FLUTTERWAVE_API_URL, config.FLUTTERWAVE_WEBHOOK_HASH) : null,
        monnify:
          config.MONNIFY_API_KEY && config.MONNIFY_SECRET_KEY && config.MONNIFY_CONTRACT_CODE && !inSandbox(settings, 'monnify')
            ? new MonnifyProvider(config.MONNIFY_API_KEY, config.MONNIFY_SECRET_KEY, config.MONNIFY_CONTRACT_CODE, config.MONNIFY_API_URL)
            : null,
        stripe: config.STRIPE_SECRET_KEY && !inSandbox(settings, 'stripe') ? new StripeProvider(config.STRIPE_SECRET_KEY, config.STRIPE_API_URL, config.STRIPE_WEBHOOK_SECRET) : null,
        pawapay: config.PAWAPAY_API_TOKEN && !inSandbox(settings, 'pawapay') ? new PawapayPaymentsProvider(config.PAWAPAY_API_TOKEN, config.PAWAPAY_API_URL, config.PAWAPAY_CALLBACK_TOKEN) : null,
      };
    });
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

  get stripe() {
    return this.clients().stripe;
  }

  get pawapay() {
    return this.clients().pawapay;
  }

  /** A gateway set up for live payments (credentials set, not switched to its sandbox), or null. */
  live(gateway: string): CheckoutProvider | null {
    if (!isPaymentGateway(gateway)) return null;
    return this.clients()[gateway];
  }

  /** The provider that handled an existing payment (`payments.provider`), or null if it is no longer set up. */
  checkoutByName(name: string): CheckoutProvider | null {
    return name === 'sandbox' ? this.sandbox : this.live(name);
  }

  /**
   * A reseller's own account with a gateway (their connection's credentials), at the gateway's live address: payments
   * go into their account, never BitoCard's. Null for a gateway resellers cannot connect, or credentials missing a key.
   */
  forAccount(gateway: string, credentials: Record<string, string>): CheckoutProvider | null {
    const config = urlsFor(this.integrations.config, 'live');
    if (gateway === 'stripe' && credentials.secret_key) return new StripeProvider(credentials.secret_key, config.STRIPE_API_URL, credentials.webhook_secret || undefined);
    if (gateway === 'flutterwave' && credentials.secret_key) return new FlutterwaveProvider(credentials.secret_key, config.FLUTTERWAVE_API_URL, credentials.webhook_hash || undefined);
    if (gateway === 'monnify' && credentials.api_key && credentials.secret_key && credentials.contract_code) {
      return new MonnifyProvider(credentials.api_key, credentials.secret_key, credentials.contract_code, config.MONNIFY_API_URL);
    }
    return null;
  }

  /** The payment page for a gateway the market offers. Test mode always uses the sandbox. */
  checkout(mode: LedgerMode, gateway: string, country: string, currency: string): CheckoutProvider {
    if (mode === 'test') return this.sandbox;
    const provider = this.live(gateway);
    if (!provider?.supportsCheckout(country, currency)) throw providerUnavailable(`${isPaymentGateway(gateway) ? paymentGateways[gateway].label : 'This payment method'}`);
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
