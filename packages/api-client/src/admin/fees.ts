import { bitocardApi } from '../base';
import type { List } from './types';

export type FeeKind = 'supplier_order' | 'gateway_payment';

/** A fee rate. The most specific rule for a transaction wins (country, then category, then plan). */
export type FeeRule = {
  object: 'fee_rule';
  id: string;
  kind: FeeKind;
  country_code: string | null;
  category: string | null;
  plan_code: string | null;
  /** Parts per billion: 1 = 0.0000001%, 100,000,000 = 10%. */
  rate_ppb: number;
  rate_percent: string;
  min_fee_minor: number | null;
  updated_at: string;
};

export type FeeRuleInput = { kind: FeeKind; country_code?: string | null; category?: string | null; plan_code?: string | null; rate_ppb: number; min_fee_minor?: number | null };
export type FeeReportGroup = 'reseller' | 'kind' | 'category' | 'country' | 'plan';
export type FeeReport = {
  object: 'fee_report';
  from: string;
  to: string;
  mode: 'live' | 'test';
  group_by: FeeReportGroup;
  data: Array<{ key: string; label: string; currency: string; transactions: number; charged: number; refunded: number; net: number }>;
};
export type FeeReconciliation = {
  object: 'fee_reconciliation';
  ok: boolean;
  checked: number;
  mismatches: Array<{ reseller_id: string; mode: string; currency: string; exact_plus_extra_nano: string; charged_plus_carry_nano: string }>;
  ledger_mismatches: Array<{ mode: string; currency: string; account_balance: number; fees_net: number }>;
};

/** Platform fees: rules (finance), revenue reports and the reconciliation check. */
export const adminFeesApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    feeRules: build.query<List<FeeRule>, void>({ query: () => '/v1/admin/fee-rules', providesTags: ['FeeRule'] }),
    setFeeRule: build.mutation<FeeRule, FeeRuleInput>({ query: body => ({ url: '/v1/admin/fee-rules', method: 'PUT', body }), invalidatesTags: ['FeeRule', 'Activity'] }),
    deleteFeeRule: build.mutation<void, string>({ query: id => ({ url: `/v1/admin/fee-rules/${id}`, method: 'DELETE' }), invalidatesTags: ['FeeRule', 'Activity'] }),
    feeReport: build.query<FeeReport, { from: string; to: string; group_by: FeeReportGroup; mode?: 'live' | 'test' }>({
      query: params => ({ url: '/v1/admin/fees/report', params }),
      providesTags: ['Fee'],
    }),
    feeReconciliation: build.query<FeeReconciliation, void>({ query: () => '/v1/admin/fees/reconciliation', providesTags: ['Fee'] }),
  }),
});

export const { useFeeRulesQuery, useSetFeeRuleMutation, useDeleteFeeRuleMutation, useFeeReportQuery, useFeeReconciliationQuery } = adminFeesApi;

/** "0.0000001" to "10" (percent) as parts per billion, exactly; null if it is not a valid rate. */
export function percentToPpb(text: string): number | null {
  const match = /^(\d{1,2})(?:\.(\d{1,7}))?$/.exec(text.trim());
  if (!match) return null;
  const ppb = Number(match[1]) * 10_000_000 + Number((match[2] ?? '').padEnd(7, '0'));
  return ppb <= 100_000_000 ? ppb : null;
}
