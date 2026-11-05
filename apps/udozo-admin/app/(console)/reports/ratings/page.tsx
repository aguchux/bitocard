"use client";

import { useState } from "react";
import { EyeOff, Gauge, Sparkles, Wallet } from "lucide-react";
import { Card, CardHeader, formatNumber, PageHeader, QueryView, Skeleton, StatCard } from "@bitocard/admin-ui";
import { useScoresReportQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { UdozoShell } from "@/components/shell";

/**
 * Reports > Seller ratings: how Anjio's scores spread across sellers (by band, and those not enough to rate yet), and
 * its nightly summaries: how many are written, hidden or reported by their sellers, and what they cost this month.
 */
export default function RatingsReportPage() {
  const [country, setCountry] = useState("");
  const report = useScoresReportQuery(country ? { country } : undefined);
  return (
    <UdozoShell section="reports" current="/reports/ratings" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Seller ratings" }]}>
      <PageHeader title="Seller ratings" description="Anjio's nightly scores of sellers, and the short summaries it writes from them. Scores are worked out whether or not they are public in a market." />
      <div className="mt-6">
        <MarketFilter id="ratings-report-market" value={country} onChange={setCountry} />
      </div>
      <QueryView query={report} loading={<Skeleton className="mt-4 h-64 w-full" />}>
        {data => (
          <div className="mt-4 grid gap-6">
            <div className="grid gap-3 sm:grid-cols-4">
              <StatCard icon={<Gauge className="size-5" />} label="Sellers scored" value={formatNumber(data.sellers)} />
              <StatCard icon={<Sparkles className="size-5" />} label="Summaries written" value={formatNumber(data.summaries.written)} />
              <StatCard icon={<EyeOff className="size-5" />} label="Hidden or reported" value={`${formatNumber(data.summaries.hidden)} / ${formatNumber(data.summaries.reported)}`} />
              <StatCard icon={<Wallet className="size-5" />} label="Summaries this month" value={`${formatNumber(data.summaries.this_month.count)} · US$${data.summaries.this_month.cost_usd.toFixed(2)}`} />
            </div>
            <Card>
              <CardHeader title="By band" />
              <ul className="grid gap-2 px-5 pb-5 text-sm sm:px-6">
                {data.bands.map(band => {
                  const share = data.sellers ? Math.round((100 * band.count) / data.sellers) : 0;
                  return (
                    <li key={band.label} className="grid gap-1">
                      <span className="flex justify-between">
                        <span>{band.label}</span>
                        <span className="text-muted">
                          {formatNumber(band.count)} ({share}%)
                        </span>
                      </span>
                      <span className="h-2 rounded-full bg-slate-100" aria-hidden="true">
                        <span className="block h-2 rounded-full bg-brand-600" style={{ width: `${share}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        )}
      </QueryView>
    </UdozoShell>
  );
}
