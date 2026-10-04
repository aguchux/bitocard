import { bitocardApi } from '../base';
import type { List, Page } from './common';

export type FeeKind = 'supplier_order' | 'gateway_payment';

/** One BitoCard fee on an own-integration transaction. Amounts are minor units; `*_nano` are billionths of one. */
export type FeeCharge = {
  object: 'fee_charge';
  id: string;
  mode: 'live' | 'test';
  kind: FeeKind;
  status: 'held' | 'charged' | 'released' | 'refunded';
  currency: string;
  source: { type: string; id: string };
  category: string | null;
  rate_ppb: number;
  rate_percent: string;
  base: number;
  min_fee: number | null;
  exact_nano: string;
  held: number;
  charged: number | null;
  carry_before_nano: string | null;
  carry_after_nano: string | null;
  refund_reason: string | null;
  created_at: string;
  settled_at: string | null;
};

export type FeeStatement = {
  object: 'fee_statement';
  month: string;
  mode: 'live' | 'test';
  currency: string;
  fees: {
    transactions: number;
    charged: number;
    refunded: number;
    net: number;
    by_kind: Array<{ kind: FeeKind; transactions: number; base: number; charged: number; refunded: number }>;
  };
  subscription: number;
  total: number;
  /** Accrued but not yet charged, in billionths of a minor unit (always below one unit). */
  carried_nano: string;
};

export type FeeRate = { object: 'fee_rate'; kind: FeeKind; category: string | null; rate_ppb: number; rate_percent: string; min_fee: number | null };

/** BitoCard's fees on your own-integration transactions (`/v1/wallet/fees`), per mode. */
export const resellerFeesApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    feeCharges: build.query<List<FeeCharge>, Page & { month?: string }>({ query: params => ({ url: '/v1/wallet/fees', params }), providesTags: ['Fee'] }),
    feeStatement: build.query<FeeStatement, string>({ query: month => ({ url: '/v1/wallet/fees/statement', params: { month } }), providesTags: ['Fee'] }),
    feeRates: build.query<List<FeeRate>, void>({ query: () => '/v1/wallet/fee-rates', providesTags: ['Fee'] }),
  }),
});

export const { useFeeChargesQuery, useFeeStatementQuery, useFeeRatesQuery } = resellerFeesApi;
