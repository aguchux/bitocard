"use client";

import { useParams } from "next/navigation";
import { Check, CircleDashed, MinusCircle, X } from "lucide-react";
import { Badge, Card, CardHeader, cn, formatDateTime, KeyValue, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type SignupJourneyDetail, type SignupMilestone, signupMilestones, useSignupJourneyQuery } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { codeLabel, duration, methodLabel, milestoneLabels, statusLabels, statusTones, stepLabel, stuckLabels, surfaceLabels } from "@/components/signups";

/**
 * One person's sign-up journey: the milestones across the top (each with when it was reached and how long it took
 * from the one before), then every step in order with what Udozo answered. Opening it is recorded in the activity log.
 */
export default function SignupJourneyPage() {
  const { id } = useParams<{ id: string }>();
  const journey = useSignupJourneyQuery(id);
  return (
    <UdozoShell section="reports" current="/reports/signups" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Sign-up journeys", href: "/reports/signups" }, { label: journey.data?.email ?? "Journey" }]}>
      <QueryView query={journey} loading={<Card className="p-5"><Skeleton className="h-64 w-full" /></Card>}>
        {data => <Journey data={data} />}
      </QueryView>
    </UdozoShell>
  );
}

function Journey({ data }: { data: SignupJourneyDetail }) {
  const at = (milestone: SignupMilestone) => data.milestones[milestone];
  const reached = (milestone: SignupMilestone) => Boolean(at(milestone)) || (milestone === "phone_verified" && data.phone_skipped);
  const started = new Date(data.started_at).getTime();
  return (
    <>
      <PageHeader
        title={data.email}
        description={`${surfaceLabels[data.surface]} · ${methodLabel(data.method)} sign-up · started ${formatDateTime(data.started_at)}`}
        actions={<Badge tone={statusTones[data.status]}>{statusLabels[data.status]}</Badge>}
      />

      {data.status !== "completed" && data.stuck_at ? (
        <div role="status" className={cn("rounded-2xl p-4 text-sm", data.status === "stuck" ? "bg-amber-50 text-amber-900" : "bg-blue-50 text-blue-900")}>
          <p className="font-semibold">{data.status === "stuck" ? `Stuck: ${stuckLabels[data.stuck_at].toLowerCase()}` : `Next: ${milestoneLabels[data.stuck_at].toLowerCase()}`}</p>
          {data.last_error ? <p className="mt-1">Last refused because: {codeLabel(data.last_error.code)} ({stepLabel(data.last_error.step).toLowerCase()}).</p> : null}
        </div>
      ) : null}

      <Card>
        <CardHeader title="Milestones" description="Each one is kept from the first time it was reached." />
        <ol className="grid gap-3 px-5 pt-4 pb-6 sm:grid-cols-3 sm:px-6 xl:grid-cols-6" aria-label="Milestones">
          {signupMilestones.map((milestone, index) => {
            const time = at(milestone);
            const done = reached(milestone);
            const previousTime = signupMilestones.slice(0, index).map(at).filter(Boolean).at(-1);
            const skipped = milestone === "phone_verified" && data.phone_skipped && !time;
            return (
              <li key={milestone} className={cn("rounded-xl border p-3", done ? "border-emerald-200 bg-emerald-50/60" : milestone === data.stuck_at ? "border-amber-300 bg-amber-50" : "border-line")}>
                <div className="flex items-center gap-2">
                  <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full", done ? "bg-emerald-500 text-white" : "bg-canvas text-subtle")}>
                    {skipped ? <MinusCircle className="size-4" /> : done ? <Check className="size-4" /> : <CircleDashed className="size-4" />}
                  </span>
                  <span className="text-sm font-semibold text-ink">{milestoneLabels[milestone]}</span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {skipped ? "Skipped: the country cannot text" : time ? formatDateTime(time) : milestone === data.stuck_at ? "Not yet" : "—"}
                </p>
                {time ? <p className="text-xs text-muted">{index === 0 ? "first step" : `+${duration(new Date(time).getTime() - new Date(previousTime ?? data.started_at).getTime())}`}</p> : null}
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Every step" description={`${data.events.length} steps, ${data.refusals} refused, oldest first.`} />
          <ol className="relative grid gap-0 px-5 pt-4 pb-6 sm:px-6" aria-label="Steps">
            {data.events.map((event, index) => {
              const previous = index > 0 ? data.events[index - 1]! : null;
              const ok = event.outcome === "ok";
              return (
                <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < data.events.length - 1 ? <span aria-hidden className="absolute top-7 left-3 h-[calc(100%-1.25rem)] w-px bg-line" /> : null}
                  <span aria-hidden className={cn("relative grid size-6 shrink-0 place-items-center rounded-full", ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                    {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {stepLabel(event.step)}
                      <span className="sr-only">{ok ? ": went through" : ": refused"}</span>
                    </p>
                    {!ok ? (
                      <p className="text-sm text-red-700">
                        {codeLabel(event.code)}
                        {event.param ? <span className="text-muted"> · field {event.param}</span> : null}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted">
                      {formatDateTime(event.at)}
                      {previous ? ` · ${duration(new Date(event.at).getTime() - new Date(previous.at).getTime())} after the last` : ` · ${duration(new Date(event.at).getTime() - started)} in`}
                      {event.device ? ` · ${event.device}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card>
          <CardHeader title="About this journey" />
          <div className="px-5 pt-3 pb-6 sm:px-6">
            <KeyValue
              items={[
                { label: "Sign-up", value: surfaceLabels[data.surface] },
                { label: "Country", value: data.country ?? "Not chosen yet" },
                { label: "Device", value: data.device ?? "—" },
                { label: "Steps", value: `${data.steps}${data.refusals ? ` (${data.refusals} refused)` : ""}` },
                { label: "Last step", value: formatDateTime(data.last_event_at) },
                {
                  label: "Account",
                  value: data.account ? data.account.kind === "customer" ? <AppLink href={`/customers/${data.account.id}`} className="font-semibold text-brand-600 hover:underline">Open the account</AppLink> : "A Seller HQ account" : "None yet",
                },
                { label: "Deleted on", value: formatDateTime(data.deletes_at) },
              ]}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
