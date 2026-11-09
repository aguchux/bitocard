"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, formatDateTime, KeyValue, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { udozoOrigin } from "@/components/theme";
import { type AdminReviewAction, type AdminReviewDetail, useDecideReviewReportMutation, useModerateReviewMutation, useRemoveReviewPostMutation, useReviewQuery } from "@bitocard/api-client/admin";
import { aspectLabels, heldReasonLabels, RatingBadge, reportReasonLabels, ReviewStatusBadge, roleLabels, sourceLabels, stanceLabels } from "@/components/reviews";

type Pending = { kind: "review"; action: AdminReviewAction } | { kind: "post"; postId: string } | { kind: "report"; reportId: string; decision: "upheld" | "dismissed" };

const actionWords: Record<AdminReviewAction, { title: string; description: string; label: string; danger: boolean }> = {
  publish: { title: "Publish this review?", description: "It shows on the seller's page and counts in their reviews. The seller is told.", label: "Publish", danger: false },
  remove: { title: "Remove this review?", description: "It no longer shows or counts. The reviewer is told, with your reason.", label: "Remove review", danger: true },
  restore: { title: "Restore this review?", description: "It shows and counts again. The reviewer is told.", label: "Restore", danger: false },
  lock: { title: "Close the conversation?", description: "Nobody can write in it any more. The review still shows.", label: "Close it", danger: true },
  unlock: { title: "Open the conversation again?", description: "The seller, the reviewer and buyers of the same item can write again.", label: "Open it", danger: false },
};

const ratingWord = (rating: string) => (rating === "positive" ? "Positive" : rating === "negative" ? "Negative" : "Neutral");

/** One review: the review, its earlier versions, the purchase behind it, the conversation and the reports. */
export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const review = useReviewQuery(id);
  return (
    <UdozoShell section="marketplace" current="/classifieds/reviews" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Reviews", href: "/classifieds/reviews" }, { label: review.data?.product.label ?? "Review" }]}>
      <QueryView query={review} loading={<Skeleton className="h-96 w-full" />}>
        {data => <Detail review={data} />}
      </QueryView>
    </UdozoShell>
  );
}

