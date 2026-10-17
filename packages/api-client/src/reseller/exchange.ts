import { bitocardApi } from '../base';
import { cursorPages, type List, type Mode, params } from './common';

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
export type ExchangeDeskSettings = { object: 'exchange_desk'; enabled: boolean; fallback_to_bitocard: boolean; markup_cap_bps: number };

export type ResellerExchangeAsset = {
  asset: string; name: string; decimals: number; market_usd: string; buy_price: number; sell_price: number;
  available_to_buy: string; available_to_sell_for: number; your_coins: string; your_wallet: number;
} | { asset: string; name: string; decimals: number; closed: string; your_coins: string };
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

/** A customer's trade at the reseller's own desk (`GET /v1/exchange/desk/trades`): the markup is the reseller's. */
export type DeskTrade = {
  object: 'desk_trade'; id: string; number: string; mode: Mode; side: 'buy' | 'sell'; asset: string; currency: string;
  amount: string; fiat: number; price: number; markup: number; customer: { id: string; name: string; email: string }; created_at: string;
};
/** Coins moved between the reseller's coin wallet and its customer desk reserve. */
export type ResellerCoinBalance = { object: 'reseller_coin_balance'; mode: Mode; asset: string; wallet: string; reserve: string };

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
    /** Every trade with BitoCard, newest first, a page at a time. */
    resellerExchangeTradePages: build.infiniteQuery<List<ResellerExchangeTrade>, void, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ pageParam }) => ({ url: '/v1/exchange/trades', params: params({ limit: 25, starting_after: pageParam }) }),
      providesTags: ['Exchange'],
    }),
    /** Customers' trades at the reseller's own desk, newest first, a page at a time. */
    resellerDeskTrades: build.infiniteQuery<List<DeskTrade>, void, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ pageParam }) => ({ url: '/v1/exchange/desk/trades', params: params({ limit: 25, starting_after: pageParam }) }),
      providesTags: ['Exchange'],
    }),
    resellerExchangeReserves: build.query<ExchangeReserves, void>({ query: () => '/v1/exchange/reserves', providesTags: ['Exchange'] }),
    transferExchangeReserve: build.mutation<ExchangeReserves, { currency: string; amount: number; direction: 'fund' | 'withdraw' }>({
      query: body => ({ url: '/v1/exchange/reserves/transfers', method: 'POST', body }),
      invalidatesTags: ['Exchange', 'Wallet'],
    }),
    transferExchangeCoins: build.mutation<ResellerCoinBalance, { asset: string; amount: string; direction: 'fund' | 'withdraw' }>({
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
  useResellerExchangeDeskQuery, useSetResellerExchangeDeskMutation, useResellerExchangeTradePagesInfiniteQuery, useResellerDeskTradesInfiniteQuery } = resellerExchangeApi;
