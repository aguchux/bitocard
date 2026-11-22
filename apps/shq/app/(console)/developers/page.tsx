"use client";

import { useState, type ReactNode } from "react";
import { Activity, ArrowRight, BookOpen, CheckCircle2, FileClock, FlaskConical, KeyRound, Radio, ShoppingBag, Webhook } from "lucide-react";
import { Card, CardHeader, ErrorState, errorMessage, formatRelative, humanise, LineChart, Notice, PageHeader, Skeleton, StatCard, Tabs, cn } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type DeveloperOverview, type Mode, useDeveloperOverviewQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { EnvironmentPanel, environments } from "@/components/environment";

const docsUrl = "https://docs.bitocard.com";
const number = (value: number) => new Intl.NumberFormat("en-GB").format(value);
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Live and sandbox side by side: what each holds, the current one marked, the other a click away. */
function EnvironmentCards({ data }: { data: DeveloperOverview | undefined }) {
  const { mode, setMode } = useReseller();
  const card = (value: Mode) => {
    const current = mode === value;
    const counts = data?.environments[value];
    const live = value === "live";
    return (
      <div
        key={value}
        className={cn(
          "flex flex-col gap-4 rounded-2xl border p-5 transition-shadow",
          current ? (live ? "border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-200" : "border-amber-300 bg-amber-50/70 ring-2 ring-amber-200") : "border-line bg-white",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className={cn("grid size-10 place-items-center rounded-xl", live ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
              {live ? <Radio className="size-5" /> : <FlaskConical className="size-5" />}
            </span>
            <div>
              <p className="font-bold text-ink">{environments[value].name}</p>
              <p className="text-xs text-muted">
                Keys start <code className="font-mono">{environments[value].prefix}</code>
              </p>
            </div>
          </div>
          {current ? (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold", live ? "bg-emerald-600 text-white" : "bg-amber-400 text-amber-950")}>
              <CheckCircle2 className="size-3.5" aria-hidden />
              You are here
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold text-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2",
                live ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-500 hover:bg-amber-600",
              )}
            >
              {live ? "Open live" : "Open sandbox"}
              <ArrowRight className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3">
          {[
            ["Active API keys", counts?.api_keys],
            ["Webhook endpoints", counts?.webhook_endpoints],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl bg-white/80 p-3 ring-1 ring-line">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-xl font-extrabold text-ink">{value === undefined ? <Skeleton className="mt-1 h-6 w-10" /> : number(value as number)}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  };
  return <div className="grid gap-4 md:grid-cols-2">{(["live", "test"] as const).map(card)}</div>;
}

/** A row of the event types with a bar for each, longest first. */
function TopEvents({ data }: { data: DeveloperOverview }) {
  const top = data.events.top_types;
  const most = Math.max(1, ...top.map(item => item.count));
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Most frequent events" description={`What happened to your account in the last ${data.days} days.`} />
      {top.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line p-4 text-sm text-muted">No events yet. They appear as orders, top-ups and checks happen.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {top.map(item => (
            <li key={item.type}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <code className="truncate font-mono text-ink">{item.type}</code>
                <span className="font-semibold tabular-nums text-ink">{number(item.count)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-canvas">
                <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-brand-500" style={{ width: `${Math.max(4, (item.count / most) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Webhook health: the success rate as a ring, and the endpoints' state. */
function WebhookHealth({ data }: { data: DeveloperOverview }) {
  const rate = data.deliveries.success_rate;
  const tone = rate === null ? "#94a3b8" : rate >= 98 ? "#059669" : rate >= 90 ? "#d97706" : "#dc2626";
  const circumference = 2 * Math.PI * 42;
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title="Webhook health" description="Deliveries to your endpoints in this period." />
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <svg viewBox="0 0 100 100" className="size-28 shrink-0 -rotate-90" role="img" aria-label={rate === null ? "No deliveries yet" : `${rate}% delivered`}>
          <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="10" />
          <circle cx="50" cy="50" r="42" fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${((rate ?? 0) / 100) * circumference} ${circumference}`} />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[18px] font-extrabold" transform="rotate(90 50 50)">
            {rate === null ? "–" : `${rate}%`}
          </text>
        </svg>
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-muted">Delivered</dt>
            <dd className="font-bold text-emerald-700">{number(data.deliveries.succeeded)}</dd>
          </div>
          <div>
            <dt className="text-muted">Failed</dt>
            <dd className="font-bold text-red-600">{number(data.deliveries.failed)}</dd>
          </div>
          <div>
            <dt className="text-muted">Retrying</dt>
            <dd className="font-bold text-ink">{number(data.deliveries.pending)}</dd>
          </div>
          <div>
            <dt className="text-muted">Endpoints</dt>
            <dd className="font-bold text-ink">{`${number(data.webhooks.enabled)} on · ${number(data.webhooks.disabled)} off`}</dd>
          </div>
        </dl>
      </div>
      {data.webhooks.failing ? (
        <div className="mt-4">
          <Notice tone="red" title={`${data.webhooks.failing} endpoint${data.webhooks.failing === 1 ? " is" : "s are"} failing`}>
            Deliveries keep failing. Endpoints that fail for 3 days are switched off. <AppLink href="/developers/webhooks" className="font-semibold underline">Check your endpoints</AppLink>
          </Notice>
        </div>
      ) : null}
    </Card>
  );
}

function QuickAction({ href, icon, title, text, external }: { href: string; icon: ReactNode; title: string; text: string; external?: boolean }) {
  const body = (
    <>
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-500 group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
      <ArrowRight className="ml-auto size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
    </>
  );
  const className = "group flex items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-card transition-shadow hover:shadow-lg";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <AppLink href={href} className={className}>
      {body}
    </AppLink>
  );
}

/** Developers > Overview: the environment with its switch, both environments side by side, and the period's figures. */
export default function DevelopersOverviewPage() {
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "developer");
  const [days, setDays] = useState<"7" | "30">("7");
  const query = useDeveloperOverviewQuery({ days: Number(days) as 7 | 30 }, { skip: !allowed });
  const data = query.data;
  const loading = !data && query.isLoading;
  const labels = data?.series.map(item => shortDay(item.day)) ?? [];

  return (
    <ShqShell section="developers" current="/developers" crumbs={[{ label: "Developers", href: "/developers" }, { label: "Overview" }]}>
      <EnvironmentPanel live={data?.live} />
      <PageHeader
        title="Developer overview"
        description={`How your integration is doing in the ${environments[mode].name.toLowerCase()}: API keys, orders through the API, events and webhook deliveries.`}
        actions={<Tabs variant="pills" label="Period" value={days} onChange={setDays} items={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} />}
      />

      {!allowed ? (
        <Notice tone="grey" title="Owners, admins and developers only">
          Your role cannot see the developer tools. Ask the account owner if you need access.
        </Notice>
      ) : query.isError && !data ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <EnvironmentCards data={data} />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Orders through the API"
              tone="blue"
              icon={<ShoppingBag />}
              loading={loading}
              value={data ? number(data.orders.through_api) : null}
              footer={data ? <span className="text-xs text-muted">{`${number(data.orders.completed)} delivered · ${number(data.orders.failed)} failed of ${number(data.orders.total)}`}</span> : null}
            />
            <StatCard
              label="Active API keys"
              tone="violet"
              icon={<KeyRound />}
              loading={loading}
              value={data ? number(data.api_keys.active) : null}
              footer={
                data ? (
                  <span className="text-xs text-muted">{data.api_keys.last_used_at ? `${data.api_keys.last_used_by} used ${formatRelative(data.api_keys.last_used_at)}` : "Not used yet"}</span>
                ) : null
              }
            />
            <StatCard
              label="Webhooks delivered"
              tone="green"
              icon={<Webhook />}
              loading={loading}
              value={data ? (data.deliveries.success_rate === null ? "–" : `${data.deliveries.success_rate}%`) : null}
              footer={data ? <span className="text-xs text-muted">{`${number(data.deliveries.total)} deliveries`}</span> : null}
            />
            <StatCard
              label="Events"
              tone="amber"
              icon={<FileClock />}
              loading={loading}
              value={data ? number(data.events.total) : null}
              footer={data ? <span className="text-xs text-muted">{`Since ${shortDay(data.from)}`}</span> : null}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-5 sm:p-6 xl:col-span-2">
              <CardHeader title="Activity" description="Orders and events each day (UTC)." />
              <div className="mt-4">
                {data ? (
                  <LineChart
                    label="Orders and events each day"
                    labels={labels}
                    series={[
                      { name: "Events", color: "#7c3aed", values: data.series.map(item => item.events), format: number },
                      { name: "Orders", color: "#2563eb", values: data.series.map(item => item.orders), format: number, axis: "right" },
                    ]}
                  />
                ) : (
                  <Skeleton className="h-56 w-full" />
                )}
              </div>
            </Card>
            {data ? <WebhookHealth data={data} /> : <Skeleton className="h-72 w-full rounded-2xl" />}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-5 sm:p-6 xl:col-span-2">
              <CardHeader title="Webhook deliveries" description="Delivered and failed each day." />
              <div className="mt-4">
                {data ? (
                  <LineChart
                    label="Webhook deliveries each day"
                    labels={labels}
                    series={[
                      { name: "Delivered", color: "#059669", values: data.series.map(item => item.deliveries_succeeded), format: number },
                      { name: "Failed", color: "#dc2626", values: data.series.map(item => item.deliveries_failed), format: number },
                    ]}
                  />
                ) : (
                  <Skeleton className="h-56 w-full" />
                )}
              </div>
            </Card>
            {data ? <TopEvents data={data} /> : <Skeleton className="h-72 w-full rounded-2xl" />}
          </div>

          <section aria-label="Get going" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <QuickAction href="/developers/keys" icon={<KeyRound className="size-5" />} title="API keys" text={`Create a ${environments[mode].prefix} key`} />
            <QuickAction href="/developers/webhooks" icon={<Webhook className="size-5" />} title="Webhooks" text="Get told the moment an order changes" />
            <QuickAction href="/developers/events" icon={<Activity className="size-5" />} title="Events" text="Everything that happened, to catch up" />
            <QuickAction href={docsUrl} external icon={<BookOpen className="size-5" />} title="API docs" text={`Try it in the ${humanise(mode === "test" ? "sandbox" : "live")}`} />
          </section>
        </>
      )}
    </ShqShell>
  );
}
