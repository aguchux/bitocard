"use client";

import { useParams } from "next/navigation";
import { Check, CircleDashed, X } from "lucide-react";
import { Badge, Card, CardHeader, cn, formatDateTime, KeyValue, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type PostingJourneyDetail, usePostingJourneyQuery } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";
import { duration } from "@/components/signups";
import { codeLabel, originLabel, paramLabel, reviewCodeLabel, sourceLabel, statusLabels, statusTones, stepLabel, stuckLabels } from "@/components/postings";

type MilestoneKey = keyof PostingJourneyDetail["milestones"];
const strip: Array<{ key: MilestoneKey; label: string }> = [
  { key: "opened", label: "Opened Post an ad" },
  { key: "draft", label: "Draft saved" },
  { key: "first_photo", label: "First photo" },
  { key: "submitted", label: "Posted" },
  { key: "review_queued", label: "Sent to review" },
  { key: "reviewed", label: "Reviewed" },
  { key: "live", label: "Live" },
  { key: "first_view", label: "First view" },
  { key: "first_chat", label: "First chat" },
  { key: "first_call", label: "First call" },
  { key: "first_lead", label: "First lead" },
  { key: "sold", label: "Sold" },
];

/**
 * One ad's posting journey: its milestones across the top (each with when it was reached and how long after the
 * journey started), then every step in order with who told it (the form, posting or Udozo) and why one was refused.
 * Opening it is recorded in the activity log.
 */
export default function PostingJourneyPage() {
  const { id } = useParams<{ id: string }>();
  const journey = usePostingJourneyQuery(id);
  return (
    <UdozoShell section="reports" current="/reports/postings" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Posting journeys", href: "/reports/postings" }, { label: journey.data?.listing?.title ?? journey.data?.seller.name ?? "Journey" }]}>
      <QueryView query={journey} loading={<Card className="p-5"><Skeleton className="h-64 w-full" /></Card>}>
        {data => <Journey data={data} />}
      </QueryView>
    </UdozoShell>
  );
}

