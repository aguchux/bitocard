"use client";

import { useRouter } from "next/navigation";
import { Card, chatStatusLabels, DataTable, errorMessage, formatRelative, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type AdminChatSummary, useAdminChatsQuery } from "@bitocard/api-client/admin";
import { usePrefetchQuery } from "@bitocard/api-client";

const tone = (status: string) => (status === "waiting" ? "open" : status === "closed" ? "resolved" : "pending");

/** BitoCard's live chats: resellers' teams and bitocard.com's customers. Polled while open. */
export default function AdminChatsPage() {
  const router = useRouter();
  // Opening a row draws at once: its page's code and data are fetched as the pointer reaches it.
  const prefetchDetail = usePrefetchQuery("adminChat");
  const query = useAdminChatsQuery(undefined, { pollingInterval: 10_000, skipPollingIfUnfocused: true });
  return (
    <AdminShell section="support" current="/support/chats" crumbs={[{ label: "Support", href: "/support" }, { label: "Chats" }]}>
      <PageHeader title="Chats" description="Resellers and bitocard.com’s customers chatting with BitoCard now." />
      <Card>
        <DataTable<AdminChatSummary>
          caption="Chats"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/support/chats/${row.id}`)}
          onRowIntent={row => { router.prefetch(`/support/chats/${row.id}`); prefetchDetail(row.id); }}
          empty="No one is chatting right now."
          columns={[
            {
              key: "who",
              header: "From",
              cell: row => (
                <AppLink href={`/support/chats/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                  {`${row.requester_name ?? "Someone"} · ${row.requester === "reseller" ? "Reseller" : row.visitor ? "Visitor" : "Customer"}`}
                </AppLink>
              ),
            },
            { key: "status", header: "Status", cell: row => <StatusBadge status={tone(row.status)} label={chatStatusLabels[row.status]} /> },
            { key: "last", header: "Last message", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.last_message_at)}</span>, hideOnMobile: true },
          ]}
        />
      </Card>
    </AdminShell>
  );
}
