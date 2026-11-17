"use client";

import Link from "next/link";
import { Card, DataTable, errorMessage, formatBps, formatMoney, formatRelative, Notice, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { type ResellerAirtimePurchase, type ResellerAirtimeSale, useAirtimeExchangeQuery } from "@bitocard/api-client/reseller";
import { useState } from "react";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** Why the airtime exchange is closed on the reseller's stores, in their words. */
const closedText: Record<string, string> = {
  not_enabled: "BitoCard has not opened the airtime exchange for your stores yet.",
  country_unsupported: "The airtime exchange is not offered in your country yet.",
  exchange_closed: "The airtime exchange is not open in your country right now.",
};

const saleStatus: Record<ResellerAirtimeSale["status"], string> = {
  awaiting_transfer: "Waiting for airtime",
  sent: "Being checked",
  received: "Received",
  credited: "Paid",
  expired: "Not sent",
  cancelled: "Cancelled",
  not_received: "Not received",
  reversed: "Reversed",
};

const purchaseStatus: Record<ResellerAirtimePurchase["status"], string> = { paid: "Paid", delivering: "Being sent", delivered: "Sent", refunded: "Refunded" };

/**
 * Airtime trades: unused airtime your customers sold or bought on your stores. They sell at BitoCard's rate less your
 * cut and buy at BitoCard's price plus it; your cut is your airtime markup (else your general markup), up to each
 * network's cap, and reaches your earnings once the trade settles, after the payout hold.
 */
export default function AirtimeTradesPage() {
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "finance", "support");
  const query = useAirtimeExchangeQuery(undefined, { skip: !allowed });
  const [tab, setTab] = useState<"sales" | "purchases">("sales");
  const data = query.data;
  const money = (minor: number | null) => (minor === null || !data?.currency ? "—" : formatMoney(minor, data.currency));
  const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
  const customerColumn = { key: "customer", header: "Customer", hideOnMobile: true, cell: (row: { customer: { name: string | null; email: string } }) => <span className="break-words text-muted">{row.customer.name ?? row.customer.email}</span> };

  return (
    <ShqShell section="orders" current="/airtime-trades" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Airtime trades" }]}>
      <PageHeader
        title="Airtime trades"
        description={
          mode === "test"
            ? "Sandbox trades. Nothing here is real."
            : "Your customers sell unused airtime and buy it for less than its value on your stores. Your cut is added to your earnings once each trade settles."
        }
      />
      {!allowed ? (
        <Notice tone="grey" title="No access">
          Only the owner and admin, finance or support members see the airtime traded on your stores.
        </Notice>
      ) : (
        <>
          {data ? (
            data.available ? (
              <Notice tone="green" title={`Your cut: ${formatBps(data.markup_bps)} of BitoCard’s rates`}>
                It follows your airtime markup (else your general markup), up to each network’s cap. Change it on{" "}
                <Link href="/catalogue/pricing" className="font-semibold underline">
                  Pricing
                </Link>
                .
              </Notice>
            ) : (
              <Notice tone="grey" title="Your stores do not trade airtime yet">
                {closedText[data.reason ?? ""] ?? closedText.not_enabled}
              </Notice>
            )
          ) : null}
          {data?.networks.length ? (
            <Card>
              <DataTable
                caption="Rates for your customers"
                rows={data.networks}
                rowKey={row => row.network}
                columns={[
                  { key: "network", header: "Network", cell: row => <span className="font-semibold text-ink">{row.name}</span> },
                  { key: "sell", header: "Customers get", cell: row => <span>{percent(row.sell_rate_bps)}</span> },
                  { key: "buy", header: "Customers pay", cell: row => <span>{percent(row.buy_rate_bps)}</span> },
                  { key: "cut", header: "Your cut", cell: row => <span className="font-semibold text-green-700">{`${percent(row.cut_bps)} (up to ${percent(row.cap_bps)})`}</span> },
                ]}
              />
            </Card>
          ) : null}
          <Tabs
            label="Airtime trades"
            value={tab}
            onChange={setTab}
            items={[
              { value: "sales", label: "Sold to you" },
              { value: "purchases", label: "Bought from you" },
            ]}
          />
          <Card>
            {tab === "sales" ? (
              <DataTable<ResellerAirtimeSale>
                caption="Airtime your customers sold"
                rows={query.isLoading ? undefined : data?.sales}
                loading={query.isLoading}
                error={query.error ? errorMessage(query.error) : null}
                onRetry={query.refetch}
                rowKey={row => row.id}
                empty="No airtime sold yet."
                columns={[
                  { key: "airtime", header: "Airtime", cell: row => <span className="font-semibold text-ink">{`${row.network.toUpperCase()} ${money(row.amount)}`}</span> },
                  customerColumn,
                  { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={saleStatus[row.status]} /> },
                  { key: "paid", header: "Customer got", cell: row => <span className="whitespace-nowrap">{money(row.payout)}</span> },
                  { key: "earned", header: "You earned", cell: row => <span className="whitespace-nowrap font-semibold text-green-700">{money(row.earned)}</span> },
                  { key: "when", header: "When", hideOnMobile: true, cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.created_at)}</span> },
                ]}
              />
            ) : (
              <DataTable<ResellerAirtimePurchase>
                caption="Airtime your customers bought"
                rows={query.isLoading ? undefined : data?.purchases}
                loading={query.isLoading}
                error={query.error ? errorMessage(query.error) : null}
                onRetry={query.refetch}
                rowKey={row => row.id}
                empty="No airtime bought yet."
                columns={[
                  { key: "airtime", header: "Airtime", cell: row => <span className="font-semibold text-ink">{`${row.network.toUpperCase()} ${money(row.amount)}`}</span> },
                  customerColumn,
                  { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={purchaseStatus[row.status]} /> },
                  { key: "price", header: "Customer paid", cell: row => <span className="whitespace-nowrap">{money(row.price)}</span> },
                  { key: "earned", header: "You earned", cell: row => <span className="whitespace-nowrap font-semibold text-green-700">{money(row.earned)}</span> },
                  { key: "when", header: "When", hideOnMobile: true, cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.created_at)}</span> },
                ]}
              />
            )}
          </Card>
        </>
      )}
    </ShqShell>
  );
}