function Journey({ data }: { data: PostingJourneyDetail }) {
  const started = new Date(data.started_at).getTime();
  const shown = strip.filter(item => item.key !== "review_queued" || data.milestones.review_queued || !data.milestones.live || data.live_via === "review").filter(item => item.key !== "reviewed" || data.milestones.review_queued);
  return (
    <>
      <PageHeader
        title={data.listing?.title ?? (data.listing ? "Untitled draft" : "No draft yet")}
        description={`${data.seller.name} · from ${sourceLabel(data.source).toLowerCase()} · started ${formatDateTime(data.started_at)}`}
        actions={<Badge tone={statusTones[data.status]}>{statusLabels[data.status]}</Badge>}
      />

      {data.stuck_at ? (
        <div role="status" className={cn("rounded-2xl p-4 text-sm", data.status === "in_progress" ? "bg-blue-50 text-blue-900" : "bg-amber-50 text-amber-900")}>
          <p className="font-semibold">{data.status === "in_progress" ? `Now: ${stuckLabels[data.stuck_at].toLowerCase()}` : `Stuck: ${stuckLabels[data.stuck_at].toLowerCase()}`}</p>
          {data.last_reject_code && data.status === "sent_back" ? <p className="mt-1">Sent back because: {reviewCodeLabel(data.last_reject_code)}.</p> : null}
          {data.last_error ? <p className="mt-1">Last refused because: {codeLabel(data.last_error.code)} ({stepLabel(data.last_error.step).toLowerCase()}).</p> : null}
        </div>
      ) : null}

      <Card>
        <CardHeader title="Milestones" description="Each one is kept from the first time it was reached." />
        <ol className="grid gap-3 px-5 pt-4 pb-6 sm:grid-cols-3 sm:px-6 xl:grid-cols-6" aria-label="Milestones">
          {shown.map(item => {
            const time = data.milestones[item.key];
            return (
              <li key={item.key} className={cn("rounded-xl border p-3", time ? "border-emerald-200 bg-emerald-50/60" : "border-line")}>
                <div className="flex items-center gap-2">
                  <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full", time ? "bg-emerald-500 text-white" : "bg-canvas text-subtle")}>
                    {time ? <Check className="size-4" /> : <CircleDashed className="size-4" />}
                  </span>
                  <span className="text-sm font-semibold text-ink">{item.label}</span>
                </div>
                <p className="mt-2 text-xs text-muted">{time ? formatDateTime(time) : "Not yet"}</p>
                {time ? <p className="text-xs text-muted">+{duration(Math.max(0, new Date(time).getTime() - started))}</p> : null}
              </li>
            );
          })}
        </ol>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Every step" description={`${data.events.length} steps, ${data.refusals} refused, oldest first. Never what the seller typed.`} />
          <ol className="relative grid gap-0 px-5 pt-4 pb-6 sm:px-6" aria-label="Steps">
            {data.events.map((event, index) => {
              const previous = index > 0 ? data.events[index - 1]! : null;
              const ok = event.outcome === "ok";
              const decision = event.origin === "system" && event.code && ["sent_back", "removed"].includes(event.step);
              return (
                <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < data.events.length - 1 ? <span aria-hidden className="absolute top-7 left-3 h-[calc(100%-1.25rem)] w-px bg-line" /> : null}
                  <span aria-hidden className={cn("relative grid size-6 shrink-0 place-items-center rounded-full", ok ? (decision ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700") : "bg-red-100 text-red-700")}>
                    {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {stepLabel(event.step)}
                      <span className="font-normal text-muted"> · {originLabel(event.origin)}</span>
                      <span className="sr-only">{ok ? ": went through" : ": refused"}</span>
                    </p>
                    {!ok ? (
                      <p className="text-sm text-red-700">
                        {codeLabel(event.code)}
                        {paramLabel(event.param) ? <span className="text-muted"> · {paramLabel(event.param)}</span> : null}
                      </p>
                    ) : event.code ? (
                      <p className="text-sm text-muted">{decision ? reviewCodeLabel(event.code) : codeLabel(event.code)}</p>
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
                { label: "Seller", value: <AppLink href={`/classifieds/sellers/${data.seller.id}`} className="font-semibold text-brand-600 hover:underline">{data.seller.name}</AppLink> },
                { label: "Email", value: <span className="break-all">{data.seller.email}</span> },
                {
                  label: "Ad",
                  value: data.listing ? (
                    data.listing.status === "deleted" ? `${data.listing.sku ?? `#${data.listing.ref}`} (deleted)` : <AppLink href={`/classifieds/listings/${data.listing.id}`} className="font-semibold text-brand-600 hover:underline">{data.listing.sku ?? `#${data.listing.ref}`}</AppLink>
                  ) : "No draft yet",
                },
                { label: "Category", value: data.category?.name ?? "Not chosen yet" },
                { label: "Where Sell was pressed", value: sourceLabel(data.source) },
                { label: "Went live", value: data.live_via === "direct" ? "At once" : data.live_via === "review" ? "After a moderator" : "Not yet" },
                { label: "Reviews", value: data.reviews ? `${data.reviews}${data.sent_back_count ? ` (${data.sent_back_count} sent back)` : ""}` : "None" },
                ...(data.review_flags.length ? [{ label: "Sent to review because", value: data.review_flags.map(flag => codeLabel(flag)).join(", ") }] : []),
                ...(data.ended_reason ? [{ label: "Ended", value: { never_drafted: "Never saved a draft", draft_deleted: "Draft deleted", deleted: "Ad deleted", removed: `Removed: ${reviewCodeLabel(data.last_reject_code)}` }[data.ended_reason] }] : []),
                { label: "Device", value: data.device ?? "—" },
                { label: "Steps", value: `${data.steps}${data.refusals ? ` (${data.refusals} refused)` : ""}` },
                { label: "Last step", value: formatDateTime(data.last_event_at) },
                { label: "Deleted on", value: formatDateTime(data.deletes_at) },
              ]}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
