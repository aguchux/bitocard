"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, EmptyState, formatDateTime, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedListing, useClassifiedQueueQuery, useModerateClassifiedListingMutation } from "@bitocard/api-client/admin";
import { flagLabels, listingPrice, MarketFilter, reportReasonLabels } from "@/components/classifieds";

type Decision = { listing: AdminClassifiedListing; action: "approve" | "reject" | "remove" };

const dialogs = {
  approve: { title: "Put this ad live?", confirm: "Approve", tone: "primary", description: "It goes on BitoCard Shop now and the seller is told. Open reports on it are dismissed with your note." },
  reject: { title: "Send this ad back?", confirm: "Send back", tone: "primary", description: "The seller sees your reason, fixes the ad and submits it again." },
  remove: { title: "Remove this ad for good?", confirm: "Remove", tone: "danger", description: "For banned goods or scams: it can never go live again, and the seller is told why." },
} as const;

/**
 * BitoCard Shop > Review queue: ads waiting for a moderator (a new seller's first ads, doubtful words, a price far
 * below the usual, another seller's photo, posting fast, or reported by three customers), oldest first. Support
 * reads; operations decide. Every decision is audited and the seller is told.
 */
export default function ClassifiedQueuePage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("");
  const queue = useClassifiedQueueQuery(country ? { country } : undefined);
  const [moderate] = useModerateClassifiedListingMutation();
  const [open, setOpen] = useState<Decision | null>(null);
  const decides = can(admin, "operations");

  return (
    <AdminShell section="classifieds" current="/classifieds" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Review queue" }]}>
      <PageHeader title="Review queue" description="Ads waiting for a person before they go live, oldest first. Check the photos, the price and the words; approve, send back with what to fix, or remove scams and banned goods." />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketFilter id="queue-market" value={country} onChange={setCountry} />
      </div>
      <div className="mt-4">
        <QueryView query={queue} loading={<Skeleton className="h-64 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="space-y-4">
                {data.data.map(listing => (
                  <li key={listing.id}>
                    <QueueCard listing={listing} decides={decides} onDecide={action => setOpen({ listing, action })} />
                  </li>
                ))}
              </ul>
            ) : (
              <Card>
                <EmptyState title="Nothing to review">New ads that need a person show up here.</EmptyState>
              </Card>
            )
          }
        </QueryView>
      </div>
      {open ? (
        <ActionDialog
          open
          onClose={() => setOpen(null)}
          title={dialogs[open.action].title}
          description={dialogs[open.action].description}
          confirmLabel={dialogs[open.action].confirm}
          tone={dialogs[open.action].tone}
          requireReason={open.action !== "approve"}
          onConfirm={note => moderate({ id: open.listing.id, action: open.action, note }).unwrap()}
        />
      ) : null}
    </AdminShell>
  );
}

function QueueCard({ listing, decides, onDecide }: { listing: AdminClassifiedListing; decides: boolean; onDecide: (action: Decision["action"]) => void }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex gap-2 overflow-x-auto lg:w-80 lg:shrink-0 lg:flex-wrap">
          {listing.photos.slice(0, 6).map(photo => (
            <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="shrink-0">
              <img src={photo.url} alt="" className="size-24 rounded-lg border border-line object-cover" loading="lazy" />
            </a>
          ))}
          {listing.video ? <Badge tone="blue">Video {listing.video.status === "ready" ? "" : `(${listing.video.status})`}</Badge> : null}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <AppLink href={`/classifieds/listings/${listing.id}`} className="text-lg font-semibold text-ink hover:underline">
                {listing.title ?? "Untitled"}
              </AppLink>
              <p className="text-sm text-muted">
                #{listing.ref} · {listing.category ? `${listing.category.parent?.name ?? ""}${listing.category.parent ? " › " : ""}${listing.category.name}` : "No category"} · {listing.area?.name ?? "—"}
                {listing.area?.state ? `, ${listing.area.state.name}` : ""} · submitted {formatDateTime(listing.submitted_at)}
              </p>
            </div>
            <p className="text-lg font-semibold text-ink">{listingPrice(listing.price)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {listing.review_flags.map(flag => (
              <Badge key={flag} tone={flag === "reported" || flag === "photo_reused" ? "red" : "amber"}>
                {flagLabels[flag] ?? flag}
              </Badge>
            ))}
          </div>
          {listing.description ? <p className="line-clamp-4 whitespace-pre-line text-sm text-ink">{listing.description}</p> : null}
          <p className="text-sm text-muted">
            Seller:{" "}
            <AppLink href={`/classifieds/sellers/${listing.seller.id}`} className="font-medium text-brand-600 hover:underline">
              {listing.seller.name}
            </AppLink>{" "}
            ({listing.seller.email}) · member since {formatDateTime(listing.seller.member_since)} · {listing.seller.published_listings ?? 0} ads before
            {listing.seller.phone_confirmed ? " · phone confirmed" : " · no phone"}
            {listing.seller.suspended ? " · suspended" : ""}
          </p>
          {listing.open_reports.length ? (
            <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              {listing.open_reports.map(report => (
                <li key={report.id}>
                  <span className="font-semibold">{reportReasonLabels[report.reason] ?? report.reason}</span>
                  {report.details ? `: ${report.details}` : ""} <span className="text-xs">({formatDateTime(report.created_at)})</span>
                </li>
              ))}
            </ul>
          ) : null}
          {decides ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => onDecide("approve")}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onDecide("reject")}>
                Send back
              </Button>
              <Button size="sm" variant="danger" onClick={() => onDecide("remove")}>
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {listing.review_reason && !listing.review_flags.length ? <p className="mt-3 text-xs text-muted">Why: {listing.review_reason}</p> : null}
    </Card>
  );
}
