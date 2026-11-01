"use client";

import { useParams } from "next/navigation";
import { Button, Card, CardHeader, DisputeReply, DisputeThread, Field, KeyValue, Notice, PageHeader, QueryView, Select, Skeleton, StatusBadge, errorMessage, formatDateTime } from "@bitocard/admin-ui";
import { AppLink, useAdmin } from "@bitocard/admin-ui/shell";
import { type ContactMessage, type ContactStatus, contactKindLabels, contactStatuses, contactStatusLabels, useContactMessageQuery, useNoteContactMessageMutation, useReplyContactMessageMutation, useUpdateContactMessageMutation } from "@bitocard/api-client/admin";
import { contactThread } from "@/components/contact/thread";
import { UdozoShell } from "@/components/shell";

function MessageView({ message, adminId }: { message: ContactMessage; adminId: string | null }) {
  const [reply, replyState] = useReplyContactMessageMutation();
  const [note, noteState] = useNoteContactMessageMutation();
  const [update, updateState] = useUpdateContactMessageMutation();
  const closed = message.status === "resolved" || message.status === "spam";
  const sendError = replyState.error ?? noteState.error;

  return (
    <>
      <PageHeader
        title={`${message.reference}: ${contactKindLabels[message.kind]}`}
        description={closed ? "Closed. Open it again to reply." : "Your reply is emailed to the sender. A staff note stays with the team."}
        actions={
          closed ? (
            <Button variant="secondary" onClick={() => void update({ id: message.id, status: "open" })}>
              Open again
            </Button>
          ) : (
            <Button onClick={() => void update({ id: message.id, status: "resolved" })}>Resolve</Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Messages" className="px-0 pt-0 pb-4" />
          <DisputeThread messages={contactThread(message)} viewer="admin" requester="sender" />
          {!closed ? (
            <div className="mt-5 border-t border-line pt-5">
              <DisputeReply
                error={sendError ? errorMessage(sendError) : null}
                onSend={async (body, visibility) => Boolean(await (visibility === "staff" ? note({ id: message.id, body }) : reply({ id: message.id, body })).unwrap().catch(() => null))}
              />
            </div>
          ) : null}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <KeyValue
              items={[
                { label: "Status", value: <StatusBadge status={message.status} label={contactStatusLabels[message.status]} /> },
                { label: "From", value: message.name },
                { label: "Email", value: <a href={`mailto:${message.email}`} className="break-all font-semibold text-brand-600 hover:underline">{message.email}</a> },
                ...(message.phone ? [{ label: "Phone", value: <a href={`tel:${message.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-brand-600 hover:underline">{message.phone}</a> }] : []),
                ...(message.country ? [{ label: "Market", value: message.country }] : []),
                {
                  label: "Account",
                  value: message.customer_id ? (
                    <AppLink href={`/customers/${message.customer_id}`} className="font-semibold text-brand-600 hover:underline">
                      Signed in: view account
                    </AppLink>
                  ) : (
                    "Not signed in (the email is as typed)"
                  ),
                },
                { label: "Received", value: formatDateTime(message.created_at) },
                ...(message.replied_at ? [{ label: "Last reply", value: formatDateTime(message.replied_at) }] : []),
              ]}
            />
          </Card>
          <Card className="space-y-3 p-5">
            <CardHeader title="Handling" className="px-0 pt-0 pb-1" />
            {updateState.error ? <Notice tone="red">{errorMessage(updateState.error)}</Notice> : null}
            <Field label="Status" htmlFor="contact-status">
              <Select id="contact-status" value={message.status} onChange={event => void update({ id: message.id, status: event.target.value as ContactStatus })}>
                {contactStatuses.map(item => (
                  <option key={item} value={item}>
                    {contactStatusLabels[item]}
                  </option>
                ))}
              </Select>
            </Field>
            {adminId ? (
              <Button variant="secondary" size="sm" onClick={() => void update({ id: message.id, assignee_id: message.assignee_id === adminId ? null : adminId })}>
                {message.assignee_id === adminId ? "Unassign me" : message.assignee_id ? "Take it over" : "Assign to me"}
              </Button>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

export default function ContactMessagePage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const query = useContactMessageQuery(id, { pollingInterval: 30_000, skipPollingIfUnfocused: true });
  return (
    <UdozoShell section="support" current="/support/contact" crumbs={[{ label: "Support", href: "/support" }, { label: "Contact us", href: "/support/contact" }, { label: query.data?.reference ?? "Message" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {message => <MessageView message={message} adminId={admin.id} />}
      </QueryView>
    </UdozoShell>
  );
}
