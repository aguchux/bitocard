import { bitocardApi } from '../base';
import type { DomainContact, StoreDomain } from './domains';

/**
 * Udozo's Seller HQ only (shq.udozo.com, docs/UDOZO_SPINOFF_PLAN.md step 3): these routes exist only on Udozo's instance
 * of the API (api.udozo.com) and answer as unknown routes on BitoCard's.
 */

/** The seller's one-time Seller HQ setup fee (`/v1/billing/setup-fee`), in their market's currency. */
export type SetupFee = {
  object: 'setup_fee';
  /** Whether their market charges one (switched on by Udozo's admins, above zero). */
  charged: boolean;
  /** Charged and not paid yet: going live answers `setup_fee_unpaid` until it is. */
  due: boolean;
  /** What is due, or what was paid, in `currency`'s minor units; null while Udozo's fee in US dollars cannot be converted (no exchange rate). */
  amount: number | null;
  currency: string | null;
  paid_at: string | null;
};

/** Premium's free domain for one store (`/v1/stores/:store/free-domain`). */
export type FreeDomain = {
  object: 'free_domain';
  /** Free domains the store's plan includes; null: no limit. */
  allowance: number | null;
  used: number;
  /** One is left, and the store's Premium collected something to pay for it. */
  available: boolean;
  /** The most a free domain may cost: what the store's Premium month (and the setup fee paid with it) collected. */
  covers_up_to: { amount: number; currency: string };
};

/** The product's colour theme (`/v1/theme`, public), chosen by Udozo's admins. */
export type SiteThemeColors = { primary: string; accent: string; ink: string; page: string };
export type SiteTheme = { object: 'theme'; preset: string | null; colors: SiteThemeColors; version: number; preview: boolean };

/** Webhook events a Udozo endpoint can subscribe to: the API's `eventTypesFor('udozo')` that Seller HQ offers. */
export const udozoWebhookEventTypes = [
  'top_up.succeeded',
  'top_up.failed',
  'payout.paid',
  'payout.failed',
  'support_ticket.created',
  'support_ticket.updated',
  'support_ticket.message_received',
  'resale_order.created',
  'resale_order.updated',
] as const;
export type UdozoWebhookEventType = (typeof udozoWebhookEventTypes)[number];

/**
 * API key scopes Seller HQ offers on Udozo keys: those of `apiKeyScopesFor('udozo')` that reach Udozo's routes (the
 * catalogue, quotes, orders, customers' checks and disputes are BitoCard's).
 */
export const udozoApiKeyScopes = ['wallet:read', 'wallet:write', 'webhooks:manage', 'events:read', 'stores:manage', 'support:read', 'support:write', 'resale:read', 'resale:write'] as const;
export type UdozoApiKeyScope = (typeof udozoApiKeyScopes)[number];

export const resellerUdozoApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    setupFee: build.query<SetupFee, void>({ query: () => '/v1/billing/setup-fee', providesTags: ['Subscription'] }),
    /** Pays it from the live wallet (the sandbox answers `live_only`). */
    paySetupFee: build.mutation<SetupFee, void>({
      query: () => ({ url: '/v1/billing/setup-fee', method: 'POST' }),
      invalidatesTags: ['Subscription', 'Wallet', 'Invoice', 'Store'],
    }),
    freeDomain: build.query<FreeDomain, string>({ query: store => `/v1/stores/${store}/free-domain`, providesTags: ['Domain', 'Subscription'] }),
    /** Buys the store's free domain: nothing is taken from the wallet (`free_domain_unavailable`, `domain_not_covered`). */
    claimFreeDomain: build.mutation<StoreDomain, { store: string; domain: string; contact: DomainContact }>({
      query: ({ store, ...body }) => ({ url: `/v1/stores/${store}/free-domain`, method: 'POST', body }),
      invalidatesTags: ['Domain', 'Store', 'Subscription'],
    }),
    /** Named apart from anything the storefront apps add to the shared API slice. */
    sellerHqTheme: build.query<SiteTheme, void>({ query: () => '/v1/theme', keepUnusedDataFor: 3600 }),
  }),
});

export const { useSetupFeeQuery, usePaySetupFeeMutation, useFreeDomainQuery, useClaimFreeDomainMutation, useSellerHqThemeQuery } = resellerUdozoApi;
