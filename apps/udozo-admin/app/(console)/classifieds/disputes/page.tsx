"use client";

import { useState } from "react";
import { Badge, Card, DataTable, errorMessage, formatDateTime, formatMoney, formatRelative, PageHeader, Tabs, type Column } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { type AdminClassifiedDisputeRow, useClassifiedDisputesQuery } from "@bitocard/api-client/admin";
import { disputeReasonLabels, ListingCell, PersonCell } from "@/components/classifieds";

const decisionLabels: Record<string, string> = { release: "Released to the seller", refund: "Refunded in full", partial: "Part refunded" };

/** Udozo > Disputes: Safe pay orders a buyer disputed, oldest first. Open one to read it and decide. */
export default function ClassifiedDisputesPage() {
  const [status, setStatus] = useState<"open" | "decided">("open");
  const disputes = useClassifiedDisputesQuery({ status });

  const columns: Array<Column<AdminClassifiedDisputeRow>> = [
    {
      key: "order",
      header: "Order",
      cell: item => (
        <span className="block">
          <AppLink href={`/classifieds/orders/${item.order.id}`} className="block font-semibold text-brand-600 hover:underline">
            {item.order.number}
          </AppLink>
          <span className="block text-xs text-muted">
            {formatMoney(item.order.price, item.order.currency)} · {item.order.fulfilment === "meet_up" ? "Meet-up" : "Delivery"}
          </span>
        </span>
      ),
    },
    { key: "ad", header: "Ad", hideOnMobile: true, cell: item => <ListingCell listing={item.order.listing} /> },
    { key: "reason", header: "Reason", cell: item => <Badge tone="red">{disputeReasonLabels[item.reason] ?? item.reason}</Badge> },
    { key: "buyer", header: "Buyer", hideOnMobile: true, cell: item => <PersonCell person={item.order.buyer} /> },
    { key: "seller", header: "Seller", hideOnMobile: true, cell: item => <PersonCell person={item.order.seller} /> },
    {
      key: "when",
      header: status === "open" ? "Opened" : "Decided",
      cell: item =>
        status === "open" ? (
          <span className="text-sm" title={formatDateTime(item.created_at)}>
            {formatRelative(item.created_at)}
          </span>
        ) : (
          <span className="block text-sm">
            {item.decision ? decisionLabels[item.decision] : "—"}
            <span className="block text-xs text-muted">{formatDateTime(item.decided_at)}</span>
          </span>
        ),
    },
  ];

  return (
    <UdozoShell section="marketplace" current="/classifieds/disputes" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Disputes" }]}>
      <PageHeader title="Disputes" description="Safe pay orders a buyer disputed: the money stays in escrow until Udozo decides. Write to both sides, then release, refund or part refund (refunds are finance's)." />
      <div className="mt-6">
        <Tabs
          label="Dispute status"
          value={status}
          onChange={setStatus}
          items={[
            { value: "open", label: "Open" },
            { value: "decided", label: "Decided" },
          ]}
        />
      </div>
      <Card className="mt-4">
        <DataTable
          columns={columns}
          rows={disputes.data?.data}
          rowKey={item => item.id}
          loading={disputes.isLoading}
          error={disputes.error ? errorMessage(disputes.error) : null}
          onRetry={disputes.refetch}
          empty={status === "open" ? "No open disputes." : "No disputes decided yet."}
        />
      </Card>
    </UdozoShell>
  );
}
