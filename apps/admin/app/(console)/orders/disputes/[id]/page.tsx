"use client";

import { useId, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
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
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminDispute, type DisputeAction, useAdminDisputeQuery, useExecuteDisputeMutation, useReplyAdminDisputeMutation, useReturnDisputeMutation } from "@bitocard/api-client/admin";

/** Actions that move money: finance only (the API decides). */
const moneyActions = new Set<DisputeAction>(["refund_customer", "credit_reseller", "contest_chargeback", "accept_chargeback"]);

function actionsFor(dispute: AdminDispute): DisputeAction[] {
  if (dispute.kind === "chargeback") return ["contest_chargeback", "accept_chargeback", "reject"];
  return [...(dispute.order_id ? (["refund_customer"] as const) : []), "credit_reseller", "reject"];
}

/** "12.50" as minor units, or null when it is not an amount. */
function toMinor(text: string) {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}

function ExecuteDialog({ dispute, finance, open, onClose }: { dispute: AdminDispute; finance: boolean; open: boolean; onClose: () => void }) {
  const id = useId();
  const options = actionsFor(dispute).filter(action => finance || !moneyActions.has(action));
  const first = dispute.recommendation && options.includes(dispute.recommendation) ? dispute.recommendation : options[0];
  const [execute, state] = useExecuteDisputeMutation();
  const [action, setAction] = useState<DisputeAction>(first);
  const [amount, setAmount] = useState(dispute.recommended_amount ? (dispute.recommended_amount / 100).toFixed(2) : "");
  const [note, setNote] = useState("");
  const minor = action === "credit_reseller" ? toMinor(amount) : undefined;
  const valid = note.trim().length >= 3 && (action !== "credit_reseller" || (minor !== null && minor! > 0));
  const close = () => {
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const done = await execute({ id: dispute.id, action, note: note.trim(), ...(minor ? { amount: minor } : {}) })
      .unwrap()
      .catch(() => null);
    if (done) close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Decide and execute"
      description="What you choose is carried out at once (a refund goes through the order's refund; a credit goes to the reseller's wallet) and is audited. Your note is sent to the reseller and, where there is one, the customer."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} variant={action === "reject" ? "secondary" : "primary"} loading={state.isLoading} disabled={!valid}>
            {disputeActionLabels[action]}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {!finance ? <Notice tone="grey">Refunds, credits and chargeback decisions need a finance admin.</Notice> : null}
        <Field label="Action" htmlFor={`${id}-action`} hint={dispute.recommendation ? `The reseller recommended: ${disputeActionLabels[dispute.recommendation]}.` : undefined}>
          <Select id={`${id}-action`} value={action} onChange={event => setAction(event.target.value as DisputeAction)}>
            {options.map(option => (
              <option key={option} value={option}>
                {disputeActionLabels[option]}
              </option>
            ))}
          </Select>
        </Field>
        {action === "credit_reseller" ? (
          <Field label={`Amount (${dispute.currency})`} htmlFor={`${id}-amount`}>
            <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} />
          </Field>
        ) : null}
        <Field label="Decision note" htmlFor={`${id}-note`}>
          <Textarea id={`${id}-note`} rows={4} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function ReturnDialog({ dispute, open, onClose }: { dispute: AdminDispute; open: boolean; onClose: () => void }) {
  const id = useId();
  const [send, state] = useReturnDisputeMutation();
  const [note, setNote] = useState("");
  const close = () => {
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (note.trim().length < 3) return;
    const done = await send({ id: dispute.id, note: note.trim() })
      .unwrap()
      .catch(() => null);
    if (done) close();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Send back to the reseller"
      description="Ask the reseller to investigate further. Your note is a staff note: the customer never sees it."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} loading={state.isLoading} disabled={note.trim().length < 3}>
            Send back
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="What is missing" htmlFor={`${id}-note`}>
          <Textarea id={`${id}-note`} rows={4} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function DisputeView({ dispute }: { dispute: AdminDispute }) {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const [reply, replyState] = useReplyAdminDisputeMutation();
  const [executing, setExecuting] = useState(false);
  const [returning, setReturning] = useState(false);
  const decidable = dispute.status === "escalated";
  const hasCustomer = Boolean(dispute.customer_id);
  const money = (minor: number | null) => (minor === null ? "—" : formatMoney(minor, dispute.currency));

  return (
    <>
      <PageHeader
        title={`${dispute.reference}: ${dispute.subject}`}
        description={
          decidable
            ? "Waiting for BitoCard's decision."
            : dispute.status === "open"
              ? "With the reseller: they are investigating."
              : dispute.status === "contested"
                ? "BitoCard is contesting this chargeback; the card network's decision closes it."
                : "Resolved."
        }
        actions={
          decidable ? (
            <>
              {dispute.kind !== "reseller" ? (
                <Button variant="secondary" onClick={() => setReturning(true)}>
                  Send back
                </Button>
              ) : null}
              <Button onClick={() => setExecuting(true)}>Decide</Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Messages" className="px-0 pt-0 pb-4" />
          <DisputeThread messages={dispute.messages} viewer="admin" />
          {dispute.status !== "resolved" ? (
            <div className="mt-5 border-t border-line pt-5">
              <DisputeReply
                staffOption={hasCustomer}
                error={replyState.error ? errorMessage(replyState.error) : null}
                onSend={async (body, visibility) => Boolean(await reply({ id: dispute.id, body, visibility }).unwrap().catch(() => null))}
              />
            </div>
          ) : null}
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <KeyValue
              items={[
                { label: "Status", value: <StatusBadge status={dispute.status} /> },
                { label: "Type", value: disputeKindLabels[dispute.kind] },
                { label: "About", value: disputeTopicLabels[dispute.topic] },
                { label: "Reseller", value: <AppLink href={`/resellers/${dispute.reseller_id}`} className="font-semibold text-brand-600 hover:underline">View reseller</AppLink> },
                ...(dispute.order_id ? [{ label: "Order", value: <AppLink href={`/orders/${dispute.order_id}`} className="font-semibold text-brand-600 hover:underline">View order</AppLink> }] : []),
                ...(dispute.chargeback_id ? [{ label: "Chargeback", value: <AppLink href="/orders/chargebacks" className="font-semibold text-brand-600 hover:underline">Chargebacks</AppLink> }] : []),
                ...(dispute.customer_reference ? [{ label: "Customer reference", value: dispute.customer_reference }] : []),
                { label: "Mode", value: dispute.mode === "test" ? "Sandbox" : "Live" },
                { label: "Opened", value: formatDateTime(dispute.created_at) },
              ]}
            />
          </Card>
          {dispute.recommendation ? (
            <Card className="p-5">
              <CardHeader title="Reseller's report" className="px-0 pt-0 pb-3" />
              <KeyValue
                items={[
                  { label: "Recommends", value: disputeActionLabels[dispute.recommendation] },
                  ...(dispute.recommended_amount ? [{ label: "Amount", value: money(dispute.recommended_amount) }] : []),
                  { label: "Escalated", value: formatDateTime(dispute.escalated_at) },
                ]}
              />
              {dispute.report ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink">{dispute.report}</p> : null}
            </Card>
          ) : null}
          {dispute.outcome ? (
            <Notice tone={dispute.outcome === "rejected" || dispute.outcome === "chargeback_lost" || dispute.outcome === "chargeback_accepted" ? "grey" : "green"} title={disputeOutcomeLabels[dispute.outcome]}>
              {[dispute.outcome_amount ? money(dispute.outcome_amount) : null, dispute.outcome_note].filter(Boolean).join(" · ") || "Resolved."}
            </Notice>
          ) : null}
        </div>
      </div>
      <ExecuteDialog key={`e-${executing}`} dispute={dispute} finance={finance} open={executing} onClose={() => setExecuting(false)} />
      <ReturnDialog key={`r-${returning}`} dispute={dispute} open={returning} onClose={() => setReturning(false)} />
    </>
  );
}

export default function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const query = useAdminDisputeQuery(id);
  return (
    <AdminShell section="orders" current="/orders/disputes" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Disputes", href: "/orders/disputes" }, { label: query.data?.reference ?? "Dispute" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {dispute => <DisputeView dispute={dispute} />}
      </QueryView>
    </AdminShell>
  );
}
