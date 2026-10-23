"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { Card, CardHeader, DataTable, DateRangePicker, defaultDateRange, errorMessage, PageHeader, Select, type Column, type DateRange } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { type Mode, reportExportUrl, type StatementRow, useCountriesQuery, useStatementReportQuery } from "@bitocard/api-client/admin";

const money = (minor: number | null, currency: string) => (minor === null ? "—" : `${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`);
const shortDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The most rows drawn on the page; the CSV and PDF exports hold every one. */
const shown = 500;

const columns: Array<Column<StatementRow>> = [
  { key: "date", header: "Date", cell: row => shortDate(row.date) },
  { key: "reference", header: "Reference", hideOnMobile: true, cell: row => row.reference },
  { key: "label", header: "Account", cell: row => row.label },
  { key: "debit", header: "Debit", align: "right", cell: row => money(row.debit, row.currency) },
  { key: "credit", header: "Credit", align: "right", cell: row => money(row.credit, row.currency) },
];

/**
 * Reports > Statements: the dated ledger rows behind a P&L for a date range, downloadable as CSV or a formatted PDF.
 */
export default function StatementsPage() {
  const [mode, setMode] = useState<Mode>("live");
  const [currency, setCurrency] = useState<string>("USD");
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const query = { mode, from: range.from, to: range.to, currency: currency === "USD" ? undefined : currency };
  const statement = useStatementReportQuery(query);
  const countries = useCountriesQuery();
  const currencies = [...new Set((countries.data?.data ?? []).map(country => country.currency))].sort();
  const rows = statement.data?.data ?? [];
  const described = rows.length > shown ? `The first ${shown} of ${rows.length} postings in this range: download the CSV for every one.` : `${rows.length} postings in this range.`;

  return (
    <AdminShell section="reports" current="/reports/statements" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Statements" }]}>
      <PageHeader
        title="Statements"
        description="Every revenue, cost-of-sales and operating-expense posting for a date range, as a downloadable statement."
        actions={
          statement.data ? (
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
            <option value="USD">Every market</option>
            {currencies.map(code => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader title="Rows" description={described} />
        <DataTable columns={columns} rows={statement.data ? rows.slice(0, shown) : undefined} rowKey={row => `${row.reference}:${row.kind}:${row.currency}`} loading={statement.isLoading} error={statement.error ? errorMessage(statement.error) : null} onRetry={statement.refetch} empty="No activity in this range." />
      </Card>
    </AdminShell>
  );
}
