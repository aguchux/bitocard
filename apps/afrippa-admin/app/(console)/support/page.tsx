"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable, errorMessage, formatRelative, PageHeader, StatusBadge, Tabs, ticketCategoryLabels, ticketPriorityLabels, ticketStatusLabel } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type AdminTicketSummary, type TicketStatus, useAdminTicketsQuery } from "@bitocard/api-client/admin";
import { AfrippaShell } from "@/components/shell";

const filters: Array<{ value: TicketStatus; label: string }> = [
  { value: "open", label: "Needs an answer" },
  { value: "pending", label: "Waiting for the trader" },
  { value: "resolved", label: "Resolved" },
];

/** Help > Tickets: traders' questions to Afrippa (its own queue), oldest waiting first. */
export default function TicketsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<TicketStatus>("open");
  const query = useAdminTicketsQuery({ status });
  return (
    <AfrippaShell section="support" current="/support" crumbs={[{ label: "Help" }, { label: "Tickets" }]}>
      <PageHeader title="Tickets" description="Traders' questions to Afrippa. Answer them as Afrippa, add notes only Afrippa's team sees, and resolve them." />
      <Tabs label="Show" value={status} onChange={setStatus} items={filters} />
      <Card>
        <DataTable<AdminTicketSummary>
          caption="Tickets"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/support/${row.id}`)}
          empty={status === "open" ? "Nobody is waiting for an answer." : "No tickets."}
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
            { key: "about", header: "About", cell: row => <span className="text-muted">{`${ticketCategoryLabels[row.category]}${row.priority !== "normal" ? ` · ${ticketPriorityLabels[row.priority]}` : ""}`}</span>, hideOnMobile: true },
            { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={ticketStatusLabel(row.status, true)} /> },
            { key: "waiting", header: "Last message", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.last_message_at)}</span>, hideOnMobile: true },
          ]}
        />
      </Card>
    </AfrippaShell>
  );
}
