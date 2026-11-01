"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable, errorMessage, formatRelative, Input, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { usePrefetchQuery } from "@bitocard/api-client";
import { type ContactMessage, type ContactMessageFilter, contactKindLabels, contactStatusLabels, useContactMessagesQuery } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";

const filters = [
  { value: "active", label: "To do" },
  { value: "new", label: "New" },
  { value: "mine", label: "Mine" },
  { value: "waiting", label: "Waiting for the sender" },
  { value: "resolved", label: "Resolved" },
  { value: "spam", label: "Spam" },
] as const;
type Filter = (typeof filters)[number]["value"];

const filterOf = (value: Filter): ContactMessageFilter => (value === "mine" ? { status: "active", assignee: "me" } : { status: value });

/**
 * Messages from udozo.com's Contact us form, newest first: what each is about, who sent it and where it stands. Each
 * opens to reply by email, add a note for the team, take it and resolve it.
 */
export default function ContactMessagesPage() {
  const router = useRouter();
  const prefetch = usePrefetchQuery("contactMessage");
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const query = useContactMessagesQuery({ ...filterOf(filter), ...(q.trim() ? { q: q.trim() } : {}) });
  const counts = query.data?.counts;

  return (
    <UdozoShell section="support" current="/support/contact" crumbs={[{ label: "Support", href: "/support" }, { label: "Contact us" }]}>
      <PageHeader title="Contact us" description="Messages from udozo.com’s Contact us form. Replies are emailed to the sender; notes stay with the team." />
      <Tabs label="Show" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.value === "new" && counts?.new ? `New (${counts.new})` : item.label }))} />
      <Card>
        <div className="border-b border-line p-4">
          <label htmlFor="contact-search" className="sr-only">
            Search by name, email, words or reference
          </label>
          <Input id="contact-search" type="search" placeholder="Search by name, email, words or C-000123" value={q} onChange={event => setQ(event.target.value)} />
        </div>
        <DataTable<ContactMessage>
          caption="Contact us messages"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/support/contact/${row.id}`)}
          onRowIntent={row => {
            router.prefetch(`/support/contact/${row.id}`);
            prefetch(row.id);
          }}
          empty={filter === "active" ? "Nothing to answer." : "No messages."}
          columns={[
            {
              key: "message",
              header: "Message",
              cell: row => (
                <div className="min-w-0 space-y-0.5">
                  <AppLink href={`/support/contact/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                    {row.reference} · {contactKindLabels[row.kind]}
                  </AppLink>
                  <p className="line-clamp-2 break-words text-sm text-ink">{row.body}</p>
                </div>
              ),
            },
            { key: "from", header: "From", cell: row => <span className="break-words text-muted">{`${row.name} · ${row.email}`}</span>, hideOnMobile: true },
            { key: "status", header: "Status", cell: row => <StatusBadge status={row.status} label={contactStatusLabels[row.status]} /> },
            { key: "received", header: "Received", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.created_at)}</span>, hideOnMobile: true },
          ]}
        />
      </Card>
    </UdozoShell>
  );
}
