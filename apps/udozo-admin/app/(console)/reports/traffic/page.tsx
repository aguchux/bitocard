"use client";

import { useState } from "react";
import { Footprints, Megaphone, UserCheck, UserPlus } from "lucide-react";
import { Card, CardHeader, DataTable, formatNumber, LineChart, Notice, PageHeader, QueryView, Select, Skeleton, StatCard } from "@bitocard/admin-ui";
import { type TrafficSummary, trafficDays, useCountriesQuery, useTrafficSummaryQuery } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { changeWords, channelLabels, channelOrder, landingLabels, sourceName } from "@/components/traffic";

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const pct = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
/** The chart's lines: every visit, then the three channels ads are bought on, in fixed colours. */
const chartLines = [
  { key: "visits", name: "All visits", color: "#94a3b8" },
  { key: "paid", name: "Ads", color: "#185174" },
  { key: "social", name: "Social", color: "#c2560f" },
  { key: "search", name: "Search", color: "#10b981" },
] as const;

/**
 * Reports > Traffic sources: where udozo.com's visitors come from (ads, social networks, search engines, messaging
 * apps, email, other sites, tagged campaigns, typed in), which campaigns and pages bring them, and which bring sign-ups,
 * so ads can be aimed where they work. Visits are counted without anything about the visitor; sign-ups are credited
 * only for visitors who chose Accept all on udozo.com's cookie banner.
 */
