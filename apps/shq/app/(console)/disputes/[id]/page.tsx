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
  Input,
  KeyValue,
  Notice,
  PageHeader,
  QueryView,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
  disputeActionLabels,
  disputeKindLabels,
  disputeOutcomeLabels,
  disputeTopicLabels,
  errorMessage,
  formatDateTime,
  formatMoney,
} from "@bitocard/admin-ui";
import { type Dispute, type DisputeAction, useDisputeQuery, useEscalateDisputeMutation, useReplyDisputeMutation, useResolveDisputeMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const statusLabel = (status: string) => ({ open: "With you", escalated: "With BitoCard", contested: "Being contested" })[status];

/** What the store can recommend for this dispute. */
function recommendationsFor(dispute: Dispute): DisputeAction[] {
  if (dispute.kind === "chargeback") return ["contest_chargeback", "accept_chargeback"];
  return [...(dispute.order_id ? (["refund_customer"] as const) : []), "credit_reseller", "reject"];
}

/** "12.50" as minor units, or null when it is not an amount. */
function toMinor(text: string) {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}

function EscalateDialog({ dispute, open, onClose }: { dispute: Dispute; open: boolean; onClose: () => void }) {
  const id = useId();
  const options = recommendationsFor(dispute);
  const [escalate, state] = useEscalateDisputeMutation();
  const [recommendation, setRecommendation] = useState<DisputeAction>(options[0]);
  const [amount, setAmount] = useState("");
  const [report, setReport] = useState("");
  const minor = recommendation === "credit_reseller" ? toMinor(amount) : undefined;
  const valid = report.trim().length >= 10 && (recommendation !== "credit_reseller" || (minor !== null && minor! > 0));
  const close = () => {
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const done = await escalate({ id: dispute.id, recommendation, report: report.trim(), ...(minor ? { amount: minor } : {}) })
      .unwrap()
      .catch(() => null);
    if (done) close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Escalate to BitoCard"
      description="Tell BitoCard what you found and what you recommend. BitoCard decides and executes; it may send it back to you."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} icon={<Send className="size-4" aria-hidden />} loading={state.isLoading} disabled={!valid}>
            Escalate
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Recommendation" htmlFor={`${id}-action`}>
          <Select id={`${id}-action`} value={recommendation} onChange={event => setRecommendation(event.target.value as DisputeAction)}>
            {options.map(option => (
              <option key={option} value={option}>
                {disputeActionLabels[option]}
              </option>
            ))}
          </Select>
        </Field>
        {recommendation === "credit_reseller" ? (
          <Field label={`Amount (${dispute.currency})`} htmlFor={`${id}-amount`} hint="How much BitoCard should credit to your wallet.">
            <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} />
          </Field>
        ) : null}
        <Field label="Your report" htmlFor={`${id}-report`} hint="What you checked and what you found: the order, the delivery, the payment, your contact with the customer.">
          <Textarea id={`${id}-report`} rows={6} maxLength={10000} value={report} onChange={event => setReport(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function ResolveDialog({ dispute, open, onClose }: { dispute: Dispute; open: boolean; onClose: () => void }) {
  const id = useId();
  const [resolve, state] = useResolveDisputeMutation();
  const [note, setNote] = useState("");
  const close = () => {
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (note.trim().length < 3) return;
    const done = await resolve({ id: dispute.id, note: note.trim() })
      .unwrap()
      .catch(() => null);
    if (done) close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Resolve this dispute"
      description="You settled it with the customer and nothing needs BitoCard. Your note is sent to the customer as the last message."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} icon={<CheckCircle2 className="size-4" aria-hidden />} loading={state.isLoading} disabled={note.trim().length < 3}>
            Resolve
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Note to the customer" htmlFor={`${id}-note`}>
          <Textarea id={`${id}-note`} rows={4} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function DisputeView({ dispute, canAct }: { dispute: Dispute; canAct: boolean }) {
  const [reply, replyState] = useReplyDisputeMutation();
  const [escalating, setEscalating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const withYou = dispute.status === "open";
  const hasCustomer = dispute.kind === "customer" || Boolean(dispute.customer_id);
  const money = (minor: number | null) => (minor === null ? "—" : formatMoney(minor, dispute.currency));

  return (
    <>
      <PageHeader
        title={`${dispute.reference}: ${dispute.subject}`}
        description={withYou ? "With you: investigate, answer, then resolve it or escalate it to BitoCard." : dispute.status === "resolved" ? "Resolved." : "With BitoCard: it will decide and tell you."}
        actions={
          canAct && withYou ? (
            <>
              {dispute.kind === "customer" ? (
                <Button variant="secondary" onClick={() => setResolving(true)}>
                  Resolve
                </Button>
              ) : null}
              <Button onClick={() => setEscalating(true)}>Escalate to BitoCard</Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Messages" className="px-0 pt-0 pb-4" />
          <DisputeThread messages={dispute.messages} viewer="reseller" />
          {canAct && dispute.status !== "resolved" ? (
            <div className="mt-5 border-t border-line pt-5">
              <DisputeReply
                staffOption={hasCustomer}
                staffFirst={!hasCustomer}
                error={replyState.error ? errorMessage(replyState.error) : null}
                onSend={async (body, visibility) => Boolean(await reply({ id: dispute.id, body, visibility: hasCustomer ? visibility : "all" }).unwrap().catch(() => null))}
              />
            </div>
          ) : null}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <KeyValue
              items={[
                { label: "Status", value: <StatusBadge status={dispute.status} label={statusLabel(dispute.status)} /> },
                { label: "Type", value: disputeKindLabels[dispute.kind] },
                { label: "About", value: disputeTopicLabels[dispute.topic] },
                ...(dispute.order_id ? [{ label: "Order", value: <Link href={`/orders/${dispute.order_id}`} className="font-semibold text-brand-600 hover:underline">View order</Link> }] : []),
                ...(dispute.customer_reference ? [{ label: "Customer", value: dispute.customer_reference }] : []),
                { label: "Opened", value: formatDateTime(dispute.created_at) },
              ]}
            />
          </Card>
          {dispute.recommendation ? (
            <Card className="p-5">
              <CardHeader title="Your escalation" className="px-0 pt-0 pb-3" />
              <KeyValue
                items={[
                  { label: "Recommended", value: disputeActionLabels[dispute.recommendation] },
                  ...(dispute.recommended_amount ? [{ label: "Amount", value: money(dispute.recommended_amount) }] : []),
                  { label: "Escalated", value: formatDateTime(dispute.escalated_at) },
                ]}
              />
              {dispute.report ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted">{dispute.report}</p> : null}
            </Card>
          ) : null}
          {dispute.outcome ? (
            <Notice tone={dispute.outcome === "rejected" || dispute.outcome === "chargeback_lost" ? "grey" : "green"} title={disputeOutcomeLabels[dispute.outcome]}>
              {[dispute.outcome_amount ? money(dispute.outcome_amount) : null, dispute.outcome_note].filter(Boolean).join(" · ") || "Resolved."}
            </Notice>
          ) : null}
        </div>
      </div>
      <EscalateDialog key={`e-${escalating}`} dispute={dispute} open={escalating} onClose={() => setEscalating(false)} />
      <ResolveDialog key={`r-${resolving}`} dispute={dispute} open={resolving} onClose={() => setResolving(false)} />
    </>
  );
}

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const { membership } = useReseller();
  const allowed = can(membership, "admin", "support", "finance");
  const query = useDisputeQuery(id, { skip: !allowed });
  return (
    <ShqShell section="orders" current="/disputes" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Disputes", href: "/disputes" }, { label: query.data?.reference ?? "Dispute" }]}>
      {allowed ? (
        <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
          {dispute => <DisputeView dispute={dispute} canAct={allowed} />}
        </QueryView>
      ) : (
        <Notice tone="grey" title="No access to disputes">
          Only the owner and admin, support or finance members handle disputes.
        </Notice>
      )}
    </ShqShell>
  );
}
