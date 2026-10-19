"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Card, ChatPanel, chatStatusLabels, Dialog, Field, Input, Notice, PageHeader, QueryView, Select, Skeleton, StatusBadge, errorMessage, ticketCategoryLabels } from "@bitocard/admin-ui";
import { type Chat, chatFile, type TicketCategory, ticketCategories, useAttachChatMutation, useChatQuery, useChatTicketMutation, useCloseChatMutation, useReplyChatMutation, useTakeChatMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

function TicketDialog({ chat, open, onClose }: { chat: Chat; open: boolean; onClose: () => void }) {
  const id = useId();
  const [make, state] = useChatTicketMutation();
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("order");
  const close = () => {
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (subject.trim().length < 3) return;
    if (await make({ id: chat.id, subject: subject.trim(), category }).unwrap().catch(() => null)) close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Turn into a ticket"
      description="The chat ends and becomes a ticket with its transcript, so you can follow up there. The customer is told its reference."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} loading={state.isLoading} disabled={subject.trim().length < 3}>
            Make ticket
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Subject" htmlFor={`${id}-subject`}>
          <Input id={`${id}-subject`} maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} />
        </Field>
        <Field label="About" htmlFor={`${id}-category`}>
          <Select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value as TicketCategory)}>
            {ticketCategories.map(item => (
              <option key={item} value={item}>
                {ticketCategoryLabels[item]}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

function ChatView({ chat, userId }: { chat: Chat; userId: string | null }) {
  const [reply, replyState] = useReplyChatMutation();
  const [attach, attachState] = useAttachChatMutation();
  const [take, takeState] = useTakeChatMutation();
  const [close, closeState] = useCloseChatMutation();
  const [ticketing, setTicketing] = useState(false);
  const open = chat.status !== "closed";
  const error = replyState.error ?? attachState.error ?? takeState.error ?? closeState.error;
  return (
    <>
      <PageHeader
        title={`Chat with ${chat.requester_name ?? "a customer"}`}
        description={open ? (chat.status === "waiting" ? "Waiting for a person: answer to take it." : "You are chatting with this customer.") : "This chat has ended."}
        actions={
          open ? (
            <>
              {chat.assignee_id !== userId ? (
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
            side="reseller"
            requesterLabel={chat.requester_name ?? "Customer"}
            onSend={open ? async body => Boolean(await reply({ id: chat.id, body }).unwrap().catch(() => null)) : undefined}
            onAttach={open ? async (file, body) => Boolean(await attach({ id: chat.id, file, body }).unwrap().catch(() => null)) : undefined}
            loadFile={file => chatFile(`/v1/support/chats/${chat.id}/files/${file}`)}
            error={error ? errorMessage(error) : null}
            placeholder="Answer the customer"
          />
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <p>
            <StatusBadge status={chat.status === "waiting" ? "open" : chat.status === "closed" ? "resolved" : "pending"} label={chatStatusLabels[chat.status]} />
          </p>
          {chat.visitor ? (
            <div className="rounded-xl bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
              <p className="font-semibold">Visitor, not signed in</p>
              <p>{chat.visitor.name}</p>
              <p className="break-all">{chat.visitor.email}</p>
              <p className="mt-1 text-xs">The email is as they typed it, not confirmed. They are emailed when you reply.</p>
            </div>
          ) : null}
          {chat.assignee_id ? <p className="text-muted">{chat.assignee_id === userId ? "You are answering." : "Another team member is answering."}</p> : null}
          {chat.ticket_id ? (
            <p>
              Became ticket{" "}
              <Link href={`/support/${chat.ticket_id}`} className="font-semibold text-brand-600 hover:underline">
                {chat.ticket_reference}
              </Link>
            </p>
          ) : null}
        </Card>
      </div>
      <TicketDialog key={`t-${ticketing}`} chat={chat} open={ticketing} onClose={() => setTicketing(false)} />
    </>
  );
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const { membership, user } = useReseller();
  const allowed = can(membership, "admin", "support");
  const query = useChatQuery(id, { skip: !allowed, pollingInterval: 3_000, skipPollingIfUnfocused: true });
  return (
    <ShqShell section="support" current="/support/chats" crumbs={[{ label: "Support", href: "/support" }, { label: "Chats", href: "/support/chats" }, { label: query.data?.requester_name ?? "Chat" }]}>
      {allowed ? (
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {chat => <ChatView chat={chat} userId={user?.id ?? null} />}
        </QueryView>
      ) : (
        <Notice tone="grey" title="No access to chats">
          Only the owner and admin or support members answer chats.
        </Notice>
      )}
    </ShqShell>
  );
}
