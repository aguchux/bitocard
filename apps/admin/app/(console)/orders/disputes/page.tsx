"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable, disputeActionLabels, disputeKindLabels, disputeTopicLabels, errorMessage, formatRelative, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type AdminDisputeSummary, type DisputeStatus, useAdminDisputesQuery } from "@bitocard/api-client/admin";

const filters = [
  { value: "escalated", label: "Needs a decision" },
  { value: "contested", label: "Contesting" },
  { value: "open", label: "With resellers" },
  { value: "resolved", label: "Resolved" },
] as const;
type Filter = (typeof filters)[number]["value"];

/**
 * Disputes escalated to BitoCard: customers' disputes and chargebacks the reseller investigated (with their report and
 * recommendation), resellers' own disputes, and disputes at BitoCard's own store. Oldest first, so nothing waits.
 */
export default function DisputesPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("escalated");
  const query = useAdminDisputesQuery({ status: filter as DisputeStatus });

  return (
    <AdminShell section="orders" current="/orders/disputes" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Disputes" }]}>
      <PageHeader
        title="Disputes"
        description="Resellers investigate their customers’ disputes and chargebacks first and escalate them here with a report and a recommendation. Decide, execute, or send one back for more."
      />
      <Tabs label="Show" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
      <Card>
        <DataTable<AdminDisputeSummary>
          caption="Disputes"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/orders/disputes/${row.id}`)}
          empty={filter === "escalated" ? "Nothing waiting for a decision." : "No disputes."}
          columns={[
            {
              key: "dispute",
              header: "Dispute",
              cell: row => (
                <div className="min-w-0 space-y-0.5">
                  <AppLink href={`/orders/disputes/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                    {row.reference}
                  </AppLink>
                  <p className="break-words text-sm text-ink">{row.subject}</p>
                </div>
              ),
            },
            { key: "kind", header: "Type", cell: row => <span className="text-muted">{`${disputeKindLabels[row.kind]} · ${disputeTopicLabels[row.topic]}`}</span>, hideOnMobile: true },
            {
              key: "recommendation",
              header: "Recommended",
              cell: row => <span className="text-muted">{row.recommendation ? disputeActionLabels[row.recommendation] : "—"}</span>,
              hideOnMobile: true,
            },
            { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} /> },
            {
              key: "waiting",
              header: "Waiting",
              cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.escalated_at ?? row.created_at)}</span>,
              hideOnMobile: true,
            },
          ]}
        />
      </Card>
    </AdminShell>
  );
}
