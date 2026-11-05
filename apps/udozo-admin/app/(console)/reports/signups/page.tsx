"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock3, Eye, Hourglass, UserPlus } from "lucide-react";
import { Badge, Card, CardHeader, DataTable, errorMessage, formatNumber, formatRelative, Input, LineChart, PageHeader, QueryView, Select, Skeleton, StatCard, Tabs } from "@bitocard/admin-ui";
import { usePrefetchQuery } from "@bitocard/api-client";
import {
  type SignupJourney,
  type SignupJourneyStatus,
  type SignupMilestone,
  type SignupSummary,
  type SignupSurface,
  signupSummaryDays,
  useSignupJourneysQuery,
  useSignupSummaryQuery,
} from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { codeLabel, duration, milestoneLabels, percent, statusLabels, statusTones, stepLabel, stuckLabels, surfaceLabels } from "@/components/signups";

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const showFilters = [
  { value: "all", label: "All" },
  { value: "stuck", label: "Stuck" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
] as const;
type Show = (typeof showFilters)[number]["value"];

/**
 * Reports > Sign-up journeys: where people who start signing up on udozo.com or Seller HQ get stuck, and why. The
 * funnel from opening sign-up to a usable account, what refuses people most, the daily trend, and every journey with
 * its own history (kept 7 days after it completes, 30 days if it never does; the counts stay).
 */
export default function SignupJourneysPage() {
  const [surface, setSurface] = useState<SignupSurface>("udozo");
  const [days, setDays] = useState<number>(7);
  const [country, setCountry] = useState("");
  const [show, setShow] = useState<Show>("stuck");
  const [stuckAt, setStuckAt] = useState<SignupMilestone | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const summary = useSignupSummaryQuery({ surface, days, ...(country ? { country } : {}) });

  const pick = (filter: { stuckAt?: SignupMilestone | null; code?: string | null }) => {
    setStuckAt(filter.stuckAt ?? null);
    setCode(filter.code ?? null);
    setShow(filter.stuckAt ? "stuck" : "all");
    document.getElementById("journeys")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <UdozoShell section="reports" current="/reports/signups" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Sign-up journeys" }]}>
      <PageHeader
        title="Sign-up journeys"
        description="Where people who start signing up get stuck, and why. Each journey is kept 7 days after the account is ready, or 30 days if it never is; the counts are kept for a year."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs label="Sign-up" value={surface} onChange={value => { setSurface(value); setCountry(""); pick({}); }} variant="pills" items={(["udozo", "shq"] as const).map(value => ({ value, label: surfaceLabels[value] }))} />
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="signup-country">Country</label>
          <Select id="signup-country" value={country} onChange={event => setCountry(event.target.value)} className="w-auto">
            <option value="">Every country</option>
            {(summary.data?.countries ?? []).filter(row => row.country).map(row => (
              <option key={row.country} value={row.country!}>{row.country}</option>
            ))}
            {country && !summary.data?.countries.some(row => row.country === country) ? <option value={country}>{country}</option> : null}
          </Select>
          <label className="sr-only" htmlFor="signup-days">Period</label>
          <Select id="signup-days" value={String(days)} onChange={event => setDays(Number(event.target.value))} className="w-auto">
            {signupSummaryDays.map(value => (
              <option key={value} value={value}>{value === 365 ? "Last year" : `Last ${value} days`}</option>
            ))}
          </Select>
        </div>
      </div>

      <QueryView query={summary} loading={<Card className="p-5"><Skeleton className="h-48 w-full" /></Card>}>{data => <Overview data={data} onPick={pick} />}</QueryView>

      <Journeys surface={surface} country={country} show={show} setShow={setShow} stuckAt={stuckAt} code={code} clear={() => pick({})} q={q} setQ={setQ} />
    </UdozoShell>
  );
}

function Overview({ data, onPick }: { data: SignupSummary; onPick: (filter: { stuckAt?: SignupMilestone | null; code?: string | null }) => void }) {
  const { totals } = data;
  const top = Math.max(data.visits, data.funnel[0]?.count ?? 0, 1);
  const stuckTotal = data.stuck_at.reduce((sum, row) => sum + row.count, 0);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Opened sign-up" value={formatNumber(data.visits)} icon={<Eye aria-hidden />} tone="blue" footer={<span className="text-xs text-muted">Page visits, counted only</span>} />
        <StatCard label="Started" value={formatNumber(totals.started)} icon={<UserPlus aria-hidden />} footer={<span className="text-xs text-muted">{data.visits ? `${percent(totals.started, data.visits)} of visits` : "Entered an email or used Google"}</span>} />
        <StatCard
          label="Ready to use"
          value={formatNumber(totals.completed)}
          icon={<CheckCircle2 aria-hidden />}
          tone="green"
          footer={<span className="text-xs text-muted">{totals.completion_rate === null ? "—" : `${percent(totals.completed, totals.started)} of those who started`}</span>}
        />
        <StatCard
          label="Stuck now"
          value={formatNumber(totals.stuck)}
          icon={<Hourglass aria-hidden />}
          tone="amber"
          footer={<span className="text-xs text-muted">{totals.in_progress} still going · {totals.average_minutes_to_complete === null ? "no average yet" : `about ${duration(totals.average_minutes_to_complete * 60000)} to finish`}</span>}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="The funnel" description={`${shortDate(data.from)} to ${shortDate(data.to)}, by the day each journey started. The drop shows how many did not reach the next step.`} />
          <ol className="grid gap-3 px-5 pt-4 pb-6 sm:px-6" aria-label="Sign-up funnel">
            {[{ key: "visits", label: "Opened sign-up", count: data.visits }, ...data.funnel.map(row => ({ key: row.milestone, label: milestoneLabels[row.milestone], count: row.count }))].map((row, index, rows) => {
              const previous = index > 0 ? rows[index - 1]!.count : null;
              const lost = previous !== null && index > 1 ? Math.max(0, previous - row.count) : 0;
              return (
                <li key={row.key} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold text-ink">{row.label}</span>
                    <span className="tabular-nums text-muted">
                      <span className="font-bold text-ink">{formatNumber(row.count)}</span>
                      {index > 0 && data.funnel[0]?.count ? ` · ${percent(row.count, data.funnel[0].count)}` : ""}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-canvas" aria-hidden>
                    <div className={index === 0 ? "h-full rounded-full bg-slate-300" : row.key === "completed" ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-brand-500"} style={{ width: `${Math.max(row.count ? 2 : 0, (row.count / top) * 100)}%` }} />
                  </div>
                  {lost > 0 ? <p className="text-xs text-red-700">{formatNumber(lost)} stopped before this ({percent(lost, previous!)})</p> : null}
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Where people are stuck now" description="Journeys quiet for over an hour, by the step they have not done. Choose one to see them." />
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
        <CardHeader title="Day by day" description="Sign-up page visits, journeys started and those that ended ready to use, by the day they started." />
        <div className="px-3 pb-5 sm:px-5">
          <LineChart
            label="Sign-ups by day"
            labels={data.daily.map(row => shortDate(row.day))}
            series={[
              { name: "Opened sign-up", color: "#94a3b8", values: data.daily.map(row => row.visits), format: formatNumber },
              { name: "Started", color: "#0e7cc0", values: data.daily.map(row => row.started), format: formatNumber },
              { name: "Ready to use", color: "#10b981", values: data.daily.map(row => row.completed), format: formatNumber },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="What refuses people" description="Each step Udozo refused, and why, by how many people it stopped at least once. Choose one to see their journeys." />
        <DataTable
          caption="Refused steps"
          rows={data.blockers}
          rowKey={row => `${row.step}:${row.code}`}
          onRowClick={row => onPick({ code: row.code })}
          empty="Nothing was refused in this period."
          columns={[
            { key: "reason", header: "Why", cell: row => <span className="font-semibold text-ink">{codeLabel(row.code)}</span> },
            { key: "step", header: "At", cell: row => stepLabel(row.step) },
            { key: "journeys", header: "People", align: "right", cell: row => <span className="font-bold tabular-nums">{formatNumber(row.journeys)}</span> },
            { key: "refusals", header: "Times", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums text-muted">{formatNumber(row.refusals)}</span> },
          ]}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Split title="How they signed up" rows={data.methods.map(row => ({ key: row.method, label: row.method === "google" ? "Google" : "Email", ...row }))} />
        <Split title="Devices" description="Journeys still kept (30 days at most)." rows={data.devices.map(row => ({ key: row.device, label: row.device, ...row }))} />
        <Split title="Countries" rows={data.countries.map(row => ({ key: row.country ?? "none", label: row.country ?? "Not chosen yet", ...row }))} />
      </div>
    </>
  );
}

function Split({ title, description, rows }: { title: string; description?: string; rows: Array<{ key: string; label: string; started: number; completed: number }> }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length === 0 ? (
        <p className="px-5 pt-3 pb-6 text-sm text-muted sm:px-6">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line px-5 pt-2 pb-4 text-sm sm:px-6">
          {rows.map(row => (
            <li key={row.key} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-ink">{row.label}</span>
              <span className="shrink-0 tabular-nums text-muted">
                <span className="font-semibold text-ink">{row.completed}</span> of {row.started} · {percent(row.completed, row.started)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Journeys(props: { surface: SignupSurface; country: string; show: Show; setShow: (value: Show) => void; stuckAt: SignupMilestone | null; code: string | null; clear: () => void; q: string; setQ: (value: string) => void }) {
  const router = useRouter();
  const prefetch = usePrefetchQuery("signupJourney");
  const [offset, setOffset] = useState(0);
  const status: SignupJourneyStatus | undefined = props.show === "all" ? undefined : props.show;
  const query = useSignupJourneysQuery({
    surface: props.surface,
    ...(status ? { status } : {}),
    ...(props.stuckAt ? { stuck_at: props.stuckAt } : {}),
    ...(props.code ? { code: props.code } : {}),
    ...(props.country ? { country: props.country } : {}),
    ...(props.q.trim() ? { q: props.q.trim() } : {}),
    limit: 50,
    offset,
  });
  return (
    <Card id="journeys">
      <CardHeader
        title="Journeys"
        description="Each person’s way through sign-up, newest activity first. Open one to see every step with its time and why one was refused."
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
        <label htmlFor="journey-search" className="sr-only">Search by email</label>
        <Input id="journey-search" type="search" placeholder="Search by email" value={props.q} onChange={event => { props.setQ(event.target.value); setOffset(0); }} />
      </div>
      <DataTable<SignupJourney>
        caption="Sign-up journeys"
        rows={query.isLoading ? undefined : query.data?.data}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={row => row.id}
        onRowClick={row => router.push(`/reports/signups/${row.id}`)}
        onRowIntent={row => {
          router.prefetch(`/reports/signups/${row.id}`);
          prefetch(row.id);
        }}
        empty="No journeys match."
        columns={[
          { key: "email", header: "Email", cell: row => <span className="font-semibold break-all text-ink">{row.email}</span> },
          { key: "status", header: "Status", cell: row => <Badge tone={statusTones[row.status]}>{statusLabels[row.status]}</Badge> },
          { key: "where", header: "Where", cell: row => (row.stuck_at ? stuckLabels[row.stuck_at] : "Ready to use") },
          { key: "why", header: "Last refusal", hideOnMobile: true, cell: row => (row.last_error ? `${codeLabel(row.last_error.code)} (${stepLabel(row.last_error.step).toLowerCase()})` : "—") },
          { key: "device", header: "Device", hideOnMobile: true, cell: row => row.device ?? "—" },
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
