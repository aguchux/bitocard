import { bitocardApi } from '../base';
import type { StoreAirtimePurchase, StoreAirtimeSale } from '../storefront';
import type { Mode } from './common';

type Who = { id: string; name: string | null; email: string };

/** A sale on your store: what your customer was paid, your cut when it was made, and what you earned once credited. */
export type ResellerAirtimeSale = Omit<StoreAirtimeSale, 'collector_number' | 'transfer_steps'> & { customer: Who; cut_bps: number; earned: number | null };
/** A purchase on your store: what your customer paid, your cut, and what you earned once the airtime was sent. */
export type ResellerAirtimePurchase = StoreAirtimePurchase & { customer: Who; cut_bps: number; earned: number | null };

/**
 * The airtime exchange on your stores (`/v1/airtime/exchange`): whether it is open for you (`reason`: `not_enabled`,
 * `country_unsupported`, `exchange_closed`), each network's rates for your customers with your cut (your airtime
 * markup, else your general markup, up to the network's `cap_bps`), and the latest trades. Amounts in minor units.
 */
export type ResellerAirtimeExchange = {
  object: 'airtime_exchange';
  mode: Mode;
  available: boolean;
  reason: string | null;
  currency: string | null;
  markup_bps: number;
  networks: Array<{ network: string; name: string; enabled: boolean; cut_bps: number; cap_bps: number; sell_rate_bps: number; buy_rate_bps: number }>;
  sales: ResellerAirtimeSale[];
  purchases: ResellerAirtimePurchase[];
};

export const resellerAirtimeApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    airtimeExchange: build.query<ResellerAirtimeExchange, void>({ query: () => '/v1/airtime/exchange', providesTags: ['Pricing'] }),
  }),
});

export const { useAirtimeExchangeQuery } = resellerAirtimeApi;
