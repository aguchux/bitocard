"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable, errorMessage, formatDate, LoadMore, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { type NumberStatus, useResellerNumbersInfiniteQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { useReseller } from "@/components/reseller";

type Filter = "all" | NumberStatus;

export default function NumbersPage() {
  const router = useRouter();
  const { mode } = useReseller();
  const [status, setStatus] = useState<Filter>("all");
  const query = useResellerNumbersInfiniteQuery({ status: status === "all" ? undefined : status });
  const rows = query.data?.pages.flatMap(page => page.data);

  return (
    <ShqShell section="orders" current="/numbers" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Numbers" }]}>
      <PageHeader
        title="Numbers"
        description={
          mode === "test"
            ? "Sandbox virtual numbers. Nothing here is real."
            : "Virtual numbers your orders bought. Each is renewed a month at a time, by you or your customer, and always paid from your wallet."
        }
      />
      <Tabs
        label="Status"
        value={status}
        onChange={setStatus}
        items={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
          { value: "expired", label: "Expired" },
          { value: "deleted", label: "Deleted" },
        ]}
      />
      <Card>
        <DataTable
          caption="Numbers"
          rows={rows}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={number => number.id}
          onRowClick={number => router.push(`/numbers/${number.id}`)}
          empty={status === "all" ? "No numbers yet. A number appears here once a virtual number order completes." : "No numbers match this filter."}
          columns={[
            { key: "number", header: "Number", cell: number => <span className="break-all font-mono">{number.number}</span> },
            { key: "status", header: "Status", cell: number => <StatusBadge status={number.status} /> },
            { key: "paid", header: "Paid up to", cell: number => <span className="text-muted">{number.status === "deleted" ? "—" : formatDate(number.expires_at)}</span> },
            { key: "renew", header: "Auto-renew", cell: number => (number.status === "deleted" ? "—" : number.auto_renew ? "On" : "Off"), hideOnMobile: true },
            { key: "order", header: "Order", cell: number => <span className="font-mono text-xs">{`#${number.order_id.slice(0, 8)}`}</span>, hideOnMobile: true },
          ]}
        />
        <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
      </Card>
    </ShqShell>
  );
}
