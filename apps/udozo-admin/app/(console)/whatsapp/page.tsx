"use client";

import { type FormEvent, useState } from "react";
import { MessageCircle, Search, Send } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, errorMessage, formatDateTime, formatNumber, Input, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type WhatsappContact, type WhatsappTemplate, useLazyWhatsappContactQuery, useOptOutWhatsappContactMutation, useSubmitWhatsappTemplatesMutation, useWhatsappOverviewQuery, useWhatsappTemplatesQuery } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";

const templateTones: Record<string, "green" | "amber" | "red" | "grey" | "blue"> = { approved: "green", pending: "blue", in_appeal: "blue", rejected: "red", paused: "amber", disabled: "red", not_submitted: "grey" };
const templateLabels: Record<string, string> = { approved: "Approved", pending: "Waiting for Meta", in_appeal: "Appealed", rejected: "Rejected", paused: "Paused by Meta", disabled: "Disabled", not_submitted: "Not submitted" };
const qualityTones: Record<string, "green" | "amber" | "red" | "grey"> = { GREEN: "green", YELLOW: "amber", RED: "red" };

/**
 * Site > WhatsApp (docs/UDOZO_WHATSAPP_PLAN.md): Udozo's number as Meta has it (name and quality rating), the week's
 * messages, the message templates with Meta's approval (and Submit to Meta), and a number looked up: whether it is linked
 * to an account and opted in, its last messages (never what was said), and opting it out.
 */
export default function WhatsappPage() {
  return (
    <UdozoShell section="theme" current="/whatsapp" crumbs={[{ label: "Site" }, { label: "WhatsApp" }]}>
      <PageHeader
        title="WhatsApp"
        description="Buyers and sellers use Udozo from its WhatsApp number: find, sell, chat (relayed, so nobody sees another's number) and post requests. Set the number up in Settings > Integrations > WhatsApp, and switch whatsapp_channel on per market."
      />
      <div className="mt-6 grid gap-6">
        <Overview />
        <Templates />
        <Contact />
      </div>
    </UdozoShell>
  );
}

function Overview() {
  const overview = useWhatsappOverviewQuery();
  return (
    <QueryView query={overview} loading={<Skeleton className="h-40" />}>
      {data => (
        <Card>
          <CardHeader title="The number" description="As Meta has it, and the last 7 days." />
          <div className="grid gap-4 px-5 pb-5 sm:px-6">
            {!data.configured ? (
              <Notice tone="amber">
                WhatsApp is not set up yet. <AppLink href="/settings/integrations" className="font-semibold underline">Settings &gt; Integrations</AppLink>: the phone number ID, the system user&apos;s token, the app secret and the verify token.
              </Notice>
            ) : data.meta?.error ? (
              <Notice tone="red">Meta did not answer: {data.meta.error}</Notice>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-ink">
                <MessageCircle className="size-4 text-muted" aria-hidden />
                <strong>{data.meta?.name ?? "Udozo"}</strong> <span className="text-muted">{data.meta?.display ?? data.number}</span>
                {data.meta?.quality ? <Badge tone={qualityTones[data.meta.quality] ?? "grey"}>Quality {data.meta.quality.toLowerCase()}</Badge> : null}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                ["Numbers", data.contacts.total],
                ["Linked to accounts", data.contacts.linked],
                ["Opted out", data.contacts.opted_out],
                ["Messages in (7 days)", data.week.received],
                ["Sent", (data.week.sent.sent ?? 0) + (data.week.sent.delivered ?? 0) + (data.week.sent.read ?? 0)],
                ["Read", data.week.sent.read ?? 0],
                ["Waiting to send", data.week.sent.queued ?? 0],
                ["Failed", data.week.failed],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl border border-line p-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-lg font-semibold text-ink">{formatNumber(value as number)}</dd>
                </div>
              ))}
            </dl>
            {data.failures.length ? (
              <DataTable
                columns={[
                  { key: "when", header: "When", cell: row => formatDateTime(row.created_at) },
                  { key: "to", header: "To", cell: row => row.phone },
                  { key: "what", header: "What", cell: row => row.template ?? row.kind },
                  { key: "why", header: "Why", cell: row => <span className="text-sm">{row.error ?? "—"}</span> },
                ]}
                rows={data.failures}
                rowKey={row => row.id}
              />
            ) : null}
          </div>
        </Card>
      )}
    </QueryView>
  );
}

