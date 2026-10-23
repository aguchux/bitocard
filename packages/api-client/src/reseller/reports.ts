import { apiBaseUrl, bitocardApi } from '../base';

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

export type ResellerStatementRow = { date: string; type: string; description: string; currency: string; amount: number };

export type ResellerStatement = { object: 'reseller_statement'; mode: 'live' | 'test'; from: string; to: string; currency: string; data: ResellerStatementRow[] };

export type ResellerReportRange = { from: string; to: string; currency?: string };

/** The signed-in reseller's own URL to one of the file exports (CSV or PDF); the browser sends the session cookie itself. */
export function resellerReportExportUrl(format: 'csv' | 'pdf', range: ResellerReportRange) {
  const params = new URLSearchParams({ from: range.from, to: range.to, ...(range.currency ? { currency: range.currency } : {}) });
  return `${apiBaseUrl()}/v1/reports/statement.${format}?${params.toString()}`;
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
