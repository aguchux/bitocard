"use client";

import { useState } from "react";
import { Card, CardHeader, DataTable, DateRangePicker, defaultDateRange, errorMessage, formatMoney, PageHeader, Select, type Column, type DateRange } from "@bitocard/admin-ui";
import { UdozoShell } from "@/components/shell";
import { type Mode, type ResaleFeesReport, useResaleFeesReportQuery } from "@bitocard/api-client/admin";

type Market = ResaleFeesReport["markets"][number];
type Top = ResaleFeesReport["top_resellers"][number];

const kindLabels = { direct: "Udozo", resale: "Resale shops" } as const;

const marketColumns: Array<Column<Market>> = [
  { key: "market", header: "Market", cell: row => <span className="font-semibold text-ink">{`${row.country} · ${kindLabels[row.kind]}`}</span> },
  { key: "orders", header: "Orders", align: "right", cell: row => row.orders },
  { key: "sales", header: "Sales", align: "right", hideOnMobile: true, cell: row => formatMoney(row.sales, row.currency) },
  { key: "buyer", header: "Buyer fees", align: "right", hideOnMobile: true, cell: row => formatMoney(row.buyer_fees, row.currency) },
  { key: "seller", header: "Seller fees", align: "right", hideOnMobile: true, cell: row => formatMoney(row.seller_fees, row.currency) },
  { key: "reseller", header: "Reseller fees", align: "right", hideOnMobile: true, cell: row => formatMoney(row.reseller_fees, row.currency) },
  { key: "fees", header: "Fees", align: "right", cell: row => <span className="font-semibold tabular-nums">{formatMoney(row.fees, row.currency)}</span> },
];

const topColumns: Array<Column<Top>> = [
  { key: "reseller", header: "Reseller", cell: row => <span className="font-semibold text-ink">{row.reseller.name}</span> },
  { key: "orders", header: "Orders", align: "right", cell: row => row.orders },
  { key: "sales", header: "Sales", align: "right", hideOnMobile: true, cell: row => formatMoney(row.sales, row.currency) },
  { key: "fees", header: "Reseller fees", align: "right", cell: row => formatMoney(row.reseller_fees, row.currency) },
];

/**
 * Reports > Safe pay and resale: Udozo's fees on Safe pay orders released in a range, by market, Udozo's
 * own sales beside resale orders, each side's fee apart, and the resellers who paid the most resale fees.
 */
export default function ResaleFeesPage() {
  const [mode, setMode] = useState<Mode>("live");
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const report = useResaleFeesReportQuery({ mode, from: range.from, to: range.to });

  return (
    <UdozoShell section="reports" current="/reports/resale" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Safe pay and resale" }]}>
      <PageHeader title="Safe pay and resale" description="Udozo’s fees on Safe pay orders released in this range, from buyers, sellers and resellers, per market." />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <Select value={mode} onChange={event => setMode(event.target.value as Mode)} className="w-auto">
          <option value="live">Live</option>
          <option value="test">Sandbox</option>
        </Select>
      </div>
      <Card>
        <CardHeader title="Fees by market" description="Orders released in this range, in each market’s currency." />
        <DataTable columns={marketColumns} rows={report.data?.markets} rowKey={row => `${row.country}:${row.currency}:${row.kind}`} loading={report.isLoading} error={report.error ? errorMessage(report.error) : null} onRetry={report.refetch} empty="No orders released in this range." />
      </Card>
      <Card>
        <CardHeader title="Resellers" description="The resellers who paid the most resale fees in this range." />
        <DataTable columns={topColumns} rows={report.data?.top_resellers} rowKey={row => `${row.reseller.id}:${row.currency}`} loading={report.isLoading} empty="No resale orders released in this range." />
      </Card>
    </UdozoShell>
  );
}
