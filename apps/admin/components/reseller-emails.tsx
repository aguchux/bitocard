"use client";

import { useId, useState } from "react";
import { Mail, PenLine, Send } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, errorMessage, Field, formatDateTime, formatRelative, Input, Notice, Textarea } from "@bitocard/admin-ui";
import { type ResellerEmails, type ResellerQuickEmail, useResellerEmailsQuery, useSendResellerEmailMutation } from "@bitocard/api-client/admin";

type Chosen = ResellerQuickEmail | "custom" | null;

/**
 * Quick emails to the reseller's owner (Start KYC, Set up your store, Verify mobile…), those that apply now marked
 * Suggested, each previewed with an optional personal note before sending; a custom email; and what was sent lately.
 */
export function ResellerEmailsCard({ resellerId }: { resellerId: string }) {
  const { data, error, isLoading } = useResellerEmailsQuery(resellerId);
  const [chosen, setChosen] = useState<Chosen>(null);
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const onboarding = data?.templates.filter(item => item.kind === "onboarding") ?? [];
  const growth = data?.templates.filter(item => item.kind === "growth") ?? [];

  return (
    <Card>
      <CardHeader
        title="Emails"
        actions={
          <Button size="sm" variant="secondary" icon={<PenLine className="size-4" aria-hidden />} onClick={() => setChosen("custom")} disabled={!data?.to}>
            Custom email
          </Button>
        }
      />
      <div className="space-y-4 p-5 sm:p-6">
        {error ? <Notice tone="red">{errorMessage(error, "Could not load the emails.")}</Notice> : null}
        {data && !data.to ? <Notice tone="amber">This reseller has no owner to email.</Notice> : null}
        {data?.to ? (
          <p className="text-sm text-muted">
            Sent to the owner, {data.to.name} ({data.to.email}), from BitoCard, each with a link to the right page in SHQ.
          </p>
        ) : null}
        {sentNotice ? <Notice tone="green">{sentNotice}</Notice> : null}
        {isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        <QuickRow title="Getting started" items={onboarding} onPick={setChosen} disabled={!data?.to} />
        <QuickRow title="Growing their business" items={growth} onPick={setChosen} disabled={!data?.to} />
        {data?.sent.length ? <SentList sent={data.sent} templates={data.templates} /> : null}
      </div>
      {data ? (
        <SendDialog
          resellerId={resellerId}
          emails={data}
          chosen={chosen}
          onClose={() => setChosen(null)}
          onSent={subject => {
            setChosen(null);
            setSentNotice(`Sent “${subject}” to ${data.to?.email ?? "the owner"}.`);
          }}
        />
      ) : null}
    </Card>
  );
}

function QuickRow({ title, items, onPick, disabled }: { title: string; items: ResellerQuickEmail[]; onPick: (item: ResellerQuickEmail) => void; disabled: boolean }) {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {items.map(item => (
          <button
            key={item.key}
            type="button"
            disabled={disabled || item.available === false}
            onClick={() => onPick(item)}
            title={item.available === false ? (item.unavailable_reason ?? item.description) : (item.suggested ?? item.description)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold ring-1 disabled:opacity-50 ${
              item.suggested ? "bg-brand-50 text-brand-700 ring-brand-200 hover:bg-brand-100" : "bg-white text-ink ring-line hover:bg-canvas"
            }`}
          >
            <Mail className="size-4" aria-hidden />
            {item.label}
            {item.suggested ? <span className="sr-only">{" (suggested)"}</span> : null}
            {item.suggested ? <span aria-hidden className="size-1.5 rounded-full bg-brand-500" /> : null}
            {item.last_sent_at ? <span className="text-xs font-normal text-muted">· sent {formatRelative(item.last_sent_at)}</span> : null}
          </button>
        ))}
      </div>
      {items
        .filter(item => item.available === false && item.unavailable_reason)
        .map(item => (
          <p key={item.key} className="mt-2 text-xs text-muted">
            {item.label}: {item.unavailable_reason}
          </p>
        ))}
    </section>
  );
}

function SentList({ sent, templates }: { sent: ResellerEmails["sent"]; templates: ResellerQuickEmail[] }) {
  const label = (key: string | null) => (key === "custom" ? "Custom" : (templates.find(item => item.key === key)?.label ?? key ?? "Email"));
  return (
    <details className="rounded-xl ring-1 ring-line">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Sent lately ({sent.length})</summary>
      <ul className="divide-y divide-line px-4 pb-2">
        {sent.map(item => (
          <li key={`${item.sent_at}-${item.template}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0">
              <Badge tone="grey" dot={false}>
                {label(item.template)}
              </Badge>{" "}
              <span className="text-ink">{item.subject}</span>
            </span>
            <span className="text-xs text-muted">
              {formatDateTime(item.sent_at)}
              {item.sent_by ? ` · ${item.sent_by.name}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function SendDialog({ resellerId, emails, chosen, onClose, onSent }: { resellerId: string; emails: ResellerEmails; chosen: Chosen; onClose: () => void; onSent: (subject: string) => void }) {
  const id = useId();
  const [send, state] = useSendResellerEmailMutation();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const custom = chosen === "custom";
  const quick = chosen && chosen !== "custom" ? chosen : null;

  const close = () => {
    setSubject("");
    setMessage("");
    state.reset();
    onClose();
  };
  const submit = async () => {
    const result = await send({ id: resellerId, template: custom ? "custom" : quick!.key, ...(custom ? { subject: subject.trim() } : {}), ...(message.trim() ? { message } : {}) })
      .unwrap()
      .catch(() => null);
    if (!result) return;
    const sentSubject = custom ? subject.trim() : quick!.subject;
    setSubject("");
    setMessage("");
    onSent(sentSubject);
  };
  const ready = custom ? subject.trim().length >= 3 && message.trim().length > 0 : Boolean(quick);

  return (
    <Dialog
      open={chosen !== null}
      onClose={close}
      title={custom ? "Custom email" : (quick?.label ?? "Email")}
      description={emails.to ? `To ${emails.to.name} (${emails.to.email})` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button icon={<Send className="size-4" aria-hidden />} loading={state.isLoading} disabled={!ready} onClick={() => void submit()}>
            Send email
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {state.error ? <Notice tone="red">{errorMessage(state.error, "The email could not be sent.")}</Notice> : null}
        {quick ? (
          <div className="space-y-1 rounded-xl bg-canvas p-4 text-sm">
            <p>
              <span className="text-muted">Subject:</span> <span className="font-semibold">{quick.subject}</span>
            </p>
            <p className="text-muted">{quick.description}</p>
            {quick.suggested ? <p className="text-brand-700">Suggested: {quick.suggested}</p> : null}
            {quick.last_sent_at ? <p className="text-amber-700">Last sent {formatRelative(quick.last_sent_at)}.</p> : null}
          </div>
        ) : null}
        {custom ? (
          <Field label="Subject" htmlFor={`${id}-subject`}>
            <Input id={`${id}-subject`} value={subject} onChange={event => setSubject(event.target.value)} maxLength={150} />
          </Field>
        ) : null}
        <Field
          label={custom ? "Message" : "Personal note (optional)"}
          htmlFor={`${id}-message`}
          hint={custom ? "Plain text. Leave a blank line between paragraphs. It starts with “Hi <first name>,” and ends with a link to SHQ." : "Added after the email’s own words."}
        >
          <Textarea id={`${id}-message`} value={message} onChange={event => setMessage(event.target.value)} maxLength={5000} rows={custom ? 8 : 3} />
        </Field>
      </div>
    </Dialog>
  );
}
