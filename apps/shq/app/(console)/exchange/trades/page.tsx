"use client";

import { useState } from "react";
import { Card, DataTable, errorMessage, formatDateTime, formatMoney, LoadMore, PageHeader, Tabs } from "@bitocard/admin-ui";
import { type DeskTrade, type ResellerExchangeTrade, useResellerDeskTradesInfiniteQuery, useResellerExchangeTradePagesInfiniteQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { coinAmount } from "../shared";

type View = "bitocard" | "desk";

const sideLabel = (side: "buy" | "sell", who: "you" | "customer") => (side === "buy" ? (who === "you" ? "You bought" : "Customer bought") : who === "you" ? "You sold" : "Customer sold");

function BitocardTrades() {
  const query = useResellerExchangeTradePagesInfiniteQuery();
  const rows = query.data?.pages.flatMap(page => page.data);
  return (
    <>
      <DataTable<ResellerExchangeTrade>
        caption="Trades with BitoCard"
        rows={rows}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={row => row.id}
        empty="No trades with BitoCard yet."
        columns={[
          { key: "number", header: "Trade", cell: row => row.number },
          { key: "side", header: "What", cell: row => `${sideLabel(row.side, "you")} ${coinAmount(row.amount)} ${row.asset}` },
          { key: "fiat", header: "Amount", align: "right", cell: row => <span className="tabular-nums">{formatMoney(row.fiat, row.currency)}</span> },
          { key: "price", header: "Price per coin", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums">{formatMoney(row.price, row.currency)}</span> },
          { key: "markup", header: "BitoCard markup", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums">{formatMoney(row.markup, row.currency)}</span> },
          { key: "when", header: "When", hideOnMobile: true, cell: row => formatDateTime(row.created_at) },
        ]}
      />
      <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </>
  );
}

function DeskTrades() {
  const query = useResellerDeskTradesInfiniteQuery();
  const rows = query.data?.pages.flatMap(page => page.data);
  return (
    <>
      <DataTable<DeskTrade>
        caption="Your customers' trades"
        rows={rows}
        loading={query.isLoading}
        error={query.error ? errorMessage(query.error) : null}
        onRetry={query.refetch}
        rowKey={row => row.id}
        empty="None of your customers has traded at your desk yet."
        columns={[
          { key: "number", header: "Trade", cell: row => row.number },
          {
            key: "customer",
            header: "Customer",
            cell: row => (
              <span className="block min-w-0 break-words">
                {row.customer.name}
                <span className="block text-xs text-muted">{row.customer.email}</span>
              </span>
            ),
          },
          { key: "side", header: "What", cell: row => `${sideLabel(row.side, "customer")} ${coinAmount(row.amount)} ${row.asset}` },
          { key: "fiat", header: "Amount", align: "right", cell: row => <span className="tabular-nums">{formatMoney(row.fiat, row.currency)}</span> },
          { key: "markup", header: "Your markup", align: "right", cell: row => <span className="tabular-nums">{formatMoney(row.markup, row.currency)}</span> },
          { key: "price", header: "Price per coin", align: "right", hideOnMobile: true, cell: row => <span className="tabular-nums">{formatMoney(row.price, row.currency)}</span> },
          { key: "when", header: "When", hideOnMobile: true, cell: row => formatDateTime(row.created_at) },
        ]}
      />
      <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </>
  );
}

/** Every exchange trade in this mode: the reseller's own with BitoCard, and its customers' at its desk. */
export default function ExchangeTradesPage() {
  const [view, setView] = useState<View>("bitocard");
  return (
    <ShqShell section="exchange" current="/exchange/trades" crumbs={[{ label: "Exchange", href: "/exchange" }, { label: "Trades" }]}>
      <PageHeader title="Trades" description="Your trades with BitoCard, and your customers' trades at your desk with the markup you earned on each." />
      <div className="mt-6 space-y-4">
        <Tabs<View>
          label="Trades"
          value={view}
          onChange={setView}
          items={[
            { value: "bitocard", label: "With BitoCard" },
            { value: "desk", label: "At your desk" },
          ]}
        />
        <Card>{view === "bitocard" ? <BitocardTrades /> : <DeskTrades />}</Card>
      </div>
    </ShqShell>
  );
}
