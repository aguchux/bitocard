"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, errorMessage, formatDateTime, Notice, Skeleton } from "@bitocard/admin-ui";
import { type AdminScoreKey, useSellerScoresActionMutation, useSellerScoresQuery } from "@bitocard/api-client/admin";

export const scoreLabels: Record<AdminScoreKey, string> = {
  response: "Reply time",
  attention: "Answering buyers",
  pricing: "Keeping to prices",
  costing: "Prices against the market",
  reliability: "Completing sales",
  satisfaction: "Reviews",
  salesmanship: "Private ratings (never public)",
};
export const bandNames: Record<string, string> = { excellent: "Excellent", very_good: "Very good", good: "Good", fair: "Fair", needs_work: "Needs work" };

type Pending = "recompute" | "regenerate" | "hide" | "unhide";

/**
 * Anjio's scores on a seller's admin page: every metric with its sample and minimum, the band, what the public sees,
 * the seller's tips, admins' flags, and the summary with its model and cost. Operations Recompute now, and hide, unhide
 * or write the summary again.
 */
export function SellerScoresCard({ sellerId, operations }: { sellerId: string; operations: boolean }) {
  const scores = useSellerScoresQuery(sellerId);
  const [act, acting] = useSellerScoresActionMutation();
  const [pending, setPending] = useState<Pending | null>(null);
  const data = scores.data;
  const words: Record<Pending, { title: string; description: string; label: string; reason: boolean }> = {
    recompute: { title: "Work their scores out now?", description: "From what is on Udozo now, instead of waiting for tonight.", label: "Recompute", reason: false },
    regenerate: { title: "Have Anjio write the summary again?", description: "From their current figures, within the assistant's daily cap and budget. It is checked before it is kept.", label: "Write it again", reason: false },
    hide: { title: "Hide Anjio's summary?", description: "It no longer shows to buyers or the seller, and is not written again until you unhide it.", label: "Hide summary", reason: true },
    unhide: { title: "Show the summary again?", description: "Buyers and the seller see it again where summaries are on.", label: "Unhide", reason: true },
  };
  return (
    <Card>
      <CardHeader title="Anjio's scores" description={data?.computed_at ? `Worked out ${formatDateTime(data.computed_at)}.` : "Not worked out yet: the nightly job scores sellers with live listings."} />
      <div className="space-y-3 px-5 pb-5 text-sm sm:px-6">
        {!data ? (
          scores.error ? <Notice tone="red">{errorMessage(scores.error)}</Notice> : <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <p className="font-semibold text-ink">{data.overall === null ? "Not enough to rate yet" : `${bandNames[data.band ?? ""] ?? data.band} (${data.overall} of 100)`}</p>
            <ul className="grid gap-1">
              {data.metrics.map(metric => (
                <li key={metric.key} className="flex justify-between gap-2">
                  <span className="text-muted">{scoreLabels[metric.key]}</span>
                  <span>{metric.score === null ? `— (${metric.n} of ${metric.minimum})` : `${metric.score} (${metric.n})`}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              Buyers see: {[data.public_view.response, data.public_view.attention, data.public_view.band_label ? `${data.public_view.band_label} seller` : null, ...data.public_view.highlights.map(item => item.words)].filter(Boolean).join(" · ") || (data.public_view.new_seller ? "New seller: not enough to rate yet" : "nothing yet")}
            </p>
            {data.flags.length ? (
              <div className="grid gap-1">
                {data.flags.map(flag => (
                  <Badge key={flag} tone="amber">
                    {flag}
                  </Badge>
                ))}
              </div>
            ) : null}
            {data.tips.length ? <p className="text-xs text-muted">Their tips: {data.tips.join(" ")}</p> : null}
            {data.summary ? (
              <div className="grid gap-1 rounded-xl border border-line p-3">
                <span className="flex flex-wrap gap-1.5">
                  {data.summary.hidden ? <Badge tone="grey">Hidden</Badge> : <Badge tone="green">Showing where summaries are on</Badge>}
                  {data.summary.reported ? <Badge tone="amber">Reported by the seller</Badge> : null}
                </span>
                <p className="text-ink">{data.summary.text}</p>
                {data.summary.reported?.details ? <p className="text-xs text-muted">They said: {data.summary.reported.details}</p> : null}
                {data.summary.hidden?.reason ? <p className="text-xs text-muted">Hidden because: {data.summary.hidden.reason}</p> : null}
                <p className="text-xs text-muted">
                  {data.summary.model ?? "Unknown model"} · {data.summary.cost_usd === null ? "—" : `US$${data.summary.cost_usd.toFixed(4)}`}
                  {data.summary.written_at ? ` · ${formatDateTime(data.summary.written_at)}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted">No summary written.</p>
            )}
            {operations ? (
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPending("recompute")}>
                  Recompute
                </Button>
                {data.overall !== null ? (
                  <Button size="sm" variant="ghost" onClick={() => setPending("regenerate")}>
                    Write the summary again
                  </Button>
                ) : null}
                {data.summary ? (
                  <Button size="sm" variant="ghost" onClick={() => setPending(data.summary?.hidden ? "unhide" : "hide")}>
                    {data.summary.hidden ? "Unhide summary" : "Hide summary"}
                  </Button>
                ) : null}
              </span>
            ) : null}
          </>
        )}
      </div>
      {pending ? (
        <ActionDialog
          open
          onClose={() => setPending(null)}
          title={words[pending].title}
          description={words[pending].description}
          confirmLabel={words[pending].label}
          tone={pending === "hide" ? "danger" : "primary"}
          requireReason={words[pending].reason}
          onConfirm={reason => act({ id: sellerId, action: pending, ...(words[pending].reason ? { reason } : {}) }).unwrap()}
        />
      ) : null}
      {acting.isLoading ? <span className="sr-only">Working…</span> : null}
    </Card>
  );
}
