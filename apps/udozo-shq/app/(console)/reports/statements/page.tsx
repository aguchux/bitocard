"use client";

import { useState } from "react";
import { Card, CardHeader, DataTable, DateRangePicker, defaultDateRange, errorMessage, PageHeader, type Column, type DateRange } from "@bitocard/admin-ui";
import { type ResellerStatementRow, useResellerStatementQuery } from "@bitocard/api-client/reseller";
import { ReportDownloads } from "@/components/report-downloads";
import { ShqShell } from "@/components/shq-shell";

const typeLabels: Record<string, string> = {
  earnings: "Earnings from a sale",
  order_refund: "Sale refunded",
  platform_fee: "Udozo fee",
  platform_fee_refund: "Udozo fee refunded",
  usage_charge: "Usage charge",
  adjustment: "Adjustment",
  subscription: "Plan subscription",
  domain: "Domain bought or renewed",
  chargeback: "Chargeback",
};

const money = (minor: number, currency: string) => `${minor < 0 ? "-" : ""}${(Math.abs(minor) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const shortDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The most rows drawn on the page; the CSV and PDF downloads hold every one. */
const shown = 500;

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
  const rows = statement.data?.data ?? [];
  const described = rows.length > shown ? `The first ${shown} of ${rows.length} entries in this range: download the CSV for every one.` : `${rows.length} entries in this range.`;

  return (
    <ShqShell section="reports" current="/reports/statements" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Statements" }]}>
      <PageHeader
        title="Statements"
        description="Every earning, fee, subscription charge, domain and chargeback for a date range, as a downloadable statement."
        actions={
          <ReportDownloads range={query} />
        }
      />

      <DateRangePicker value={range} onChange={setRange} />

      <Card>
        <CardHeader title="Rows" description={described} />
        <DataTable columns={columns} rows={statement.data ? rows.slice(0, shown) : undefined} rowKey={row => `${row.reference}:${row.type}`} loading={statement.isLoading} error={statement.error ? errorMessage(statement.error) : null} onRetry={statement.refetch} empty="No activity in this range." />
      </Card>
    </ShqShell>
  );
}
