"use client";

import { useState } from "react";
import { AlertTriangle, Boxes, Clock, PackageSearch } from "lucide-react";
import { Badge, Card, CardHeader, DataTable, errorMessage, formatNumber, PageHeader, StatCard, Tabs, type Column } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type ConnectReport, useConnectReportQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { flagLabels, flagTones, money, percent } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

type CentreRow = ConnectReport["centres"][number];
type Period = "7" | "30" | "90" | "365";

/**
 * Connect > Reports: what every Connect Centre holds now (items, those past their free time, missing, in Loss of care,
 * arriving late) and how it did over the period chosen, the centres needing attention first; the money Connect made,
 * and the sellers and buyers behind most refusals and uncollected items.
 */
export default function ConnectReportsPage() {
  const [country, setCountry] = useState("");
  const [days, setDays] = useState<Period>("30");
  const report = useConnectReportQuery({ country: country || undefined, days: Number(days) });
  const data = report.data;

  const centreColumns: Array<Column<CentreRow>> = [
    {
      key: "centre",
      header: "Centre",
      cell: row => (
        <AppLink href={`/connect/centres/${row.id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-semibold text-ink">{row.name}</span>
          <span className="block truncate text-xs text-muted">
            {row.number} · {row.area}, {row.state}
          </span>
        </AppLink>
      ),
    },
    {
      key: "holding",
      header: "Holds now",
      cell: row => (
        <span className="block text-sm">
          <span className="block text-ink">
            {formatNumber(row.now.holding)}
            {row.capacity ? ` of ${formatNumber(row.capacity)}` : ""}
          </span>
          <span className="block text-xs text-muted">
            {row.now.overdue} past free time · {row.now.missing} missing
          </span>
        </span>
      ),
    },
    {
      key: "record",
      header: "In the period",
      hideOnMobile: true,
      cell: row => (
        <span className="block text-sm">
          <span className="block text-ink">{formatNumber(row.period.handed_over)} handed over</span>
          <span className="block text-xs text-muted">
            {row.period.not_collected} not collected ({percent(row.period.uncollected_pct)}) · {row.period.refused_at_check_in + row.period.refused_at_counter} refused
          </span>
        </span>
      ),
    },
    {
      key: "flags",
      header: "Needs attention",
      cell: row =>
        row.flags.length ? (
          <span className="flex flex-wrap gap-1">
            {row.flags.map(flag => (
              <Badge key={flag} tone={flagTones[flag]}>
                {flagLabels[flag]}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-sm text-muted">Nothing</span>
        ),
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/reports" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Reports" }]}>
      <PageHeader title="Connect reports" description="What every Connect Centre holds and how it is doing, the money Connect made, and the sellers and buyers behind most problems." />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <MarketFilter id="connect-report-market" value={country} onChange={setCountry} />
        <Tabs<Period>
          label="Period"
          variant="pills"
          value={days}
          onChange={setDays}
          items={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "365", label: "A year" },
          ]}
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Held at centres now" value={formatNumber(data?.now.holding ?? 0)} icon={<Boxes />} loading={!data} footer={data ? <span className="text-xs text-muted">At {formatNumber(data.now.centres)} open centres</span> : null} />
        <StatCard label="Past their free time" value={formatNumber(data?.now.overdue ?? 0)} icon={<Clock />} tone="amber" loading={!data} footer={data ? <span className="text-xs text-muted">{data.now.loss_of_care} in Loss of care</span> : null} />
        <StatCard label="Missing" value={formatNumber(data?.now.missing ?? 0)} icon={<PackageSearch />} loading={!data} footer={data ? <span className="text-xs text-muted">{data.now.late_arrivals} arriving late</span> : null} />
        <StatCard
          label="Not collected"
          value={percent(data?.period.uncollected_pct ?? null)}
          icon={<AlertTriangle />}
          tone="violet"
          loading={!data}
          footer={data ? <span className="text-xs text-muted">{data.period.not_collected} of {data.period.handed_over + data.period.not_collected} items in the period</span> : null}
        />
      </div>

      {data?.money.length ? (
        <Card className="mt-4 p-5 sm:p-6">
          <CardHeader title="Money in the period" description="Connect fees on items handed over, shared with the centres, and storage paid." className="px-0 pt-0 pb-4" />
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.money.map(row => (
              <li key={row.currency} className="rounded-lg border border-line p-3 text-sm">
                <span className="block font-semibold text-ink">{money(row.connect_fees, row.currency)} in Connect fees</span>
                <span className="block text-muted">
                  {money(row.centres, row.currency)} to centres · {money(row.udozo, row.currency)} to Udozo
                </span>
                <span className="block text-muted">
                  Storage paid: {money(row.storage_buyers, row.currency)} by buyers, {money(row.storage_sellers, row.currency)} by sellers
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mt-4">
        <DataTable<CentreRow> caption="Centres" columns={centreColumns} rows={data?.centres} loading={report.isLoading} error={report.error ? errorMessage(report.error) : null} onRetry={report.refetch} rowKey={row => row.id} empty="No centres yet." />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Sellers" description="Most items refused at check-in or damaged in the period, and storage they owe." className="px-0 pt-0 pb-4" />
          {data?.sellers.length ? (
            <ul className="divide-y divide-line text-sm">
              {data.sellers.map(seller => (
                <li key={seller.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <AppLink href={`/classifieds/sellers/${seller.id}`} className="min-w-0 truncate font-semibold text-ink hover:underline">
                    {seller.name ?? seller.email ?? "A seller"}
                  </AppLink>
                  <span className="text-muted">
                    {seller.refused} refused · {seller.damaged} damaged
                    {seller.storage_owed ? ` · owes ${money(seller.storage_owed.amount, seller.storage_owed.currency)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No seller problems in the period.</p>
          )}
        </Card>
        <Card className="p-5 sm:p-6">
          <CardHeader title="Buyers" description="Buyers who did not collect, or refused at the counter, twice or more in the period." className="px-0 pt-0 pb-4" />
          {data?.buyers.length ? (
            <ul className="divide-y divide-line text-sm">
              {data.buyers.map(buyer => (
                <li key={buyer.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <AppLink href={`/customers/${buyer.id}`} className="min-w-0 truncate font-semibold text-ink hover:underline">
                    {buyer.name ?? buyer.email ?? "A buyer"}
                  </AppLink>
                  <span className="text-muted">
                    {buyer.not_collected} not collected · {buyer.refused_at_counter} refused at the counter
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No buyer problems in the period.</p>
          )}
        </Card>
      </div>
    </UdozoShell>
  );
}
