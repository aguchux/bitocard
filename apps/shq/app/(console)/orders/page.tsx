"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Card, categoryName, DataTable, errorMessage, formatDateTime, formatMoney, Input, LoadMore, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { type OrderStatus, useResellerOrdersInfiniteQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

type Filter = "all" | OrderStatus;

export default function OrdersPage() {
  const router = useRouter();
  const { membership, mode } = useReseller();
  const [status, setStatus] = useState<Filter>("all");
  const [reference, setReference] = useState("");
  const customerReference = useDeferredValue(reference.trim());
  const [polling, setPolling] = useState(false);
  // Refreshes every 15 seconds while a listed order is still processing (paused while the tab is in the background).
  const query = useResellerOrdersInfiniteQuery(
    { status: status === "all" ? undefined : status, customer_reference: customerReference || undefined },
    { pollingInterval: polling ? 15_000 : 0, skipPollingIfUnfocused: true },
  );
  const anyProcessing = Boolean(query.data?.pages.some(page => page.data.some(order => order.status === "processing")));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling follows the fetched list
    setPolling(anyProcessing);
  }, [anyProcessing]);
  const rows = query.data?.pages.flatMap(page => page.data);
  const canOrder = can(membership, "admin", "developer");

  return (
    <ShqShell section="orders" current="/orders" crumbs={[{ label: "Orders", href: "/orders" }, { label: "All orders" }]}>
      <PageHeader
        title="Orders"
        description={mode === "test" ? "Sandbox orders, newest first. Nothing here is real." : "Every order from your store and your API, newest first."}
        actions={
          canOrder ? (
            <Link href="/orders/new" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
              <Plus className="size-4" aria-hidden />
              New order
            </Link>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Tabs
            label="Status"
            value={status}
            onChange={setStatus}
            items={[
              { value: "all", label: "All" },
              { value: "processing", label: "Processing" },
              { value: "completed", label: "Completed" },
              { value: "failed", label: "Failed" },
              { value: "refunded", label: "Refunded" },
            ]}
          />
        </div>
        <label className="relative flex w-full items-center sm:w-64">
          <span className="sr-only">Find by customer reference</span>
          <Search className="pointer-events-none absolute left-3 size-4 text-subtle" aria-hidden />
          <Input type="search" placeholder="Customer reference" value={reference} onChange={event => setReference(event.target.value)} className="pl-9" maxLength={100} />
        </label>
      </div>
      <Card>
        <DataTable
          caption="Orders"
          rows={rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={order => order.id}
          onRowClick={order => router.push(`/orders/${order.id}`)}
          empty={status === "all" && !customerReference ? "No orders yet." : "No orders match these filters."}
          columns={[
            {
              key: "product",
              header: "Product",
              cell: order => (
                <span className="block min-w-0">
                  <span className="block truncate font-medium">{order.product.name}</span>
                  <span className="block text-xs font-normal text-muted">{`${categoryName(order.product.category)}${order.quantity > 1 ? ` · ×${order.quantity}` : ""}`}</span>
                </span>
              ),
            },
            { key: "order", header: "Order", cell: order => <span className="font-mono text-xs">{order.receipt_number ?? `#${order.id.slice(0, 8)}`}</span>, hideOnMobile: true },
            { key: "customer", header: "Customer ref.", cell: order => order.customer_reference ?? "—", hideOnMobile: true },
            { key: "price", header: "Price", align: "right", cell: order => formatMoney(order.price, order.currency) },
            { key: "profit", header: "Your profit", align: "right", cell: order => formatMoney(order.reseller_profit, order.currency), hideOnMobile: true },
            { key: "status", header: "Status", cell: order => <StatusBadge status={order.status} /> },
            { key: "time", header: "Placed", cell: order => <span className="text-muted">{formatDateTime(order.created_at)}</span> },
          ]}
        />
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </Card>
    </ShqShell>
  );
}
