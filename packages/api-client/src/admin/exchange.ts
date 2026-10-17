import { bitocardApi } from '../base';
import type { List, Mode } from './types';

/** `GET /v1/admin/exchange/reserves`: BitoCard's coin reserves (shared by every market) and each market's money reserve. */
export type ExchangeReserves = {
  object: 'exchange_reserves';
  mode: Mode;
  coins: Array<{ asset: string; name: string; decimals: number; enabled: boolean; balance: string; market: { usd: string; change_24h: number | null; updated_at: string | null } | null }>;
  /** Balances in minor units of the market's currency. */
  markets: Array<{ country: string; name: string; currency: string; balance: number }>;
};

/** BitoCard's markup on one coin in one currency, with the live prices it gives (minor units per whole coin). */
export type ExchangeMarkup = {
  object: 'exchange_markup';
  asset: string;
  currency: string;
  enabled: boolean;
  buy_markup_bps: number;
  sell_markup_bps: number;
  min_fiat: number;
  max_fiat: number | null;
  market_usd: string | null;
  market_price: number | null;
  buy_price: number | null;
  sell_price: number | null;
  updated_at: string | null;
};

export type ExchangeMarkupInput = { mode: Mode; asset: string; currency: string; buy_markup_bps: number; sell_markup_bps: number; min_fiat: number; max_fiat: number | null; enabled: boolean };

export type ReserveMovement = {
  object: 'reserve_movement';
  id: string;
  /** RM-000123. */
  number: string;
  mode: Mode;
  kind: 'fund' | 'withdraw';
  reserve: 'fiat' | 'crypto';
  currency: string;
  country: string | null;
  /** A decimal string: money with two places, coins with their own. */
  amount: string;
  status: 'awaiting_code' | 'expired' | 'completed' | 'cancelled';
  external_reference: string | null;
  reason: string;
  requested_by: { id: string; name: string | null };
  code_expires_at: string | null;
  code_sent_at: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ReserveMovementInput = { mode: Mode; kind: 'fund' | 'withdraw'; reserve: 'fiat' | 'crypto'; country?: string; currency?: string; asset?: string; amount: string; external_reference?: string; reason: string };

export type AdminExchangeTrade = {
  object: 'exchange_trade';
  id: string;
  number: string;
  mode: Mode;
  side: 'buy' | 'sell';
  asset: string;
  currency: string;
  amount: string;
  fiat: number;
  price: number;
  markup_bps: number;
  /** BitoCard's margin over the market price, minor units. */
  markup: number;
  market_usd: string;
  customer: { id: string; name: string; email: string } | null;
  created_at: string;
};

/** The instant exchange (Crypto > Exchange): reserves moved by finance with an emailed code, markups and trades. */
export const adminExchangeApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    exchangeReserves: build.query<ExchangeReserves, Mode>({ query: mode => ({ url: '/v1/admin/exchange/reserves', params: { mode } }), providesTags: ['Crypto'] }),
    reserveMovements: build.query<List<ReserveMovement>, { mode?: Mode }>({ query: params => ({ url: '/v1/admin/exchange/reserves/movements', params: { ...params, limit: 10 } }), providesTags: ['Crypto'] }),
    /** Emails a code to the signed-in admin; nothing moves until it is confirmed. */
    requestReserveMovement: build.mutation<ReserveMovement, ReserveMovementInput>({
      query: body => ({ url: '/v1/admin/exchange/reserves/movements', method: 'POST', body }),
      invalidatesTags: ['Crypto', 'Activity'],
    }),
    confirmReserveMovement: build.mutation<ReserveMovement, { id: string; code: string }>({
      query: ({ id, code }) => ({ url: `/v1/admin/exchange/reserves/movements/${id}/confirm`, method: 'POST', body: { code } }),
      invalidatesTags: ['Crypto', 'Activity'],
    }),
    resendReserveCode: build.mutation<ReserveMovement, string>({ query: id => ({ url: `/v1/admin/exchange/reserves/movements/${id}/resend-code`, method: 'POST' }), invalidatesTags: ['Crypto'] }),
    cancelReserveMovement: build.mutation<ReserveMovement, string>({ query: id => ({ url: `/v1/admin/exchange/reserves/movements/${id}/cancel`, method: 'POST' }), invalidatesTags: ['Crypto', 'Activity'] }),
    exchangeMarkups: build.query<List<ExchangeMarkup> & { mode: Mode }, Mode>({ query: mode => ({ url: '/v1/admin/exchange/markups', params: { mode } }), providesTags: ['Crypto'] }),
    setExchangeMarkup: build.mutation<ExchangeMarkup, ExchangeMarkupInput>({ query: body => ({ url: '/v1/admin/exchange/markups', method: 'PUT', body }), invalidatesTags: ['Crypto', 'Activity'] }),
    exchangeTrades: build.query<List<AdminExchangeTrade>, { mode?: Mode; asset?: string; customer_id?: string }>({ query: params => ({ url: '/v1/admin/exchange/trades', params: { ...params, limit: 50 } }), providesTags: ['Crypto'] }),
  }),
});

export const {
  useExchangeReservesQuery,
  useReserveMovementsQuery,
  useRequestReserveMovementMutation,
  useConfirmReserveMovementMutation,
  useResendReserveCodeMutation,
  useCancelReserveMovementMutation,
  useExchangeMarkupsQuery,
  useSetExchangeMarkupMutation,
  useExchangeTradesQuery,
} = adminExchangeApi;