function Detail({ review }: { review: AdminReviewDetail }) {
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const [moderate] = useModerateReviewMutation();
  const [removePost] = useRemoveReviewPostMutation();
  const [decide] = useDecideReviewReportMutation();
  const [pending, setPending] = useState<Pending | null>(null);
  const actions: AdminReviewAction[] = [
    ...(review.status === "held" ? (["publish"] as const) : []),
    ...(review.status === "published" || review.status === "held" ? (["remove"] as const) : []),
    ...(review.status === "removed" ? (["restore"] as const) : []),
    ...(review.status === "published" || review.status === "held" ? [review.locked ? ("unlock" as const) : ("lock" as const)] : []),
  ];
  const aspects = Object.entries(review.aspects);
  const confirm = (reason: string) => {
    if (!pending) return Promise.resolve();
    if (pending.kind === "review") return moderate({ id: review.id, action: pending.action, reason }).unwrap();
    if (pending.kind === "post") return removePost({ reviewId: review.id, postId: pending.postId, reason }).unwrap();
    return decide({ reviewId: review.id, reportId: pending.reportId, decision: pending.decision, note: reason }).unwrap();
  };
  const dialog = pending
    ? pending.kind === "review"
      ? { ...actionWords[pending.action], confirmLabel: actionWords[pending.action].label }
      : pending.kind === "post"
        ? { title: "Remove this reply?", description: "It shows as removed by Udozo in the conversation.", confirmLabel: "Remove reply", danger: true }
        : { title: pending.decision === "upheld" ? "Uphold this report?" : "Dismiss this report?", description: "Your note is kept with the report. Removing the review or a reply is a separate step.", confirmLabel: pending.decision === "upheld" ? "Uphold" : "Dismiss", danger: false }
    : null;

  return (
    <>
      <PageHeader
        title={review.product.label}
        description={`${sourceLabels[review.source] ?? review.source} · ${review.country} · written ${formatDateTime(review.created_at)}`}
        actions={
          <span className="flex flex-wrap gap-2">
            <RatingBadge rating={review.rating} />
            <ReviewStatusBadge status={review.status} />
          </span>
        }
      />
      {operations && actions.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map(action => (
            <Button key={action} size="sm" variant={actionWords[action].danger ? "secondary" : "primary"} onClick={() => setPending({ kind: "review", action })}>
              {actionWords[action].label}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="The review" />
            <div className="grid gap-3 px-5 pb-5 text-sm sm:px-6">
              {aspects.length ? (
                <span className="flex flex-wrap gap-1.5">
                  {aspects.map(([key, value]) => (
                    <Badge key={key} tone={value === "up" ? "green" : "red"}>{`${aspectLabels[key] ?? key}: ${value === "up" ? "good" : "not good"}`}</Badge>
                  ))}
                </span>
              ) : null}
              <p className="whitespace-pre-wrap break-words text-ink">{review.body ?? "No words."}</p>
              <KeyValue
                items={[
                  { label: "Held because", value: review.held_reason ? (heldReasonLabels[review.held_reason] ?? review.held_reason) : "—" },
                  { label: "Removed because", value: review.removed_reason ?? "—" },
                  { label: "Changed", value: review.edits ? `${review.edits} time${review.edits === 1 ? "" : "s"}${review.edited_after_reply ? ", after the seller replied" : ""}` : "Never" },
                  { label: "Conversation", value: review.locked ? "Closed" : "Open" },
                ]}
              />
            </div>
          </Card>
          {review.versions.length ? (
            <Card>
              <CardHeader title="Earlier versions" description="Oldest first: what it said before each change." />
              <ol className="grid gap-3 px-5 pb-5 text-sm sm:px-6">
                {review.versions.map((version, index) => (
                  <li key={`${version.at}:${index}`} className="rounded-xl border border-line p-3">
                    <span className="block text-xs text-muted">
                      {ratingWord(version.rating)} · until {formatDateTime(version.at)}
                    </span>
                    <span className="block whitespace-pre-wrap break-words text-ink">{version.body ?? "No words."}</span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Conversation" description="Every reply, including those removed or deleted by their author." />
            <div className="px-5 pb-5 sm:px-6">
              {review.posts.length ? (
                <ol className="space-y-3">
                  {review.posts.map(post => (
                    <li key={post.id} className="rounded-xl border border-line p-3 text-sm">
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <strong className="text-ink">{post.author.name}</strong>
                        <span>
                          {roleLabels[post.role] ?? post.role}
                          {post.stance ? `, ${stanceLabels[post.stance]}` : ""}
                        </span>
                        <span>{formatDateTime(post.created_at)}</span>
                        {post.status !== "published" ? <Badge tone={post.status === "removed" ? "red" : "grey"}>{post.status === "removed" ? "Removed" : "Deleted by its author"}</Badge> : null}
                      </span>
                      <span className="mt-1 block whitespace-pre-wrap break-words text-ink">{post.body}</span>
                      {post.removed_reason ? <span className="mt-1 block text-xs text-muted">Removed because: {post.removed_reason}</span> : null}
                      {operations && post.status === "published" ? (
                        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setPending({ kind: "post", postId: post.id })}>
                          Remove reply
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">No replies.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Reports" />
            <div className="px-5 pb-5 sm:px-6">
              {review.reports.length ? (
                <ol className="space-y-3">
                  {review.reports.map(report => (
                    <li key={report.id} className="rounded-xl border border-line p-3 text-sm">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={report.reason === "threat_or_extortion" ? "red" : "amber"}>{reportReasonLabels[report.reason] ?? report.reason}</Badge>
                        <Badge tone={report.status === "open" ? "blue" : "grey"}>{report.status === "open" ? "Open" : report.status === "upheld" ? "Upheld" : "Dismissed"}</Badge>
                        {report.post_id ? <span className="text-xs text-muted">About a reply</span> : null}
                      </span>
                      <span className="mt-1 block break-words text-ink">{report.details ?? "No details."}</span>
                      <span className="block text-xs text-muted">
                        By {report.reporter.name} ({report.reporter.email}) · {formatDateTime(report.created_at)}
                      </span>
                      {report.note ? <span className="block text-xs text-muted">Note: {report.note}</span> : null}
                      {operations && report.status === "open" ? (
                        <span className="mt-2 flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setPending({ kind: "report", reportId: report.id, decision: "upheld" })}>
                            Uphold
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "report", reportId: report.id, decision: "dismissed" })}>
                            Dismiss
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">Nobody has reported it.</p>
              )}
            </div>
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="The purchase" />
            <div className="grid gap-2 px-5 pb-5 text-sm sm:px-6">
              <span>Completed {formatDateTime(review.purchase.completed_at)}</span>
              {review.purchase.order ? (
                <AppLink href={`/classifieds/orders/${review.purchase.order.id}`} className="w-fit font-semibold text-brand-600 hover:underline">
                  UdozoPay order {review.purchase.order.number}
                </AppLink>
              ) : null}
              {review.purchase.buy_order ? (
                <AppLink href={`/classifieds/buy-orders/${review.purchase.buy_order.id}`} className="w-fit font-semibold text-brand-600 hover:underline">
                  Buy order {review.purchase.buy_order.number}
                </AppLink>
              ) : null}
              <span className="break-words font-semibold text-ink">{review.listing.title ?? "The ad"}</span>
              <AppLink href={`/classifieds/listings/${review.listing.id}`} className="w-fit font-semibold text-brand-600 hover:underline">
                Open the ad here
              </AppLink>
              <a href={`${udozoOrigin()}${review.listing.path}`} target="_blank" rel="noopener" className="w-fit font-semibold text-brand-600 hover:underline">
                Open it on udozo.com
              </a>
            </div>
          </Card>
          <Person title="Reviewer" person={review.reviewer} />
          <Person title="Seller" person={review.seller} />
        </div>
      </div>
      {pending && dialog ? <ActionDialog open onClose={() => setPending(null)} title={dialog.title} description={dialog.description} confirmLabel={dialog.confirmLabel} tone={dialog.danger ? "danger" : "primary"} onConfirm={reason => confirm(reason)} /> : null}
    </>
  );
}

function Person({ title, person }: { title: string; person: { id: string; name: string } }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="grid gap-1 px-5 pb-5 text-sm sm:px-6">
        <span className="break-words font-semibold text-ink">{person.name}</span>
        <AppLink href={`/classifieds/sellers/${person.id}`} className="mt-1 w-fit font-semibold text-brand-600 hover:underline">
          Open their marketplace page
        </AppLink>
      </div>
    </Card>
  );
}
