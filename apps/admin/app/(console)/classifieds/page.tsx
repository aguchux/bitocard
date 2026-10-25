"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, errorMessage, formatNumber, formatRelative, PageHeader, StatCard, Tabs, type Column } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedListing, type ClassifiedQueueView, useClassifiedQueueQuery, useModerateClassifiedListingMutation } from "@bitocard/api-client/admin";
import { CheckCircle2, Clock, Inbox, XCircle } from "lucide-react";
import { flagLabels, ListingCell, listingPrice, MarketFilter } from "@/components/classifieds";

type Decision = { listing: AdminClassifiedListing; action: "approve" | "reject" | "remove" };

const dialogs = {
  approve: { title: "Put this ad live?", confirm: "Approve", tone: "primary", description: "It goes on BitoCard Shop now and the seller is told. Open reports on it are dismissed with your note." },
  reject: { title: "Ask for changes?", confirm: "Ask for changes", tone: "primary", description: "The seller sees what to fix, changes the ad and submits it again." },
  remove: { title: "Reject this ad for good?", confirm: "Reject", tone: "danger", description: "For banned goods or scams: it leaves BitoCard Shop, can never go live again, and the seller is told why." },
} as const;

const views: Array<{ value: ClassifiedQueueView; label: string }> = [
  { value: "all", label: "All" },
  { value: "new_sellers", label: "New sellers" },
  { value: "flagged", label: "Flagged" },
  { value: "reported", label: "Reported" },
];

const badFlags = new Set(["reported", "photo_reused", "price_low"]);

/**
 * BitoCard Shop > Moderation queue: ads waiting for a person (a new seller's first ads, doubtful words, a price far
 * below the usual, another seller's photo, posting fast, or reported by three customers), oldest first, with the
 * queue's size and today's decisions. Support reads; operations decide. Every decision is audited and the seller told.
 */
export default function ClassifiedQueuePage() {
  const admin = useAdmin();
  const [country, setCountry] = useState("NG");
  const [view, setView] = useState<ClassifiedQueueView>("all");
  const queue = useClassifiedQueueQuery({ country: country || undefined, view });
  const [moderate] = useModerateClassifiedListingMutation();
  const [open, setOpen] = useState<Decision | null>(null);
  const decides = can(admin, "operations");
  const stats = queue.data?.stats;

  const columns: Array<Column<AdminClassifiedListing>> = [
    {
      key: "listing",
      header: "Listing",
      cell: item => (
        <span className="block min-w-0">
          <ListingCell listing={item} />
          <span className="mt-1 block text-xs text-muted">
            {listingPrice(item.price)} · {item.category?.name ?? "No category"}
          </span>
        </span>
      ),
    },
    {
      key: "seller",
      header: "Seller",
      hideOnMobile: true,
      cell: item => (
        <AppLink href={`/classifieds/sellers/${item.seller.id}`} className="block min-w-0 hover:underline">
          <span className="block font-semibold text-ink">{item.seller.name}</span>
          <span className="block text-xs text-muted">
            Joined {formatRelative(item.seller.member_since)} · {item.seller.published_listings ? `${item.seller.published_listings} ads before` : "first ad"}
            {item.seller.phone_confirmed ? "" : " · no phone"}
          </span>
        </AppLink>
      ),
    },
    {
      key: "why",
      header: "Why it is here",
      cell: item => (
        <span className="flex max-w-72 flex-wrap gap-1">
          {item.review_flags.map(flag => (
            <Badge key={flag} tone={badFlags.has(flag) ? "red" : flag === "first_listings" ? "blue" : "amber"}>
              {flagLabels[flag] ?? flag}
            </Badge>
          ))}
          {!item.review_flags.length && item.review_reason ? <span className="text-xs text-muted">{item.review_reason}</span> : null}
          {item.open_reports.length ? <span className="w-full text-xs text-red-700">{item.open_reports.length} open reports</span> : null}
        </span>
      ),
    },
    { key: "waiting", header: "Waiting", hideOnMobile: true, cell: item => <span className="whitespace-nowrap text-sm text-muted">{formatRelative(item.submitted_at)}</span> },
    {
      key: "decide",
      header: "Decide",
      align: "right",
      cell: item =>
        decides ? (
          <span className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen({ listing: item, action: "reject" })}>
              Ask for changes
            </Button>
            <Button size="sm" variant="danger" onClick={() => setOpen({ listing: item, action: "remove" })}>
              Reject
            </Button>
            <Button size="sm" onClick={() => setOpen({ listing: item, action: "approve" })}>
              Approve
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <AdminShell section="classifieds" current="/classifieds" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Moderation queue" }]}>
      <PageHeader
        title="Moderation queue"
        description="Oldest first: new sellers' first listings and anything the checks flagged or customers reported. Open an ad to see every photo before deciding."
        actions={<MarketFilter id="queue-market" value={country} onChange={setCountry} />}
      />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Waiting" value={stats ? formatNumber(stats.waiting) : "—"} icon={<Inbox className="size-5" />} loading={!stats} />
        <StatCard label="Oldest" value={stats?.oldest_submitted_at ? formatRelative(stats.oldest_submitted_at) : "—"} icon={<Clock className="size-5" />} tone="amber" loading={!stats} />
        <StatCard label="Approved today" value={stats ? formatNumber(stats.approved_today) : "—"} icon={<CheckCircle2 className="size-5" />} tone="green" loading={!stats} />
        <StatCard
          label="Rejected today"
          value={stats ? formatNumber(stats.sent_back_today + stats.removed_today) : "—"}
          icon={<XCircle className="size-5" />}
          tone="violet"
          footer={stats ? `${stats.sent_back_today} asked for changes, ${stats.removed_today} rejected` : undefined}
          loading={!stats}
        />
      </div>
      <div className="mt-6">
        <Tabs label="Why ads are here" variant="pills" value={view} onChange={setView} items={views} />
      </div>
      <Card className="mt-4">
        <DataTable
          columns={columns}
          rows={queue.data?.data}
          rowKey={item => item.id}
          loading={queue.isLoading}
          error={queue.error ? errorMessage(queue.error) : null}
          onRetry={queue.refetch}
          empty="Nothing waiting here."
        />
      </Card>
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
