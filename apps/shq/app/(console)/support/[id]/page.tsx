"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Send } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  DisputeReply,
  DisputeThread,
  Field,
  KeyValue,
  Notice,
  PageHeader,
  QueryView,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
  TicketDrafts,
  errorMessage,
  formatDateTime,
  ticketCategoryLabels,
  ticketPriorityLabels,
  ticketSourceLabels,
} from "@bitocard/admin-ui";
import {
  type Ticket,
  type TicketPriority,
  ticketPriorities,
  useDiscardTicketDraftMutation,
  useEscalateTicketMutation,
  useReplyTicketMutation,
  useResolveTicketMutation,
  useSendTicketDraftMutation,
  useTicketQuery,
  useUpdateTicketMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { shqTicketStatus, ticketTone } from "@/components/support";

function EscalateDialog({ ticket, open, onClose }: { ticket: Ticket; open: boolean; onClose: () => void }) {
  const id = useId();
  const [escalate, state] = useEscalateTicketMutation();
  const [note, setNote] = useState("");
  const close = () => {
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (note.trim().length < 10) return;
    if (await escalate({ id: ticket.id, note: note.trim() }).unwrap().catch(() => null)) close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Pass to BitoCard"
      description="BitoCard answers the customer from here and may send the ticket back to you. Your note is for BitoCard only: the customer never sees it."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} icon={<Send className="size-4" aria-hidden />} loading={state.isLoading} disabled={note.trim().length < 10}>
            Pass to BitoCard
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Note for BitoCard" htmlFor={`${id}-note`} hint="What you checked, what you found, and what the customer needs.">
          <Textarea id={`${id}-note`} rows={5} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function ResolveDialog({ ticket, open, onClose }: { ticket: Ticket; open: boolean; onClose: () => void }) {
  const id = useId();
  const [resolve, state] = useResolveTicketMutation();
  const [note, setNote] = useState("");
  const close = () => {
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await resolve({ id: ticket.id, ...(note.trim() ? { note: note.trim() } : {}) }).unwrap().catch(() => null)) close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Resolve this ticket"
      description={ticket.requester === "customer" ? "The customer is told. If they reply, the ticket reopens." : "Close your question to BitoCard. Reply on it to reopen it."}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} icon={<CheckCircle2 className="size-4" aria-hidden />} loading={state.isLoading}>
            Resolve
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Last message (optional)" htmlFor={`${id}-note`}>
          <Textarea id={`${id}-note`} rows={3} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function TicketView({ ticket, userId }: { ticket: Ticket; userId: string | null }) {
  const [reply, replyState] = useReplyTicketMutation();
  const [update, updateState] = useUpdateTicketMutation();
  const [sendDraft, sendState] = useSendTicketDraftMutation();
  const [discardDraft] = useDiscardTicketDraftMutation();
  const drafts = ticket.messages.filter(message => message.draft);
  const [escalating, setEscalating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const customer = ticket.requester === "customer";
  const answering = customer && ticket.queue === "reseller";
  const resolved = ticket.status === "resolved";
  // On a customer's ticket the store can write while it is unresolved; on its own it can always reply (reopening it).
  const canWrite = customer ? !resolved : true;

  return (
    <>
      <PageHeader
        title={`${ticket.reference}: ${ticket.subject}`}
        description={
          !customer
            ? "Your question to BitoCard."
            : ticket.queue === "bitocard"
              ? "BitoCard is answering this customer. You can still add notes or write to the customer."
              : resolved
                ? "Resolved. It reopens if the customer replies."
                : "Your customer is waiting: answer them, resolve the ticket, or pass it to BitoCard."
        }
        actions={
          !resolved && (answering || !customer) ? (
            <>
              <Button variant="secondary" onClick={() => setResolving(true)}>
                Resolve
              </Button>
              {answering ? <Button onClick={() => setEscalating(true)}>Pass to BitoCard</Button> : null}
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Messages" className="px-0 pt-0 pb-4" />
          <DisputeThread messages={ticket.messages.filter(message => !message.draft)} viewer="reseller" />
          {drafts.length ? (
            <div className="mt-4">
              {sendState.error ? <Notice tone="red">{errorMessage(sendState.error)}</Notice> : null}
              <TicketDrafts
                drafts={drafts}
                disabled={resolved}
                onSend={async (draft, body) => Boolean(await sendDraft({ id: ticket.id, draft, ...(body !== undefined ? { body } : {}) }).unwrap().catch(() => null))}
                onDiscard={async draft => Boolean(await discardDraft({ id: ticket.id, draft }).unwrap().catch(() => null))}
              />
            </div>
          ) : null}
          {canWrite ? (
            <div className="mt-5 border-t border-line pt-5">
              <DisputeReply
                staffOption={customer}
                error={replyState.error ? errorMessage(replyState.error) : null}
                onSend={async (body, visibility) => Boolean(await reply({ id: ticket.id, body, visibility: customer ? visibility : "all" }).unwrap().catch(() => null))}
              />
            </div>
          ) : null}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <KeyValue
              items={[
                { label: "Status", value: <StatusBadge status={ticketTone(ticket)} label={shqTicketStatus(ticket)} /> },
                { label: "From", value: customer ? (ticket.customer_reference ?? "A customer") : "You, to BitoCard" },
                { label: "About", value: ticketCategoryLabels[ticket.category] },
                { label: "Opened from", value: ticketSourceLabels[ticket.source] },
                ...(ticket.order_id ? [{ label: "Order", value: <Link href={`/orders/${ticket.order_id}`} className="font-semibold text-brand-600 hover:underline">View order</Link> }] : []),
                ...(ticket.escalated_at ? [{ label: "Passed to BitoCard", value: formatDateTime(ticket.escalated_at) }] : []),
                { label: "Opened", value: formatDateTime(ticket.created_at) },
              ]}
            />
          </Card>
          {answering ? (
            <Card className="space-y-3 p-5">
              <CardHeader title="Handling" className="px-0 pt-0 pb-1" />
              {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}
              <Field label="Priority" htmlFor="ticket-priority">
                <Select id="ticket-priority" value={ticket.priority} onChange={event => void update({ id: ticket.id, priority: event.target.value as TicketPriority })}>
                  {ticketPriorities.map(item => (
                    <option key={item} value={item}>
                      {ticketPriorityLabels[item]}
                    </option>
                  ))}
                </Select>
              </Field>
              {userId ? (
                ticket.assignee_id === userId ? (
                  <Button variant="secondary" size="sm" onClick={() => void update({ id: ticket.id, assignee_id: null })}>
                    Unassign me
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => void update({ id: ticket.id, assignee_id: userId })}>
                    {ticket.assignee_id ? "Take it over" : "Assign to me"}
                  </Button>
                )
              ) : null}
              {ticket.assignee_id && ticket.assignee_id !== userId ? <p className="text-sm text-muted">Assigned to another team member.</p> : null}
            </Card>
          ) : null}
        </div>
      </div>
      <EscalateDialog key={`e-${escalating}`} ticket={ticket} open={escalating} onClose={() => setEscalating(false)} />
      <ResolveDialog key={`r-${resolving}`} ticket={ticket} open={resolving} onClose={() => setResolving(false)} />
    </>
  );
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const { membership, user } = useReseller();
  const allowed = can(membership, "admin", "support");
  const query = useTicketQuery(id, { skip: !allowed, pollingInterval: 30_000, skipPollingIfUnfocused: true });
  return (
    <ShqShell section="support" current="/support" crumbs={[{ label: "Support", href: "/support" }, { label: query.data?.reference ?? "Ticket" }]}>
      {allowed ? (
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {ticket => <TicketView ticket={ticket} userId={user?.id ?? null} />}
        </QueryView>
      ) : (
        <Notice tone="grey" title="No access to support">
          Only the owner and admin or support members handle support tickets.
        </Notice>
      )}
    </ShqShell>
  );
}
