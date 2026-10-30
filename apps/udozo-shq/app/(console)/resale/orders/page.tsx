"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, DataTable, Field, PageHeader, Select, Skeleton, errorMessage, formatDate, formatMoney } from "@bitocard/admin-ui";
import { type ResaleOrder, type ResaleOrderStatus, resaleOrderStatusText, useResaleAccountQuery, useResaleOrdersQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { ResaleGate, ResaleOrderBadge } from "@/components/resale";

const filters: Array<{ value: "" | ResaleOrderStatus; label: string }> = [
  { value: "", label: "All orders" },
  { value: "locked", label: resaleOrderStatusText.locked },
  { value: "paid", label: resaleOrderStatusText.paid },
  { value: "sent", label: resaleOrderStatusText.sent },
  { value: "disputed", label: resaleOrderStatusText.disputed },
  { value: "released", label: resaleOrderStatusText.released },
];

/** Resale > Orders: what customers bought on your Resale shops, where each order is, and what you earn from it. */
export default function ResaleOrdersPage() {
  const id = useId();
  const router = useRouter();
  const account = useResaleAccountQuery();
  const stores = account.data?.stores ?? [];
  const [storeId, setStoreId] = useState("");
  const [status, setStatus] = useState<"" | ResaleOrderStatus>("");
  const query = useResaleOrdersQuery({ store_id: storeId || undefined, status: status || undefined }, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  const storeName = (id: string) => stores.find(store => store.id === id)?.name ?? "";

  return (
    <ShqShell section="resale" current="/resale/orders" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Orders" }]}>
      <PageHeader
        title="Resale orders"
        description="Customers pay from their store wallet. Their money is locked until the supplier accepts, then held by Udozo until they have the item; your margin reaches your earnings once it is released."
      />
      {account.isLoading ? <Skeleton className="h-24" /> : <ResaleGate account={account.data} />}
      <div className="flex flex-wrap gap-4">
        {stores.length > 1 ? (
          <div className="w-full max-w-xs">
            <Field label="Store" htmlFor={`${id}-store`}>
              <Select id={`${id}-store`} value={storeId} onChange={event => setStoreId(event.target.value)}>
                <option value="">Every store</option>
                {stores.map(store => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
        <div className="w-full max-w-xs">
          <Field label="Show" htmlFor={`${id}-status`}>
            <Select id={`${id}-status`} value={status} onChange={event => setStatus(event.target.value as "" | ResaleOrderStatus)}>
              {filters.map(filter => (
                <option key={filter.value} value={filter.value}>{filter.label}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <Card>
        <DataTable<ResaleOrder>
          caption="Resale orders"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/resale/orders/${row.id}`)}
          onRowIntent={row => router.prefetch(`/resale/orders/${row.id}`)}
          empty="No orders yet. They appear here as soon as a customer buys."
          columns={[
            {
              key: "order",
              header: "Order",
              cell: row => (
                <div className="min-w-0">
                  <Link href={`/resale/orders/${row.id}`} className="font-semibold text-brand-600 hover:underline">{row.listing.title}</Link>
                  <p className="text-sm text-muted">
                    {row.number}
                    {row.quantity > 1 ? ` · ${row.quantity} units` : ""}
                    {stores.length > 1 ? ` · ${storeName(row.store_id)}` : ""}
                  </p>
                </div>
              ),
            },
            { key: "status", header: "Now", cell: row => <ResaleOrderBadge status={row.status} /> },
            { key: "price", header: "Price", cell: row => formatMoney(row.price, row.currency) },
            { key: "earnings", header: "You earn", cell: row => (row.earnings !== null ? formatMoney(row.earnings, row.currency) : `${formatMoney(row.margin, row.currency)} margin`), hideOnMobile: true },
            { key: "date", header: "Bought", cell: row => formatDate(row.created_at), hideOnMobile: true },
          ]}
        />
      </Card>
    </ShqShell>
  );
}
