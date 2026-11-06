"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, Eye, FilePlus2, Hourglass, ShieldCheck } from "lucide-react";
import { Badge, Card, CardHeader, DataTable, errorMessage, formatNumber, formatRelative, Input, LineChart, PageHeader, QueryView, Select, Skeleton, StatCard, Tabs } from "@bitocard/admin-ui";
import { usePrefetchQuery } from "@bitocard/api-client";
import {
  type PostingBreakdown,
  type PostingJourney,
  type PostingStatus,
  type PostingStuckMilestone,
  type PostingSummary,
  postingSources,
  postingSummaryDays,
  usePostingJourneysQuery,
  usePostingSummaryQuery,
} from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { codeLabel, milestoneLabels, minutesText, originLabel, paramLabel, percent, reviewCodeLabel, sourceLabel, statusLabels, statusTones, stepLabel, stuckLabels } from "@/components/postings";

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const showFilters = [
  { value: "all", label: "All" },
  { value: "stuck", label: "Stuck" },
  { value: "in_progress", label: "In progress" },
  { value: "in_review", label: "In review" },
  { value: "sent_back", label: "Sent back" },
  { value: "live", label: "Live" },
  { value: "sold", label: "Sold" },
  { value: "abandoned", label: "Abandoned" },
] as const;
type Show = (typeof showFilters)[number]["value"];
type Pick = { stuckAt?: PostingStuckMilestone | null; code?: string | null };

/**
 * Reports > Posting journeys: each ad's way from the seller pressing Sell to the ad live and its first results. The
 * funnel through Post an ad's steps, where sellers are stuck, what refuses them, how reviews end and why, the daily
 * trend, and every journey with its own history (kept 30 days if never live, 90 days once live; the counts stay).
 */
