"use client";

import { useRouter } from "next/navigation";
import { Card, chatStatusLabels, DataTable, errorMessage, formatRelative, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type AdminChatSummary, useAdminChatsQuery } from "@bitocard/api-client/admin";
import { AfrippaShell } from "@/components/shell";

const tone = (status: string) => (status === "waiting" ? "open" : status === "closed" ? "resolved" : "pending");

/** Help > Chats: traders chatting with Afrippa now (its own queue), polled while open. */
export default function ChatsPage() {
  const router = useRouter();
  const query = useAdminChatsQuery(undefined, { pollingInterval: 10_000, skipPollingIfUnfocused: true });
  return (
    <AfrippaShell section="support" current="/support/chats" crumbs={[{ label: "Help", href: "/support" }, { label: "Chats" }]}>
      <PageHeader title="Chats" description="Traders chatting with Afrippa now. They see Afrippa's answers as Afrippa." />
      <Card>
        <DataTable<AdminChatSummary>
          caption="Chats"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => router.push(`/support/chats/${row.id}`)}
          empty="No one is chatting right now."
          columns={[
            {
              key: "who",
              header: "Trader",
              cell: row => (
                <AppLink href={`/support/chats/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                  {row.requester_name ?? "A trader"}
                </AppLink>
              ),
            },
            { key: "status", header: "Status", cell: row => <StatusBadge status={tone(row.status)} label={chatStatusLabels[row.status]} /> },
            { key: "last", header: "Last message", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.last_message_at)}</span>, hideOnMobile: true },
          ]}
        />
      </Card>
    </AfrippaShell>
  );
}
