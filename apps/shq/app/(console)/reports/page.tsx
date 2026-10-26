"use client";

import { useState } from "react";
import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Card, CardHeader, DataTable, DateRangePicker, defaultDateRange, errorMessage, PageHeader, StatCard, type Column, type DateRange } from "@bitocard/admin-ui";
import { type ResellerPnlReport, useResellerPnlQuery, useResaleReportQuery } from "@bitocard/api-client/reseller";
import { ReportDownloads } from "@/components/report-downloads";
import { ShqShell } from "@/components/shq-shell";

type Row = ResellerPnlReport["breakdown"][number];

const groupLabels: Record<Row["group"], string> = { revenue: "Revenue", expense: "Expense", adjustment: "Adjustment" };
const money = (minor: number, currency: string) => `${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const columnsFor = (currency: string): Array<Column<Row>> => [
  { key: "label", header: "Item", cell: row => row.label },
  { key: "group", header: "Type", hideOnMobile: true, cell: row => groupLabels[row.group] },
  { key: "amount", header: "Amount", align: "right", cell: row => <span className="font-semibold tabular-nums">{money(row.amount, currency)}</span> },
];

/**
 * Reports > P&L: your earnings from sales, less BitoCard's fees, your plan subscription, domains and any chargebacks borne,
 * for a date range. Never shows BitoCard's supplier costs, which stay internal.
 */
export default function ResellerPnlPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const query = { from: range.from, to: range.to };
  const pnl = useResellerPnlQuery(query);
  const resale = useResaleReportQuery(query);
  const data = pnl.data;

  return (
    <ShqShell section="reports" current="/reports" crumbs={[{ label: "Reports", href: "/reports" }, { label: "P&L" }]}>
      <PageHeader
        title="Profit and loss"
        description="What you earned from sales, less BitoCard's fees, your plan, domains and any chargebacks you bore, for this range."
        actions={
          <ReportDownloads range={query} />
        }
      />

      <DateRangePicker value={range} onChange={setRange} />

      {pnl.error ? <Card className="p-5 text-sm text-red-700">{errorMessage(pnl.error)}</Card> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Earnings" value={data ? money(data.revenue, data.currency) : "—"} icon={<Wallet className="size-5" aria-hidden />} tone="blue" loading={pnl.isLoading} />
        <StatCard label="Expenses" value={data ? money(data.operating_expenses, data.currency) : "—"} icon={<TrendingDown className="size-5" aria-hidden />} tone="amber" loading={pnl.isLoading} />
        <StatCard label="Net profit" value={data ? money(data.net_profit, data.currency) : "—"} icon={<TrendingUp className="size-5" aria-hidden />} tone="green" loading={pnl.isLoading} />
      </div>

      <Card>
        <CardHeader title="Breakdown" description="Every item behind the totals above, for this range." />
        <DataTable columns={columnsFor(data?.currency ?? "")} rows={data?.breakdown} rowKey={row => row.kind} loading={pnl.isLoading} error={pnl.error ? errorMessage(pnl.error) : null} onRetry={pnl.refetch} empty="No activity in this range." />
      </Card>

      {resale.data && resale.data.orders.placed + resale.data.totals.length > 0 ? (
        <Card>
          <CardHeader
            title="Resale orders"
            description={`BitoCard Shop listings sold on your Resale shops: ${resale.data.orders.placed} placed, ${resale.data.orders.completed} completed, ${resale.data.orders.open} open, ${resale.data.orders.refunded} refunded and ${resale.data.orders.not_accepted} not accepted in this range. Money below is for orders released in the range.`}
          />
          <DataTable
            columns={[
              { key: "currency", header: "Currency", cell: row => row.currency },
              { key: "orders", header: "Orders", align: "right", cell: row => row.orders },
              { key: "sales", header: "Sales", align: "right", cell: row => money(row.sales, row.currency) },
              { key: "margin", header: "Your margin", align: "right", hideOnMobile: true, cell: row => money(row.margin, row.currency) },
              { key: "fees", header: "BitoCard’s fee", align: "right", hideOnMobile: true, cell: row => money(row.reseller_fees, row.currency) },
              { key: "earnings", header: "Earnings", align: "right", cell: row => <span className="font-semibold tabular-nums">{money(row.earnings, row.currency)}</span> },
            ]}
            rows={resale.data.totals}
            rowKey={row => row.currency}
            empty="No resale orders released in this range."
          />
        </Card>
      ) : null}
    </ShqShell>
  );
}
