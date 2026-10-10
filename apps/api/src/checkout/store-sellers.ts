import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, Reseller, Store } from '../generated/prisma/client.js';
import { PaymentMethodsService, presentMethod } from '../payments/payment-methods.service.js';
import { isPaymentGateway, type PaymentGateway, PaymentProviders } from '../payments/payment-providers.js';
import type { CheckoutProvider } from '../payments/providers.js';
import { connectable } from '../reseller-integrations/connectable.js';
import { ResellerIntegrationsService } from '../reseller-integrations/reseller-integrations.service.js';
import { HouseService, houseStoreId } from './house.service.js';

/** A way to pay on a store: BitoCard's gateway, or the reseller's own account with it (`own`). */
export type PaymentOption = { gateway: PaymentGateway | 'sandbox'; own?: { connectionId: string; provider: CheckoutProvider } };

const storeMissing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'store_unavailable', 'This store is not open.');

/**
 * Who sells on a store, and how its customers can pay. bitocard.com sells through BitoCard's house account for the
 * customer's market. A reseller's hosted store (<subdomain>.bitocard.com) sells through the reseller, in their country
 * and currency, in sandbox until they switch its checkout live; its customers pay through BitoCard's gateways (the
 * market's checkout methods) or, where the reseller connected one, their own gateway account.
 */
@Injectable()
export class StoreSellers {
  constructor(
    private readonly prisma: PrismaService,
    private readonly house: HouseService,
    private readonly methods: PaymentMethodsService,
    private readonly providers: PaymentProviders,
    private readonly integrations: ResellerIntegrationsService,
  ) {}

  /** A payment option as payers see it, with its mobile money networks in the country. Own gateways are BitoCard's labels. */
  async describe(option: PaymentOption, country: { code: string; currency: string }) {
    return option.own ? presentMethod(option.gateway as PaymentGateway) : this.methods.describe(option.gateway as PaymentGateway, country);
  }

  isHouse(store: Pick<Store, 'id'>) {
    return store.id === houseStoreId;
  }

  /** The store named (null: bitocard.com). A reseller's store must be published and its reseller not suspended. */
  async resolve(key: string | null): Promise<Store> {
    if (!key) return this.house.store();
    const store = await this.prisma.store.findUnique({ where: { subdomain: key }, include: { reseller: true } });
    if (!store || store.status !== 'published' || store.reseller.status === 'suspended' || store.reseller.house) throw storeMissing();
    return store;
  }

  /** Whether the store's checkout is live or the sandbox. */
  mode(store: Store): LedgerMode {
    return this.isHouse(store) ? this.house.mode() : store.checkoutMode;
  }

  /** The account selling: the house account for the customer's market on bitocard.com, otherwise the store's reseller. */
  async seller(store: Store, country: string): Promise<Reseller> {
    if (this.isHouse(store)) return this.house.resellerFor(country);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: store.resellerId } });
    if (store.status !== 'published' || reseller.status === 'suspended') throw storeMissing();
    if (!reseller.country) throw storeMissing();
    if (this.mode(store) === 'live' && reseller.status !== 'active') {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'store_checkout_unavailable', 'This store cannot take orders yet. Try again later.');
    }
    return reseller;
  }

  /**
   * How a store's customers can pay, best first. bitocard.com offers the market's checkout methods. A reseller's store
   * adds their own gateway connections (active, not switched off): `preferred` ones first, replacing BitoCard's same
   * gateway, `fallback` ones after BitoCard's methods when BitoCard does not offer that gateway.
   */
  async paymentOptions(store: Store, seller: Reseller, mode: LedgerMode): Promise<PaymentOption[]> {
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: seller.country! } });
    const bitocard: PaymentOption[] = (await this.methods.offered('checkout', country, mode)).map(gateway => ({ gateway }));
    if (this.isHouse(store)) return bitocard;
    const own = await this.ownOptions(seller, mode, country);
    const preferred = own.filter(item => item.routing === 'preferred').map(item => item.option);
    const fallback = own.filter(item => item.routing === 'fallback').map(item => item.option);
    const taken = new Set(preferred.map(item => item.gateway));
    const middle = bitocard.filter(item => !taken.has(item.gateway));
    const offered = new Set([...preferred, ...middle].map(item => item.gateway));
    return [...preferred, ...middle, ...fallback.filter(item => !offered.has(item.gateway))];
  }

  /** The reseller's usable own gateway connections in this mode, able to take this country's currency. */
  private async ownOptions(seller: Reseller, mode: LedgerMode, country: { code: string; currency: string }) {
    if (!(await this.integrations.access(seller.id, mode)).allowed) return [];
    const rows = await this.prisma.resellerConnection.findMany({ where: { resellerId: seller.id, mode, status: 'active', routing: { not: 'off' } }, orderBy: { createdAt: 'asc' } });
    const options: Array<{ routing: 'preferred' | 'fallback'; option: PaymentOption }> = [];
    for (const row of rows) {
      if (connectable(row.integrationId)?.kind !== 'payment_gateway' || !isPaymentGateway(row.integrationId)) continue;
      const provider = await this.ownProvider(row.id, row.integrationId);
      if (!provider || (mode === 'live' && !(await provider.supportsCheckout(country.code, country.currency)))) continue;
      options.push({ routing: row.routing === 'fallback' ? 'fallback' : 'preferred', option: { gateway: row.integrationId, own: { connectionId: row.id, provider } } });
    }
    return options;
  }

  /**
   * The reseller's own account with a gateway, from their connection: the sandbox for sandbox connections (BitoCard's
   * sandbox stays simulated), otherwise their credentials at the gateway's live address. Null when the connection is
   * no longer active or an admin switched the gateway's reseller access off.
   */
  async ownProvider(connectionId: string, gateway: string): Promise<CheckoutProvider | null> {
    const row = await this.prisma.resellerConnection.findUnique({ where: { id: connectionId } });
    if (!row || row.integrationId !== gateway) return null;
    const active = await this.integrations.active(row.resellerId, row.integrationId, row.mode);
    if (!active) return null;
    return row.mode === 'test' ? this.providers.sandbox : this.providers.forAccount(gateway, active.credentials);
  }
}
