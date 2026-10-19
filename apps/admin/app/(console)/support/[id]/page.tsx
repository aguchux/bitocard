"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  ActionDialog,
  Button,
  Card,
  CardHeader,
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
  ticketStatusLabel,
} from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { EngineeringIssue } from "@/components/engineering-issue";
import {
  type AdminTicket,
  type TicketPriority,
  ticketPriorities,
  useAdminTicketQuery,
  useDiscardAdminTicketDraftMutation,
  useReplyAdminTicketMutation,
  useResolveAdminTicketMutation,
  useReturnTicketMutation,
  useSendAdminTicketDraftMutation,
  useUpdateAdminTicketMutation,
} from "@bitocard/api-client/admin";

const houseStoreId = "00000000-0000-4000-8000-0000000000b2";

function TicketView({ ticket, adminId, canEscalate }: { ticket: AdminTicket; adminId: string | null; canEscalate: boolean }) {
  const [reply, replyState] = useReplyAdminTicketMutation();
  const [resolve] = useResolveAdminTicketMutation();
  const [sendBack] = useReturnTicketMutation();
  const [update, updateState] = useUpdateAdminTicketMutation();
  const [sendDraft, sendState] = useSendAdminTicketDraftMutation();
  const [discardDraft] = useDiscardAdminTicketDraftMutation();
  const drafts = ticket.messages.filter(message => message.draft);
  const [resolving, setResolving] = useState(false);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const ours = ticket.queue === "bitocard";
  const resolved = ticket.status === "resolved";
  const returnable = ours && ticket.requester === "customer" && ticket.store_id !== houseStoreId && !resolved;
  const requester = ticket.requester === "reseller" ? "reseller" : "customer";

  return (
    <>
      <PageHeader
        title={`${ticket.reference}: ${ticket.subject}`}
        description={ours ? (resolved ? "Resolved. It reopens if the requester replies." : `${ticket.requester === "reseller" ? "A reseller’s question" : "A customer’s ticket"} for BitoCard to answer.`) : "With the store: it answers its customers. You can still read and write."}
        actions={
          !resolved ? (
            <>
              {returnable ? (
                <Button variant="secondary" onClick={() => setReturning(true)}>
                  Send back to the store
                </Button>
              ) : null}
              <Button onClick={() => setResolving(true)}>Resolve</Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Messages" className="px-0 pt-0 pb-4" />
          <DisputeThread messages={ticket.messages.filter(message => !message.draft)} viewer="admin" requester={requester} />
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
          {!resolved ? (
            <div className="mt-5 border-t border-line pt-5">
              <DisputeReply
                error={replyState.error ? errorMessage(replyState.error) : null}
                onSend={async (body, visibility) => Boolean(await reply({ id: ticket.id, body, visibility }).unwrap().catch(() => null))}
              />
            </div>
          ) : null}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <KeyValue
              items={[
                { label: "Status", value: <StatusBadge status={ticket.status} label={ours ? ticketStatusLabel(ticket.status, true) : "With the store"} /> },
                { label: "From", value: ticket.requester === "reseller" ? "Reseller" : (ticket.customer_reference ?? "Customer") },
                { label: "Reseller", value: <AppLink href={`/resellers/${ticket.reseller_id}`} className="font-semibold text-brand-600 hover:underline">View reseller</AppLink> },
                { label: "About", value: ticketCategoryLabels[ticket.category] },
                { label: "Opened from", value: ticketSourceLabels[ticket.source] },
                ...(ticket.order_id ? [{ label: "Order", value: <AppLink href={`/orders/${ticket.order_id}`} className="font-semibold text-brand-600 hover:underline">View order</AppLink> }] : []),
                ...(ticket.escalated_at ? [{ label: "Passed to BitoCard", value: formatDateTime(ticket.escalated_at) }] : []),
                { label: "Mode", value: ticket.mode === "test" ? "Sandbox" : "Live" },
                { label: "Opened", value: formatDateTime(ticket.created_at) },
              ]}
            />
          </Card>
          <EngineeringIssue ticket={ticket} canEscalate={canEscalate} />
          {ours ? (
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
              {adminId ? (
                <Button variant="secondary" size="sm" onClick={() => void update({ id: ticket.id, assignee_id: ticket.assignee_id === adminId ? null : adminId })}>
                  {ticket.assignee_id === adminId ? "Unassign me" : ticket.assignee_id ? "Take it over" : "Assign to me"}
                </Button>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
      <ActionDialog
        open={resolving}
        onClose={() => {
          setResolving(false);
          setNote("");
        }}
        title="Resolve this ticket"
        description="The requester is told. If they reply, it reopens."
        confirmLabel="Resolve"
        requireReason={false}
        onConfirm={async () => {
          await resolve({ id: ticket.id, ...(note.trim() ? { note: note.trim() } : {}) }).unwrap();
          setNote("");
        }}
      >
        <Field label="Last message to the requester (optional)" htmlFor="resolve-note">
          <Textarea id="resolve-note" rows={3} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
      </ActionDialog>
      <ActionDialog
        open={returning}
        onClose={() => {
          setReturning(false);
          setNote("");
        }}
        title="Send back to the store"
        description="The store answers its customer from here. Your note is for the store only; the customer never sees it."
        confirmLabel="Send back"
        requireReason={false}
        onConfirm={async () => {
          await sendBack({ id: ticket.id, note: note.trim() }).unwrap();
          setNote("");
        }}
      >
        <Field label="Note for the store" htmlFor="return-note" hint="At least 3 characters.">
          <Textarea id="return-note" rows={3} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
      </ActionDialog>
    </>
  );
}

export default function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const query = useAdminTicketQuery(id, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  return (
    <AdminShell section="support" current="/support" crumbs={[{ label: "Support", href: "/support" }, { label: query.data?.reference ?? "Ticket" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {ticket => <TicketView ticket={ticket} adminId={admin.id} canEscalate={can(admin, "operations")} />}
      </QueryView>
    </AdminShell>
  );
}
