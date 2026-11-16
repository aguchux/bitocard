"use client";

import { Suspense, useId, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ActionDialog, Button, Card, DataTable, Dialog, errorMessage, Field, formatMoney, formatRelative, Input, MoneyInput, Notice, PageHeader, StatusBadge, Tabs } from "@bitocard/admin-ui";
import { moneyInputValue, parseMoney } from "@bitocard/api-client/money";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminBankDeposit, type BankDepositStatus, useBankDepositsQuery, useCreditBankDepositMutation, useRejectBankDepositMutation } from "@bitocard/api-client/admin";

const tabs = [
  { value: "sent", label: "To check" },
  { value: "awaiting_payment", label: "Waiting for payment" },
  { value: "credited", label: "Credited" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
] as const satisfies ReadonlyArray<{ value: BankDepositStatus; label: string }>;

const statusLabel: Record<BankDepositStatus, string> = {
  awaiting_payment: "Waiting for payment",
  sent: "Says paid",
  credited: "Credited",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
};

/**
 * Customers' bank deposits: they paid cash into, or transferred to, one of Golojan's accounts and said so. Finance
 * checks the bank for the reference and credits what arrived (after step-up), or rejects it saying why.
 */
export default function BankDepositsPage() {
  return (
    <Suspense fallback={null}>
      <BankDeposits />
    </Suspense>
  );
}

function BankDeposits() {
  const asked = useSearchParams().get("status");
  const [status, setStatus] = useState<BankDepositStatus>(tabs.some(item => item.value === asked) ? (asked as BankDepositStatus) : "sent");
  const [q, setQ] = useState("");
  const list = useBankDepositsQuery({ status, ...(q.trim() ? { q: q.trim() } : {}) });
  const admin = useAdmin();
  const [crediting, setCrediting] = useState<AdminBankDeposit | null>(null);
  const [rejecting, setRejecting] = useState<AdminBankDeposit | null>(null);
  const [reject] = useRejectBankDepositMutation();
  const decidable = (row: AdminBankDeposit) => row.status === "sent" || row.status === "awaiting_payment" || row.status === "expired";

  return (
    <AdminShell section="orders" current="/orders/bank-deposits" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Bank deposits" }]}>
      <PageHeader
        title="Bank deposits"
        description="Customers who paid cash into, or transferred to, Golojan's bank account. Find the reference in the bank's statement, then credit what arrived. Nothing is credited on the customer's word. The accounts are set per market on Settings > Markets."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs label="Show" value={status} onChange={setStatus} items={tabs.map(item => ({ value: item.value, label: item.label }))} />
        <Input aria-label="Search by reference, BD number, sender or customer" placeholder="Reference, BD number, name or email" value={q} onChange={event => setQ(event.target.value)} className="sm:max-w-xs" />
      </div>
      {list.error && !list.data ? <Notice tone="red">{errorMessage(list.error)}</Notice> : null}
      <Card>
        <DataTable
          caption="Bank deposits"
          rows={list.data?.data}
          loading={list.isLoading}
          rowKey={row => row.id}
          empty={status === "sent" ? "Nothing to check." : "None."}
          columns={[
            {
              key: "deposit",
              header: "Deposit",
              cell: row => (
                <div className="space-y-1">
                  <span className="font-semibold">{formatMoney(row.amount, row.currency)}</span>
                  <p className="font-mono text-sm">{row.reference}</p>
                  <p className="text-xs text-muted">{`${row.number} · ${row.country}${row.mode === "test" ? " · Sandbox" : ""}`}</p>
                </div>
              ),
            },
            {
              key: "customer",
              header: "Customer",
              cell: row =>
                row.customer ? (
                  <div className="space-y-0.5 text-sm">
                    <AppLink href={`/storefront/customers/${row.customer.id}`} className="font-semibold hover:underline">
                      {row.customer.name}
                    </AppLink>
                    <p className="text-xs text-muted">{`${row.customer.email} · ${row.customer.store}`}</p>
                  </div>
                ) : null,
            },
            {
              key: "paid",
              header: "Paid",
              hideOnMobile: true,
              cell: row => (
                <div className="space-y-0.5 text-sm">
                  <p>{`${row.account.bank_name} ${row.account.account_number}`}</p>
                  {row.sent_at ? <p className="text-xs text-muted">{`${row.method === "cash" ? "Cash" : "Transfer"} from ${row.sender_name}, ${formatRelative(row.sent_at)}`}</p> : <p className="text-xs text-muted">{`Asked ${formatRelative(row.created_at)}`}</p>}
                  {row.note ? <p className="text-xs text-muted">{`“${row.note}”`}</p> : null}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: row => (
                <div className="space-y-1">
                  <StatusBadge status={row.status} label={statusLabel[row.status]} />
                  {row.status === "credited" && row.credited_amount !== null ? <p className="text-xs text-muted">{`${formatMoney(row.credited_amount, row.currency)}${row.decided_by?.name ? ` by ${row.decided_by.name}` : ""}`}</p> : null}
                  {row.status === "rejected" && row.decision_note ? <p className="text-xs text-muted">{row.decision_note}</p> : null}
                </div>
              ),
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: row =>
                decidable(row) ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {can(admin, "finance") ? (
                      <Button size="sm" onClick={() => setCrediting(row)}>
                        Credit
                      </Button>
                    ) : null}
                    {can(admin, "finance", "operations") ? (
                      <Button size="sm" variant="secondary" onClick={() => setRejecting(row)}>
                        Reject
                      </Button>
                    ) : null}
                  </div>
                ) : null,
            },
          ]}
        />
      </Card>
      {crediting ? <CreditDialog deposit={crediting} onClose={() => setCrediting(null)} /> : null}
      <ActionDialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject this deposit"
        description="Nothing is added to the customer's wallet. They see the reason, so say what you found (for example, no deposit with this reference reached the account)."
        confirmLabel="Reject"
        tone="danger"
        onConfirm={reason => reject({ id: rejecting!.id, reason }).unwrap()}
      />
    </AdminShell>
  );
}

/** Credits what arrived: the amount asked for unless the bank shows otherwise, with the bank's own reference. */
function CreditDialog({ deposit, onClose }: { deposit: AdminBankDeposit; onClose: () => void }) {
  const id = useId();
  const [credit, state] = useCreditBankDepositMutation();
  const [amount, setAmount] = useState(moneyInputValue(deposit.amount, deposit.currency));
  const [external, setExternal] = useState("");
  const [note, setNote] = useState("");
  const minor = parseMoney(amount, deposit.currency);
  const valid = minor !== null && minor > 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    await credit({ id: deposit.id, amount: minor, ...(external.trim() ? { external_reference: external.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) })
      .unwrap()
      .then(onClose)
      .catch(() => undefined);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Credit ${deposit.reference}`}
      description={`Only once ${deposit.account.bank_name} ${deposit.account.account_number} shows the money with this reference. It goes into the customer's ${deposit.currency} wallet at once, and cannot be undone here.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} loading={state.isLoading} disabled={!valid}>
            {valid ? `Credit ${formatMoney(minor, deposit.currency)}` : "Credit"}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label={`Amount that arrived (${deposit.currency})`} htmlFor={`${id}-amount`} hint={`The customer asked to add ${formatMoney(deposit.amount, deposit.currency)}.`}>
          <MoneyInput id={`${id}-amount`} currency={deposit.currency} value={amount} onValueChange={setAmount} aria-invalid={!valid || undefined} />
        </Field>
        <Field label="Bank's reference (optional)" htmlFor={`${id}-ref`}>
          <Input id={`${id}-ref`} value={external} maxLength={120} onChange={event => setExternal(event.target.value)} />
        </Field>
        <Field label="Note (optional)" htmlFor={`${id}-note`}>
          <Input id={`${id}-note`} value={note} maxLength={300} onChange={event => setNote(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
