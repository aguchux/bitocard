"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, DataTable, disputeKindLabels, disputeTopicLabels, errorMessage, formatRelative, Notice, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { type DisputeSummary, useDisputesQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const filters = [
  { value: "mine", label: "With you" },
  { value: "bitocard", label: "With BitoCard" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;
type Filter = (typeof filters)[number]["value"];

const shows: Record<Filter, (row: DisputeSummary) => boolean> = {
  mine: row => row.status === "open",
  bitocard: row => row.status === "escalated" || row.status === "contested",
  resolved: row => row.status === "resolved",
  all: () => true,
};

const statusLabel = (status: string) => ({ open: "With you", escalated: "With BitoCard", contested: "Being contested" })[status];

/**
 * Disputes: customers' disputes (from the store, or logged here) and chargebacks, which the store investigates first,
 * plus the store's own disputes with BitoCard. Resolve them, or escalate them to BitoCard with a report and a
 * recommendation; BitoCard decides anything that moves money.
 */
export default function DisputesPage() {
  const router = useRouter();
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "support", "finance");
  const [filter, setFilter] = useState<Filter>("mine");
  const query = useDisputesQuery(undefined, { skip: !allowed });
  const all = query.data?.data;
  const rows = all?.filter(shows[filter]);
  const waiting = all?.filter(shows.mine).length ?? 0;

  return (
    <ShqShell section="orders" current="/disputes" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Disputes" }]}>
      <PageHeader
        title="Disputes"
        description={
          mode === "test"
            ? "Sandbox disputes. Nothing here is real."
            : "Your customers’ disputes and chargebacks come to you first: investigate, answer, then resolve them or escalate them to BitoCard with your recommendation."
        }
        actions={
          allowed ? (
            <Link href="/disputes/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
              <Plus className="size-4" aria-hidden />
              New dispute
            </Link>
          ) : null
        }
      />
      {!allowed ? (
        <Notice tone="grey" title="No access to disputes">
          Only the owner and admin, support or finance members handle disputes.
        </Notice>
      ) : (
        <>
          {waiting ? <Notice tone="amber" title={`${waiting} ${waiting === 1 ? "dispute is" : "disputes are"} waiting for you`}>Answer the customer, then resolve it or escalate it to BitoCard.</Notice> : null}
          <Tabs label="Show" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
          <Card>
            <DataTable<DisputeSummary>
              caption="Disputes"
              rows={query.isLoading ? undefined : rows}
              loading={query.isLoading}
              error={query.error ? errorMessage(query.error) : null}
              onRetry={query.refetch}
              rowKey={row => row.id}
              onRowClick={row => router.push(`/disputes/${row.id}`)}
              empty={filter === "mine" ? "Nothing waiting for you." : "No disputes."}
              columns={[
                {
                  key: "subject",
                  header: "Dispute",
                  cell: row => (
                    <div className="min-w-0 space-y-0.5">
                      <Link href={`/disputes/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                        {row.reference}
                      </Link>
                      <p className="break-words text-sm text-ink">{row.subject}</p>
                    </div>
                  ),
                },
                { key: "kind", header: "Type", cell: row => <span className="text-muted">{`${disputeKindLabels[row.kind]} · ${disputeTopicLabels[row.topic]}`}</span>, hideOnMobile: true },
                { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={statusLabel(row.status)} /> },
                { key: "updated", header: "Updated", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.updated_at)}</span>, hideOnMobile: true },
              ]}
            />
          </Card>
        </>
      )}
    </ShqShell>
  );
}
