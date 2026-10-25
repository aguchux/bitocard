"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Card, DataTable, errorMessage, formatDateTime, formatMoney, formatRelative, PageHeader, Tabs, type Column } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedDisputeRow, useClassifiedDisputesQuery } from "@bitocard/api-client/admin";
import { disputeReasonLabels, ListingCell, PersonCell } from "@/components/classifieds";

const decisionLabels: Record<string, string> = { release: "Released to the seller", refund: "Refunded in full", partial: "Part refunded" };

/** BitoCard Shop > Disputes: Safe pay orders a buyer disputed, oldest first. Open one to read it and decide. */
export default function ClassifiedDisputesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"open" | "decided">("open");
  const disputes = useClassifiedDisputesQuery({ status });

  const columns: Array<Column<AdminClassifiedDisputeRow>> = [
    {
      key: "order",
      header: "Order",
      cell: item => (
        <span className="block">
          <span className="block font-semibold text-ink">{item.order.number}</span>
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
    <AdminShell section="classifieds" current="/classifieds/disputes" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Disputes" }]}>
      <PageHeader title="Disputes" description="Safe pay orders a buyer disputed: the money stays in escrow until BitoCard decides. Write to both sides, then release, refund or part refund (refunds are finance's)." />
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
          onRowClick={item => router.push(`/classifieds/orders/${item.order.id}`)}
          empty={status === "open" ? "No open disputes." : "No disputes decided yet."}
        />
      </Card>
    </AdminShell>
  );
}
