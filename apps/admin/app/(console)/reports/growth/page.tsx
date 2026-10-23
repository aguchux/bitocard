"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardHeader, DateRangePicker, defaultDateRange, errorMessage, LineChart, PageHeader, Select, StatCard, Tabs, Trend, type DateRange } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { type Mode, type ReportMetric, useGrowthReportQuery } from "@bitocard/api-client/admin";

const metrics: Array<{ value: ReportMetric; label: string; format: (value: number) => string }> = [
  { value: "gross_sales", label: "Gross sales", format: value => `$${value.toLocaleString("en-GB")}` },
  { value: "orders", label: "Orders", format: value => value.toLocaleString("en-GB") },
  { value: "platform_revenue", label: "Revenue", format: value => `$${value.toLocaleString("en-GB")}` },
  { value: "new_resellers", label: "New resellers", format: value => value.toLocaleString("en-GB") },
];

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Reports > Growth: a metric's daily history over a date range, its change against the immediately preceding
 * range of the same length, and a simple linear trend continued a little further (clearly marked as an estimate).
 */
export default function GrowthReportPage() {
  const [mode, setMode] = useState<Mode>("live");
  const [metric, setMetric] = useState<ReportMetric>("gross_sales");
  const [range, setRange] = useState<DateRange>(defaultDateRange());
  const growth = useGrowthReportQuery({ mode, from: range.from, to: range.to, metric });
  const data = growth.data;
  const chosen = metrics.find(item => item.value === metric)!;
  const projectedFrom = data?.points.find(point => point.projected)?.date;

  return (
    <AdminShell section="reports" current="/reports/growth" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Growth" }]}>
      <PageHeader title="Growth" description="How a metric is trending, and a simple projection of where it is headed if the recent trend continues. An estimate, not a forecast commitment." />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <Select value={mode} onChange={event => setMode(event.target.value as Mode)} className="w-auto">
          <option value="live">Live</option>
          <option value="test">Sandbox</option>
        </Select>
      </div>

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
          {data ? (
            <LineChart
              label={chosen.label}
              labels={data.points.map(point => shortDate(point.date))}
              series={[{ name: chosen.label, color: "#ec4899", values: data.points.map(point => point.value), format: chosen.format }]}
            />
          ) : null}
        </div>
      </Card>

      {data && data.points.some(point => point.projected) ? (
        <Card>
          <CardHeader title="Projected" description="A simple trend line fitted to the range above, continued a little further. Never shown below zero." />
          <ul className="divide-y divide-line px-5 py-2 text-sm sm:px-6">
            {data.points
              .filter(point => point.projected)
              .map(point => (
                <li key={point.date} className="flex items-center justify-between py-2">
                  <span className="text-muted">{shortDate(point.date)}</span>
                  <span className="font-semibold text-ink">{chosen.format(point.value)}</span>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
    </AdminShell>
  );
}
