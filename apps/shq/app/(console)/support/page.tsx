"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, DataTable, errorMessage, formatRelative, Notice, PageHeader, StatusBadge, Tabs, ticketCategoryLabels, ticketPriorityLabels } from "@bitocard/admin-ui";
import { type TicketSummary, useTicketsQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { needsAnswer, shqTicketStatus, ticketTone } from "@/components/support";

const filters = [
  { value: "answer", label: "Needs an answer" },
  { value: "waiting", label: "Waiting for customer" },
  { value: "bitocard", label: "With BitoCard" },
  { value: "mine", label: "Your questions" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
] as const;
type Filter = (typeof filters)[number]["value"];

const customers = (row: TicketSummary) => row.requester === "customer";
const shows: Record<Filter, (row: TicketSummary) => boolean> = {
  answer: needsAnswer,
  waiting: row => customers(row) && row.queue === "reseller" && row.status === "pending",
  bitocard: row => customers(row) && row.queue === "bitocard" && row.status !== "resolved",
  mine: row => row.requester === "reseller" && row.status !== "resolved",
  resolved: row => row.status === "resolved",
  all: () => true,
};

/**
 * Support tickets: customers' questions to the store (answer them, add staff notes, resolve them or pass them to
 * BitoCard) and the store's own questions to BitoCard.
 */
export default function SupportPage() {
  const router = useRouter();
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "support");
  const [filter, setFilter] = useState<Filter>("answer");
  const query = useTicketsQuery(undefined, { skip: !allowed });
  const all = query.data?.data;
  const rows = all?.filter(shows[filter]);
  const waiting = all?.filter(shows.answer).length ?? 0;
  const answered = all?.filter(row => row.requester === "reseller" && row.status === "pending").length ?? 0;

  return (
    <ShqShell section="support" current="/support" crumbs={[{ label: "Support" }, { label: "Tickets" }]}>
      <PageHeader
        title="Support tickets"
        description={mode === "test" ? "Sandbox tickets from your sandbox store’s customers." : "Your customers’ questions come to you first: answer them, or pass them to BitoCard. Ask BitoCard your own questions here too."}
        actions={
          allowed ? (
            <Link href="/support/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
              <Plus className="size-4" aria-hidden />
              New ticket
            </Link>
          ) : null
        }
      />
      {!allowed ? (
        <Notice tone="grey" title="No access to support">
          Only the owner and admin or support members handle support tickets.
        </Notice>
      ) : (
        <>
          {waiting ? <Notice tone="amber" title={`${waiting} ${waiting === 1 ? "customer is" : "customers are"} waiting for an answer`}>Answer them, or pass the ticket to BitoCard.</Notice> : null}
          {answered ? <Notice tone="blue" title={`BitoCard answered ${answered === 1 ? "one of your questions" : `${answered} of your questions`}`}>Reply if you need more, or resolve it.</Notice> : null}
          <Tabs label="Show" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
          <Card>
            <DataTable<TicketSummary>
              caption="Support tickets"
              rows={query.isLoading ? undefined : rows}
              loading={query.isLoading}
              error={query.error ? errorMessage(query.error) : null}
              onRetry={query.refetch}
              rowKey={row => row.id}
              onRowClick={row => router.push(`/support/${row.id}`)}
              empty={filter === "answer" ? "No customer is waiting for you." : "No tickets."}
              columns={[
                {
                  key: "subject",
                  header: "Ticket",
                  cell: row => (
                    <div className="min-w-0 space-y-0.5">
                      <Link href={`/support/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                        {row.reference}
                      </Link>
                      <p className="break-words text-sm text-ink">{row.subject}</p>
                    </div>
                  ),
                },
                { key: "from", header: "From", cell: row => <span className="text-muted">{row.requester === "reseller" ? "You, to BitoCard" : (row.customer_reference ?? "Customer")}</span>, hideOnMobile: true },
                { key: "about", header: "About", cell: row => <span className="text-muted">{`${ticketCategoryLabels[row.category]}${row.priority !== "normal" ? ` · ${ticketPriorityLabels[row.priority]}` : ""}`}</span>, hideOnMobile: true },
                { key: "status", header: "Status", cell: row => <StatusBadge status={ticketTone(row)} label={shqTicketStatus(row)} /> },
                { key: "updated", header: "Last message", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.last_message_at)}</span>, hideOnMobile: true },
              ]}
            />
          </Card>
        </>
      )}
    </ShqShell>
  );
}
