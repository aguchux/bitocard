"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { ActionDialog, Button, Card, ChatPanel, chatStatusLabels, Field, Input, PageHeader, QueryView, Select, Skeleton, StatusBadge, errorMessage, ticketCategoryLabels } from "@bitocard/admin-ui";
import { AdminShell, AppLink, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminChat, type TicketCategory, ticketCategories, useAdminChatQuery, useAdminChatTicketMutation, useCloseAdminChatMutation, useReplyAdminChatMutation, useTakeAdminChatMutation } from "@bitocard/api-client/admin";

function ChatView({ chat, adminId }: { chat: AdminChat; adminId: string }) {
  const [reply, replyState] = useReplyAdminChatMutation();
  const [take, takeState] = useTakeAdminChatMutation();
  const [close, closeState] = useCloseAdminChatMutation();
  const [makeTicket] = useAdminChatTicketMutation();
  const [ticketing, setTicketing] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("other");
  const open = chat.status !== "closed";
  const error = replyState.error ?? takeState.error ?? closeState.error;
  return (
    <>
      <PageHeader
        title={`Chat with ${chat.requester_name ?? "someone"}`}
        description={`${chat.requester === "reseller" ? "A reseller’s team" : "A bitocard.com customer"}${open ? "" : " · ended"}`}
        actions={
          open ? (
            <>
              {chat.assignee_id !== adminId ? (
                <Button variant="secondary" onClick={() => void take(chat.id)} loading={takeState.isLoading}>
                  Take over
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setTicketing(true)}>
                Turn into a ticket
              </Button>
              <Button variant="ghost" onClick={() => void close(chat.id)} loading={closeState.isLoading}>
                End chat
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-4 sm:p-5">
          <ChatPanel
            messages={chat.messages}
            side="bitocard"
            requesterLabel={chat.requester_name ?? undefined}
            onSend={open ? async body => Boolean(await reply({ id: chat.id, body }).unwrap().catch(() => null)) : undefined}
            error={error ? errorMessage(error) : null}
          />
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <p>
            <StatusBadge status={chat.status === "waiting" ? "open" : chat.status === "closed" ? "resolved" : "pending"} label={chatStatusLabels[chat.status]} />
          </p>
          <p>
            <AppLink href={`/resellers/${chat.reseller_id}`} className="font-semibold text-brand-600 hover:underline">
              View reseller
            </AppLink>
          </p>
          {chat.ticket_id ? (
            <p>
              Became ticket{" "}
              <AppLink href={`/support/${chat.ticket_id}`} className="font-semibold text-brand-600 hover:underline">
                {chat.ticket_reference}
              </AppLink>
            </p>
          ) : null}
        </Card>
      </div>
      <ActionDialog
        open={ticketing}
        onClose={() => setTicketing(false)}
        title="Turn into a ticket"
        description="The chat ends and becomes a ticket with its transcript. The requester is told its reference."
        confirmLabel="Make ticket"
        requireReason={false}
        onConfirm={async () => {
          await makeTicket({ id: chat.id, subject: subject.trim(), category }).unwrap();
        }}
      >
        <Field label="Subject" htmlFor="chat-ticket-subject" hint="At least 3 characters.">
          <Input id="chat-ticket-subject" maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} />
        </Field>
        <Field label="About" htmlFor="chat-ticket-category">
          <Select id="chat-ticket-category" value={category} onChange={event => setCategory(event.target.value as TicketCategory)}>
            {ticketCategories.map(item => (
              <option key={item} value={item}>
                {ticketCategoryLabels[item]}
              </option>
            ))}
          </Select>
        </Field>
      </ActionDialog>
    </>
  );
}

export default function AdminChatPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const query = useAdminChatQuery(id, { pollingInterval: 3_000, skipPollingIfUnfocused: true });
  return (
    <AdminShell section="support" current="/support/chats" crumbs={[{ label: "Support", href: "/support" }, { label: "Chats", href: "/support/chats" }, { label: query.data?.requester_name ?? "Chat" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {chat => <ChatView chat={chat} adminId={admin.id} />}
      </QueryView>
    </AdminShell>
  );
}
