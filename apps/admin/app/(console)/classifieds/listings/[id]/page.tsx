"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, formatDateTime, formatNumber, KeyValue, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedListing, useClassifiedListingQuery, useModerateClassifiedListingMutation } from "@bitocard/api-client/admin";
import { flagLabels, ListingStatus, listingPrice, reportReasonLabels } from "@/components/classifieds";

type Action = "approve" | "reject" | "remove";

const conditionLabels: Record<string, string> = { new: "New", used: "Used", untested: "Untested", parts: "For parts" };
const deliveryLabels: Record<string, string> = { none: "Pick-up only", state: "Delivers in the state", nationwide: "Delivers nationwide" };
const contactLabels: Record<string, string> = { chat: "Chat only", phone: "Calls only", both: "Chat and calls" };

/** One ad as moderators see it: photos and video, every detail, its seller and open reports, and the decisions. */
export default function ClassifiedListingPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const listing = useClassifiedListingQuery(id);
  const [moderate] = useModerateClassifiedListingMutation();
  const [action, setAction] = useState<Action | null>(null);
  const decides = can(admin, "operations");

  return (
    <AdminShell
      section="classifieds"
      current="/classifieds/listings"
      crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Listings", href: "/classifieds/listings" }, { label: listing.data ? `#${listing.data.ref}` : "Ad" }]}
    >
      <QueryView query={listing} loading={<Skeleton className="h-96 w-full" />}>
        {data => (
          <>
            <PageHeader
              title={data.title ?? "Untitled draft"}
              description={`#${data.ref} · ${data.country}`}
              actions={
                decides ? (
                  <span className="flex flex-wrap gap-2">
                    {data.status === "pending_review" ? (
                      <>
                        <Button onClick={() => setAction("approve")}>Approve</Button>
                        <Button variant="secondary" onClick={() => setAction("reject")}>
                          Send back
                        </Button>
                      </>
                    ) : null}
                    {data.status !== "removed" && data.status !== "deleted" ? (
                      <Button variant="danger" onClick={() => setAction("remove")}>
                        Remove
                      </Button>
                    ) : null}
                  </span>
                ) : null
              }
            />
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Media listing={data} />
                <Card>
                  <CardHeader title="The ad" />
                  <div className="space-y-4 px-5 pb-5 sm:px-6">
                    <KeyValue
                      items={[
                        { label: "Status", value: <ListingStatus status={data.status} /> },
                        { label: "Price", value: listingPrice(data.price) },
                        { label: "Category", value: data.category ? `${data.category.parent ? `${data.category.parent.name} › ` : ""}${data.category.name}` : "—" },
                        { label: "Condition", value: data.condition ? conditionLabels[data.condition] : "—" },
                        { label: "Where", value: data.area ? `${data.area.name}${data.area.state ? `, ${data.area.state.name}` : ""}` : "—" },
                        { label: "Delivery", value: deliveryLabels[data.delivery] },
                        { label: "Contact", value: contactLabels[data.contact] },
                        { label: "Views and leads", value: `${formatNumber(data.views)} views · ${formatNumber(data.leads)} leads` },
                      ]}
                    />
                    {data.features.length ? (
                      <ul className="flex flex-wrap gap-2">
                        {data.features.map(feature => (
                          <li key={feature.key}>
                            <Badge tone="grey" dot={false}>
                              {feature.name}: {String(feature.value)}
                              {feature.unit ? ` ${feature.unit}` : ""}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {data.description ? <p className="whitespace-pre-line text-sm text-ink">{data.description}</p> : <p className="text-sm text-muted">No description.</p>}
                  </div>
                </Card>
              </div>
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Seller" />
                  <div className="space-y-2 px-5 pb-5 text-sm sm:px-6">
                    <AppLink href={`/classifieds/sellers/${data.seller.id}`} className="font-semibold text-brand-600 hover:underline">
                      {data.seller.name}
                    </AppLink>
                    <p className="text-muted">{data.seller.email}</p>
                    <p className="text-muted">
                      Member since {formatDateTime(data.seller.member_since)} · {data.seller.published_listings ?? 0} published ads · {data.seller.phone_confirmed ? "phone confirmed" : "no confirmed phone"}
                    </p>
                    {data.seller.suspended ? <Badge tone="red">Suspended</Badge> : null}
                  </div>
                </Card>
                {data.review_flags.length || data.review_reason ? (
                  <Card>
                    <CardHeader title="Why it was checked" />
                    <div className="space-y-2 px-5 pb-5 text-sm sm:px-6">
                      <div className="flex flex-wrap gap-2">
                        {data.review_flags.map(flag => (
                          <Badge key={flag} tone="amber">
                            {flagLabels[flag] ?? flag}
                          </Badge>
                        ))}
                      </div>
                      {data.review_reason ? <p className="text-muted">{data.review_reason}</p> : null}
                    </div>
                  </Card>
                ) : null}
                <Card>
                  <CardHeader title="Open reports" />
                  <div className="px-5 pb-5 text-sm sm:px-6">
                    {data.open_reports.length ? (
                      <ul className="space-y-2">
                        {data.open_reports.map(report => (
                          <li key={report.id}>
                            <span className="font-semibold">{reportReasonLabels[report.reason] ?? report.reason}</span>
                            {report.details ? `: ${report.details}` : ""}
                            <span className="block text-xs text-muted">{formatDateTime(report.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted">None.</p>
                    )}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Dates" />
                  <div className="px-5 pb-5 sm:px-6">
                    <KeyValue
                      items={[
                        { label: "Created", value: formatDateTime(data.created_at) },
                        { label: "Submitted", value: formatDateTime(data.submitted_at) },
                        { label: "Published", value: formatDateTime(data.published_at) },
                        { label: "Ends", value: formatDateTime(data.expires_at) },
                        { label: "Sold", value: formatDateTime(data.sold_at) },
                      ]}
                    />
                    {data.url ? (
                      <a href={data.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:underline">
                        Open on BitoCard Shop
                      </a>
                    ) : null}
                  </div>
                </Card>
              </div>
            </div>
            {action ? (
              <ActionDialog
                open
                onClose={() => setAction(null)}
                title={{ approve: "Put this ad live?", reject: "Send this ad back?", remove: "Remove this ad for good?" }[action]}
                description={
                  {
                    approve: "It goes on BitoCard Shop now and the seller is told.",
                    reject: "The seller sees your reason, fixes the ad and submits it again.",
                    remove: "It leaves BitoCard Shop and can never go live again. Open reports are closed with your reason, and the seller is told.",
                  }[action]
                }
                confirmLabel={{ approve: "Approve", reject: "Send back", remove: "Remove" }[action]}
                tone={action === "remove" ? "danger" : "primary"}
                requireReason={action !== "approve"}
                onConfirm={note => moderate({ id, action, note }).unwrap()}
              />
            ) : null}
          </>
        )}
      </QueryView>
    </AdminShell>
  );
}

function Media({ listing }: { listing: AdminClassifiedListing }) {
  if (!listing.photos.length && !listing.video) return null;
  return (
    <Card>
      <CardHeader title="Photos and video" description="Tap a photo to open it full size. The first is the cover." />
      <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 sm:px-6">
        {listing.photos.map(photo => (
          <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
            <img src={photo.url} alt="" className="aspect-square w-full rounded-lg border border-line object-cover" loading="lazy" />
          </a>
        ))}
        {listing.video ? (
          <div className="col-span-2 sm:col-span-3">
            {listing.video.status === "ready" && listing.video.url ? (
              <video src={listing.video.url} poster={listing.video.poster_url ?? undefined} controls preload="metadata" className="max-h-96 w-full rounded-lg border border-line bg-black" />
            ) : (
              <p className="text-sm text-muted">Video: {listing.video.status}{listing.video.failure_reason ? ` (${listing.video.failure_reason})` : ""}</p>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
