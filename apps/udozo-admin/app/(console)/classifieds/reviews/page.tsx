"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Button, Card, DataTable, errorMessage, formatDateTime, formatNumber, Notice, PageHeader, Tabs, type Column } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type AdminReviewListItem, type AdminReviewTab, useReviewsQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { RatingBadge, ReviewStatusBadge } from "@/components/reviews";

const pageSize = 50;

/**
 * Marketplace > Reviews: reviews reported (any threat first to read) and held for a moderator, oldest first, and every
 * review. A seller's page links here with ?seller= (reviews about them) or ?reviewer= (reviews they wrote).
 */
export default function ReviewsPage() {
  return (
    <Suspense>
      <Reviews />
    </Suspense>
  );
}

function Reviews() {
  const search = useSearchParams();
  const router = useRouter();
  const seller = search.get("seller") ?? undefined;
  const reviewer = search.get("reviewer") ?? undefined;
  const [tab, setTab] = useState<AdminReviewTab>(seller || reviewer ? "all" : "reported");
  const [country, setCountry] = useState("");
  const [offset, setOffset] = useState(0);
  const reviews = useReviewsQuery({ tab, country: country || undefined, seller, reviewer, limit: pageSize, offset });
  const total = reviews.data?.total ?? 0;
  const counts = reviews.data?.counts;
  const someone = seller ? "reviews about this seller" : reviewer ? "reviews this customer wrote" : null;

  const columns: Array<Column<AdminReviewListItem>> = [
    {
      key: "review",
      header: "Review",
      cell: item => (
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <RatingBadge rating={item.rating} />
            {item.threat ? <Badge tone="red">Threat reported</Badge> : null}
          </span>
          <AppLink href={`/classifieds/reviews/${item.id}`} className="mt-1 block truncate font-semibold text-brand-600 hover:underline">
            {item.product.label}
          </AppLink>
          <span className="block truncate text-sm text-ink">{item.body ?? "No words"}</span>
          <span className="block text-xs text-muted">{formatDateTime(item.created_at)}</span>
        </span>
      ),
    },
    { key: "reviewer", header: "Reviewer", hideOnMobile: true, cell: item => <span className="break-words text-sm">{item.reviewer.name}</span> },
    { key: "seller", header: "Seller", hideOnMobile: true, cell: item => <span className="break-words text-sm">{item.seller.name}</span> },
    { key: "reports", header: "Open reports", align: "right", cell: item => (item.open_reports ? <span className="font-semibold text-ink">{item.open_reports}</span> : <span className="text-muted">0</span>) },
    { key: "status", header: "Status", cell: item => <ReviewStatusBadge status={item.status} /> },
  ];

  return (
    <UdozoShell section="marketplace" current="/classifieds/reviews" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Reviews" }]}>
      <PageHeader
        title="Reviews"
        description="Buyers who completed a purchase review the seller; the seller and buyers of the same item reply. Reports never hide a review by themselves: read it, then decide. Reviews from new accounts or quick sales wait here until published."
      />
      {someone ? (
        <div className="mt-4">
          <Notice tone="blue">
            Showing only {someone}.{" "}
            <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => router.push("/classifieds/reviews")}>
              Show every review
            </button>
          </Notice>
        </div>
      ) : null}
      <div className="mt-6 grid gap-3">
        <Tabs
          label="Reviews"
          value={tab}
          onChange={value => {
            setTab(value as AdminReviewTab);
            setOffset(0);
          }}
          items={[
            { value: "reported", label: "Reported", count: counts?.reported },
            { value: "held", label: "Held", count: counts?.held },
            { value: "removed", label: "Removed" },
            { value: "all", label: "All" },
          ]}
        />
        <div className="flex flex-wrap items-end gap-3">
          <MarketFilter
            id="reviews-market"
            value={country}
            onChange={value => {
              setCountry(value);
              setOffset(0);
            }}
          />
        </div>
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={reviews.data?.data} rowKey={item => item.id} loading={reviews.isLoading} error={reviews.error ? errorMessage(reviews.error) : null} onRetry={reviews.refetch} empty="No reviews here." />
      </Card>
      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {offset + 1} to {Math.min(offset + pageSize, total)} of {formatNumber(total)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </UdozoShell>
  );
}