function Templates() {
  const admin = useAdmin();
  const templates = useWhatsappTemplatesQuery();
  const [submit, submitting] = useSubmitWhatsappTemplatesMutation();
  const [result, setResult] = useState<string | null>(null);
  const missing = templates.data?.data.filter(item => item.status === "not_submitted" || item.status === "rejected").length ?? 0;
  const send = async () => {
    setResult(null);
    const done = await submit().unwrap().catch(error => {
      setResult(errorMessage(error));
      return null;
    });
    if (done) setResult(done.failed.length ? `Submitted ${done.submitted.length}; ${done.failed.map(item => `${item.name}: ${item.error}`).join("; ")}` : `Submitted ${done.submitted.length} to Meta for approval.`);
  };
  return (
    <Card>
      <CardHeader
        title="Message templates"
        description="Outside 24 hours of a person's last message, Meta lets Udozo send only these approved templates (a waiting chat message, a request that fits, an update). Each goes at most once an hour per chat."
        actions={can(admin, "operations") && missing ? <Button icon={<Send className="size-4" aria-hidden />} loading={submitting.isLoading} onClick={() => void send()}>Submit to Meta</Button> : undefined}
      />
      <div className="grid gap-3 px-5 pb-5 sm:px-6">
        {result ? <Notice tone="blue">{result}</Notice> : null}
        <QueryView query={templates} loading={<Skeleton className="h-32" />}>
          {data => (
            <DataTable<WhatsappTemplate>
              columns={[
                {
                  key: "name",
                  header: "Template",
                  cell: row => (
                    <span className="block min-w-0">
                      <span className="block font-mono text-sm font-semibold text-ink">{row.name}</span>
                      <span className="block text-xs text-muted">{row.purpose}</span>
                    </span>
                  ),
                },
                { key: "body", header: "Says", hideOnMobile: true, cell: row => <span className="text-sm">{row.body} <em className="text-muted">[{row.button}]</em></span> },
                {
                  key: "status",
                  header: "Meta",
                  cell: row => (
                    <span className="grid gap-1">
                      <Badge tone={templateTones[row.status] ?? "grey"}>{templateLabels[row.status] ?? row.status}</Badge>
                      {row.rejected_reason && row.rejected_reason !== "NONE" ? <span className="text-xs text-muted">{row.rejected_reason}</span> : null}
                    </span>
                  ),
                },
              ]}
              rows={data.data}
              rowKey={row => row.name}
            />
          )}
        </QueryView>
      </div>
    </Card>
  );
}

function Contact() {
  const admin = useAdmin();
  const [phone, setPhone] = useState("");
  const [lookup, found] = useLazyWhatsappContactQuery();
  const [optOut] = useOptOutWhatsappContactMutation();
  const [stopping, setStopping] = useState<WhatsappContact | null>(null);
  const search = (event: FormEvent) => {
    event.preventDefault();
    if (phone.replace(/\D/g, "").length >= 8) void lookup(phone.trim());
  };
  const contact = found.data;
  return (
    <Card>
      <CardHeader title="Look up a number" description="Whether a number wrote to Udozo, the account it is linked to, and its last messages (never what was said)." />
      <div className="grid gap-4 px-5 pb-5 sm:px-6">
        <form onSubmit={search} className="flex flex-wrap gap-2">
          <Input aria-label="WhatsApp number" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+234 803 123 4567" className="w-64" inputMode="tel" />
          <Button type="submit" variant="secondary" icon={<Search className="size-4" aria-hidden />} loading={found.isFetching}>
            Look up
          </Button>
        </form>
        {found.error ? <Notice tone="grey">{errorMessage(found.error)}</Notice> : null}
        {contact ? (
          <div className="grid gap-3">
            <dl className="grid gap-1 text-sm">
              <div>
                <dt className="inline text-muted">Number: </dt>
                <dd className="inline font-semibold text-ink">{contact.phone}</dd>
              </div>
              <div>
                <dt className="inline text-muted">Account: </dt>
                <dd className="inline">{contact.customer ? <AppLink href={`/customers/${contact.customer.id}`} className="font-semibold text-brand-600 hover:underline">{contact.customer.name} ({contact.customer.email})</AppLink> : "Not linked"}</dd>
              </div>
              <div>
                <dt className="inline text-muted">Messages Udozo: </dt>
                <dd className="inline">{contact.opted_out_at ? `opted out ${formatDateTime(contact.opted_out_at)}` : contact.unreachable_at ? "cannot get messages (Meta said so)" : "opted in"}</dd>
              </div>
              {contact.last_inbound_at ? (
                <div>
                  <dt className="inline text-muted">Last wrote: </dt>
                  <dd className="inline">{formatDateTime(contact.last_inbound_at)}</dd>
                </div>
              ) : null}
            </dl>
            {can(admin, "operations") && !contact.opted_out_at ? (
              <Button variant="secondary" className="w-fit" onClick={() => setStopping(contact)}>
                Opt this number out
              </Button>
            ) : null}
            <DataTable
              columns={[
                { key: "when", header: "When", cell: row => formatDateTime(row.created_at) },
                { key: "dir", header: "", cell: row => (row.direction === "in" ? "In" : "Out") },
                { key: "kind", header: "What", cell: row => row.template ?? row.kind },
                { key: "status", header: "Status", cell: row => <span className="text-sm">{row.status}{row.error ? ` · ${row.error}` : ""}</span> },
              ]}
              rows={contact.messages}
              rowKey={row => row.id}
              empty="No messages in the last 90 days."
            />
          </div>
        ) : null}
      </div>
      <ActionDialog
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title="Opt this number out?"
        description="Udozo sends it nothing more. They can still send START to come back."
        confirmLabel="Opt out"
        tone="danger"
        onConfirm={async reason => {
          await optOut({ id: stopping!.id, reason }).unwrap();
          void lookup(stopping!.phone);
        }}
      />
    </Card>
  );
}