export default function PostingJourneysPage() {
  const [days, setDays] = useState<number>(30);
  const [country, setCountry] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [show, setShow] = useState<Show>("stuck");
  const [stuckAt, setStuckAt] = useState<PostingStuckMilestone | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const summary = usePostingSummaryQuery({ days, ...(country ? { country } : {}), ...(source ? { source } : {}), ...(category ? { category } : {}) });

  const pick = (filter: Pick) => {
    setStuckAt(filter.stuckAt ?? null);
    setCode(filter.code ?? null);
    setShow(filter.stuckAt === "resubmitted" ? "sent_back" : filter.stuckAt ? "stuck" : "all");
    document.getElementById("journeys")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <UdozoShell section="reports" current="/reports/postings" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Posting journeys" }]}>
      <PageHeader
        title="Posting journeys"
        description="Each ad's way from Sell to live and its first results: where sellers get stuck, what refuses them and how reviews end. Kept 30 days if the ad never goes live, 90 days once it does; the counts are kept for a year."
      />

      <div className="flex flex-wrap justify-end gap-2">
        <label className="sr-only" htmlFor="posting-country">Country</label>
        <Select id="posting-country" value={country} onChange={event => setCountry(event.target.value)} className="w-auto">
          <option value="">Every country</option>
          {(summary.data?.countries ?? []).filter(row => row.key).map(row => (
            <option key={row.key} value={row.key}>{row.key}</option>
          ))}
          {country && !summary.data?.countries.some(row => row.key === country) ? <option value={country}>{country}</option> : null}
        </Select>
        <label className="sr-only" htmlFor="posting-source">Where Sell was pressed</label>
        <Select id="posting-source" value={source} onChange={event => setSource(event.target.value)} className="w-auto">
          <option value="">Every way in</option>
          {postingSources.map(value => (
            <option key={value} value={value}>{sourceLabel(value)}</option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="posting-category">Category</label>
        <Select id="posting-category" value={category} onChange={event => setCategory(event.target.value)} className="w-auto">
          <option value="">Every category</option>
          {(summary.data?.categories ?? []).filter(row => row.key).map(row => (
            <option key={row.key} value={row.key}>{row.label ?? row.key}</option>
          ))}
          {category && !summary.data?.categories.some(row => row.key === category) ? <option value={category}>This category</option> : null}
        </Select>
        <label className="sr-only" htmlFor="posting-days">Period</label>
        <Select id="posting-days" value={String(days)} onChange={event => setDays(Number(event.target.value))} className="w-auto">
          {postingSummaryDays.map(value => (
            <option key={value} value={value}>{value === 365 ? "Last year" : `Last ${value} days`}</option>
          ))}
        </Select>
      </div>

      <QueryView query={summary} loading={<Card className="p-5"><Skeleton className="h-48 w-full" /></Card>}>{data => <Overview data={data} onPick={pick} />}</QueryView>

      <Journeys country={country} source={source} category={category} show={show} setShow={setShow} stuckAt={stuckAt} code={code} clear={() => pick({})} q={q} setQ={setQ} />
    </UdozoShell>
  );
}

function Overview({ data, onPick }: { data: PostingSummary; onPick: (filter: Pick) => void }) {
  const { totals, review } = data;
  const visits = data.visits.signed_in + data.visits.signed_out;
  const top = Math.max(visits, totals.started, data.funnel[0]?.count ?? 0, 1);
  const stuckTotal = data.stuck_at.reduce((sum, row) => sum + row.count, 0);
  const decided = review.approved + review.sent_back + review.removed;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Opened Post an ad"
          value={formatNumber(visits)}
          icon={<Eye aria-hidden />}
          tone="blue"
          footer={<span className="text-xs text-muted">{formatNumber(data.visits.signed_out)} signed out first · counted only</span>}
        />
        <StatCard label="Started" value={formatNumber(totals.started)} icon={<FilePlus2 aria-hidden />} footer={<span className="text-xs text-muted">{formatNumber(totals.submitted)} posted · {percent(totals.submitted, totals.started)}</span>} />
        <StatCard
          label="Live"
          value={formatNumber(totals.live)}
          icon={<CheckCircle2 aria-hidden />}
          tone="green"
          footer={<span className="text-xs text-muted">{totals.post_rate === null ? "—" : `${percent(totals.live, totals.started)} of those who started`} · about {minutesText(totals.median_minutes_to_live ?? totals.average_minutes_to_live)}</span>}
        />
        <StatCard
          label="Stuck now"
          value={formatNumber(totals.stuck)}
          icon={<Hourglass aria-hidden />}
          tone="amber"
          footer={<span className="text-xs text-muted">{totals.in_progress} still going · {totals.in_review_now} in review · {totals.sent_back_now} sent back</span>}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="The funnel" description={`${shortDate(data.from)} to ${shortDate(data.to)}, by the day each journey started. The drop shows how many did not reach the next step.`} />
          <ol className="grid gap-3 px-5 pt-4 pb-6 sm:px-6" aria-label="Posting funnel">
            {[{ key: "visits", label: "Opened Post an ad (visits)", count: visits }, { key: "started", label: "Started a journey", count: totals.started }, ...data.funnel.map(row => ({ key: row.milestone, label: milestoneLabels[row.milestone], count: row.count }))].map((row, index, rows) => {
              const previous = index > 1 ? rows[index - 1]!.count : null;
              // Up to live each step follows the one before; first results are each of the live ads.
              const after = ["first_view", "first_contact", "first_lead", "sold"].includes(row.key);
              const base = after ? totals.live : previous;
              const lost = base !== null && !after && index > 2 ? Math.max(0, base - row.count) : 0;
              return (
                <li key={row.key} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold text-ink">{row.label}</span>
                    <span className="tabular-nums text-muted">
                      <span className="font-bold text-ink">{formatNumber(row.count)}</span>
                      {index > 1 && totals.started ? ` · ${after ? `${percent(row.count, totals.live)} of live` : percent(row.count, totals.started)}` : ""}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-canvas" aria-hidden>
                    <div className={index === 0 ? "h-full rounded-full bg-slate-300" : row.key === "live" || row.key === "sold" ? "h-full rounded-full bg-emerald-500" : after ? "h-full rounded-full bg-sky-500" : "h-full rounded-full bg-brand-500"} style={{ width: `${Math.max(row.count ? 2 : 0, (row.count / top) * 100)}%` }} />
                  </div>
                  {row.key === "live" ? <p className="text-xs text-muted">{formatNumber(data.live_split.direct)} live at once · {formatNumber(data.live_split.after_review)} after a moderator</p> : null}
                  {lost > 0 ? <p className="text-xs text-red-700">{formatNumber(lost)} stopped before this ({percent(lost, base!)})</p> : null}
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Where sellers are stuck now" description="Ads quiet for over a day before posting, and ads sent back but not posted again. Choose one to see them." />
          {stuckTotal === 0 ? (
            <p className="px-5 pt-3 pb-6 text-sm text-muted sm:px-6">Nobody is stuck right now.</p>
          ) : (
            <ul className="grid gap-2 px-5 pt-3 pb-6 sm:px-6">
              {data.stuck_at.filter(row => row.count > 0).sort((a, b) => b.count - a.count).map(row => (
                <li key={row.milestone}>
                  <button type="button" onClick={() => onPick({ stuckAt: row.milestone })} className="grid w-full gap-1 rounded-xl border border-line p-3 text-left hover:bg-canvas">
                    <span className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-semibold text-ink">{stuckLabels[row.milestone]}</span>
                      <span className="font-bold tabular-nums text-amber-700">{row.count}</span>
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-canvas" aria-hidden>
                      <span className="block h-full rounded-full bg-amber-500" style={{ width: `${(row.count / stuckTotal) * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Day by day" description="Post an ad opened, journeys started, ads posted and ads live, by the day each journey started." />
        <div className="px-3 pb-5 sm:px-5">
          <LineChart
            label="Posting by day"
            labels={data.daily.map(row => shortDate(row.day))}
            series={[
              { name: "Opened", color: "#94a3b8", values: data.daily.map(row => row.visits), format: formatNumber },
              { name: "Started", color: "#0e7cc0", values: data.daily.map(row => row.started), format: formatNumber },
              { name: "Posted", color: "#c2560f", values: data.daily.map(row => row.submitted), format: formatNumber },
              { name: "Live", color: "#10b981", values: data.daily.map(row => row.live), format: formatNumber },
            ]}
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="What refuses sellers" description="Each step the form or Udozo refused, and why, by how many ads it stopped at least once. Choose one to see their journeys." />
          <DataTable
            caption="Refused steps"
            rows={data.blockers}
            rowKey={row => `${row.origin}:${row.step}:${row.code}:${row.param ?? ""}`}
            onRowClick={row => onPick({ code: row.code })}
            empty="Nothing was refused in this period."
            columns={[
              { key: "reason", header: "Why", cell: row => <span className="font-semibold text-ink">{codeLabel(row.code)}{paramLabel(row.param) ? <span className="font-normal text-muted"> · {paramLabel(row.param)}</span> : null}</span> },
              { key: "step", header: "At", cell: row => stepLabel(row.step) },
              { key: "origin", header: "By", hideOnMobile: true, cell: row => originLabel(row.origin) },
              { key: "journeys", header: "Ads", align: "right", cell: row => <span className="font-bold tabular-nums">{formatNumber(row.journeys)}</span> },
              { key: "refusals", header: "Times", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums text-muted">{formatNumber(row.refusals)}</span> },
            ]}
          />
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Reviews" description="Ads sent to a moderator, how reviews ended and why ads were sent back or removed." />
          <div className="grid gap-4 px-5 pt-3 pb-6 sm:px-6">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:grid-cols-2">
              <Figure label="Sent to review" value={formatNumber(review.queued)} />
              <Figure label="Approved" value={`${formatNumber(review.approved)}${decided ? ` · ${percent(review.approved, decided)}` : ""}`} />
              <Figure label="Sent back" value={formatNumber(review.sent_back)} />
              <Figure label="Removed" value={formatNumber(review.removed)} />
            </div>
            <p className="flex items-center gap-2 text-sm text-muted">
              <ShieldCheck className="size-4 shrink-0" aria-hidden />
              {review.median_minutes_to_review !== null ? `Usually decided within ${minutesText(review.median_minutes_to_review)}` : review.average_minutes_to_review !== null ? `Decided in about ${minutesText(review.average_minutes_to_review)} on average` : "No decisions yet"}
            </p>
            <Breakdown title="Why sent back or removed" rows={review.reasons.map(row => ({ key: row.code, label: reviewCodeLabel(row.code), count: row.count }))} />
            <Breakdown title="Why sent to review" rows={review.flags.map(row => ({ key: row.flag, label: codeLabel(row.flag), count: row.count }))} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <Split title="Where Sell was pressed" rows={data.sources.map(row => ({ ...row, label: sourceLabel(row.key) }))} />
        <Split title="Categories" rows={data.categories.map(row => ({ ...row, label: row.label ?? (row.key ? "A category" : "Not chosen yet") }))} />
        <Split title="Devices" description="Journeys still kept." rows={data.devices.map(row => ({ ...row, label: row.key }))} />
        <Split title="Countries" rows={data.countries.map(row => ({ ...row, label: row.key || "Not known" }))} />
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-canvas p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ key: string; label: string; count: number }> }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div>
      <p className="text-xs font-semibold text-muted uppercase">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted">None in this period.</p>
      ) : (
        <ul className="mt-1 grid gap-1.5 text-sm">
          {rows.slice(0, 8).map(row => (
            <li key={row.key} className="grid gap-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-ink">{row.label}</span>
                <span className="shrink-0 tabular-nums font-semibold text-ink">{row.count}</span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
                <span className="block h-full rounded-full bg-brand-500" style={{ width: `${total ? (row.count / total) * 100 : 0}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Split({ title, description, rows }: { title: string; description?: string; rows: Array<PostingBreakdown & { label: string }> }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <p className="px-5 pt-3 pb-6 text-sm text-muted sm:px-6">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line px-5 pt-2 pb-4 text-sm sm:px-6">
          {rows.map(row => (
            <li key={row.key || "none"} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-ink">{row.label}</span>
              <span className="shrink-0 tabular-nums text-muted" title={`${row.started} started, ${row.submitted} posted, ${row.live} live`}>
                <span className="font-semibold text-ink">{row.live}</span> of {row.started} live · {percent(row.live, row.started)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Journeys(props: { country: string; source: string; category: string; show: Show; setShow: (value: Show) => void; stuckAt: PostingStuckMilestone | null; code: string | null; clear: () => void; q: string; setQ: (value: string) => void }) {
  const router = useRouter();
  const prefetch = usePrefetchQuery("postingJourney");
  const [offset, setOffset] = useState(0);
  const status: PostingStatus | undefined = props.show === "all" ? undefined : props.show;
  const query = usePostingJourneysQuery({
    ...(status ? { status } : {}),
    ...(props.stuckAt ? { stuck_at: props.stuckAt } : {}),
    ...(props.code ? { code: props.code } : {}),
    ...(props.country ? { country: props.country } : {}),
    ...(props.source ? { source: props.source } : {}),
    ...(props.category ? { category: props.category } : {}),
    ...(props.q.trim() ? { q: props.q.trim() } : {}),
    limit: 50,
    offset,
  });
  return (
    <Card id="journeys">
      <CardHeader
        title="Journeys"
        description="Each ad's way from Sell, newest activity first. Open one to see every step with its time and why one was refused."
        actions={
          props.stuckAt || props.code ? (
            <button type="button" onClick={props.clear} className="text-sm font-semibold text-brand-600 hover:underline">
              Clear: {props.stuckAt ? stuckLabels[props.stuckAt] : codeLabel(props.code)}
            </button>
          ) : null
        }
      />
      <div className="grid gap-3 border-b border-line px-5 pt-3 pb-4 sm:px-6">
        <Tabs label="Show" value={props.show} onChange={value => { props.setShow(value); setOffset(0); }} items={showFilters.map(item => ({ value: item.value, label: item.label }))} />
        <label htmlFor="posting-search" className="sr-only">Search by seller, email, ad number or SKU</label>
        <Input id="posting-search" type="search" placeholder="Search by seller, email, ad number or SKU" value={props.q} onChange={event => { props.setQ(event.target.value); setOffset(0); }} />
      </div>
      <DataTable<PostingJourney>
        caption="Posting journeys"
        rows={query.isLoading ? undefined : query.data?.data}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={row => row.id}
        onRowClick={row => router.push(`/reports/postings/${row.id}`)}
        onRowIntent={row => {
          router.prefetch(`/reports/postings/${row.id}`);
          prefetch(row.id);
        }}
        empty="No journeys match."
        columns={[
          {
            key: "ad",
            header: "Ad",
            cell: row => (
              <span className="grid min-w-0">
                <span className="truncate font-semibold text-ink">{row.listing?.title ?? (row.listing ? "Untitled draft" : "No draft yet")}</span>
                <span className="truncate text-xs text-muted">{row.seller.name} · {row.listing?.sku ?? (row.listing?.ref ? `#${row.listing.ref}` : sourceLabel(row.source))}</span>
              </span>
            ),
          },
          { key: "status", header: "Status", cell: row => <Badge tone={statusTones[row.status]}>{statusLabels[row.status]}</Badge> },
          { key: "where", header: "Where", cell: row => (row.stuck_at ? stuckLabels[row.stuck_at] : row.status === "removed" ? `Removed: ${reviewCodeLabel(row.last_reject_code)}` : row.milestones.sold ? "Sold" : row.milestones.first_lead ? "Has leads" : row.milestones.live ? "Live, no lead yet" : "—") },
          { key: "why", header: "Last refusal", hideOnMobile: true, cell: row => (row.last_error ? `${codeLabel(row.last_error.code)} (${stepLabel(row.last_error.step).toLowerCase()})` : "—") },
          { key: "source", header: "From", hideOnMobile: true, cell: row => sourceLabel(row.source) },
          { key: "last", header: "Last step", align: "right", cell: row => <span className="inline-flex items-center gap-1 text-muted"><Clock3 className="size-3.5" aria-hidden />{formatRelative(row.last_event_at)}</span> },
        ]}
      />
      {query.data && (offset > 0 || query.data.has_more) ? (
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm sm:px-6">
          <span className="text-muted">
            {offset + 1} to {offset + query.data.data.length} of {query.data.total}
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="rounded-lg border border-line px-3 py-1.5 font-semibold disabled:opacity-40">Newer</button>
            <button type="button" disabled={!query.data.has_more} onClick={() => setOffset(offset + 50)} className="rounded-lg border border-line px-3 py-1.5 font-semibold disabled:opacity-40">Older</button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
