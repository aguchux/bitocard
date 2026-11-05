"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, DataTable, errorMessage, FilterSelect, formatDateTime, formatMoney, formatNumber, Notice, PageHeader, type Column } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type AdminBuyOrder, type BuyOrderStatusFilter, buyOrderStatuses, useBuyOrdersQuery } from "@bitocard/api-client/admin";
import { MarketFilter, PersonCell } from "@/components/classifieds";
import { BuyOrderStatusBadge, buyOrderStatusLabels } from "@/components/buy-orders";

const pageSize = 50;

/**
 * Marketplace > Buy orders: a buyer asks to buy a listing at a price, the seller accepts, counters or declines, and
 * they meet and pay in person, off Udozo. Newest first; a seller's page links here with ?seller=, an account's with
 * ?buyer=.
 */
export default function BuyOrdersPage() {
  return (
    <Suspense>
      <BuyOrders />
    </Suspense>
  );
}

function BuyOrders() {
  const search = useSearchParams();
  const router = useRouter();
  const seller = search.get("seller") ?? undefined;
  const buyer = search.get("buyer") ?? undefined;
  const [status, setStatus] = useState<BuyOrderStatusFilter | "">("");
  const [country, setCountry] = useState("");
  const [offset, setOffset] = useState(0);
  const orders = useBuyOrdersQuery({ status: status || undefined, country: country || undefined, seller, buyer, limit: pageSize, offset });
  const total = orders.data?.total ?? 0;
  const someone = seller ? "this seller" : buyer ? "this buyer" : null;

  const columns: Array<Column<AdminBuyOrder>> = [
    {
      key: "order",
      header: "Buy order",
      cell: item => (
        <span className="block min-w-0">
          <AppLink href={`/classifieds/buy-orders/${item.id}`} className="block font-semibold text-brand-600 hover:underline">
            {item.number}
          </AppLink>
          <span className="block truncate text-sm text-ink">{item.listing.title ?? `Ad #${item.listing.ref}`}</span>
          <span className="block text-xs text-muted">{formatDateTime(item.created_at)}</span>
        </span>
      ),
    },
    { key: "buyer", header: "Buyer", hideOnMobile: true, cell: item => <PersonCell person={item.buyer} /> },
    { key: "seller", header: "Seller", hideOnMobile: true, cell: item => <PersonCell person={item.seller} /> },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: item => (
        <span className="block whitespace-nowrap">
          <span className="block font-semibold text-ink">{formatMoney(item.price, item.currency)}</span>
          {item.quantity > 1 ? <span className="block text-xs text-muted">for {item.quantity}</span> : null}
          {item.counter !== null ? <span className="block text-xs text-muted">countered {formatMoney(item.counter, item.currency)}</span> : null}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: item => <BuyOrderStatusBadge status={item.status} /> },
  ];

  return (
    <UdozoShell section="marketplace" current="/classifieds/buy-orders" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Buy orders" }]}>
      <PageHeader
        title="Buy orders"
        description="A buyer asks to buy an ad at a price; the seller accepts (holding it), counters or declines; they meet and pay in person, off Udozo. A buyer who did not buy it can say so within 7 days, and 3 of those in 90 days pause the seller's buy orders for 30 days."
      />
      {someone ? (
        <div className="mt-4">
          <Notice tone="blue">
            Showing only {someone}&apos;s buy orders.{" "}
            <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => router.push("/classifieds/buy-orders")}>
              Show everyone&apos;s
            </button>
          </Notice>
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <FilterSelect
          id="buy-orders-status"
          label="Status"
          value={status}
          onChange={value => {
            setStatus(value as BuyOrderStatusFilter | "");
            setOffset(0);
          }}
          options={[{ value: "", label: "All" }, { value: "open", label: "Open (waiting, countered or accepted)" }, ...buyOrderStatuses.map(value => ({ value, label: buyOrderStatusLabels[value] }))]}
        />
        <MarketFilter
          id="buy-orders-market"
          value={country}
          onChange={value => {
            setCountry(value);
            setOffset(0);
          }}
        />
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={orders.data?.data} rowKey={item => item.id} loading={orders.isLoading} error={orders.error ? errorMessage(orders.error) : null} onRetry={orders.refetch} empty="No buy orders match." />
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
    </UdozoShell>
  );
}
