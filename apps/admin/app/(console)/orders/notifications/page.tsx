"use client";

import { useState } from "react";
import { RotateCw } from "lucide-react";
import { Button, Card, DataTable, errorMessage, formatDateTime, formatRelative, LoadMore, Notice, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type SupplierWebhookStatus, useRetrySupplierWebhookMutation, useSupplierWebhooksInfiniteQuery } from "@bitocard/api-client/admin";

const filters = [
  { value: "attention", label: "Needs attention" },
  { value: "received", label: "Waiting" },
  { value: "processed", label: "Processed" },
  { value: "all", label: "All" },
] as const;

type Filter = (typeof filters)[number]["value"];

/**
 * Every notification a supplier sent. Each is stored before it is acknowledged, so nothing is lost; ones that match no
 * order, or keep failing, stay here for an admin. The body is never shown (it is encrypted and may carry customer details).
 */
export default function SupplierNotificationsPage() {
  const admin = useAdmin();
  const [filter, setFilter] = useState<Filter>("attention");
  const status: SupplierWebhookStatus | undefined = filter === "attention" ? "unmatched" : filter === "all" ? undefined : filter;
  const query = useSupplierWebhooksInfiniteQuery({ status });
  const failed = useSupplierWebhooksInfiniteQuery({ status: "failed" }, { skip: filter !== "attention" });
  const [retry, retryState] = useRetrySupplierWebhookMutation();
  const rows = [...(filter === "attention" ? (failed.data?.pages.flatMap(page => page.data) ?? []) : []), ...(query.data?.pages.flatMap(page => page.data) ?? [])];

  return (
    <AdminShell section="orders" current="/orders/notifications" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Supplier notifications" }]}>
      <PageHeader
        title="Supplier notifications"
        description="Status updates suppliers send about orders. Each one is stored before it is acknowledged and only makes BitoCard re-check the order with the supplier."
      />
      {retryState.error ? <Notice tone="red">{errorMessage(retryState.error)}</Notice> : null}
      <Tabs label="Show" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
      <Card>
        <DataTable
          caption="Supplier notifications"
          rows={query.isLoading ? undefined : rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          empty={filter === "attention" ? "Nothing needs attention: every notification matched an order." : "No notifications."}
          columns={[
            { key: "received", header: "Received", cell: row => <span title={formatDateTime(row.received_at)}>{formatRelative(row.received_at)}</span> },
            { key: "supplier", header: "Supplier", cell: row => <span className="font-medium">{row.supplier}</span> },
            { key: "event", header: "Event", cell: row => <span className="font-mono text-xs">{row.event_type ?? "—"}</span>, hideOnMobile: true },
            {
              key: "order",
              header: "Order",
              cell: row =>
                row.order_id ? (
                  <AppLink href={`/orders/${row.order_id}`} className="font-semibold text-brand-600 hover:underline">
                    View order
                  </AppLink>
                ) : (
                  <span className="font-mono text-xs text-muted">{row.reference ?? "no reference"}</span>
                ),
            },
            {
              key: "status",
              header: "Status",
              cell: row => (
                <div className="space-y-0.5">
                  <StatusBadge status={row.status} label={row.status === "received" ? "Waiting" : undefined} />
                  {row.last_error ? <p className="text-xs text-muted">{row.last_error}</p> : null}
                  {row.next_attempt_at ? <p className="text-xs text-subtle">{`Next try ${formatRelative(row.next_attempt_at)} · ${row.attempts} so far`}</p> : null}
                </div>
              ),
            },
            {
              key: "retry",
              header: "",
              align: "right",
              cell: row =>
                can(admin, "operations") && row.status !== "processed" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RotateCw className="size-4" aria-hidden />}
                    loading={retryState.isLoading && retryState.originalArgs === row.id}
                    onClick={() => retry(row.id)}
                  >
                    Retry
                  </Button>
                ) : null,
            },
          ]}
        />
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </Card>
    </AdminShell>
  );
}
