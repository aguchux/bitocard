"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Button, Card, DataTable, errorMessage, FilterSelect, formatDateTime, formatMoney, formatNumber, Input, PageHeader, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedOrder, type ClassifiedOrderStatus, type ClassifiedPayoutReview, classifiedOrderStatuses, useClassifiedOrdersQuery } from "@bitocard/api-client/admin";
import { ListingCell, MarketFilter, OrderStatus, orderStatusLabels, PersonCell, payoutReviewLabels, payoutReviewTones } from "@/components/classifieds";

const pageSize = 50;

/**
 * BitoCard Shop > Safe pay orders: every order, newest first, searched by number or either side's email. Finance
 * filters the sellers' payouts held for review (the buyer paid from a recent card or mobile money top-up).
 */
export default function ClassifiedOrdersPage() {
  // The Safe pay settings page links here with ?payout_review=pending.
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const router = useRouter();
  const linked = useSearchParams().get("payout_review") as ClassifiedPayoutReview | null;
  const [status, setStatus] = useState<ClassifiedOrderStatus | "">("");
  const [review, setReview] = useState<ClassifiedPayoutReview | "">(linked ?? "");
  const [country, setCountry] = useState("");
  const [words, setWords] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(words.trim());
  const orders = useClassifiedOrdersQuery({ status: status || undefined, payout_review: review || undefined, country: country || undefined, q: q || undefined, offset });
  const total = orders.data?.total ?? 0;
  const reset = () => setOffset(0);

  const columns: Array<Column<AdminClassifiedOrder>> = [
    {
      key: "order",
      header: "Order",
      cell: item => (
        <span className="block">
          <span className="block font-semibold text-ink">{item.number}</span>
          <span className="block text-xs text-muted">
            {formatDateTime(item.timeline.requested_at)} · {item.fulfilment === "meet_up" ? "Meet-up" : "Delivery"}
            {item.mode === "test" ? " · test" : ""}
          </span>
        </span>
      ),
    },
    { key: "ad", header: "Ad", hideOnMobile: true, cell: item => <ListingCell listing={item.listing} /> },
    { key: "buyer", header: "Buyer", hideOnMobile: true, cell: item => <PersonCell person={item.buyer} /> },
    { key: "seller", header: "Seller", hideOnMobile: true, cell: item => <PersonCell person={item.seller} /> },
    {
      key: "money",
      header: "Price",
      align: "right",
      cell: item => (
        <span className="block whitespace-nowrap">
          <span className="block font-semibold text-ink">{formatMoney(item.price, item.currency)}</span>
          <span className="block text-xs text-muted">fees {formatMoney(item.buyer_fee + item.seller_fee, item.currency)}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: item => (
        <span className="flex flex-col items-start gap-1">
          <OrderStatus status={item.status} />
          {item.payout_review ? <Badge tone={payoutReviewTones[item.payout_review]}>{payoutReviewLabels[item.payout_review]}</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <AdminShell section="classifieds" current="/classifieds/orders" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Safe pay orders" }]}>
      <PageHeader title="Safe pay orders" description="Buyers pay into escrow from their wallet; the money reaches the seller when the buyer confirms, gives the release code at a meet-up, or after the confirmation days. Search by SP number or either side's email." />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <FilterSelect
          id="orders-status"
          label="Status"
          value={status}
          onChange={value => {
            setStatus(value as ClassifiedOrderStatus | "");
            reset();
          }}
          options={[{ value: "", label: "All" }, ...classifiedOrderStatuses.map(value => ({ value, label: orderStatusLabels[value] }))]}
        />
        <FilterSelect
          id="orders-review"
          label="Seller payout"
          value={review}
          onChange={value => {
            setReview(value as ClassifiedPayoutReview | "");
            reset();
          }}
          options={[
            { value: "", label: "Any" },
            { value: "pending", label: "Held for review" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Kept held" },
          ]}
        />
        <MarketFilter
          id="orders-market"
          value={country}
          onChange={value => {
            setCountry(value);
            reset();
          }}
        />
        <label className="min-w-56 flex-1 sm:max-w-sm">
          <span className="sr-only">Search orders</span>
          <Input
            type="search"
            placeholder="SP-100001 or an email"
            value={words}
            onChange={event => {
              setWords(event.target.value);
              reset();
            }}
          />
        </label>
      </div>
      <Card className="mt-4">
        <DataTable
          columns={columns}
          rows={orders.data?.data}
          rowKey={item => item.id}
          loading={orders.isLoading}
          error={orders.error ? errorMessage(orders.error) : null}
          onRetry={orders.refetch}
          onRowClick={item => router.push(`/classifieds/orders/${item.id}`)}
          empty="No Safe pay orders match."
        />
      </Card>
      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {offset + 1} to {Math.min(offset + pageSize, total)} of {formatNumber(total)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Newer
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
              Older
            </Button>
          </span>
        </div>
      ) : null}
    </AdminShell>
  );
}
