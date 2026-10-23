"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { Card, CardHeader, DataTable, DateRangePicker, defaultDateRange, errorMessage, PageHeader, type Column, type DateRange } from "@bitocard/admin-ui";
import { resellerReportExportUrl, type ResellerStatementRow, useResellerStatementQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";

const typeLabels: Record<string, string> = {
  earnings: "Earnings from a sale",
  order_refund: "Sale refunded",
  platform_fee: "BitoCard fee",
  platform_fee_refund: "BitoCard fee refunded",
  usage_charge: "Usage charge",
  adjustment: "Adjustment",
  subscription: "Plan subscription",
  chargeback: "Chargeback",
};

const money = (minor: number, currency: string) => `${minor < 0 ? "-" : ""}${(Math.abs(minor) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const shortDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const columns: Array<Column<ResellerStatementRow>> = [
  { key: "date", header: "Date", cell: row => shortDate(row.date) },
  { key: "type", header: "Item", cell: row => typeLabels[row.type] ?? row.description },
  { key: "amount", header: "Amount", align: "right", cell: row => <span className={row.amount < 0 ? "text-red-700" : "text-emerald-700"}>{money(row.amount, row.currency)}</span> },
];

/** Reports > Statements: the dated rows behind your P&L for a date range, downloadable as CSV or a formatted PDF. */
export default function ResellerStatementsPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const query = { from: range.from, to: range.to };
  const statement = useResellerStatementQuery(query);

  return (
    <ShqShell section="reports" current="/reports/statements" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Statements" }]}>
      <PageHeader
        title="Statements"
        description="Every earning, fee, subscription charge and chargeback for a date range, as a downloadable statement."
        actions={
          statement.data ? (
            <div className="flex flex-wrap gap-2">
              <a href={resellerReportExportUrl("csv", query)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                <Download className="size-4" aria-hidden /> CSV
              </a>
              <a href={resellerReportExportUrl("pdf", query)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-canvas">
                <FileText className="size-4" aria-hidden /> PDF
              </a>
            </div>
          ) : null
        }
      />

      <DateRangePicker value={range} onChange={setRange} />

      <Card>
        <CardHeader title="Rows" description={`${statement.data?.data.length ?? 0} entries in this range.`} />
        <DataTable columns={columns} rows={statement.data?.data} rowKey={row => `${row.date}:${row.type}`} loading={statement.isLoading} error={statement.error ? errorMessage(statement.error) : null} onRetry={statement.refetch} empty="No activity in this range." />
      </Card>
    </ShqShell>
  );
}
