"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, chatStatusLabels, DataTable, errorMessage, formatRelative, Notice, PageHeader, StatusBadge } from "@bitocard/admin-ui";
import { type ChatSummary, useChatsQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { usePrefetchQuery } from "@bitocard/api-client";

const tone = (status: string) => (status === "waiting" ? "open" : status === "closed" ? "resolved" : "pending");

/** The store's live chats with its customers, newest activity first. Polled while the page is open. */
export default function ChatsPage() {
  const router = useRouter();
  // Opening a row draws at once: its page's code and data are fetched as the pointer reaches it.
  const prefetchDetail = usePrefetchQuery("chat");
  const { membership, mode } = useReseller();
  const allowed = can(membership, "admin", "support");
  const query = useChatsQuery(undefined, { skip: !allowed, pollingInterval: 10_000, skipPollingIfUnfocused: true });
  const rows = query.data?.data;
  const waiting = rows?.filter(row => row.status === "waiting").length ?? 0;

  return (
    <ShqShell section="support" current="/support/chats" crumbs={[{ label: "Support", href: "/support" }, { label: "Chats" }]}>
      <PageHeader title="Chats" description={mode === "test" ? "Sandbox chats from your sandbox store’s customers." : "Customers chatting with your store now. Answer them, take a chat over, or turn it into a ticket to follow up."} />
      {!allowed ? (
        <Notice tone="grey" title="No access to chats">
          Only the owner and admin or support members answer chats.
        </Notice>
      ) : (
        <>
          {waiting ? <Notice tone="amber" title={`${waiting} ${waiting === 1 ? "customer is" : "customers are"} waiting`}>Open a chat to answer.</Notice> : null}
          <Card>
            <DataTable<ChatSummary>
              caption="Chats"
              rows={query.isLoading ? undefined : rows}
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
                  header: "Customer",
                  cell: row => (
                    <Link href={`/support/chats/${row.id}`} className="font-semibold text-brand-600 hover:underline">
                      {row.requester_name ?? "Customer"}
                      {row.visitor ? <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Visitor</span> : null}
                    </Link>
                  ),
                },
                { key: "status", header: "Status", cell: row => <StatusBadge status={tone(row.status)} label={chatStatusLabels[row.status]} /> },
                { key: "asked", header: "Last message", cell: row => <span className="whitespace-nowrap text-muted">{formatRelative(row.last_message_at)}</span>, hideOnMobile: true },
              ]}
            />
          </Card>
        </>
      )}
    </ShqShell>
  );
}
