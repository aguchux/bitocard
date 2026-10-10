import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, PaymentMethodPurpose } from '../generated/prisma/client.js';
import { PawapayPaymentsProvider } from './pawapay.provider.js';
import { isPaymentGateway, type PaymentGateway, paymentGateways, PaymentProviders } from './payment-providers.js';

export const paymentMethodPurposes = ['wallet_top_up', 'checkout'] as const satisfies readonly PaymentMethodPurpose[];

export function presentMethod(gateway: PaymentGateway, networks: string[] = []) {
  return { object: 'payment_method' as const, id: gateway, label: paymentGateways[gateway].label, description: paymentGateways[gateway].description, networks };
}

const unknownCountry = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such market.');

/**
 * Which payment gateways each market offers, for resellers' wallet top-ups and for customers at checkout. An admin
 * switches each on per market and orders them (Settings > Markets > Payment methods); a live payment also needs the
 * gateway set up (credentials saved, not switched to its sandbox) and able to take that country and currency. In test
 * mode every switched-on method is offered, and the sandbox stands in for all of them.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly audit: AuditService,
  ) {}

  /** A method as payers see it, with the mobile money networks they can pay from in this country (pawaPay's, from its API). */
  async describe(gateway: PaymentGateway, country: { code: string; currency: string }) {
    const provider = gateway === 'pawapay' ? this.providers.live(gateway) : null;
    const networks = provider instanceof PawapayPaymentsProvider ? await provider.networks(country.code, country.currency) : [];
    return presentMethod(gateway, networks);
  }

  /** The gateways a payer in this country can use now, best first. */
  async offered(purpose: PaymentMethodPurpose, country: { code: string; currency: string }, mode: LedgerMode): Promise<PaymentGateway[]> {
    const rows = await this.prisma.paymentMethod.findMany({ where: { countryCode: country.code, purpose, enabled: true }, orderBy: [{ position: 'asc' }, { gateway: 'asc' }] });
    const offered: PaymentGateway[] = [];
    for (const gateway of rows.map(row => row.gateway).filter(isPaymentGateway)) {
      if (mode === 'test' || (await this.providers.live(gateway)?.supportsCheckout(country.code, country.currency))) offered.push(gateway);
    }
    return offered;
  }

  /**
   * The gateway to use for a payment: the one asked for if the market offers it, else the market's first. Test mode
   * with nothing switched on still works (the sandbox), so integrations can be tried before an admin sets methods up.
   */
  async choose(purpose: PaymentMethodPurpose, country: { code: string; currency: string }, mode: LedgerMode, asked?: string): Promise<PaymentGateway | 'sandbox'> {
    const offered = await this.offered(purpose, country, mode);
    if (asked) {
      if (offered.includes(asked as PaymentGateway)) return asked as PaymentGateway;
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'payment_method_unavailable', 'This payment method is not available in your country. List the methods offered first.', 'method');
    }
    if (offered[0]) return offered[0];
    if (mode === 'test') return 'sandbox';
    throw new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'api_error',
      'provider_unavailable',
      purpose === 'checkout' ? 'Payments are not available in your country yet.' : 'Wallet top-ups are not available in your country yet.',
    );
  }

  // -- Admin -----------------------------------------------------------------------------------------------------

  /** Every gateway for a market, both purposes: switched on or not, its order, and whether it can take live payments there. */
  async adminList(code: string) {
    const country = await this.prisma.country.findUnique({ where: { code: code.toUpperCase() } });
    if (!country) throw unknownCountry();
    const rows = await this.prisma.paymentMethod.findMany({ where: { countryCode: country.code } });
    // Whether each set-up gateway takes this country and currency (pawaPay asks its API).
    const supported = new Map<PaymentGateway, boolean>();
    for (const gateway of Object.keys(paymentGateways) as PaymentGateway[]) {
      const provider = this.providers.live(gateway);
      if (provider) supported.set(gateway, await provider.supportsCheckout(country.code, country.currency));
    }
    const purposes = Object.fromEntries(
      paymentMethodPurposes.map(purpose => {
        const set = rows.filter(row => row.purpose === purpose);
        const gateways = (Object.keys(paymentGateways) as PaymentGateway[])
          .map(gateway => {
            const row = set.find(item => item.gateway === gateway);
            const provider = this.providers.live(gateway);
            return {
              gateway,
              name: paymentGateways[gateway].name,
              label: paymentGateways[gateway].label,
              enabled: row?.enabled ?? false,
              position: row?.position ?? 100,
              /** Credentials saved and not in its sandbox. */
              configured: Boolean(provider),
              /** Can take payments from this country in its currency. */
              supported: provider ? (supported.get(gateway) ?? false) : null,
            };
          })
          .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.position - b.position || a.gateway.localeCompare(b.gateway));
        return [purpose, gateways];
      }),
    );
    return { object: 'payment_methods' as const, country: country.code, currency: country.currency, wallet_top_up: purposes.wallet_top_up, checkout: purposes.checkout };
  }

  /** Replaces a market's methods for one purpose: the gateways switched on, in the order given. */
  async set(actorId: string | null, code: string, purpose: PaymentMethodPurpose, enabled: string[]) {
    const country = await this.prisma.country.findUnique({ where: { code: code.toUpperCase() } });
    if (!country) throw unknownCountry();
    const unknown = enabled.find(gateway => !isPaymentGateway(gateway));
    if (unknown) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `Unknown payment gateway: ${unknown}.`, 'enabled');
    if (new Set(enabled).size !== enabled.length) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'List each gateway once.', 'enabled');
    const before = await this.adminList(country.code);
    await this.prisma.$transaction([
      this.prisma.paymentMethod.updateMany({ where: { countryCode: country.code, purpose }, data: { enabled: false } }),
      ...enabled.map((gateway, position) =>
        this.prisma.paymentMethod.upsert({
          where: { countryCode_purpose_gateway: { countryCode: country.code, purpose, gateway } },
          create: { countryCode: country.code, purpose, gateway, enabled: true, position },
          update: { enabled: true, position },
        }),
      ),
    ]);
    const after = await this.adminList(country.code);
    const summary = (list: typeof before) => list[purpose].filter(item => item.enabled).map(item => item.gateway);
    await this.audit.record({
      actorId,
      action: 'country.payment_methods_changed',
      targetType: 'country',
      targetId: country.code,
      before: { purpose, enabled: summary(before) },
      after: { purpose, enabled: summary(after) },
    });
    return after;
  }
}
