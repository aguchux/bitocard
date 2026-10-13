"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge, Card, DataTable, errorMessage, FilterSelect, formatDateTime, formatMoney, PageHeader, type Column } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type Mode, type P2pTrade, useP2pTradesQuery } from "@bitocard/api-client/admin";

const columns: Array<Column<P2pTrade>> = [
  {
    key: "trade",
    header: "Trade",
    cell: trade => (
      <span className="block">
        <span className="block font-semibold text-ink">{trade.number}</span>
        <span className="block text-xs text-muted">{formatDateTime(trade.created_at)}</span>
      </span>
    ),
  },
  { key: "amount", header: "Amount", cell: trade => `${trade.amount} ${trade.asset}` },
  { key: "fiat", header: "Paid", cell: trade => formatMoney(trade.fiat, trade.currency), align: "right" },
  { key: "price", header: "Price", cell: trade => `${formatMoney(trade.price, trade.currency)} / ${trade.asset}`, hideOnMobile: true },
  { key: "fee", header: "BitoCard fee", cell: trade => `${trade.fee} ${trade.asset}`, hideOnMobile: true },
  {
    key: "parties",
    header: "Seller → buyer",
    hideOnMobile: true,
    cell: trade => (
      <span className="block text-xs">
        <AppLink href={`/crypto/customers/${trade.seller.id}`} className="block text-brand-600 hover:underline">
          {trade.seller.email}
        </AppLink>
        <AppLink href={`/crypto/customers/${trade.buyer.id}`} className="block text-brand-600 hover:underline">
          {trade.buyer.email}
        </AppLink>
      </span>
    ),
  },
  { key: "status", header: "Status", cell: trade => <Badge tone={trade.status === "completed" ? "green" : "amber"}>{trade.status}</Badge> },
];

/** Crypto > P2P trades: every trade, newest first, by mode; from a customer's page, only theirs. */
export default function P2pTradesPage() {
  // useSearchParams needs a Suspense boundary (a customer's page links here with ?customer=<id>).
  return (
    <Suspense>
      <P2pTrades />
    </Suspense>
  );
}

function P2pTrades() {
  const customer = useSearchParams().get("customer") ?? undefined;
  const [mode, setMode] = useState<Mode>("live");
  const trades = useP2pTradesQuery({ mode, ...(customer ? { customer_id: customer } : {}) });
  return (
    <AdminShell section="crypto" current="/crypto/trades" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "P2P trades" }]}>
      <PageHeader title="P2P trades" description="Instant trades between customers, settled from their BitoCard wallets. BitoCard's fee is taken in the coin from what the buyer receives." />
      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect id="trades-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Test" }]} />
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={trades.data?.data} rowKey={trade => trade.id} loading={trades.isLoading} error={trades.error ? errorMessage(trades.error) : null} onRetry={trades.refetch} empty="No trades yet." />
      </Card>
    </AdminShell>
  );
}
