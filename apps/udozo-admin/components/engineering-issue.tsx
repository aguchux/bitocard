"use client";

import { useState } from "react";
import { Bug, ExternalLink } from "lucide-react";
import { Button, Card, CardHeader, Dialog, Field, Input, Notice, Select, Textarea, errorMessage } from "@bitocard/admin-ui";
import { type AdminTicket, useCreateTicketIssueMutation, useLazyTicketIssueDraftQuery } from "@bitocard/api-client/admin";

/**
 * Engineering on a ticket: its GitHub issue (number, state, link), or Escalate to engineering, which drafts the issue
 * (Udozo's AI, else a template) for the admin to edit before it is opened. Nothing personal leaves Udozo.
 */
export function EngineeringIssue({ ticket, canEscalate }: { ticket: AdminTicket; canEscalate: boolean }) {
  const [loadDraft, draftState] = useLazyTicketIssueDraftQuery();
  const [create, createState] = useCreateTicketIssueMutation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"bug" | "feature">("bug");
  const issue = ticket.github_issue;

  const start = async () => {
    setOpen(true);
    const draft = await loadDraft(ticket.id).unwrap().catch(() => null);
    if (draft) {
      setTitle(draft.title);
      setBody(draft.body);
    }
  };
  const close = () => {
    createState.reset();
    setOpen(false);
  };

  return (
    <Card className="space-y-3 p-5">
      <CardHeader title="Engineering" className="px-0 pt-0 pb-0" />
      {issue ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Bug className="size-4 text-muted" aria-hidden />
          {`Issue #${issue.number} · ${issue.state === "closed" ? "closed" : "open"}`}
          {issue.url ? (
            <a href={issue.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
              Open on GitHub <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </p>
      ) : canEscalate ? (
        <>
          <p className="text-sm text-muted">A bug or a missing feature? Open a GitHub issue for the engineers. When it is closed, this ticket comes back to you to confirm the fix.</p>
          <Button variant="secondary" size="sm" icon={<Bug className="size-4" aria-hidden />} onClick={() => void start()}>
            Escalate to engineering
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted">No engineering issue.</p>
      )}
      <Dialog
        open={open}
        onClose={close}
        title="Escalate to engineering"
        description={draftState.data?.drafted_by === "ai" ? "Drafted by Udozo’s AI from the ticket: check it, then open the issue." : "Fill in the steps, then open the issue."}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              loading={createState.isLoading}
              disabled={title.trim().length < 5 || body.trim().length < 10}
              onClick={async () => {
                if (await create({ id: ticket.id, title: title.trim(), body: body.trim(), kind }).unwrap().catch(() => null)) close();
              }}
            >
              Open issue
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {draftState.isFetching ? <p className="text-sm text-muted">Drafting from the ticket…</p> : null}
          {draftState.error ? <Notice tone="red">{errorMessage(draftState.error)}</Notice> : null}
          {createState.error ? <Notice tone="red">{errorMessage(createState.error)}</Notice> : null}
          <Notice tone="blue">No names, emails, phone numbers, codes or account numbers: they are removed again before the issue is sent.</Notice>
          <Field label="Kind" htmlFor="issue-kind">
            <Select id="issue-kind" value={kind} onChange={event => setKind(event.target.value as "bug" | "feature")}>
              <option value="bug">Bug</option>
              <option value="feature">Feature request</option>
            </Select>
          </Field>
          <Field label="Title" htmlFor="issue-title">
            <Input id="issue-title" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} />
          </Field>
          <Field label="Details" htmlFor="issue-body">
            <Textarea id="issue-body" rows={12} className="font-mono text-xs" maxLength={20000} value={body} onChange={event => setBody(event.target.value)} />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}
