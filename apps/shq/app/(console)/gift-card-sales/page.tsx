"use client";

import Link from "next/link";
import { Card, DataTable, errorMessage, formatBps, formatMoney, formatRelative, Notice, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { type BuyBackSale, useGiftCardBuyBackQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

/** Why buy back is closed on the reseller's stores, in their words. */
const closedText: Record<string, string> = {
  not_enabled: "BitoCard has not opened buy back for your stores yet.",
  country_unsupported: "Buy back is not offered in your country yet.",
  not_configured: "Buy back is not available right now.",
};

const statusLabel: Record<BuyBackSale["status"], string> = { pending: "Being checked", completed: "Accepted", rejected: "Not accepted", failed: "Not sent" };

/**
 * Cards sold to you: gift cards your customers sold on your stores. They get BitoCard's rate less your cut, which is
 * your gift card markup (else your general markup), up to the cap BitoCard sets; your cut reaches your earnings once a
 * card is accepted, after the payout hold.
 */
export default function GiftCardSalesPage() {
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "finance", "support");
  const query = useGiftCardBuyBackQuery(undefined, { skip: !allowed });
  const data = query.data;
  const money = (minor: number | null) => (minor === null || !data?.currency ? "—" : formatMoney(minor, data.currency));

  return (
    <ShqShell section="orders" current="/gift-card-sales" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Cards sold to you" }]}>
      <PageHeader
        title="Cards sold to you"
        description={
          mode === "test"
            ? "Sandbox sales. Nothing here is real."
            : "Your customers sell their gift cards on each gift card’s page of your store. They get BitoCard’s rate less your cut, and your cut is added to your earnings once the card is accepted."
        }
      />
      {!allowed ? (
        <Notice tone="grey" title="No access">
          Only the owner and admin, finance or support members see the cards sold to your stores.
        </Notice>
      ) : (
        <>
          {data ? (
            data.available ? (
              <Notice tone="green" title={`Your cut: ${formatBps(data.spread_bps)} of BitoCard’s rate`}>
                It follows your gift card markup (else your general markup), up to {formatBps(data.cap_bps)}. Change it on{" "}
                <Link href="/catalogue/pricing" className="font-semibold underline">
                  Pricing
                </Link>
                .
              </Notice>
            ) : (
              <Notice tone="grey" title="Your stores do not buy gift cards yet">
                {closedText[data.reason ?? ""] ?? closedText.not_configured}
              </Notice>
            )
          ) : null}
          <Card>
            <DataTable<BuyBackSale>
              caption="Cards sold to you"
              rows={query.isLoading ? undefined : data?.data}
              loading={query.isLoading}
              error={query.error ? errorMessage(query.error) : null}
              onRetry={query.refetch}
              rowKey={row => row.id}
              empty="No cards sold yet."
              columns={[
                {
                  key: "card",
                  header: "Card",
                  cell: row => (
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-semibold text-ink">{row.card.name}</p>
                      <p className="text-sm text-muted">{`${row.number} · ${row.amount} value`}</p>
                    </div>
                  ),
                },
                { key: "customer", header: "Customer", cell: row => <span className="break-words text-muted">{row.customer.name}</span>, hideOnMobile: true },
                { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={statusLabel[row.status]} /> },
                { key: "paid", header: "Customer got", cell: row => <span className="whitespace-nowrap">{money(row.paid ?? row.quoted)}</span> },
                { key: "earned", header: "You earned", cell: row => <span className="whitespace-nowrap font-semibold text-green-700">{money(row.earned)}</span> },
                { key: "when", header: "Sent", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.created_at)}</span>, hideOnMobile: true },
              ]}
            />
          </Card>
        </>
      )}
    </ShqShell>
  );
}
