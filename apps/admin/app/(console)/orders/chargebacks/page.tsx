"use client";

import { useId, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { ActionDialog, Badge, Button, Card, DataTable, Dialog, errorMessage, Field, formatDateTime, formatMoney, formatRelative, Input, Notice, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type Chargeback, type ChargebackStatus, useChargebacksQuery, useClearChargebackMutation, useRecordChargebackMutation, useResolveChargebackMutation } from "@bitocard/api-client/admin";

const filters = [
  { value: "open", label: "Open" },
  { value: "lost", label: "Lost" },
  { value: "won", label: "Won" },
  { value: "all", label: "All" },
] as const;

type Filter = (typeof filters)[number]["value"];
type Pending = { dispute: Chargeback; action: "won" | "lost" | "clear" };

/** "12.50" in the payment's currency as minor units, or null when it is not an amount. */
function toMinor(text: string) {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}

/** Finance records a dispute it sees in another gateway's dashboard (Stripe's arrive by themselves). */
function RecordChargeback({ open, onClose }: { open: boolean; onClose: () => void }) {
  const id = useId();
  const [record, state] = useRecordChargebackMutation();
  const [paymentId, setPaymentId] = useState("");
  const [disputeId, setDisputeId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const minor = amount.trim() ? toMinor(amount) : undefined;
  const valid = /^[0-9a-f-]{36}$/i.test(paymentId.trim()) && disputeId.trim().length > 0 && reason.trim().length >= 5 && minor !== null;

  const close = () => {
    setPaymentId("");
    setDisputeId("");
    setAmount("");
    setReason("");
    state.reset();
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const done = await record({ payment_id: paymentId.trim(), provider_dispute_id: disputeId.trim(), reason: reason.trim(), ...(minor ? { amount: minor } : {}) })
      .unwrap()
      .catch(() => null);
    if (done) close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Record a chargeback"
      description="For a chargeback shown in Flutterwave's or Monnify's dashboard. The amount is held from the reseller's wallet at once, unless their plan has chargeback protection."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} loading={state.isLoading} disabled={!valid}>
            Record chargeback
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Payment ID" htmlFor={`${id}-payment`} hint="The BitoCard payment (top-up or checkout) that was disputed.">
          <Input id={`${id}-payment`} autoComplete="off" value={paymentId} onChange={event => setPaymentId(event.target.value)} />
        </Field>
        <Field label="Gateway dispute ID" htmlFor={`${id}-dispute`} hint="As the gateway shows it, so the dispute is recorded once.">
          <Input id={`${id}-dispute`} autoComplete="off" maxLength={200} value={disputeId} onChange={event => setDisputeId(event.target.value)} />
        </Field>
        <Field label="Disputed amount" htmlFor={`${id}-amount`} hint="In the payment's currency. Leave empty for the whole payment.">
          <Input id={`${id}-amount`} inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} />
        </Field>
        <Field label="Reason" htmlFor={`${id}-reason`} hint="Recorded in the activity log.">
          <Input id={`${id}-reason`} autoComplete="off" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * Card payment disputes (chargebacks) on payments into BitoCard's own gateways. While one is open its amount is held
 * from the reseller's wallet and their withdrawals wait; finance records other gateways' disputes, decides them, and
 * clears a lost dispute's shortfall once it is settled with the reseller.
 */
export default function ChargebacksPage() {
  const admin = useAdmin();
  const finance = can(admin, "finance");
  const [filter, setFilter] = useState<Filter>("open");
  const query = useChargebacksQuery(filter === "all" ? {} : { status: filter as ChargebackStatus });
  const [resolve] = useResolveChargebackMutation();
  const [clear] = useClearChargebackMutation();
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = async (reason: string) => {
    if (!pending) return;
    if (pending.action === "clear") await clear({ id: pending.dispute.id, reason }).unwrap();
    else await resolve({ id: pending.dispute.id, outcome: pending.action, reason }).unwrap();
  };

  return (
    <AdminShell section="orders" current="/orders/chargebacks" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Chargebacks" }]}>
      <PageHeader
        title="Chargebacks"
        description="Chargebacks on payments into BitoCard's gateways. Stripe's arrive by themselves; record other gateways' here. While a dispute is open its amount is held from the reseller's wallet and their withdrawals wait."
        actions={
          finance ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setRecording(true)}>
              Record chargeback
            </Button>
          ) : null
        }
      />
      <Tabs label="Show" value={filter} onChange={setFilter} items={filters.map(item => ({ value: item.value, label: item.label }))} />
      <Card>
        <DataTable
          caption="Chargebacks"
          rows={query.isLoading ? undefined : query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          empty={filter === "open" ? "No open chargebacks." : "No chargebacks."}
          columns={[
            { key: "opened", header: "Opened", cell: row => <span title={formatDateTime(row.opened_at)}>{formatRelative(row.opened_at)}</span> },
            {
              key: "dispute",
              header: "Chargeback",
              cell: row => (
                <div className="space-y-0.5">
                  <span className="font-medium capitalize">{row.provider}</span>
                  <p className="font-mono text-xs text-muted">{row.provider_dispute_id}</p>
                  {row.reason ? <p className="text-xs text-subtle">{row.reason}</p> : null}
                </div>
              ),
            },
            {
              key: "reseller",
              header: "Reseller",
              cell: row => (
                <AppLink href={`/resellers/${row.reseller_id}`} className="font-semibold text-brand-600 hover:underline">
                  View reseller
                </AppLink>
              ),
              hideOnMobile: true,
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              cell: row => (
                <div className="space-y-0.5 text-right">
                  <span className="font-semibold">{formatMoney(row.amount, row.currency)}</span>
                  {row.protected ? (
                    <p className="text-xs text-muted">Chargeback protection</p>
                  ) : (
                    <p className="text-xs text-muted">{`Held ${formatMoney(row.held, row.currency)}${row.shortfall ? ` · short ${formatMoney(row.shortfall, row.currency)}` : ""}`}</p>
                  )}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: row => (
                <div className="space-y-1">
                  <StatusBadge status={row.status} />
                  {row.mode === "test" ? <Badge tone="amber">Sandbox</Badge> : null}
                  {row.status === "lost" && row.shortfall && !row.protected ? (
                    <p className="text-xs text-muted">{row.cleared_at ? `Cleared ${formatRelative(row.cleared_at)}` : "Withdrawals wait until cleared"}</p>
                  ) : null}
                </div>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: row =>
                !finance ? null : row.status === "open" ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setPending({ dispute: row, action: "won" })}>
                      Won
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setPending({ dispute: row, action: "lost" })}>
                      Lost
                    </Button>
                  </div>
                ) : row.status === "lost" && row.shortfall && !row.protected && !row.cleared_at ? (
                  <Button variant="secondary" size="sm" onClick={() => setPending({ dispute: row, action: "clear" })}>
                    Clear shortfall
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
      <RecordChargeback open={recording} onClose={() => setRecording(false)} />
      <ActionDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.action === "won" ? "Chargeback won" : pending?.action === "lost" ? "Chargeback lost" : "Clear the shortfall"}
        description={
          pending?.action === "won"
            ? "The card network decided for the merchant: the held amount goes back to the reseller's wallet."
            : pending?.action === "lost"
              ? "The card network decided for the cardholder: the held amount repays the gateway, and BitoCard bears anything the wallet did not cover."
              : "The shortfall has been settled with the reseller (or written off): their withdrawals can resume."
        }
        confirmLabel={pending?.action === "won" ? "Mark won" : pending?.action === "lost" ? "Mark lost" : "Clear"}
        tone={pending?.action === "lost" ? "danger" : "primary"}
        onConfirm={confirm}
      />
    </AdminShell>
  );
}
