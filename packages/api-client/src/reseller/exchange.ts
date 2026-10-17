import { bitocardApi } from '../base';
import type { List, Mode } from './common';

export type ExchangeReserves = {
  object: 'exchange_reserves';
  mode: Mode;
  desk: { id: string; name: string };
  coins: Array<{ asset: string; name: string; enabled: boolean; balance: string }>;
  wallets: Array<{ currency: string; balance: number }>;
};

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

export type ExchangeMarkupInput = Pick<ExchangeMarkup, 'asset' | 'currency' | 'enabled' | 'buy_markup_bps' | 'sell_markup_bps' | 'min_fiat' | 'max_fiat'> & { mode: Mode };
export type ExchangeDeskSettings = { object: 'exchange_desk'; enabled: boolean; fallback_to_bitocard: boolean };

export type ResellerExchangeAsset = {
  asset: string; name: string; decimals: number; market_usd: string; buy_price: number; sell_price: number;
  available_to_buy: string; available_to_sell_for: number; your_coins: string; your_wallet: number;
} | { asset: string; name: string; decimals: number; closed: string };
export type ResellerExchangeOverview = {
  object: 'reseller_exchange'; mode: Mode; currency: string; desk: { id: string; name: string }; quote_seconds: number;
  assets: ResellerExchangeAsset[];
};
export type ResellerExchangeQuote = {
  object: 'reseller_exchange_quote'; id: string; mode: Mode; side: 'buy' | 'sell'; asset: string; currency: string;
  amount: string; fiat: number; price: number; markup_bps: number; expires_at: string; created_at: string;
};
export type ResellerExchangeTrade = {
  object: 'reseller_exchange_trade'; id: string; number: string; mode: Mode; side: 'buy' | 'sell'; asset: string; currency: string;
  amount: string; fiat: number; price: number; markup: number; created_at: string;
};

export const resellerExchangeApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    resellerExchangeDesk: build.query<ExchangeDeskSettings, void>({ query: () => '/v1/exchange/desk', providesTags: ['Exchange'] }),
    setResellerExchangeDesk: build.mutation<ExchangeDeskSettings, { fallback_to_bitocard: boolean }>({
      query: body => ({ url: '/v1/exchange/desk', method: 'PUT', body }), invalidatesTags: ['Exchange'],
    }),
    resellerExchangeOverview: build.query<ResellerExchangeOverview, string>({ query: currency => `/v1/exchange?currency=${encodeURIComponent(currency)}`, providesTags: ['Exchange'] }),
    quoteResellerExchange: build.mutation<ResellerExchangeQuote, { asset: string; currency: string; side: 'buy' | 'sell'; amount: string }>({
      query: body => ({ url: '/v1/exchange/quotes', method: 'POST', body }),
    }),
    tradeResellerExchange: build.mutation<ResellerExchangeTrade, { quote_id: string }>({
      query: body => ({ url: '/v1/exchange/trades', method: 'POST', body }),
      invalidatesTags: ['Exchange', 'Wallet'],
    }),
    resellerExchangeTrades: build.query<List<ResellerExchangeTrade>, void>({ query: () => '/v1/exchange/trades', providesTags: ['Exchange'] }),
    resellerExchangeReserves: build.query<ExchangeReserves, void>({ query: () => '/v1/exchange/reserves', providesTags: ['Exchange'] }),
    transferExchangeReserve: build.mutation<ExchangeReserves, { currency: string; amount: number; direction: 'fund' | 'withdraw' }>({
      query: body => ({ url: '/v1/exchange/reserves/transfers', method: 'POST', body }),
      invalidatesTags: ['Exchange', 'Wallet'],
    }),
    transferExchangeCoins: build.mutation<{ object: 'reseller_coin_balance'; wallet: string; reserve: string }, { asset: string; amount: string; direction: 'fund' | 'withdraw' }>({
      query: body => ({ url: '/v1/exchange/reserves/coins/transfers', method: 'POST', body }), invalidatesTags: ['Exchange'],
    }),
    resellerExchangeMarkups: build.query<List<ExchangeMarkup>, void>({ query: () => '/v1/exchange/markups', providesTags: ['Exchange'] }),
    setResellerExchangeMarkup: build.mutation<ExchangeMarkup, ExchangeMarkupInput>({
      query: body => ({ url: '/v1/exchange/markups', method: 'PUT', body }),
      invalidatesTags: ['Exchange'],
    }),
  }),
});

export const { useResellerExchangeOverviewQuery, useQuoteResellerExchangeMutation, useTradeResellerExchangeMutation, useResellerExchangeTradesQuery,
  useResellerExchangeReservesQuery, useTransferExchangeReserveMutation, useTransferExchangeCoinsMutation, useResellerExchangeMarkupsQuery, useSetResellerExchangeMarkupMutation,
  useResellerExchangeDeskQuery, useSetResellerExchangeDeskMutation } = resellerExchangeApi;
