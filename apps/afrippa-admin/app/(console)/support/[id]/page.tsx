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
  errorMessage,
  formatDateTime,
  ticketCategoryLabels,
  ticketPriorityLabels,
  ticketSourceLabels,
  ticketStatusLabel,
} from "@bitocard/admin-ui";
import { useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminTicket, type TicketPriority, ticketPriorities, useAdminTicketQuery, useReplyAdminTicketMutation, useResolveAdminTicketMutation, useUpdateAdminTicketMutation } from "@bitocard/api-client/admin";
import { AfrippaShell } from "@/components/shell";

/** One trader's ticket: the thread (Afrippa's answers shown to the trader as "Afrippa"), reply or note, priority, assignee and resolving. */
function TicketView({ ticket, adminId }: { ticket: AdminTicket; adminId: string }) {
  const [reply, replyState] = useReplyAdminTicketMutation();
  const [resolve] = useResolveAdminTicketMutation();
  const [update, updateState] = useUpdateAdminTicketMutation();
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const resolved = ticket.status === "resolved";
  return (
    <>
      <PageHeader
        title={`${ticket.reference}: ${ticket.subject}`}
        description={resolved ? "Resolved. It reopens if the trader replies." : "A trader's question for Afrippa to answer."}
        actions={!resolved ? <Button onClick={() => setResolving(true)}>Resolve</Button> : null}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Messages" className="px-0 pt-0 pb-4" />
          <DisputeThread messages={ticket.messages.filter(message => !message.draft)} viewer="admin" requester="trader" />
          {!resolved ? (
            <div className="mt-5 border-t border-line pt-5">
              <DisputeReply error={replyState.error ? errorMessage(replyState.error) : null} onSend={async (body, visibility) => Boolean(await reply({ id: ticket.id, body, visibility }).unwrap().catch(() => null))} />
            </div>
          ) : null}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <KeyValue
              items={[
                { label: "Status", value: <StatusBadge status={ticket.status} label={ticketStatusLabel(ticket.status, true)} /> },
                { label: "About", value: ticketCategoryLabels[ticket.category] },
                { label: "Opened from", value: ticketSourceLabels[ticket.source] },
                { label: "Mode", value: ticket.mode === "test" ? "Sandbox" : "Live" },
                { label: "Opened", value: formatDateTime(ticket.created_at) },
              ]}
            />
          </Card>
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
            <Button variant="secondary" size="sm" onClick={() => void update({ id: ticket.id, assignee_id: ticket.assignee_id === adminId ? null : adminId })}>
              {ticket.assignee_id === adminId ? "Unassign me" : ticket.assignee_id ? "Take it over" : "Assign to me"}
            </Button>
          </Card>
        </div>
      </div>
      <ActionDialog
        open={resolving}
        onClose={() => {
          setResolving(false);
          setNote("");
        }}
        title="Resolve this ticket"
        description="The trader is told. If they reply, it reopens."
        confirmLabel="Resolve"
        requireReason={false}
        onConfirm={async () => {
          await resolve({ id: ticket.id, ...(note.trim() ? { note: note.trim() } : {}) }).unwrap();
          setNote("");
        }}
      >
        <Field label="Last message to the trader (optional)" htmlFor="resolve-note">
          <Textarea id="resolve-note" rows={3} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
      </ActionDialog>
    </>
  );
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const query = useAdminTicketQuery(id, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  return (
    <AfrippaShell section="support" current="/support" crumbs={[{ label: "Help", href: "/support" }, { label: query.data?.reference ?? "Ticket" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {ticket => <TicketView ticket={ticket} adminId={admin.id} />}
      </QueryView>
    </AfrippaShell>
  );
}
