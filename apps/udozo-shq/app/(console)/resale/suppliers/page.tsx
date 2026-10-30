"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Card, DataTable, PageHeader, Skeleton, errorMessage, formatRelative } from "@bitocard/admin-ui";
import { type ResaleSupplier, useResaleAccountQuery, useResaleSuppliersQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { ResaleGate } from "@/components/resale";

/** Resale > Suppliers: everyone whose listings you carry or you wrote to, with unread messages and deals. */
export default function ResaleSuppliersPage() {
  const router = useRouter();
  const account = useResaleAccountQuery();
  const query = useResaleSuppliersQuery(undefined, { pollingInterval: 30_000, skipPollingIfUnfocused: true });

  return (
    <ShqShell section="resale" current="/resale/suppliers" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Suppliers" }]}>
      <PageHeader title="Suppliers" description="The Udozo sellers whose listings you sell. Chat, call and agree better deals with them here." />
      {account.isLoading ? <Skeleton className="h-24" /> : <ResaleGate account={account.data} />}
      <Card>
        <DataTable<ResaleSupplier>
          caption="Suppliers"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/resale/suppliers/${row.id}`)}
          onRowIntent={row => router.prefetch(`/resale/suppliers/${row.id}`)}
          empty="No suppliers yet. Add a resale listing to your store, or message a supplier from a listing."
          columns={[
            {
              key: "name",
              header: "Supplier",
              cell: row => (
                <div className="min-w-0">
                  <Link href={`/resale/suppliers/${row.id}`} className="font-semibold text-brand-600 hover:underline">{row.supplier.name}</Link>
                  <p className="text-sm text-muted">{row.supplier.phone ?? "Phone hidden"}</p>
                </div>
              ),
            },
            { key: "listings", header: "On your stores", cell: row => String(row.listings_in_stores), hideOnMobile: true },
            {
              key: "status",
              header: "Status",
              cell: row =>
                row.stopped_by_supplier ? (
                  <Badge tone="red">Stopped you</Badge>
                ) : row.deals.some(deal => deal.status === "offered") ? (
                  <Badge tone="pink">Deal offered</Badge>
                ) : row.deals.some(deal => deal.status === "active") ? (
                  <Badge tone="green">Deal running</Badge>
                ) : row.unread ? (
                  <Badge tone="blue">{row.unread} unread</Badge>
                ) : (
                  <Badge tone="grey">Working together</Badge>
                ),
            },
            { key: "last", header: "Last message", cell: row => <span className="text-muted">{row.last_message_at ? formatRelative(row.last_message_at) : "—"}</span>, hideOnMobile: true },
          ]}
        />
      </Card>
    </ShqShell>
  );
}
