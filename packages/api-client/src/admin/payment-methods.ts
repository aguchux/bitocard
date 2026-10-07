import { bitocardApi } from '../base';

export type PaymentGateway = 'stripe' | 'flutterwave' | 'monnify' | 'pawapay';
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

export const adminPaymentMethodsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
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
      invalidatesTags: ['Activity'],
    }),
  }),
});

export const { usePaymentMethodsQuery, useSetPaymentMethodsMutation } = adminPaymentMethodsApi;

/** Moves one gateway up or down in the switched-on order. */
export function reorder(enabled: PaymentGateway[], gateway: PaymentGateway, by: -1 | 1) {
  const from = enabled.indexOf(gateway);
  const to = from + by;
  if (from < 0 || to < 0 || to >= enabled.length) return enabled;
  const next = [...enabled];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
