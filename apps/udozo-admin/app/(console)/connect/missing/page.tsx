"use client";

import { useState } from "react";
import { Card, DataTable, errorMessage, formatDateTime, PageHeader, type Column } from "@bitocard/admin-ui";
import { type ConnectMissingItem, useConnectMissingQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { money } from "@/components/connect";
import { UdozoShell } from "@/components/shell";

/**
 * Connect > Missing items: everything a Connect Centre's stock check did not find, oldest first, until a later check
 * finds it or it is handed over. Each links to its order and its centre.
 */
export default function ConnectMissingPage() {
  const [country, setCountry] = useState("");
  const missing = useConnectMissingQuery({ country: country || undefined });

  const columns: Array<Column<ConnectMissingItem>> = [
    {
      key: "item",
      header: "Item",
      cell: row => (
        <a href={`/classifieds/orders/${row.order_id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-semibold text-ink">{row.title}</span>
          <span className="block truncate text-xs text-muted">
            {row.number} · {money(row.price, row.currency)}
          </span>
        </a>
      ),
    },
    {
      key: "centre",
      header: "Centre",
      cell: row =>
        row.centre ? (
          <a href={`/connect/centres/${row.centre.id}`} className="block text-sm hover:underline">
            <span className="block text-ink">{row.centre.name}</span>
            <span className="block text-xs text-muted">
              {row.centre.number}
              {row.shelf ? ` · on ${row.shelf}` : " · on no storage place"}
            </span>
          </a>
        ) : null,
    },
    {
      key: "since",
      header: "Missing since",
      cell: row => (
        <span className="block text-sm">
          <span className="block font-semibold text-red-700">{formatDateTime(row.missing_since)}</span>
          <span className="block text-xs text-muted">{row.seen_at ? `Last found ${formatDateTime(row.seen_at)}` : "Never found at a check"}</span>
        </span>
      ),
    },
  ];

  return (
    <UdozoShell section="connect" current="/connect/missing" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Missing items" }]}>
      <PageHeader title="Missing items" description="Items a Connect Centre's stock check could not find. Each stays here until a later check finds it or it is handed over; ask the centre, then decide with the buyer and seller." />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <MarketFilter id="missing-market" value={country} onChange={setCountry} />
      </div>
      <Card className="mt-4">
        <DataTable<ConnectMissingItem>
          caption="Missing items"
          columns={columns}
          rows={missing.data?.data}
          loading={missing.isLoading}
          error={missing.error ? errorMessage(missing.error) : null}
          onRetry={missing.refetch}
          rowKey={row => row.order_id}
          empty="Nothing is missing."
        />
      </Card>
    </UdozoShell>
  );
}
