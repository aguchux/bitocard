import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Customer, LedgerMode, Reseller, Store } from '../generated/prisma/client.js';
import { PaymentMethodsService, presentMethod } from '../payments/payment-methods.service.js';
import { isPaymentGateway, type PaymentGateway, PaymentProviders } from '../payments/payment-providers.js';
import type { CheckoutProvider } from '../payments/providers.js';
import { connectable } from '../reseller-integrations/connectable.js';
import { ResellerIntegrationsService } from '../reseller-integrations/reseller-integrations.service.js';
import { HouseService, houseStoreId } from './house.service.js';

/** A way to pay on a store: BitoCard's gateway, or the reseller's own account with it (`own`). */
export type PaymentOption = { gateway: PaymentGateway | 'sandbox'; own?: { connectionId: string; provider: CheckoutProvider } };

/** A store with enough of its reseller joined to tell a house store (root or a market's country store) from a reseller's. */
export type HouseAwareStore = Store & { reseller: { house: boolean } };

const storeMissing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'store_unavailable', 'This store is not open.');

/**
 * Who sells on a store, and how its customers can pay. Root bitocard.com (no fixed country) sells through BitoCard's
 * house account for the *customer's* market, since root serves every market without its own store yet. A market's own
 * country store (`<country>.bitocard.com`, `docs/BITOCARD_COUNTRY_STORES_PLAN.md`) always sells through *that market's*
 * house account instead, whatever country the visiting customer is in — this is the fix for same-country purchases
 * being forced through a foreign buyer's currency. A reseller's hosted store sells through the reseller, in their
 * country and currency, in sandbox until they switch its checkout live; its customers pay through BitoCard's gateways
 * (the market's checkout methods) or, where the reseller connected one, their own gateway account.
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

  /** Any house store: root bitocard.com, or a market's own country store. Never a reseller's. */
  isHouse(store: { reseller: { house: boolean } }) {
    return store.reseller.house;
  }

  /** The single root bitocard.com store (no fixed country) — the only house store whose seller depends on the buyer. */
  private isRoot(store: Pick<Store, 'id'>) {
    return store.id === houseStoreId;
  }

  /**
   * The store named (null: bitocard.com). A reseller's store, or a market's own country store, must be published and
   * its reseller not suspended; only the single root store (reached with no key at all) is refused here.
   */
  async resolve(key: string | null): Promise<Store & { reseller: Reseller }> {
    if (!key) return this.house.store();
    const store = await this.prisma.store.findUnique({ where: { subdomain: key }, include: { reseller: true } });
    if (!store || store.status !== 'published' || store.reseller.status === 'suspended' || this.isRoot(store)) throw storeMissing();
    return store;
  }

  /** Whether the store's checkout is live or the sandbox. Every house store (root or a country store) shares BitoCard's own switch. */
  mode(store: HouseAwareStore): LedgerMode {
    return this.isHouse(store) ? this.house.mode() : store.checkoutMode;
  }

  /**
   * The account selling: on root bitocard.com, the house account for the country given (the buyer's market, since root
   * has no country of its own); on a market's own country store, always that store's own house account, never the
   * buyer's; otherwise the store's reseller.
   */
  async seller(store: HouseAwareStore, country: string): Promise<Reseller> {
    if (this.isRoot(store)) return this.house.resellerFor(country);
    const reseller = await this.prisma.reseller.findUniqueOrThrow({ where: { id: store.resellerId } });
    // A country store is BitoCard's own: always active, never suspended or unverified, so none of the independent-
    // reseller checks below apply — it sells exactly as root does, just fixed to its own market instead of the buyer's.
    if (this.isHouse(store)) return reseller;
    if (store.status !== 'published' || reseller.status === 'suspended') throw storeMissing();
    if (!reseller.country) throw storeMissing();
    if (this.mode(store) === 'live' && reseller.status !== 'active') {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'store_checkout_unavailable', 'This store cannot take orders yet. Try again later.');
    }
    return reseller;
  }

  /**
   * The account selling to a customer: on root bitocard.com their country's house account (their country is fixed at
   * sign-up; an older account without one is fixed now to the country asked, else `country_required`); on a market's
   * own country store, or a reseller's store, the store's own seller, never the customer's country. Whatever else is
   * asked, a customer always buys and tops up in their own country's currency (their wallet, not the seller).
   */
  async sellerFor(customer: Customer & { store: HouseAwareStore }, asked?: string): Promise<Reseller> {
    if (!this.isRoot(customer.store)) return this.seller(customer.store, '');
    if (!customer.country) {
      if (!asked) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'country_required', 'Choose your country in your account first.', 'country');
      const market = await this.prisma.country.findUnique({ where: { code: asked.toUpperCase() } });
      if (!market) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'market_unavailable', 'BitoCard does not sell in this country yet.', 'country');
      await this.prisma.customer.updateMany({ where: { id: customer.id, country: null }, data: { country: market.code } });
      // Another request may have fixed it first: theirs stands.
      customer.country = (await this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { country: true } })).country;
    }
    return this.seller(customer.store, customer.country!);
  }

  /**
   * How a store's customers can pay, best first. bitocard.com offers the market's checkout methods. A reseller's store
   * adds their own gateway connections (active, not switched off): `preferred` ones first, replacing BitoCard's same
   * gateway, `fallback` ones after BitoCard's methods when BitoCard does not offer that gateway.
   */
  /**
   * How a store's customers pay at checkout. The reseller's own gateway collects when it is theirs to use and they chose
   * it (`payment_collector: own`): then only their gateways are offered (`preferred` ones first), and BitoCard's only if
   * none of theirs takes the country's currency. Otherwise (they chose BitoCard, have no usable gateway, or are not on
   * a plan and market with own gateways) BitoCard's gateways collect and the money reaches their wallet.
   */
  async paymentOptions(store: HouseAwareStore, seller: Reseller, mode: LedgerMode): Promise<PaymentOption[]> {
    const country = await this.prisma.country.findUniqueOrThrow({ where: { code: seller.country! } });
    const bitocard: PaymentOption[] = (await this.methods.offered('checkout', country, mode)).map(gateway => ({ gateway }));
    if (this.isHouse(store) || seller.paymentCollector === 'bitocard') return bitocard;
    const own = await this.ownOptions(seller, mode, country);
    if (!own.length) return bitocard;
    return [...own.filter(item => item.routing === 'preferred'), ...own.filter(item => item.routing === 'fallback')].map(item => item.option);
  }

  /** The reseller's usable own gateway connections in this mode, able to take this country's currency. */
  private async ownOptions(seller: Reseller, mode: LedgerMode, country: { code: string; currency: string }) {
    if (!(await this.integrations.access(seller.id, mode, 'payment_gateway')).allowed) return [];
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