export default function TrafficPage() {
  const [country, setCountry] = useState("");
  const [days, setDays] = useState<number>(30);
  const countries = useCountriesQuery();
  const summary = useTrafficSummaryQuery({ days, ...(country ? { country } : {}) });
  const name = (code: string) => (code === "WW" ? "Across countries" : (countries.data?.data.find(item => item.code === code)?.name ?? code));

  return (
    <UdozoShell section="reports" current="/reports/traffic" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Traffic sources" }]}>
      <PageHeader
        title="Traffic sources"
        description="Where people come to udozo.com from, and which sources bring sign-ups. Daily counts are kept about 13 months."
        actions={
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="traffic-country">Country</label>
            <Select id="traffic-country" value={country} onChange={event => setCountry(event.target.value)} className="w-auto">
              <option value="">Every country</option>
              {(countries.data?.data ?? []).map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
            <label className="sr-only" htmlFor="traffic-days">Period</label>
            <Select id="traffic-days" value={String(days)} onChange={event => setDays(Number(event.target.value))} className="w-auto">
              {trafficDays.map(value => (
                <option key={value} value={value}>{`Last ${value} days`}</option>
              ))}
            </Select>
          </div>
        }
      />
      <QueryView query={summary} loading={<Card className="p-5"><Skeleton className="h-48 w-full" /></Card>}>
        {data => <Report data={data} name={name} />}
      </QueryView>
    </UdozoShell>
  );
}

function Report({ data, name }: { data: TrafficSummary; name: (code: string) => string }) {
  const paid = data.channels.find(item => item.channel === "paid");
  const channels = channelOrder.map(channel => data.channels.find(item => item.channel === channel) ?? { channel, visits: 0, share: 0, signups: 0 });
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Visits" value={formatNumber(data.visits)} icon={<Footprints aria-hidden />} tone="blue" footer={<span className="text-xs text-muted">{changeWords(data.visits, data.previous_visits)}</span>} />
        <StatCard label="From ads" value={formatNumber(paid?.visits ?? 0)} icon={<Megaphone aria-hidden />} footer={<span className="text-xs text-muted">{`${pct(paid?.share ?? 0)} of visits`}</span>} />
        <StatCard label="Sign-ups" value={formatNumber(data.signups)} icon={<UserPlus aria-hidden />} tone="green" footer={<span className="text-xs text-muted">{`${shortDate(data.since)} to ${shortDate(data.until)}`}</span>} />
        <StatCard
          label="Sign-ups with a source"
          value={formatNumber(data.signups_attributed)}
          icon={<UserCheck aria-hidden />}
          tone="amber"
          footer={<span className="text-xs text-muted">Visitors who chose Accept all</span>}
        />
      </div>

      <Notice tone="grey">
        Visits are counted for every landing on udozo.com, with nothing kept about the visitor. A sign-up is credited to where its visit came from only when the visitor chose Accept all on the cookie banner, so sources show fewer sign-ups than there are. Tag every ad and campaign link with <code>utm_source</code>, <code>utm_medium</code> (for example <code>cpc</code>) and <code>utm_campaign</code> to see each one here.
      </Notice>

      <Card>
        <CardHeader title="By channel" description="How people arrived. Facebook adds fbclid to every link, ads or not: tag ads with utm_medium=cpc (or paid_social) so they count as ads." />
        <DataTable
          caption="Visits by channel"
          rows={channels}
          rowKey={row => row.channel}
          columns={[
            {
              key: "channel",
              header: "Channel",
              cell: row => (
                <span className="grid gap-0.5">
                  <span className="font-semibold text-ink">{channelLabels[row.channel].name}</span>
                  <span className="text-xs text-muted">{channelLabels[row.channel].detail}</span>
                </span>
              ),
            },
            { key: "visits", header: "Visits", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.visits)}</span> },
            {
              key: "share",
              header: "Share",
              align: "right",
              cell: row => (
                <span className="inline-flex items-center justify-end gap-2">
                  <span aria-hidden className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-line sm:block">
                    <span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, row.share)}%` }} />
                  </span>
                  <span className="tabular-nums">{pct(row.share)}</span>
                </span>
              ),
            },
            { key: "signups", header: "Sign-ups", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.signups)}</span> },
          ]}
        />
      </Card>

      <Card>
        <CardHeader title="Day by day" description="Visits each day (UTC), with those from ads, social networks and search." />
        <div className="px-3 pb-5 sm:px-5">
          <LineChart
            label="Visits by day"
            labels={data.daily.map(row => shortDate(row.day))}
            series={chartLines.map(line => ({ name: line.name, color: line.color, values: data.daily.map(row => row[line.key]), format: formatNumber }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Top sources" description="Each site, network or tagged source, with the sign-ups credited to it." />
        <DataTable
          caption="Visits by source"
          rows={data.sources}
          rowKey={row => `${row.channel}|${row.source}`}
          empty="No visits in this period."
          columns={[
            { key: "source", header: "Source", cell: row => <span className="font-semibold break-words text-ink">{sourceName(row.source)}</span> },
            { key: "channel", header: "Channel", hideOnMobile: true, cell: row => channelLabels[row.channel].name },
            { key: "visits", header: "Visits", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.visits)}</span> },
            { key: "share", header: "Share", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums">{pct(row.share)}</span> },
            { key: "signups", header: "Sign-ups", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.signups)}</span> },
          ]}
        />
      </Card>

      <Card>
        <CardHeader title="Campaigns" description="Links tagged with utm_medium or utm_campaign: one row per source, medium and campaign." />
        <DataTable
          caption="Visits by campaign"
          rows={data.campaigns}
          rowKey={row => `${row.source}|${row.medium}|${row.campaign}`}
          empty="No tagged links in this period. Add utm_source, utm_medium and utm_campaign to your ads' links."
          columns={[
            { key: "campaign", header: "Campaign", cell: row => <span className="font-semibold break-words text-ink">{row.campaign || "No campaign name"}</span> },
            { key: "source", header: "Source", cell: row => sourceName(row.source) },
            { key: "medium", header: "Medium", hideOnMobile: true, cell: row => row.medium || "—" },
            { key: "visits", header: "Visits", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.visits)}</span> },
          ]}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Where they land" description="The kind of page people arrive on." />
          <List rows={data.landings.map(row => ({ key: row.landing, label: landingLabels[row.landing], visits: row.visits }))} empty="No visits in this period." />
        </Card>
        <Card>
          <CardHeader title="By market" description="Visits to each country's pages; pages across countries apart." />
          <List rows={data.markets.map(row => ({ key: row.country, label: name(row.country), visits: row.visits }))} empty="No visits in this period." />
        </Card>
      </div>
    </>
  );
}

function List({ rows, empty }: { rows: Array<{ key: string; label: string; visits: number }>; empty: string }) {
  if (!rows.length) return <p className="px-5 pt-3 pb-6 text-sm text-muted sm:px-6">{empty}</p>;
  return (
    <ul className="grid divide-y divide-line px-5 pt-2 pb-4 text-sm sm:px-6">
      {rows.map(row => (
        <li key={row.key} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 truncate text-ink">{row.label}</span>
          <span className="shrink-0 font-semibold tabular-nums text-ink">{formatNumber(row.visits)}</span>
        </li>
      ))}
    </ul>
  );
}
