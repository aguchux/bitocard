"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardHeader, DateRangePicker, defaultDateRange, errorMessage, LineChart, PageHeader, StatCard, Tabs, Trend, type DateRange } from "@bitocard/admin-ui";
import { type ResellerReportMetric, useResellerGrowthQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";

// Earnings and sales come in minor units of the wallet's currency.
const money = (value: number) => (value / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const metrics: Array<{ value: ResellerReportMetric; label: string; format: (value: number) => string }> = [
  { value: "earnings", label: "Earnings", format: money },
  { value: "gross_sales", label: "Gross sales", format: money },
  { value: "orders", label: "Orders", format: value => value.toLocaleString("en-GB") },
];

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Reports > Growth: your own earnings, sales or orders over a date range, with a simple trend continued a little further. */
export default function ResellerGrowthPage() {
  const [metric, setMetric] = useState<ResellerReportMetric>("earnings");
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const growth = useResellerGrowthQuery({ from: range.from, to: range.to, metric });
  const data = growth.data;
  const chosen = metrics.find(item => item.value === metric)!;
  const projectedFrom = data?.points.find(point => point.projected)?.date;

  return (
    <ShqShell section="reports" current="/reports/growth" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Growth" }]}>
      <PageHeader title="Growth" description="How your own sales are trending, and a simple projection if the recent trend continues. An estimate, not a promise." />

      <DateRangePicker value={range} onChange={setRange} />
      <Tabs label="Metric" value={metric} onChange={setMetric} variant="pills" items={metrics.map(item => ({ value: item.value, label: item.label }))} />

      {growth.error ? <Card className="p-5 text-sm text-red-700">{errorMessage(growth.error)}</Card> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label={`${chosen.label} (this range)`}
          value={data ? chosen.format(data.current) : "—"}
          icon={<TrendingUp className="size-5" aria-hidden />}
          loading={growth.isLoading}
          footer={<Trend change={data?.change_percent ?? null} />}
        />
        <StatCard label="Previous range" value={data ? chosen.format(data.previous) : "—"} icon={<TrendingUp className="size-5" aria-hidden />} loading={growth.isLoading} footer="Same length, immediately before" />
      </div>

      <Card>
        <CardHeader title={chosen.label} description={projectedFrom ? `The trend continues past ${shortDate(projectedFrom)} (dates after it are projected).` : "Daily values for the range."} />
        <div className="px-3 pb-5 sm:px-5">
          {data ? <LineChart label={chosen.label} labels={data.points.map(point => shortDate(point.date))} series={[{ name: chosen.label, color: "#ec4899", values: data.points.map(point => point.value), format: chosen.format }]} /> : null}
        </div>
      </Card>
    </ShqShell>
  );
}
