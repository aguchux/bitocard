"use client";

import { useState } from "react";
import { DollarSign, Download, FileText, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardHeader, DataTable, DateRangePicker, defaultDateRange, errorMessage, PageHeader, Select, StatCard, type Column, type DateRange } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { type Mode, type PnlReport, reportExportUrl, useCountriesQuery, usePnlReportQuery } from "@bitocard/api-client/admin";

type Row = PnlReport["breakdown"][number];

const groupLabels: Record<Row["group"], string> = { revenue: "Revenue", cost_of_sales: "Cost of sales", expense: "Operating expense" };

const money = (minor: number, currency: string) => `${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const columnsFor = (currency: string): Array<Column<Row>> => [
  { key: "label", header: "Account", cell: row => row.label },
  { key: "group", header: "Group", hideOnMobile: true, cell: row => groupLabels[row.group] },
  { key: "amount", header: "Amount", align: "right", cell: row => <span className="font-semibold tabular-nums">{money(row.amount, currency)}</span> },
];

/**
 * Reports > P&L: revenue less cost of sales is gross profit, less operating expenses is net profit, for a date
 * range, across every market (converted to USD at the reference rate) or one market's own currency.
 */
export default function PnlReportPage() {
  const [mode, setMode] = useState<Mode>("live");
  const [currency, setCurrency] = useState<string>("USD");
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const query = { mode, from: range.from, to: range.to, currency: currency === "USD" ? undefined : currency };
  const pnl = usePnlReportQuery(query);
  const countries = useCountriesQuery();
  const currencies = [...new Set((countries.data?.data ?? []).map(country => country.currency))].sort();
  const data = pnl.data;

  return (
    <AdminShell section="reports" current="/reports" crumbs={[{ label: "Reports", href: "/reports" }, { label: "P&L" }]}>
      <PageHeader
        title="Profit and loss"
        description="Revenue BitoCard keeps for itself, less what suppliers charge for fulfilled orders and what it costs to run the business. Crypto revenue and spin rewards are not yet priced into this report."
        actions={
          data ? (
            <div className="flex flex-wrap gap-2">
              <a href={reportExportUrl("csv", query)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                <Download className="size-4" aria-hidden /> CSV
              </a>
              <a href={reportExportUrl("pdf", query)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                <FileText className="size-4" aria-hidden /> PDF
              </a>
            </div>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="flex items-end gap-2">
          <Select value={mode} onChange={event => setMode(event.target.value as Mode)} className="w-auto">
            <option value="live">Live</option>
            <option value="test">Sandbox</option>
          </Select>
          <Select value={currency} onChange={event => setCurrency(event.target.value)} className="w-auto">
            <option value="USD">Every market (USD)</option>
            {currencies.map(code => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {pnl.error ? <Card className="p-5 text-sm text-red-700">{errorMessage(pnl.error)}</Card> : null}
      {data?.unconverted.length ? <Card className="px-5 py-3 text-sm text-amber-700">No current rate for {data.unconverted.join(", ")}: left out of these totals.</Card> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Revenue" value={data ? money(data.revenue, data.currency) : "—"} icon={<DollarSign className="size-5" aria-hidden />} tone="blue" loading={pnl.isLoading} />
        <StatCard label="Cost of sales" value={data ? money(data.cost_of_sales, data.currency) : "—"} icon={<TrendingDown className="size-5" aria-hidden />} tone="amber" loading={pnl.isLoading} />
        <StatCard label="Gross profit" value={data ? money(data.gross_profit, data.currency) : "—"} icon={<TrendingUp className="size-5" aria-hidden />} tone="green" loading={pnl.isLoading} />
        <StatCard label="Operating expenses" value={data ? money(data.operating_expenses, data.currency) : "—"} icon={<TrendingDown className="size-5" aria-hidden />} tone="amber" loading={pnl.isLoading} />
        <StatCard label="Net profit" value={data ? money(data.net_profit, data.currency) : "—"} icon={<TrendingUp className="size-5" aria-hidden />} tone="pink" loading={pnl.isLoading} />
      </div>

      <Card>
        <CardHeader title="Breakdown" description="Every account kind behind the totals above, for this range." />
        <DataTable
          columns={columnsFor(data?.currency ?? "")}
          rows={data?.breakdown}
          rowKey={row => row.kind}
          loading={pnl.isLoading}
          error={pnl.error ? errorMessage(pnl.error) : null}
          onRetry={pnl.refetch}
          empty="No activity in this range."
        />
      </Card>

      {data?.rates_as_of ? <p className="text-xs text-muted">Converted at the reference rate as of {new Date(data.rates_as_of).toLocaleString("en-GB")}.</p> : null}
    </AdminShell>
  );
}
