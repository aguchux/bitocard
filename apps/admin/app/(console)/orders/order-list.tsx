"use client";

import { useRouter } from "next/navigation";
import { Card, categoryName, DataTable, errorMessage, formatDateTime, formatMoney, LoadMore, StatusBadge } from "@bitocard/admin-ui";
import { type OrderStatus, useOrdersInfiniteQuery } from "@bitocard/api-client/admin";

/** Orders, newest first, with cursor paging. The filters come from the page (queue, status, reseller). */
export function OrderList({ status, needsReview, resellerId, empty }: { status?: OrderStatus; needsReview?: boolean; resellerId?: string; empty: string }) {
  const router = useRouter();
  const query = useOrdersInfiniteQuery({ status, needs_review: needsReview, reseller_id: resellerId });
  const rows = query.data?.pages.flatMap(page => page.data);

  return (
    <Card>
      <DataTable
        caption="Orders"
        rows={rows}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={order => order.id}
        onRowClick={order => router.push(`/orders/${order.id}`)}
        empty={empty}
        columns={[
          {
            key: "order",
            header: "Order",
            cell: order => <span className="font-mono text-sm font-semibold">{order.receipt_number ?? `#${order.id.slice(0, 8)}`}</span>,
          },
          {
            key: "product",
            header: "Product",
            cell: order => (
              <span>
                <span className="font-medium">{order.product.name}</span>
                <span className="block text-xs text-muted">{`${categoryName(order.product.category)}${order.quantity > 1 ? ` · ×${order.quantity}` : ""}`}</span>
              </span>
            ),
          },
          { key: "customer", header: "Customer ref.", cell: order => order.customer_reference ?? "—", hideOnMobile: true },
          { key: "supplier", header: "Supplier", cell: order => <span className="text-muted">{order.supplier}</span>, hideOnMobile: true },
          { key: "amount", header: "Price", align: "right", cell: order => formatMoney(order.price, order.currency) },
          { key: "status", header: "Status", cell: order => <StatusBadge status={order.needs_review ? "needs_review" : order.status} /> },
          {
            key: "mode",
            header: "Mode",
            cell: order => (order.mode === "test" ? <span className="text-xs font-semibold text-amber-700">Sandbox</span> : <span className="text-xs text-muted">Live</span>),
            hideOnMobile: true,
          },
          { key: "time", header: "Placed", cell: order => <span className="text-muted">{formatDateTime(order.created_at)}</span>, hideOnMobile: true },
        ]}
      />
      <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
    </Card>
  );
}
