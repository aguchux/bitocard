"use client";

import { useState } from "react";
import { Activity, Search, SearchX, Users } from "lucide-react";
import { Card, CardHeader, DataTable, formatNumber, LineChart, Notice, PageHeader, QueryView, Select, Skeleton, StatCard } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type DiscoverySummary, discoveryDays, useCountriesQuery, useDiscoverySummaryQuery } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { kindLabel, rate, sourceLabel } from "@/components/discovery";

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const groupLabels = { personalised: "Personalised", holdout: "Comparison group" } as const;

/**
 * Reports > Discovery: what people search for on udozo.com (and find nothing for), which places on the site lead to
 * clicks and contacts, and whether For you does better than the 10% who keep today's order. Recorded only where the
 * `personalisation` switch is on, for signed-in customers and visitors who accepted every cookie.
 */
export default function DiscoveryPage() {
  const [country, setCountry] = useState("");
  const [days, setDays] = useState<number>(7);
  const countries = useCountriesQuery();
  const summary = useDiscoverySummaryQuery({ days, ...(country ? { country } : {}) });
  const name = (code: string | null) => (code ? (countries.data?.data.find(item => item.code === code)?.name ?? code) : null);

  return (
    <UdozoShell section="reports" current="/reports/discovery" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Discovery" }]}>
      <PageHeader
        title="Discovery"
        description="What people search for and find, where they click, and whether For you helps. Events are kept 90 days; daily search counts for 13 months."
        actions={
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="discovery-country">Country</label>
            <Select id="discovery-country" value={country} onChange={event => setCountry(event.target.value)} className="w-auto">
              <option value="">Every country</option>
              {(countries.data?.data ?? []).map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
            <label className="sr-only" htmlFor="discovery-days">Period</label>
            <Select id="discovery-days" value={String(days)} onChange={event => setDays(Number(event.target.value))} className="w-auto">
              {discoveryDays.map(value => (
                <option key={value} value={value}>{`Last ${value} days`}</option>
              ))}
            </Select>
          </div>
        }
      />

      <QueryView query={summary} loading={<Card className="p-5"><Skeleton className="h-48 w-full" /></Card>}>
        {data => <Report data={data} where={name(data.country) ?? "every country"} />}
      </QueryView>
    </UdozoShell>
  );
}

function Report({ data, where }: { data: DiscoverySummary; where: string }) {
  const { totals } = data;
  const holdout = data.for_you.find(row => row.group === "holdout");
  const personalised = data.for_you.find(row => row.group === "personalised");
  return (
    <>
      {data.enabled ? (
        <Notice tone="green">{`Personalisation is on for ${where}.`}</Notice>
      ) : (
        <Notice tone="amber" title={`Personalisation is off for ${where}`}>
          Nothing new is recorded and everyone sees the popular order. Switch on <span className="font-semibold">personalisation</span> in{" "}
          <AppLink href="/settings" className="font-semibold text-brand-600 hover:underline">
            Settings › Feature switches
          </AppLink>
          .
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="People" value={formatNumber(totals.subjects)} icon={<Users aria-hidden />} tone="blue" footer={<span className="text-xs text-muted">Customers and visitors recorded</span>} />
        <StatCard label="Events" value={formatNumber(totals.events)} icon={<Activity aria-hidden />} footer={<span className="text-xs text-muted">{`${shortDate(data.from)} to ${shortDate(data.to)}`}</span>} />
        <StatCard label="Searches" value={formatNumber(totals.searches)} icon={<Search aria-hidden />} tone="green" />
        <StatCard
          label="Found nothing"
          value={rate(totals.zero_result_rate)}
          icon={<SearchX aria-hidden />}
          tone="amber"
          footer={<span className="text-xs text-muted">{`${formatNumber(totals.zero_result_searches)} searches with no results`}</span>}
        />
      </div>

      <Card>
        <CardHeader title="For you against the comparison group" description="One person in ten keeps the popular order in For you, so the difference is what personalising does." />
        {personalised || holdout ? (
          <DataTable
            caption="For you, personalised and comparison group"
            rows={data.for_you}
            rowKey={row => row.group}
            columns={[
              { key: "group", header: "Group", cell: row => <span className="font-semibold text-ink">{groupLabels[row.group]}</span> },
              { key: "subjects", header: "People", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.subjects)}</span> },
              { key: "impressions", header: "Shown", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums">{formatNumber(row.impressions)}</span> },
              { key: "clicks", header: "Clicks", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums">{formatNumber(row.clicks)}</span> },
              { key: "rate", header: "Click rate", align: "right", cell: row => <span className="font-bold tabular-nums">{rate(row.click_rate)}</span> },
              { key: "contacts", header: "Contacts a person", align: "right", cell: row => <span className="tabular-nums">{row.contacts_per_subject === null ? "—" : row.contacts_per_subject.toFixed(2)}</span> },
            ]}
          />
        ) : (
          <p className="px-5 pt-3 pb-6 text-sm text-muted sm:px-6">For you has not been shown in this period.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="Where clicks come from" description="Listings shown and clicked from each place on udozo.com, and the chats, contacts, calls, offers and orders that followed in the same visit." />
        <DataTable
          caption="Clicks by source"
          rows={data.sources}
          rowKey={row => row.source}
          empty="No clicks in this period."
          columns={[
            {
              key: "source",
              header: "From",
              cell: row => (
                <span className="font-semibold text-ink">
                  {sourceLabel(row.source)}
                  {row.source.startsWith("home:") ? <span className="ml-1 font-normal text-muted">{row.source.slice(5)}</span> : null}
                </span>
              ),
            },
            { key: "impressions", header: "Shown", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums">{formatNumber(row.impressions)}</span> },
            { key: "clicks", header: "Clicks", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.clicks)}</span> },
            { key: "rate", header: "Click rate", align: "right", cell: row => <span className="font-bold tabular-nums">{rate(row.click_rate)}</span> },
            { key: "contacts", header: "Contacts", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.contacts)}</span> },
          ]}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Queries title="Top searches" description="What people searched for most, and by how many people." caption="Top searches" rows={data.top_queries} empty="No searches in this period." />
        <Queries title="Searches that found nothing" description="Worth a category, a brand or a word in the brand registry." caption="Searches with no results" rows={data.zero_result_queries} empty="Every search found something." />
      </div>

      <Card>
        <CardHeader title="Day by day" description="Events, searches and people recorded each day (UTC)." />
        <div className="px-3 pb-5 sm:px-5">
          <LineChart
            label="Discovery by day"
            labels={data.daily.map(row => shortDate(row.day))}
            series={[
              { name: "Events", color: "#94a3b8", values: data.daily.map(row => row.events), format: formatNumber },
              { name: "Searches", color: "#0e7cc0", values: data.daily.map(row => row.searches), format: formatNumber },
              { name: "People", color: "#10b981", values: data.daily.map(row => row.subjects), format: formatNumber },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="What was recorded" description="Each kind of event in the period." />
        {data.kinds.length === 0 ? (
          <p className="px-5 pt-3 pb-6 text-sm text-muted sm:px-6">Nothing recorded yet.</p>
        ) : (
          <ul aria-label="Events by kind" className="grid gap-x-6 divide-y divide-line px-5 pt-2 pb-4 text-sm sm:grid-cols-2 sm:divide-y-0 sm:px-6">
            {data.kinds.map(row => (
              <li key={row.kind} className="flex items-center justify-between gap-3 py-2 sm:border-b sm:border-line">
                <span className="min-w-0 truncate text-ink">{kindLabel(row.kind)}</span>
                <span className="shrink-0 font-semibold tabular-nums text-ink">{formatNumber(row.events)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Queries({ title, description, caption, rows, empty }: { title: string; description: string; caption: string; rows: DiscoverySummary["top_queries"]; empty: string }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <DataTable
        caption={caption}
        rows={rows}
        rowKey={row => row.query}
        empty={empty}
        columns={[
          { key: "query", header: "Search", cell: row => <span className="font-semibold break-words text-ink">{row.query}</span> },
          { key: "searches", header: "Searches", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.searches)}</span> },
          { key: "subjects", header: "People", align: "right", cell: row => <span className="tabular-nums">{formatNumber(row.subjects)}</span> },
        ]}
      />
    </Card>
  );
}
