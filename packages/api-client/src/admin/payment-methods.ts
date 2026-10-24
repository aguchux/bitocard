import { bitocardApi } from '../base';

export type PaymentGateway = 'stripe' | 'flutterwave' | 'monnify' | 'pawapay' | 'paystack';
export type PaymentMethodPurpose = 'wallet_top_up' | 'checkout';

/** One gateway in a market, for one purpose. */
export type MarketPaymentMethod = {
  gateway: PaymentGateway;
  /** The provider's name (admins only). */
  name: string;
  /** What payers see, for example "Card" or "Mobile money". */
  label: string;
  enabled: boolean;
  position: number;
  /** Credentials saved and not switched to its sandbox (Settings > Integrations). */
  configured: boolean;
  /** Takes payments from this country in its currency; null while not configured. */
  supported: boolean | null;
};

export type MarketPaymentMethods = {
  object: 'payment_methods';
  country: string;
  currency: string;
  wallet_top_up: MarketPaymentMethod[];
  checkout: MarketPaymentMethod[];
};

/** A mobile money network on BitoCard's pawaPay account: its status for payments in (deposits) and payouts, or null when not on the account. */
export type PawapayNetwork = { id: string; name: string; deposits: string | null; payouts: string | null };

/** One country on the pawaPay account, and the BitoCard market for it (null when it is not a market yet). */
export type PawapayCountry = {
  object: 'pawapay_country';
  code: string;
  alpha3: string;
  name: string;
  currencies: Array<{ currency: string; networks: PawapayNetwork[] }>;
  market: { currency: string; checkout: boolean; wallet_top_up: boolean } | null;
};

export type PawapayCoverage = { object: 'pawapay_coverage'; environment: 'live' | 'sandbox'; data: PawapayCountry[] };

export const adminPaymentMethodsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    /** Every country, currency and network on BitoCard's pawaPay account, read live from pawaPay. */
    pawapayCoverage: build.query<PawapayCoverage, void>({
      query: () => '/v1/admin/pawapay/coverage',
      providesTags: [{ type: 'Country', id: 'pawapay' }],
    }),
    /** A new market (operations, audited): every category off except software, its currency given exchange rates. */
    createCountry: build.mutation<unknown, { code: string; name: string; currency: string; min_withdrawal_minor: number }>({
      query: body => ({ url: '/v1/admin/countries', method: 'POST', body }),
      invalidatesTags: ['Country', 'Activity'],
    }),
    /** Every gateway for a market, for wallet top-ups and customer checkout. */
    paymentMethods: build.query<MarketPaymentMethods, string>({
      query: code => `/v1/admin/countries/${code}/payment-methods`,
      providesTags: (_result, _error, code) => [{ type: 'Country', id: `methods:${code}` }],
    }),
    /** The gateways switched on for one purpose, in the order payers see them; the rest are switched off. Audited. */
    setPaymentMethods: build.mutation<MarketPaymentMethods, { code: string; purpose: PaymentMethodPurpose; enabled: PaymentGateway[] }>({
      query: ({ code, ...body }) => ({ url: `/v1/admin/countries/${code}/payment-methods`, method: 'PUT', body }),
      async onQueryStarted({ code }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(adminPaymentMethodsApi.util.upsertQueryData('paymentMethods', code, data));
        } catch {
          // The page shows the error; the cached list is unchanged.
        }
      },
      invalidatesTags: ['Activity', { type: 'Country', id: 'pawapay' }],
    }),
  }),
});

export const { usePaymentMethodsQuery, useSetPaymentMethodsMutation, usePawapayCoverageQuery, useCreateCountryMutation } = adminPaymentMethodsApi;

/** Moves one gateway up or down in the switched-on order. */
export function reorder(enabled: PaymentGateway[], gateway: PaymentGateway, by: -1 | 1) {
  const from = enabled.indexOf(gateway);
  const to = from + by;
  if (from < 0 || to < 0 || to >= enabled.length) return enabled;
  const next = [...enabled];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
