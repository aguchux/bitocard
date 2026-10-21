"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable, errorMessage, formatRelative, PageHeader, StatusBadge, Tabs, ticketCategoryLabels, ticketPriorityLabels, ticketStatusLabel } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type AdminTicketSummary, type TicketQueue, type TicketStatus, useAdminTicketsQuery } from "@bitocard/api-client/admin";
import { usePrefetchQuery } from "@bitocard/api-client";

const filters = [
  { value: "open", label: "Needs an answer", status: "open", queue: "bitocard" },
  { value: "pending", label: "Waiting for requester", status: "pending", queue: "bitocard" },
  { value: "resolved", label: "Resolved", status: "resolved", queue: "bitocard" },
  { value: "stores", label: "With stores", status: undefined, queue: "reseller" },
] as const;
type Filter = (typeof filters)[number]["value"];

const requesterLabel = (row: AdminTicketSummary) => (row.requester === "reseller" ? "Reseller" : row.escalated_at ? "Customer, passed by the store" : "Customer");

/**
 * BitoCard's support queue: resellers' questions, customers' tickets their store passed on, and bitocard.com's own
 * customers. Oldest first, so nobody waits longest.
 */
export default function SupportTicketsPage() {
  const router = useRouter();
  // Opening a row draws at once: its page's code and data are fetched as the pointer reaches it.
  const prefetchDetail = usePrefetchQuery("adminTicket");
  const [filter, setFilter] = useState<Filter>("open");
  const chosen = filters.find(item => item.value === filter)!;
  const query = useAdminTicketsQuery({ queue: chosen.queue as TicketQueue, ...(chosen.status ? { status: chosen.status as TicketStatus } : {}) });

  return (
    <AdminShell section="support" current="/support" crumbs={[{ label: "Support" }, { label: "Tickets" }]}>
      <PageHeader title="Support tickets" description="Resellers’ questions, customers’ tickets stores passed to BitoCard, and bitocard.com’s customers. Answer, resolve, or send a customer’s ticket back to its store." />
      <Tabs label="Show" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
      <Card>
        <DataTable<AdminTicketSummary>
          caption="Support tickets"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/support/${row.id}`)}
          onRowIntent={row => { router.prefetch(`/support/${row.id}`); prefetchDetail(row.id); }}
          empty={filter === "open" ? "Nobody is waiting for an answer." : "No tickets."}
          columns={[
            {
              key: "ticket",
              header: "Ticket",
              cell: row => (
                <div className="min-w-0 space-y-0.5">
                  <AppLink href={`/support/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                    {row.reference}
                  </AppLink>
                  <p className="break-words text-sm text-ink">{row.subject}</p>
                </div>
              ),
            },
            { key: "from", header: "From", cell: row => <span className="text-muted">{requesterLabel(row)}</span>, hideOnMobile: true },
            { key: "about", header: "About", cell: row => <span className="text-muted">{`${ticketCategoryLabels[row.category]}${row.priority !== "normal" ? ` · ${ticketPriorityLabels[row.priority]}` : ""}`}</span>, hideOnMobile: true },
            { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={row.queue === "reseller" ? "With the store" : ticketStatusLabel(row.status, true)} /> },
            { key: "waiting", header: "Last message", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.last_message_at)}</span>, hideOnMobile: true },
          ]}
        />
      </Card>
    </AdminShell>
  );
}
