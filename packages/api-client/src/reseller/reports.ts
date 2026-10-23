import { apiFetch, bitocardApi, toApiError } from '../base';

export type ResellerReportMetric = 'earnings' | 'gross_sales' | 'orders';

export type ResellerPnlReport = {
  object: 'reseller_pnl_report';
  mode: 'live' | 'test';
  from: string;
  to: string;
  currency: string;
  revenue: number;
  operating_expenses: number;
  net_profit: number;
  breakdown: Array<{ kind: string; label: string; group: 'revenue' | 'expense' | 'adjustment'; amount: number }>;
};

export type ResellerGrowthPoint = { date: string; value: number; projected: boolean };

export type ResellerGrowthReport = {
  object: 'reseller_growth_report';
  mode: 'live' | 'test';
  metric: ResellerReportMetric;
  from: string;
  to: string;
  currency: string;
  current: number;
  previous: number;
  change_percent: number | null;
  points: ResellerGrowthPoint[];
};

export type ResellerStatementRow = { date: string; reference: string; type: string; description: string; currency: string; amount: number };

export type ResellerStatement = { object: 'reseller_statement'; mode: 'live' | 'test'; from: string; to: string; currency: string; data: ResellerStatementRow[] };

export type ResellerReportRange = { from: string; to: string; currency?: string };

/**
 * Downloads one of the statement files (CSV or PDF). Fetched with the same account and mode headers as every other
 * request (a plain link cannot send them, so it would fetch the wrong account's, or the live, statement), then saved
 * from memory. Throws the API's error (for example `statement_too_large`) for the screen to show.
 */
export async function downloadResellerStatement(format: 'csv' | 'pdf', range: ResellerReportRange) {
  const params = new URLSearchParams({ from: range.from, to: range.to, ...(range.currency ? { currency: range.currency } : {}) });
  const response = await apiFetch(`/v1/reports/statement.${format}?${params.toString()}`);
  if (!response.ok) throw toApiError(response.status, await response.json().catch(() => undefined));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `bitocard-statement-${range.from.slice(0, 10)}-${range.to.slice(0, 10)}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Your own earnings, growth and the statement behind them, from your own ledger postings. */
export const resellerReportsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    resellerPnl: build.query<ResellerPnlReport, ResellerReportRange>({ query: params => ({ url: '/v1/reports/pnl', params }), providesTags: ['Report'] }),
    resellerGrowth: build.query<ResellerGrowthReport, ResellerReportRange & { metric: ResellerReportMetric }>({ query: params => ({ url: '/v1/reports/growth', params }), providesTags: ['Report'] }),
    resellerStatement: build.query<ResellerStatement, ResellerReportRange>({ query: params => ({ url: '/v1/reports/statement', params }), providesTags: ['Report'] }),
  }),
});

export const { useResellerPnlQuery, useResellerGrowthQuery, useResellerStatementQuery } = resellerReportsApi;
