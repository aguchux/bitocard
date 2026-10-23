import { apiBaseUrl, bitocardApi } from '../base';
import type { Mode } from './types';

export type ReportMetric = 'gross_sales' | 'orders' | 'platform_revenue' | 'new_resellers';

export type PnlReport = {
  object: 'pnl_report';
  mode: Mode;
  from: string;
  to: string;
  /** USD when every market was rolled up; a market's own code when `currency` was asked for. */
  currency: string;
  /** Every amount below is in minor units of `currency` (USD cents, or the one market's own minor units). */
  revenue: number;
  cost_of_sales: number;
  gross_profit: number;
  operating_expenses: number;
  net_profit: number;
  breakdown: Array<{ kind: string; label: string; group: 'revenue' | 'cost_of_sales' | 'expense'; amount: number }>;
  /** The oldest reference rate used, or null when nothing needed converting. */
  rates_as_of: string | null;
  /** Currencies involved with no fresh rate: left out of the totals. */
  unconverted: string[];
};

export type GrowthPoint = { date: string; value: number; projected: boolean };

export type GrowthReport = {
  object: 'growth_report';
  mode: Mode;
  metric: ReportMetric;
  from: string;
  to: string;
  current: number;
  previous: number;
  /** Null when the previous period had nothing to compare against. */
  change_percent: number | null;
  points: GrowthPoint[];
};

export type StatementRow = { date: string; reference: string; type: string; description: string; kind: string; label: string; currency: string; debit: number | null; credit: number | null };

export type Statement = { object: 'statement'; mode: Mode; from: string; to: string; data: StatementRow[] };

export type ReportRange = { mode: Mode; from: string; to: string; currency?: string };

/** The signed-in admin's own URL to one of the file exports (CSV or PDF); the browser sends the session cookie itself. */
export function reportExportUrl(format: 'csv' | 'pdf', range: ReportRange) {
  const params = new URLSearchParams({ mode: range.mode, from: range.from, to: range.to, ...(range.currency ? { currency: range.currency } : {}) });
  return `${apiBaseUrl()}/v1/admin/reports/statement.${format}?${params.toString()}`;
}

/** Platform-wide P&L, growth and the statement behind them. */
export const adminReportsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    pnlReport: build.query<PnlReport, ReportRange>({
      query: params => ({ url: '/v1/admin/reports/pnl', params }),
      providesTags: ['Report'],
    }),
    growthReport: build.query<GrowthReport, ReportRange & { metric: ReportMetric }>({
      query: params => ({ url: '/v1/admin/reports/growth', params }),
      providesTags: ['Report'],
    }),
    statementReport: build.query<Statement, ReportRange>({
      query: params => ({ url: '/v1/admin/reports/statement', params }),
      providesTags: ['Report'],
    }),
  }),
});

export const { usePnlReportQuery, useGrowthReportQuery, useStatementReportQuery } = adminReportsApi;
