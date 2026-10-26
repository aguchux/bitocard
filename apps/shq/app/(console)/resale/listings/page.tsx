"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, DataTable, Field, Notice, PageHeader, Select, Skeleton, errorMessage, formatMoney } from "@bitocard/admin-ui";
import { type ResaleListing, useResaleAccountQuery, useResaleListingsQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { ResaleGate, ResaleStateBadge } from "@/components/resale";

/** Resale > Your listings: what each store sells, what each can do now, your price and what you keep per sale. */
export default function ResaleListingsPage() {
  const id = useId();
  const router = useRouter();
  const account = useResaleAccountQuery();
  const stores = account.data?.stores ?? [];
  const [picked, setStoreId] = useState("");
  // The first store until another is chosen.
  const storeId = picked || stores[0]?.id || "";
  const query = useResaleListingsQuery({ store_id: storeId || undefined }, { skip: !storeId });
  const rows = query.data?.data;
  const attention = rows?.filter(row => row.state !== "selling" && row.state !== "paused").length ?? 0;
  const notes = rows?.filter(row => row.note?.status === "pending").length ?? 0;

  return (
    <ShqShell section="resale" current="/resale/listings" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Your listings" }]}>
      <PageHeader title="Your resale listings" description="Listings you sell on your Resale shop stores. They always show the supplier’s own words and photos." />
      {account.isLoading ? <Skeleton className="h-24" /> : <ResaleGate account={account.data} />}
      {stores.length > 1 ? (
        <div className="max-w-xs">
          <Field label="Store" htmlFor={`${id}-store`}>
            <Select id={`${id}-store`} value={storeId} onChange={event => setStoreId(event.target.value)}>
              {stores.map(store => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      {attention ? (
        <Notice tone="amber" title={`${attention} ${attention === 1 ? "listing is" : "listings are"} not selling`}>
          Sold out, paused or stopped by the supplier, or priced outside their limits after a change. Open one to see why.
        </Notice>
      ) : null}
      {notes ? <Notice tone="blue">{notes === 1 ? "One note is" : `${notes} notes are`} waiting for the supplier’s approval.</Notice> : null}
      {storeId ? (
        <Card>
          <DataTable<ResaleListing>
            caption="Resale listings"
            rows={query.isLoading ? undefined : rows}
            loading={query.isLoading}
            error={query.error ? errorMessage(query.error) : null}
            onRetry={query.refetch}
            rowKey={row => row.id}
            onRowClick={row => router.push(`/resale/listings/${row.id}`)}
            onRowIntent={row => router.prefetch(`/resale/listings/${row.id}`)}
            empty="Nothing yet. Browse resale listings or set up a rule."

            columns={[
              {
                key: "title",
                header: "Listing",
                cell: row => (
                  <div className="min-w-0">
                    <Link href={`/resale/listings/${row.id}`} className="font-semibold text-brand-600 hover:underline">{row.title}</Link>
                    <p className="text-sm text-muted">Supplied by {row.supplier.name}</p>
                  </div>
                ),
              },
              { key: "state", header: "Now", cell: row => <ResaleStateBadge state={row.state} /> },
              { key: "price", header: "Your price", cell: row => formatMoney(row.price, row.currency) },
              { key: "earnings", header: "You keep", cell: row => formatMoney(row.earnings, row.currency), hideOnMobile: true },
              { key: "left", header: "Left", cell: row => String(row.available), hideOnMobile: true },
            ]}
          />
        </Card>
      ) : null}
    </ShqShell>
  );
}
